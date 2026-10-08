-- ============================================================================
-- VIMDY OS — CAJA FINAL HARDENING
-- ============================================================================
-- Objetivo:
--   1. Aislamiento multi-tenant real de idempotency_key.
--   2. SECURITY DEFINER correctamente cerrada.
--   3. Validaciones server-side de movimientos.
--   4. Idempotencia sin sobrescribir silenciosamente un movimiento existente.
--   5. Cierre atómico de turno.
-- ============================================================================

-- ============================================================================
-- 0. DEPENDENCY GUARD
-- ----------------------------------------------------------------------------
-- Esta migración reemplaza register_movement_atomic() creada en
-- 20260923_cash_hardening.sql. Supabase aplica migraciones en orden
-- alfabético: "20260923190000_..." ordena ANTES que "20260923_..."
-- (dígito '1' < underscore '_' en ASCII), por lo que esta migración puede
-- ejecutarse antes que la original. Este guardián asegura que las columnas
-- y el constraint requeridos existan, usando IF NOT EXISTS para ser
-- idempotente: si la migración original ya se aplicó, es un no-op.
-- ============================================================================

ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS data_date timestamptz
  GENERATED ALWAYS AS ((data->>'date')::timestamptz) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS shifts_single_open_per_business_branch
  ON shifts (business_id, branch_id)
  WHERE (data->>'status') = 'OPEN';

