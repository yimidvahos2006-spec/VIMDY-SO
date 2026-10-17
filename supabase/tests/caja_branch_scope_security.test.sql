-- =============================================================================
-- VIMDY OS — CAJA: aislamiento estricto por sucursal e idempotencia financiera
-- =============================================================================
-- Motivos:
--   * Los RPC Enterprise de Caja eran SECURITY DEFINER y algunos validaban
--     membresía/rol del negocio, pero no que el usuario tuviera acceso a la
--     sucursal indicada. Eso permitía operar con IDs de otra sucursal del
--     mismo negocio y reintentar algunas RPC para leer resultados.
--   * Las policies de cajas, arqueos y transferencias solo comprobaban la
--     membresía del negocio, no la asignación efectiva a la sucursal.
--   * register_movement_atomic devolvía un movimiento existente para una clave
--     idempotente sin comprobar que el segundo payload representara la misma
--     operación financiera.
--
-- Estrategia conservadora: conservar intactas las implementaciones atómicas
-- ya existentes como funciones internas sin permiso público; exponer wrappers
-- con las mismas firmas que validan el alcance de sucursal. El wrapper del
-- movimiento genérico además rechaza reutilizar una clave con otro payload.
-- No modifica datos históricos.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Guard común de autorización por negocio + sucursal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caja_assert_branch_access(
  p_business_id uuid,
  p_branch_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_business_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'CAJA_CONTEXT_REQUIRED';
  END IF;

  -- Estas RPC de Caja son operaciones interactivas y sus implementaciones
  -- internas requieren un usuario autenticado. Los webhooks/proveedores tienen
  -- su RPC dedicada y no deben saltarse este guard mediante service_role.
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'CAJA_AUTH_REQUIRED';
  END IF;

  -- Un solo error para sucursal inexistente/no asignada evita usar la RPC
  -- como oráculo para enumerar sucursales de otros usuarios.
  IF NOT EXISTS (
    SELECT 1
    FROM public.branches AS b
    WHERE b.id = p_branch_id
      AND b.business_id = p_business_id
      AND b.active = true
      AND b.id = ANY (public.auth_branch_ids())
  ) THEN
    RAISE EXCEPTION 'CAJA_BRANCH_FORBIDDEN';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.caja_assert_branch_access(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. RLS: leer y modificar cajas físicas solo dentro del alcance de sucursal.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS cash_registers_select_member ON public.cash_registers;
CREATE POLICY cash_registers_select_member
ON public.cash_registers
FOR SELECT TO authenticated
USING (
  public.is_business_member(cash_registers.business_id)
  AND COALESCE(cash_registers.branch_id = ANY (public.auth_branch_ids()), false)
);

DROP POLICY IF EXISTS cash_registers_insert_admin ON public.cash_registers;
CREATE POLICY cash_registers_insert_admin
ON public.cash_registers
FOR INSERT TO authenticated
WITH CHECK (
  public.has_business_role(business_id, ARRAY['ADMIN'])
  AND COALESCE(branch_id = ANY (public.auth_branch_ids()), false)
  AND EXISTS (
    SELECT 1
    FROM public.branches AS b
    WHERE b.id = cash_registers.branch_id
      AND b.business_id = cash_registers.business_id
      AND b.active = true
  )
);

DROP POLICY IF EXISTS cash_registers_update_admin ON public.cash_registers;
CREATE POLICY cash_registers_update_admin
ON public.cash_registers
FOR UPDATE TO authenticated
USING (
  public.has_business_role(business_id, ARRAY['ADMIN'])
  AND COALESCE(branch_id = ANY (public.auth_branch_ids()), false)
)
WITH CHECK (
  public.has_business_role(business_id, ARRAY['ADMIN'])
  AND COALESCE(branch_id = ANY (public.auth_branch_ids()), false)
  AND EXISTS (
    SELECT 1
    FROM public.branches AS b
    WHERE b.id = cash_registers.branch_id
      AND b.business_id = cash_registers.business_id
      AND b.active = true
  )
);

-- Arqueos y transferencias incluyen importes y diferencias de efectivo:
-- un miembro del negocio no debe poder leer sucursales que no tiene asignadas.
DROP POLICY IF EXISTS cash_drawer_counts_member_select ON public.cash_drawer_counts;
CREATE POLICY cash_drawer_counts_member_select
ON public.cash_drawer_counts
FOR SELECT TO authenticated
USING (
  public.is_business_member(cash_drawer_counts.business_id)
  AND COALESCE(cash_drawer_counts.branch_id = ANY (public.auth_branch_ids()), false)
);

DROP POLICY IF EXISTS cash_register_transfers_member_select ON public.cash_register_transfers;
CREATE POLICY cash_register_transfers_member_select
ON public.cash_register_transfers
FOR SELECT TO authenticated
USING (
  public.is_business_member(cash_register_transfers.business_id)
  AND COALESCE(cash_register_transfers.branch_id = ANY (public.auth_branch_ids()), false)
);

-- ---------------------------------------------------------------------------
-- 3. Encapsular las implementaciones previas. Se revocan las llamadas directas
--    al nombre interno para impedir saltarse el control de sucursal.
-- ---------------------------------------------------------------------------
DO $rename_internal_functions$
DECLARE
  v_item record;
BEGIN
  FOR v_item IN
    SELECT * FROM (VALUES
      ('public.ensure_default_cash_register(uuid,uuid)', 'ensure_default_cash_register', 'caja_internal_ensure_default_cash_register'),
      ('public.deactivate_cash_register_atomic(uuid)', 'deactivate_cash_register_atomic', 'caja_internal_deactivate_cash_register_atomic'),
      ('public.open_shift_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text)', 'open_shift_atomic', 'caja_internal_open_shift_atomic'),
      ('public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)', 'register_movement_atomic', 'caja_internal_register_movement_atomic'),
      ('public.close_shift_atomic(uuid,numeric,text)', 'close_shift_atomic', 'caja_internal_close_shift_atomic'),
      ('public.register_cash_movement_enterprise(text,uuid,uuid,uuid,uuid,text,numeric,text,text)', 'register_cash_movement_enterprise', 'caja_internal_register_cash_movement_enterprise'),
      ('public.transfer_cash_between_registers_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,numeric,text)', 'transfer_cash_between_registers_atomic', 'caja_internal_transfer_cash_between_registers_atomic'),
      ('public.close_shift_with_cash_count_atomic(uuid,uuid,uuid,uuid,numeric,jsonb,text,text)', 'close_shift_with_cash_count_atomic', 'caja_internal_close_shift_with_cash_count_atomic')
    ) AS functions(signature, public_name, internal_name)
  LOOP
    IF to_regprocedure(v_item.signature) IS NOT NULL
       AND to_regprocedure('public.' || v_item.internal_name || substring(v_item.signature from position('(' in v_item.signature))) IS NULL THEN
      EXECUTE format('ALTER FUNCTION %s RENAME TO %I', v_item.signature, v_item.internal_name);
    ELSIF to_regprocedure('public.' || v_item.internal_name || substring(v_item.signature from position('(' in v_item.signature))) IS NULL THEN
      RAISE EXCEPTION 'CAJA_FUNCTION_MISSING: %', v_item.signature;
    END IF;
  END LOOP;
END;
$rename_internal_functions$;

-- ---------------------------------------------------------------------------
-- 3b. Corregir los totales persistidos del cierre en el servidor.
-- Antes totalIncome sumaba IN y OUT, y cashAmount nulo de movimientos antiguos
-- se trataba como cero aunque el método fuera efectivo. Eso hacía discrepar el
-- resumen del turno con ShiftEngine y podía mostrar ingresos inflados.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caja_internal_close_shift_atomic(
  p_shift_id uuid,
  p_counted_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(shift_id uuid, data jsonb, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_closed_at timestamptz := clock_timestamp();
  v_total_income numeric := 0;
  v_total_expense numeric := 0;
  v_total_cash_income numeric := 0;
  v_expected_amount numeric := 0;
  v_difference numeric := 0;
  v_income_by_method jsonb := '{}'::jsonb;
  v_new_data jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SHIFT_AUTH_REQUIRED'; END IF;
  IF p_counted_amount IS NULL OR p_counted_amount < 0
     OR p_counted_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'SHIFT_INVALID_COUNTED_AMOUNT';
  END IF;

  SELECT * INTO v_shift FROM public.shifts s WHERE s.id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_NOT_FOUND'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = v_shift.business_id AND bm.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'SHIFT_NOT_A_MEMBER'; END IF;
  IF NOT public.has_business_role(v_shift.business_id, ARRAY['ADMIN','GERENTE','CAJERO']) THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = v_shift.branch_id AND b.business_id = v_shift.business_id AND b.active = true
  ) THEN RAISE EXCEPTION 'SHIFT_INVALID_BRANCH'; END IF;
  IF v_shift.data->>'status' = 'CLOSED' THEN RAISE EXCEPTION 'SHIFT_ALREADY_CLOSED'; END IF;
  IF v_shift.data->>'status' <> 'OPEN' THEN RAISE EXCEPTION 'SHIFT_NOT_OPEN'; END IF;
  IF v_shift.cash_register_id IS NULL THEN RAISE EXCEPTION 'SHIFT_CASH_REGISTER_REQUIRED'; END IF;
  IF NOT public.has_business_role(v_shift.business_id, ARRAY['ADMIN','GERENTE'])
     AND NULLIF(v_shift.data->>'cashierId', '')::uuid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'SHIFT_OWNER_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_movements cm
    WHERE cm.business_id = v_shift.business_id
      AND cm.branch_id = v_shift.branch_id
      AND cm.cash_register_id = v_shift.cash_register_id
      AND cm.shift_id IS NULL
      AND cm.data_date >= (v_shift.data->>'openedAt')::timestamptz
  ) THEN
    RAISE EXCEPTION 'SHIFT_HAS_UNASSIGNED_MOVEMENTS';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN cm.data->>'type' = 'IN'
      THEN (cm.data->>'amount')::numeric ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.data->>'type' = 'OUT'
      THEN (cm.data->>'amount')::numeric ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.data->>'type' = 'IN' THEN
      COALESCE(
        (cm.data->>'cashAmount')::numeric,
        CASE
          WHEN cm.data->>'paymentMethod' = 'CASH'
            OR cm.data->>'paymentMethod' IS NULL
          THEN (cm.data->>'amount')::numeric
          ELSE 0
        END
      )
      ELSE 0 END), 0)
  INTO v_total_income, v_total_expense, v_total_cash_income
  FROM public.cash_movements cm
  WHERE cm.business_id = v_shift.business_id
    AND cm.branch_id = v_shift.branch_id
    AND cm.shift_id = v_shift.id::text;

  SELECT COALESCE(jsonb_object_agg(method, amount), '{}'::jsonb)
    INTO v_income_by_method
  FROM (
    SELECT cm.data->>'paymentMethod' AS method,
           SUM((cm.data->>'amount')::numeric) AS amount
    FROM public.cash_movements cm
    WHERE cm.business_id = v_shift.business_id
      AND cm.branch_id = v_shift.branch_id
      AND cm.shift_id = v_shift.id::text
      AND cm.data->>'type' = 'IN'
      AND cm.data->>'paymentMethod' IS NOT NULL
    GROUP BY cm.data->>'paymentMethod'
  ) t;

  v_expected_amount := COALESCE((v_shift.data->>'openingAmount')::numeric, 0)
    + v_total_cash_income - v_total_expense;
  v_difference := p_counted_amount - v_expected_amount;

  v_new_data := v_shift.data || jsonb_build_object(
    'status', 'CLOSED',
    'closedAt', v_closed_at,
    'closingNotes', p_notes,
    'totalIncome', v_total_income,
    'totalExpense', v_total_expense,
    'totalCashIncome', v_total_cash_income,
    'incomeByMethod', v_income_by_method,
    'expectedAmount', v_expected_amount,
    'countedAmount', p_counted_amount,
    'difference', v_difference
  );

  UPDATE public.shifts
  SET data = v_new_data, version = v_shift.version + 1, updated_at = v_closed_at
  WHERE public.shifts.id = v_shift.id AND public.shifts.version = v_shift.version;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_CLOSE_CONFLICT'; END IF;

  INSERT INTO public.daily_report_jobs(
    business_id, branch_id, shift_id, business_date, opened_at, closed_at,
    data_cutoff_at, cash_expected, cash_counted, cash_difference, status, next_attempt_at
  )
  SELECT
    v_shift.business_id,
    v_shift.branch_id,
    v_shift.id,
    (v_closed_at AT TIME ZONE COALESCE(
      (SELECT timezone FROM public.businesses WHERE id = v_shift.business_id), 'UTC'
    ))::date,
    NULLIF(v_shift.data->>'openedAt', '')::timestamptz,
    v_closed_at,
    v_closed_at,
    v_expected_amount,
    p_counted_amount,
    v_difference,
    'PENDING',
    v_closed_at
  WHERE NOT EXISTS (
    SELECT 1 FROM public.daily_report_jobs drj WHERE drj.shift_id = v_shift.id
  );

  RETURN QUERY SELECT v_shift.id, v_new_data, v_shift.version + 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.caja_internal_ensure_default_cash_register(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.caja_internal_deactivate_cash_register_atomic(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.caja_internal_open_shift_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.caja_internal_register_movement_atomic(text, uuid, uuid, text, numeric, text, text, numeric, text, timestamptz, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.caja_internal_close_shift_atomic(uuid, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.caja_internal_register_cash_movement_enterprise(text, uuid, uuid, uuid, uuid, text, numeric, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.caja_internal_transfer_cash_between_registers_atomic(uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.caja_internal_close_shift_with_cash_count_atomic(uuid, uuid, uuid, uuid, numeric, jsonb, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Mantener las mismas firmas públicas con guard de sucursal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_cash_register(
  p_business_id uuid,
  p_branch_id uuid
)
RETURNS TABLE(data jsonb, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM public.caja_assert_branch_access(p_business_id, p_branch_id);
  RETURN QUERY
  SELECT * FROM public.caja_internal_ensure_default_cash_register(p_business_id, p_branch_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.ensure_default_cash_register(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_cash_register(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.deactivate_cash_register_atomic(
  p_cash_register_id uuid
)
RETURNS TABLE(data jsonb, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'CAJA_AUTH_REQUIRED';
  END IF;
  SELECT r.business_id, r.branch_id
    INTO v_business_id, v_branch_id
  FROM public.cash_registers AS r
  WHERE r.id = p_cash_register_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CASH_REGISTER_NOT_FOUND'; END IF;
  PERFORM public.caja_assert_branch_access(v_business_id, v_branch_id);
  RETURN QUERY
  SELECT * FROM public.caja_internal_deactivate_cash_register_atomic(p_cash_register_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.deactivate_cash_register_atomic(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_cash_register_atomic(uuid) TO authenticated;
-- Conserva el ACL observado en el proyecto remoto antes de envolver la RPC.
GRANT EXECUTE ON FUNCTION public.deactivate_cash_register_atomic(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.open_shift_atomic(
  p_shift_id uuid,
  p_business_id uuid,
  p_branch_id uuid,
  p_cash_register_id uuid,
  p_cashier_id uuid,
  p_opening_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(data jsonb, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM public.caja_assert_branch_access(p_business_id, p_branch_id);
  IF p_opening_amount IS NULL
     OR p_opening_amount::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_opening_amount < 0 THEN
    RAISE EXCEPTION 'SHIFT_INVALID_OPENING_AMOUNT';
  END IF;
  RETURN QUERY
  SELECT * FROM public.caja_internal_open_shift_atomic(
    p_shift_id, p_business_id, p_branch_id, p_cash_register_id,
    p_cashier_id, p_opening_amount, p_notes
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.open_shift_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_shift_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text) TO authenticated;
-- Conserva el ACL observado en el proyecto remoto antes de envolver la RPC.
GRANT EXECUTE ON FUNCTION public.open_shift_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Movimiento genérico: guard de sucursal + clave idempotente vinculada al
--    mismo payload (tipo, importe, descripción, medio, efectivo y venta).
-- ---------------------------------------------------------------------------
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
  p_created_at timestamptz DEFAULT now(),
  p_cash_register_id uuid DEFAULT NULL,
  p_verification_source text DEFAULT NULL
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
  created_at timestamptz,
  cash_register_id uuid,
  shift_id text,
  payment_verification_source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_result record;
BEGIN
  PERFORM public.caja_assert_branch_access(p_business_id, p_branch_id);
  IF p_amount IS NULL OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') OR p_amount <= 0 THEN
    RAISE EXCEPTION 'CAJA_INVALID_AMOUNT';
  END IF;
  IF p_cash_amount IS NULL OR p_cash_amount::text IN ('NaN', 'Infinity', '-Infinity') OR p_cash_amount < 0 THEN
    RAISE EXCEPTION 'CAJA_INVALID_CASH_AMOUNT';
  END IF;

  -- La implementación interna conserva la lógica original de turno, caja,
  -- validación del método de pago y escritura atómica. Después verificamos
  -- que un reintento realmente correspondiera a la misma operación.
  SELECT * INTO v_result
  FROM public.caja_internal_register_movement_atomic(
    p_idempotency_key, p_business_id, p_branch_id, p_type, p_amount,
    p_description, p_payment_method, p_cash_amount, p_sale_id,
    p_created_at, p_cash_register_id, p_verification_source
  );
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPABASE_REGISTER_MOVEMENT_NO_RESULT'; END IF;

  IF v_result.type IS DISTINCT FROM p_type
     OR COALESCE(abs(v_result.amount - p_amount) > 0.005, true)
     OR v_result.description IS DISTINCT FROM p_description
     OR v_result.payment_method IS DISTINCT FROM p_payment_method
     OR COALESCE(abs(v_result.cash_amount - p_cash_amount) > 0.005, true)
     OR v_result.sale_id IS DISTINCT FROM p_sale_id
     OR v_result.payment_verification_source IS DISTINCT FROM p_verification_source
     OR (p_cash_register_id IS NOT NULL AND v_result.cash_register_id IS DISTINCT FROM p_cash_register_id) THEN
    RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED';
  END IF;

  RETURN QUERY SELECT
    v_result.movement_id, v_result.idempotency_key, v_result.type,
    v_result.amount, v_result.description, v_result.date,
    v_result.payment_method, v_result.cash_amount, v_result.business_id,
    v_result.branch_id, v_result.sale_id, v_result.created_at,
    v_result.cash_register_id, v_result.shift_id,
    v_result.payment_verification_source;
END;
$function$;
REVOKE ALL ON FUNCTION public.register_movement_atomic(text, uuid, uuid, text, numeric, text, text, numeric, text, timestamptz, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_movement_atomic(text, uuid, uuid, text, numeric, text, text, numeric, text, timestamptz, uuid, text) TO authenticated;
-- Conserva el ACL observado en el proyecto remoto antes de envolver la RPC.
GRANT EXECUTE ON FUNCTION public.register_movement_atomic(text, uuid, uuid, text, numeric, text, text, numeric, text, timestamptz, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.close_shift_atomic(
  p_shift_id uuid,
  p_counted_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(shift_id uuid, data jsonb, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'CAJA_AUTH_REQUIRED';
  END IF;
  IF p_counted_amount IS NULL
     OR p_counted_amount::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_counted_amount < 0 THEN
    RAISE EXCEPTION 'SHIFT_INVALID_COUNTED_AMOUNT';
  END IF;
  SELECT s.business_id, s.branch_id
    INTO v_business_id, v_branch_id
  FROM public.shifts AS s
  WHERE s.id = p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_NOT_FOUND'; END IF;
  PERFORM public.caja_assert_branch_access(v_business_id, v_branch_id);
  RETURN QUERY
  SELECT * FROM public.caja_internal_close_shift_atomic(p_shift_id, p_counted_amount, p_notes);
END;
$function$;
REVOKE ALL ON FUNCTION public.close_shift_atomic(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_shift_atomic(uuid, numeric, text) TO authenticated;
-- Conserva el ACL observado en el proyecto remoto antes de envolver la RPC.
GRANT EXECUTE ON FUNCTION public.close_shift_atomic(uuid, numeric, text) TO service_role;

CREATE OR REPLACE FUNCTION public.register_cash_movement_enterprise(
  p_idempotency_key text,
  p_business_id uuid,
  p_branch_id uuid,
  p_cash_register_id uuid,
  p_shift_id uuid,
  p_type text,
  p_amount numeric,
  p_reason_code text,
  p_description text
)
RETURNS TABLE(
  movement_id text,
  idempotency_key text,
  type text,
  amount numeric,
  business_id uuid,
  branch_id uuid,
  cash_register_id uuid,
  shift_id text,
  reason_code text,
  date timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM public.caja_assert_branch_access(p_business_id, p_branch_id);
  IF p_amount IS NULL OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') OR p_amount <= 0 THEN
    RAISE EXCEPTION 'CAJA_INVALID_AMOUNT';
  END IF;
  RETURN QUERY
  SELECT * FROM public.caja_internal_register_cash_movement_enterprise(
    p_idempotency_key, p_business_id, p_branch_id, p_cash_register_id,
    p_shift_id, p_type, p_amount, p_reason_code, p_description
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.register_cash_movement_enterprise(text, uuid, uuid, uuid, uuid, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_cash_movement_enterprise(text, uuid, uuid, uuid, uuid, text, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_cash_between_registers_atomic(
  p_transfer_id uuid,
  p_business_id uuid,
  p_branch_id uuid,
  p_from_cash_register_id uuid,
  p_to_cash_register_id uuid,
  p_from_shift_id uuid,
  p_to_shift_id uuid,
  p_amount numeric,
  p_reason text
)
RETURNS TABLE(
  transfer_id uuid,
  amount numeric,
  from_movement_id text,
  to_movement_id text,
  from_cash_register_id uuid,
  to_cash_register_id uuid,
  from_shift_id uuid,
  to_shift_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM public.caja_assert_branch_access(p_business_id, p_branch_id);
  IF p_amount IS NULL OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') OR p_amount <= 0 THEN
    RAISE EXCEPTION 'CAJA_TRANSFER_INVALID_AMOUNT';
  END IF;
  RETURN QUERY
  SELECT * FROM public.caja_internal_transfer_cash_between_registers_atomic(
    p_transfer_id, p_business_id, p_branch_id,
    p_from_cash_register_id, p_to_cash_register_id,
    p_from_shift_id, p_to_shift_id, p_amount, p_reason
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.transfer_cash_between_registers_atomic(uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_cash_between_registers_atomic(uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_shift_with_cash_count_atomic(
  p_shift_id uuid,
  p_business_id uuid,
  p_branch_id uuid,
  p_cash_register_id uuid,
  p_counted_amount numeric,
  p_denominations jsonb,
  p_currency_code text DEFAULT 'COP',
  p_notes text DEFAULT NULL
)
RETURNS TABLE(
  shift_id uuid,
  count_id uuid,
  version integer,
  expected_amount numeric,
  counted_amount numeric,
  difference numeric,
  blind_count boolean,
  denominations jsonb,
  currency_code text,
  closed_at timestamptz,
  shift_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM public.caja_assert_branch_access(p_business_id, p_branch_id);
  IF p_counted_amount IS NULL
     OR p_counted_amount::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_counted_amount < 0 THEN
    RAISE EXCEPTION 'SHIFT_INVALID_COUNTED_AMOUNT';
  END IF;
  RETURN QUERY
  SELECT * FROM public.caja_internal_close_shift_with_cash_count_atomic(
    p_shift_id, p_business_id, p_branch_id, p_cash_register_id,
    p_counted_amount, p_denominations, p_currency_code, p_notes
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.close_shift_with_cash_count_atomic(uuid, uuid, uuid, uuid, numeric, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_shift_with_cash_count_atomic(uuid, uuid, uuid, uuid, numeric, jsonb, text, text) TO authenticated;

-- Fuerza la actualización del catálogo de funciones de PostgREST tras renombrar
-- las implementaciones internas y recrear las firmas públicas.
NOTIFY pgrst, 'reload schema';

COMMIT;