-- ============================================================================
-- 1. VALIDAR DUPLICADOS ANTES DE CREAR EL NUEVO ÍNDICE
-- ============================================================================
-- Si ya existen claves idempotentes duplicadas DENTRO DEL MISMO business +
-- branch, la migration DEBE FALLAR explícitamente. No se elimina ni modifica
-- ningún movimiento automáticamente: el equipo de datos debe resolverlo a
-- mano antes de aplicar esta migration.
DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*)
  INTO duplicate_count
  FROM (
    SELECT business_id, branch_id, idempotency_key
    FROM cash_movements
    WHERE idempotency_key IS NOT NULL
    GROUP BY business_id, branch_id, idempotency_key
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'CAJA_MIGRATION_ABORTED: existen % claves idempotentes duplicadas dentro del mismo business/branch. Resolver manualmente antes de aplicar esta migration.',
      duplicate_count;
  END IF;
END $$;


-- ============================================================================
-- 2. CAMBIAR IDEMPOTENCIA GLOBAL → BUSINESS + BRANCH
-- ============================================================================
-- El índice anterior (cash_movements_idempotency_key_idx) era global: permitía
-- que dos negocios distintos usaran la misma idempotency_key sin colisión, lo
-- cual es CORRECTO (no deben interferirse), pero el índice global no reflejaba
-- el aislamiento real que la nueva RPC aplica. Con el índice anterior, la
-- cláusula ON CONFLICT (business_id, branch_id, idempotency_key) no podía
-- encontrarse porque el índice no cubría esa combinación.
--
-- Nuevo índice parcial: único SOLO cuando idempotency_key y branch_id son
-- NOT NULL (movimientos de venta manual siempre aportan ambos). Los
-- movimientos con idempotency_key=NULL o branch_id=NULL no participan del
-- conflicto y se insertan libremente.
DROP INDEX IF EXISTS cash_movements_idempotency_key_idx;

CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_business_branch_idempotency_idx
ON cash_movements (
  business_id,
  branch_id,
  idempotency_key
)
WHERE idempotency_key IS NOT NULL
  AND branch_id IS NOT NULL;


-- ============================================================================
-- 3. RPC register_movement_atomic()
-- ============================================================================
-- REPLACE de la función creada en 20260923_cash_hardening.sql.
--
-- Cambios críticos:
--   - LANGUAGE plpgsql (antes sql) para poder validar antes de insertar.
--   - SECURITY DEFINER + SET search_path = public (defensa contra inyección
--     de search_path).
--   - ON CONFLICT ... DO NOTHING (antes DO UPDATE): un retry devuelve el
--     movimiento ORIGINAL sin modificarlo. Nunca pisa datos financieros.
--   - Validaciones server-side: auth.uid(), membresía, sucursal, monto,
--     método de pago, reglas de efectivo.
--   - Revoke + Grant explícitos para PUBLIC → authenticated.
CREATE OR REPLACE FUNCTION public.register_movement_atomic(
  p_idempotency_key text,
  p_business_id uuid,
  p_branch_id uuid,
  p_type text,
  p_amount numeric,
  p_description text,
  p_payment_method text DEFAULT 'CASH',
  p_cash_amount numeric DEFAULT 0,
  p_sale_id text DEFAULT NULL,
  p_created_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  movement_id text,
  idempotency_key text,
  type text,
  amount numeric,
  description text,
  date timestamptz,
  payment_method text,
  cash_amount numeric,
  business_id uuid,
  branch_id uuid,
  sale_id text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id text;
BEGIN

  -- ----------------------------------------------------------
  -- AUTH OBLIGATORIA
  -- ----------------------------------------------------------

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'CAJA_AUTH_REQUIRED: se requiere usuario autenticado.';
  END IF;


  -- ----------------------------------------------------------
  -- VALIDACIÓN BUSINESS
  -- ----------------------------------------------------------

  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'CAJA_BUSINESS_REQUIRED: business_id es obligatorio.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM business_members
    WHERE business_id = p_business_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'CAJA_NOT_A_MEMBER: el usuario no pertenece a este negocio.';
  END IF;


  -- ----------------------------------------------------------
  -- AUTORIZACIÓN RBAC SERVER-SIDE
  -- ----------------------------------------------------------
  -- Solo los roles con permiso 'cash.registerMovement' pueden registrar
  -- movimientos. Según rolePermissions.ts y seedIdentity.ts, esos roles
  -- son: ADMIN, CAJERO. GERENTE/CONTADOR/etc. NO pueden registrar movimientos
  -- de caja. La autorización crítica es server-side: has_business_role()
  -- consulta business_members.role directamente en la base de datos.
  -- -------------------------------------------------------------------

  IF NOT public.has_business_role(p_business_id, array['ADMIN', 'CAJERO']) THEN
    RAISE EXCEPTION 'CAJA_FORBIDDEN: permiso cash.registerMovement requerido (rol ADMIN o CAJERO).';
  END IF;


  -- ----------------------------------------------------------
  -- VALIDACIÓN BRANCH
  -- ----------------------------------------------------------

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'CAJA_BRANCH_REQUIRED: branch_id es obligatorio.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM branches
    WHERE id = p_branch_id
      AND business_id = p_business_id
      AND active = true
  ) THEN
    RAISE EXCEPTION 'CAJA_INVALID_BRANCH: la sucursal no pertenece al negocio o está inactiva.';
  END IF;


  -- ----------------------------------------------------------
  -- VALIDACIONES FINANCIERAS
  -- ----------------------------------------------------------

  IF p_type NOT IN ('IN', 'OUT') THEN
    RAISE EXCEPTION 'CAJA_INVALID_TYPE: type debe ser IN u OUT.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'CAJA_INVALID_AMOUNT: amount debe ser mayor que cero.';
  END IF;

  IF p_cash_amount IS NULL OR p_cash_amount < 0 THEN
    RAISE EXCEPTION 'CAJA_INVALID_CASH_AMOUNT: cash_amount no puede ser negativo.';
  END IF;

  IF p_payment_method NOT IN ('CASH', 'CARD', 'TRANSFER', 'QR', 'MIXED') THEN
    RAISE EXCEPTION 'CAJA_INVALID_PAYMENT_METHOD: método de pago no permitido.';
  END IF;


  -- ----------------------------------------------------------
  -- REGLAS DE EFECTIVO
  -- ----------------------------------------------------------

  IF p_type = 'OUT' THEN

    IF p_payment_method <> 'CASH' THEN
      RAISE EXCEPTION 'CAJA_INVALID_EXPENSE_METHOD: un egreso de caja debe ser CASH.';
    END IF;

    IF p_cash_amount <> p_amount THEN
      RAISE EXCEPTION 'CAJA_INVALID_EXPENSE_CASH: un egreso debe salir completamente de efectivo.';
    END IF;

  ELSE

    IF p_payment_method = 'CASH'
       AND p_cash_amount <> p_amount THEN
      RAISE EXCEPTION 'CAJA_INVALID_CASH_INCOME: un ingreso CASH debe tener cash_amount igual a amount.';
    END IF;

    IF p_payment_method IN ('CARD', 'TRANSFER', 'QR')
       AND p_cash_amount <> 0 THEN
      RAISE EXCEPTION 'CAJA_INVALID_NON_CASH_AMOUNT: CARD/TRANSFER/QR deben tener cash_amount = 0.';
    END IF;

    IF p_payment_method = 'MIXED'
       AND p_cash_amount > p_amount THEN
      RAISE EXCEPTION 'CAJA_INVALID_MIXED_CASH: cash_amount no puede superar amount.';
    END IF;

  END IF;


  -- ----------------------------------------------------------
  -- IDEMPOTENCY KEY
  -- ----------------------------------------------------------

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'CAJA_IDEMPOTENCY_REQUIRED: toda operación persistida debe tener idempotency_key.';
  END IF;


  -- ----------------------------------------------------------
  -- INSERT IDEMPOTENTE
  --
  -- IMPORTANTE:
  -- NO hacemos DO UPDATE.
  -- Un reintento devuelve exactamente el movimiento original.
  -- Nunca permitimos que un retry cambie monto, método o descripción.
  -- ----------------------------------------------------------

  INSERT INTO cash_movements (
    id,
    idempotency_key,
    business_id,
    branch_id,
    data
  )
  VALUES (
    gen_random_uuid(),
    p_idempotency_key,
    p_business_id,
    p_branch_id,
    jsonb_build_object(
      'id', p_idempotency_key,
      'idempotencyKey', p_idempotency_key,
      'type', p_type,
      'amount', p_amount,
      'description', p_description,
      'date', p_created_at,
      'paymentMethod', p_payment_method,
      'cashAmount', p_cash_amount,
      'saleId', p_sale_id,
      'createdAt', p_created_at,
      'businessId', p_business_id::text,
      'branchId', p_branch_id::text
    )
  )
  ON CONFLICT (
    business_id,
    branch_id,
    idempotency_key
  )
  WHERE idempotency_key IS NOT NULL
    AND branch_id IS NOT NULL
  DO NOTHING;


  -- ----------------------------------------------------------
  -- DEVOLVER SIEMPRE EL MOVIMIENTO EXISTENTE/CREADO
  -- ----------------------------------------------------------

  RETURN QUERY
  SELECT
    cm.id::text AS movement_id,
    cm.idempotency_key,
    cm.data->>'type',
    (cm.data->>'amount')::numeric,
    cm.data->>'description',
    (cm.data->>'date')::timestamptz,
    cm.data->>'paymentMethod',
    (cm.data->>'cashAmount')::numeric,
    cm.business_id,
    cm.branch_id,
    cm.data->>'saleId',
    (cm.data->>'createdAt')::timestamptz
  FROM cash_movements cm
  WHERE cm.business_id = p_business_id
    AND cm.branch_id = p_branch_id
    AND cm.idempotency_key = p_idempotency_key
  LIMIT 1;

END;
$$;


REVOKE ALL ON FUNCTION public.register_movement_atomic(
  text,
  uuid,
  uuid,
  text,
  numeric,
  text,
  text,
  numeric,
  text,
  timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.register_movement_atomic(
  text,
  uuid,
  uuid,
  text,
  numeric,
  text,
  text,
  numeric,
  text,
  timestamptz
) TO authenticated;


COMMENT ON FUNCTION public.register_movement_atomic IS
'Caja: movimiento atómico e idempotente, aislado por business_id + branch_id, con validación de membresía, sucursal, monto y método. Nunca sobreescribe silenciosamente una operación existente.';


-- ============================================================================
-- 4. RPC DE CIERRE ATÓMICO DE TURNO
-- ============================================================================
-- Cierra un turno de caja de forma atómica en servidor:
--   1. Bloquea el turno (FOR UPDATE) para evitar cierres concurrentes.
--   2. Valida que el usuario pertenezca al negocio y a la sucursal.
--   3. Verifica que el turno esté en estado OPEN.
--   4. Calcula ingresos, egresos, efectivo esperado y diferencia.
--   5. Actualiza el turno a CLOSED con el arqueo completo en una sola
--      transacción (version-based optimistic lock).
CREATE OR REPLACE FUNCTION public.close_shift_atomic(
  p_shift_id uuid,
  p_counted_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(
  shift_id uuid,
  data jsonb,
  version integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_business_id uuid;
  v_shift_branch_id uuid;
  v_shift_data jsonb;
  v_shift_version integer;
  v_status text;
  v_opened_at timestamptz;
  v_closed_at timestamptz := clock_timestamp();

  v_total_income numeric := 0;
  v_total_expense numeric := 0;
  v_total_cash_income numeric := 0;
  v_expected_amount numeric := 0;
  v_difference numeric := 0;

  v_income_by_method jsonb := '{}'::jsonb;
  v_new_data jsonb;
BEGIN

  -- ----------------------------------------------------------
  -- AUTH
  -- ----------------------------------------------------------

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SHIFT_AUTH_REQUIRED: se requiere usuario autenticado.';
  END IF;

  IF p_counted_amount IS NULL OR p_counted_amount < 0 THEN
    RAISE EXCEPTION 'SHIFT_INVALID_COUNTED_AMOUNT: el monto contado no puede ser negativo.';
  END IF;


  -- ----------------------------------------------------------
  -- BLOQUEO DEL TURNO
  -- ----------------------------------------------------------

  SELECT
    s.business_id,
    s.branch_id,
    s.data,
    s.version
  INTO
    v_shift_business_id,
    v_shift_branch_id,
    v_shift_data,
    v_shift_version
  FROM shifts s
  WHERE s.id = p_shift_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIFT_NOT_FOUND: turno inexistente.';
  END IF;


  -- ----------------------------------------------------------
  -- SEGURIDAD MULTI-TENANT
  -- ----------------------------------------------------------

  IF NOT EXISTS (
    SELECT 1
    FROM business_members
    WHERE business_id = v_shift_business_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'SHIFT_NOT_A_MEMBER: el usuario no pertenece al negocio.';
  END IF;

  -- ----------------------------------------------------------
  -- AUTORIZACIÓN RBAC SERVER-SIDE
  -- ----------------------------------------------------------
  -- Solo los roles con permiso 'shift.close' pueden cerrar turnos.
  -- Según rolePermissions.ts y seedIdentity.ts, esos roles son:
  -- ADMIN, CAJERO. GERENTE/CONTADOR/etc. NO pueden cerrar turnos.
  -- La autorización crítica es server-side: has_business_role()
  -- consulta business_members.role directamente en la base de datos.
  -- -------------------------------------------------------------------

  IF NOT public.has_business_role(v_shift_business_id, array['ADMIN', 'CAJERO']) THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: permiso shift.close requerido (rol ADMIN o CAJERO).';
  END IF;

  IF v_shift_branch_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM branches
       WHERE id = v_shift_branch_id
         AND business_id = v_shift_business_id
         AND active = true
     ) THEN
    RAISE EXCEPTION 'SHIFT_INVALID_BRANCH: sucursal inválida.';
  END IF;


  -- ----------------------------------------------------------
  -- ESTADO
  -- ----------------------------------------------------------

  v_status := v_shift_data->>'status';

  IF v_status = 'CLOSED' THEN
    RAISE EXCEPTION 'SHIFT_ALREADY_CLOSED: este turno ya fue cerrado.';
  END IF;

  IF v_status <> 'OPEN' THEN
    RAISE EXCEPTION 'SHIFT_NOT_OPEN: el turno no está abierto.';
  END IF;

  v_opened_at := (v_shift_data->>'openedAt')::timestamptz;

  IF v_opened_at IS NULL THEN
    RAISE EXCEPTION 'SHIFT_INVALID_OPENED_AT: el turno no tiene openedAt válido.';
  END IF;


  -- ----------------------------------------------------------
  -- INGRESOS TOTALES
  -- ----------------------------------------------------------

  SELECT COALESCE(SUM(
    CASE
      WHEN cm.data->>'type' = 'IN'
      THEN (cm.data->>'amount')::numeric
      ELSE 0
    END
  ), 0)
  INTO v_total_income
  FROM cash_movements cm
  WHERE cm.business_id = v_shift_business_id
    AND cm.branch_id = v_shift_branch_id
    AND cm.data_date >= v_opened_at
    AND cm.data_date <= v_closed_at;


  -- ----------------------------------------------------------
  -- INGRESOS FÍSICOS DE EFECTIVO
  -- ----------------------------------------------------------

  SELECT COALESCE(SUM(
    CASE
      WHEN cm.data->>'type' = 'IN'
      THEN COALESCE((cm.data->>'cashAmount')::numeric, 0)
      ELSE 0
    END
  ), 0)
  INTO v_total_cash_income
  FROM cash_movements cm
  WHERE cm.business_id = v_shift_business_id
    AND cm.branch_id = v_shift_branch_id
    AND cm.data_date >= v_opened_at
    AND cm.data_date <= v_closed_at;


  -- ----------------------------------------------------------
  -- EGRESOS
  -- ----------------------------------------------------------

  SELECT COALESCE(SUM(
    CASE
      WHEN cm.data->>'type' = 'OUT'
      THEN (cm.data->>'amount')::numeric
      ELSE 0
    END
  ), 0)
  INTO v_total_expense
  FROM cash_movements cm
  WHERE cm.business_id = v_shift_business_id
    AND cm.branch_id = v_shift_branch_id
    AND cm.data_date >= v_opened_at
    AND cm.data_date <= v_closed_at;


  -- ----------------------------------------------------------
  -- DESGLOSE POR MÉTODO
  -- ----------------------------------------------------------

  SELECT COALESCE(
    jsonb_object_agg(method, total),
    '{}'::jsonb
  )
  INTO v_income_by_method
  FROM (
    SELECT
      COALESCE(cm.data->>'paymentMethod', 'CASH') AS method,
      SUM((cm.data->>'amount')::numeric) AS total
    FROM cash_movements cm
    WHERE cm.business_id = v_shift_business_id
      AND cm.branch_id = v_shift_branch_id
      AND cm.data_date >= v_opened_at
      AND cm.data_date <= v_closed_at
      AND cm.data->>'type' = 'IN'
    GROUP BY COALESCE(cm.data->>'paymentMethod', 'CASH')
  ) methods;


  -- ----------------------------------------------------------
  -- ARQUEO
  -- ----------------------------------------------------------

  v_expected_amount :=
      COALESCE((v_shift_data->>'openingAmount')::numeric, 0)
      + v_total_cash_income
      - v_total_expense;

  v_difference := p_counted_amount - v_expected_amount;


  -- ----------------------------------------------------------
  -- NUEVO ESTADO
  -- ----------------------------------------------------------

  v_new_data :=
    v_shift_data
    || jsonb_build_object(
      'status', 'CLOSED',
      'totalIncome', v_total_income,
      'totalExpense', v_total_expense,
      'totalCashIncome', v_total_cash_income,
      'incomeByMethod', v_income_by_method,
      'expectedAmount', v_expected_amount,
      'countedAmount', p_counted_amount,
      'difference', v_difference,
      'closedAt', v_closed_at,
      'closingNotes', p_notes
    );


  -- ----------------------------------------------------------
  -- ACTUALIZACIÓN ATÓMICA
  -- ----------------------------------------------------------

  UPDATE shifts
  SET
    data = v_new_data,
    version = v_shift_version + 1,
    updated_at = v_closed_at
  WHERE id = p_shift_id
    AND version = v_shift_version
    AND business_id = v_shift_business_id
    AND branch_id = v_shift_branch_id
    AND data->>'status' = 'OPEN';


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'SHIFT_CLOSE_CONFLICT: el turno cambió mientras se intentaba cerrar.';
  END IF;


  RETURN QUERY
  SELECT
    p_shift_id,
    v_new_data,
    v_shift_version + 1;

END;
$$;


REVOKE ALL ON FUNCTION public.close_shift_atomic(
  uuid,
  numeric,
  text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.close_shift_atomic(
  uuid,
  numeric,
  text
) TO authenticated;


COMMENT ON FUNCTION public.close_shift_atomic IS
'Caja: cierre atómico de turno. Bloquea el turno, calcula ingresos/egresos/efectivo/esperado, registra arqueo y cambia OPEN→CLOSED en una sola transacción.';
