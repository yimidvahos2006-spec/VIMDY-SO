-- ============================================================================
-- VIMDY CAJA ENTERPRISE V4 — CONTROL OPERATIVO Y ARQUEO FÍSICO
-- ============================================================================
-- Objetivo:
--   1) Cierre ciego con denominaciones y snapshot inmutable del arqueo.
--   2) Movimientos manuales tipificados, ligados a caja + turno exactos.
--   3) Salidas de efectivo bloqueadas si exceden el efectivo disponible.
--   4) Transferencias atómicas entre cajas con dos movimientos compensados.
--   5) Cierre permitido a ADMIN/GERENTE/CAJERO; CAJERO solo puede cerrar su turno.
--   6) Validación final de la integridad de CONFIRMED en payment_verifications.
--
-- PRERREQUISITO:
--   Aplicar V2 + V3 antes de esta migration.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. SNAPSHOT FÍSICO DE ARQUEO
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cash_drawer_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  cash_register_id uuid NOT NULL REFERENCES public.cash_registers(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE RESTRICT,
  count_type text NOT NULL DEFAULT 'CLOSING'
    CHECK (count_type IN ('CLOSING')),
  currency_code text NOT NULL DEFAULT 'COP'
    CHECK (char_length(currency_code) BETWEEN 3 AND 6),
  denominations jsonb NOT NULL DEFAULT '{}'::jsonb,
  counted_amount numeric(18,2) NOT NULL CHECK (counted_amount >= 0),
  expected_amount numeric(18,2),
  difference numeric(18,2),
  blind boolean NOT NULL DEFAULT true,
  notes text,
  counted_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_drawer_counts_shift_closing_uq
  ON public.cash_drawer_counts (business_id, branch_id, shift_id, count_type);

CREATE INDEX IF NOT EXISTS cash_drawer_counts_business_branch_created_idx
  ON public.cash_drawer_counts (business_id, branch_id, created_at DESC);

ALTER TABLE public.cash_drawer_counts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_drawer_counts_member_select ON public.cash_drawer_counts;
DROP POLICY IF EXISTS cash_drawer_counts_no_direct_insert ON public.cash_drawer_counts;
DROP POLICY IF EXISTS cash_drawer_counts_no_direct_update ON public.cash_drawer_counts;
DROP POLICY IF EXISTS cash_drawer_counts_no_direct_delete ON public.cash_drawer_counts;

CREATE POLICY cash_drawer_counts_member_select
ON public.cash_drawer_counts
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.business_members bm
  WHERE bm.business_id = cash_drawer_counts.business_id
    AND bm.user_id = auth.uid()
));

CREATE POLICY cash_drawer_counts_no_direct_insert
ON public.cash_drawer_counts
FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY cash_drawer_counts_no_direct_update
ON public.cash_drawer_counts
FOR UPDATE TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY cash_drawer_counts_no_direct_delete
ON public.cash_drawer_counts
FOR DELETE TO authenticated
USING (false);

REVOKE INSERT, UPDATE, DELETE ON public.cash_drawer_counts FROM authenticated;
GRANT SELECT ON public.cash_drawer_counts TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. REGISTRO DE TRANSFERENCIAS ENTRE CAJAS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cash_register_transfers (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  from_cash_register_id uuid NOT NULL REFERENCES public.cash_registers(id) ON DELETE RESTRICT,
  to_cash_register_id uuid NOT NULL REFERENCES public.cash_registers(id) ON DELETE RESTRICT,
  from_shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE RESTRICT,
  to_shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (from_cash_register_id <> to_cash_register_id),
  CHECK (from_shift_id <> to_shift_id)
);

CREATE INDEX IF NOT EXISTS cash_register_transfers_business_branch_created_idx
  ON public.cash_register_transfers (business_id, branch_id, created_at DESC);

ALTER TABLE public.cash_register_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_register_transfers_member_select ON public.cash_register_transfers;
DROP POLICY IF EXISTS cash_register_transfers_no_direct_insert ON public.cash_register_transfers;
DROP POLICY IF EXISTS cash_register_transfers_no_direct_update ON public.cash_register_transfers;
DROP POLICY IF EXISTS cash_register_transfers_no_direct_delete ON public.cash_register_transfers;

CREATE POLICY cash_register_transfers_member_select
ON public.cash_register_transfers
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.business_members bm
  WHERE bm.business_id = cash_register_transfers.business_id
    AND bm.user_id = auth.uid()
));

CREATE POLICY cash_register_transfers_no_direct_insert
ON public.cash_register_transfers
FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY cash_register_transfers_no_direct_update
ON public.cash_register_transfers
FOR UPDATE TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY cash_register_transfers_no_direct_delete
ON public.cash_register_transfers
FOR DELETE TO authenticated
USING (false);

REVOKE INSERT, UPDATE, DELETE ON public.cash_register_transfers FROM authenticated;
GRANT SELECT ON public.cash_register_transfers TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. HELPER: EFECTIVO DISPONIBLE DE UN TURNO
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shift_cash_available(p_shift_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((s.data->>'openingAmount')::numeric, 0)
    + COALESCE((
        SELECT SUM(
          CASE WHEN cm.data->>'type' = 'IN'
            THEN COALESCE((cm.data->>'cashAmount')::numeric, (cm.data->>'amount')::numeric, 0)
            ELSE -COALESCE((cm.data->>'cashAmount')::numeric, (cm.data->>'amount')::numeric, 0)
          END
        )
        FROM public.cash_movements cm
        WHERE cm.shift_id = s.id::text
          AND cm.business_id = s.business_id
          AND cm.branch_id = s.branch_id
      ), 0)
  FROM public.shifts s
  WHERE s.id = p_shift_id;
$$;

REVOKE ALL ON FUNCTION public.shift_cash_available(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. MOVIMIENTO MANUAL ENTERPRISE
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.register_cash_movement_enterprise(text,uuid,uuid,uuid,uuid,text,numeric,text,text);

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
SET search_path = public
AS $$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_existing public.cash_movements%ROWTYPE;
  v_role_ok boolean := false;
  v_available numeric := 0;
  v_date timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CAJA_AUTH_REQUIRED'; END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REQUIRED'; END IF;
  IF p_type NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'CAJA_INVALID_MOVEMENT_TYPE'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'CAJA_INVALID_MOVEMENT_AMOUNT'; END IF;
  IF p_description IS NULL OR btrim(p_description) = '' THEN RAISE EXCEPTION 'CAJA_MOVEMENT_DESCRIPTION_REQUIRED'; END IF;
  IF p_reason_code NOT IN ('CHANGE_FUND_IN','OTHER_IN','EXPENSE','OTHER_OUT','SAFE_DROP','BANK_DEPOSIT') THEN
    RAISE EXCEPTION 'CAJA_INVALID_REASON_CODE';
  END IF;

  v_role_ok := public.has_business_role(p_business_id, ARRAY['ADMIN','GERENTE','CAJERO']);
  IF NOT v_role_ok THEN RAISE EXCEPTION 'CAJA_FORBIDDEN'; END IF;

  IF p_reason_code = 'CHANGE_FUND_IN' AND p_type <> 'IN' THEN RAISE EXCEPTION 'CAJA_REASON_TYPE_MISMATCH'; END IF;
  IF p_reason_code = 'OTHER_IN' AND p_type <> 'IN' THEN RAISE EXCEPTION 'CAJA_REASON_TYPE_MISMATCH'; END IF;
  IF p_reason_code IN ('EXPENSE','OTHER_OUT','SAFE_DROP','BANK_DEPOSIT') AND p_type <> 'OUT' THEN
    RAISE EXCEPTION 'CAJA_REASON_TYPE_MISMATCH';
  END IF;

  -- Retiros físicos de caja fuerte/banco y salidas arbitrarias requieren administración o gerencia.
  IF p_reason_code IN ('SAFE_DROP','BANK_DEPOSIT','OTHER_OUT')
     AND NOT public.has_business_role(p_business_id, ARRAY['ADMIN','GERENTE']) THEN
    RAISE EXCEPTION 'CAJA_SENSITIVE_MOVEMENT_FORBIDDEN';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_registers r
    WHERE r.id = p_cash_register_id
      AND r.business_id = p_business_id
      AND r.branch_id = p_branch_id
      AND r.active = true
      AND r.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'CAJA_REGISTER_CONTEXT_INVALID';
  END IF;

  SELECT * INTO v_shift
  FROM public.shifts s
  WHERE s.id = p_shift_id
    AND s.business_id = p_business_id
    AND s.branch_id = p_branch_id
    AND s.cash_register_id = p_cash_register_id
    AND s.data->>'status' = 'OPEN'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_SHIFT_REGISTER_MISMATCH'; END IF;

  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','GERENTE'])
     AND v_shift.cashier_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'CAJA_SHIFT_OWNER_REQUIRED';
  END IF;

  -- Reintento idempotente: devuelve el movimiento original solo si coincide con el contexto/monto.
  SELECT * INTO v_existing
  FROM public.cash_movements cm
  WHERE cm.business_id = p_business_id
    AND cm.branch_id = p_branch_id
    AND cm.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.shift_id IS DISTINCT FROM p_shift_id::text
       OR v_existing.cash_register_id IS DISTINCT FROM p_cash_register_id
       OR (v_existing.data->>'type') IS DISTINCT FROM p_type
       OR (v_existing.data->>'reasonCode') IS DISTINCT FROM p_reason_code
       OR (v_existing.data->>'description') IS DISTINCT FROM btrim(p_description)
       OR abs(COALESCE((v_existing.data->>'amount')::numeric,0) - p_amount) > 0.005 THEN
      RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED';
    END IF;
    RETURN QUERY SELECT
      v_existing.id::text,
      v_existing.idempotency_key,
      v_existing.data->>'type',
      (v_existing.data->>'amount')::numeric,
      v_existing.business_id,
      v_existing.branch_id,
      v_existing.cash_register_id,
      v_existing.shift_id,
      v_existing.data->>'reasonCode',
      (v_existing.data->>'date')::timestamptz;
    RETURN;
  END IF;

  IF p_type = 'OUT' THEN
    v_available := public.shift_cash_available(v_shift.id);
    IF v_available + 0.005 < p_amount THEN
      RAISE EXCEPTION 'CAJA_EFECTIVO_INSUFICIENTE';
    END IF;
  END IF;

  INSERT INTO public.cash_movements (
    id,
    idempotency_key,
    business_id,
    branch_id,
    cash_register_id,
    shift_id,
    data
  )
  VALUES (
    gen_random_uuid(),
    p_idempotency_key,
    p_business_id,
    p_branch_id,
    p_cash_register_id,
    p_shift_id::text,
    jsonb_build_object(
      'id', p_idempotency_key,
      'idempotencyKey', p_idempotency_key,
      'type', p_type,
      'amount', p_amount,
      'description', btrim(p_description),
      'date', v_date,
      'createdAt', v_date,
      'paymentMethod', 'CASH',
      'cashAmount', p_amount,
      'businessId', p_business_id::text,
      'branchId', p_branch_id::text,
      'cashRegisterId', p_cash_register_id::text,
      'shiftId', p_shift_id::text,
      'userId', auth.uid()::text,
      'reasonCode', p_reason_code,
      'movementClass', CASE WHEN p_type = 'IN' THEN 'MANUAL_IN' ELSE 'MANUAL_OUT' END
    )
  );

  RETURN QUERY SELECT
    p_idempotency_key,
    p_idempotency_key,
    p_type,
    p_amount,
    p_business_id,
    p_branch_id,
    p_cash_register_id,
    p_shift_id::text,
    p_reason_code,
    v_date;
END;
$$;

REVOKE ALL ON FUNCTION public.register_cash_movement_enterprise(text,uuid,uuid,uuid,uuid,text,numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_cash_movement_enterprise(text,uuid,uuid,uuid,uuid,text,numeric,text,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. TRANSFERENCIA ENTRE CAJAS — TODO O NADA
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.transfer_cash_between_registers_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,numeric,text);

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
SET search_path = public
AS $$
DECLARE
  v_from_shift public.shifts%ROWTYPE;
  v_to_shift public.shifts%ROWTYPE;
  v_available numeric := 0;
  v_created_at timestamptz := clock_timestamp();
  v_from_key text := 'transfer:' || p_transfer_id::text || ':OUT';
  v_existing_transfer public.cash_register_transfers%ROWTYPE;
  v_to_key text := 'transfer:' || p_transfer_id::text || ':IN';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CAJA_AUTH_REQUIRED'; END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','GERENTE']) THEN
    RAISE EXCEPTION 'CAJA_TRANSFER_FORBIDDEN';
  END IF;
  IF p_from_cash_register_id = p_to_cash_register_id OR p_from_shift_id = p_to_shift_id THEN
    RAISE EXCEPTION 'CAJA_TRANSFER_SAME_REGISTER';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'CAJA_INVALID_TRANSFER_AMOUNT'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'CAJA_TRANSFER_REASON_REQUIRED'; END IF;

  -- Validar que ambas cajas pertenecen al mismo negocio/sucursal y están activas.
  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_registers r
    WHERE r.id = p_from_cash_register_id
      AND r.business_id = p_business_id
      AND r.branch_id = p_branch_id
      AND r.active = true
      AND r.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'CAJA_SOURCE_REGISTER_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_registers r
    WHERE r.id = p_to_cash_register_id
      AND r.business_id = p_business_id
      AND r.branch_id = p_branch_id
      AND r.active = true
      AND r.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'CAJA_DESTINATION_REGISTER_INVALID';
  END IF;

  -- Serializar por transfer_id para que un reintento concurrente sea seguro.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_transfer_id::text, 0));

  -- Idempotencia fuerte: una misma transferencia debe reutilizar exactamente
  -- el mismo contexto y monto. Nunca devolvemos silenciosamente otra operación.
  SELECT * INTO v_existing_transfer
  FROM public.cash_register_transfers t
  WHERE t.id = p_transfer_id;

  IF FOUND THEN
    IF v_existing_transfer.business_id IS DISTINCT FROM p_business_id
       OR v_existing_transfer.branch_id IS DISTINCT FROM p_branch_id
       OR v_existing_transfer.from_cash_register_id IS DISTINCT FROM p_from_cash_register_id
       OR v_existing_transfer.to_cash_register_id IS DISTINCT FROM p_to_cash_register_id
       OR v_existing_transfer.from_shift_id IS DISTINCT FROM p_from_shift_id
       OR v_existing_transfer.to_shift_id IS DISTINCT FROM p_to_shift_id
       OR abs(v_existing_transfer.amount - p_amount) > 0.005
       OR btrim(v_existing_transfer.reason) IS DISTINCT FROM btrim(p_reason) THEN
      RAISE EXCEPTION 'CAJA_TRANSFER_IDEMPOTENCY_KEY_REUSED';
    END IF;

    RETURN QUERY
    SELECT
      v_existing_transfer.id,
      v_existing_transfer.amount,
      'transfer:' || v_existing_transfer.id::text || ':OUT',
      'transfer:' || v_existing_transfer.id::text || ':IN',
      v_existing_transfer.from_cash_register_id,
      v_existing_transfer.to_cash_register_id,
      v_existing_transfer.from_shift_id,
      v_existing_transfer.to_shift_id,
      v_existing_transfer.created_at;
    RETURN;
  END IF;

  -- Bloqueo determinista por UUID para evitar deadlocks si dos transferencias
  -- simultáneas intentan mover efectivo en sentidos opuestos.
  IF p_from_shift_id::text < p_to_shift_id::text THEN
    SELECT * INTO v_from_shift
    FROM public.shifts s
    WHERE s.id = p_from_shift_id
      AND s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.cash_register_id = p_from_cash_register_id
      AND s.data->>'status' = 'OPEN'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_SOURCE_SHIFT_INVALID'; END IF;

    SELECT * INTO v_to_shift
    FROM public.shifts s
    WHERE s.id = p_to_shift_id
      AND s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.cash_register_id = p_to_cash_register_id
      AND s.data->>'status' = 'OPEN'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_DESTINATION_SHIFT_INVALID'; END IF;
  ELSE
    SELECT * INTO v_to_shift
    FROM public.shifts s
    WHERE s.id = p_to_shift_id
      AND s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.cash_register_id = p_to_cash_register_id
      AND s.data->>'status' = 'OPEN'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_DESTINATION_SHIFT_INVALID'; END IF;

    SELECT * INTO v_from_shift
    FROM public.shifts s
    WHERE s.id = p_from_shift_id
      AND s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.cash_register_id = p_from_cash_register_id
      AND s.data->>'status' = 'OPEN'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_SOURCE_SHIFT_INVALID'; END IF;
  END IF;

  SELECT public.shift_cash_available(v_from_shift.id) INTO v_available;
  IF v_available + 0.005 < p_amount THEN
    RAISE EXCEPTION 'CAJA_EFECTIVO_INSUFICIENTE';
  END IF;

  INSERT INTO public.cash_register_transfers (
    id, business_id, branch_id,
    from_cash_register_id, to_cash_register_id,
    from_shift_id, to_shift_id,
    amount, reason, created_by, created_at
  )
  VALUES (
    p_transfer_id, p_business_id, p_branch_id,
    p_from_cash_register_id, p_to_cash_register_id,
    p_from_shift_id, p_to_shift_id,
    p_amount, btrim(p_reason), auth.uid(), v_created_at
  );

  INSERT INTO public.cash_movements (
    id, idempotency_key, business_id, branch_id, cash_register_id, shift_id, data
  ) VALUES (
    gen_random_uuid(), v_from_key, p_business_id, p_branch_id, p_from_cash_register_id, p_from_shift_id::text,
    jsonb_build_object(
      'id', v_from_key, 'idempotencyKey', v_from_key, 'type', 'OUT', 'amount', p_amount,
      'description', 'Transferencia a caja ' || p_to_cash_register_id::text,
      'date', v_created_at, 'createdAt', v_created_at, 'paymentMethod', 'CASH', 'cashAmount', p_amount,
      'businessId', p_business_id::text, 'branchId', p_branch_id::text,
      'cashRegisterId', p_from_cash_register_id::text, 'shiftId', p_from_shift_id::text,
      'userId', auth.uid()::text, 'reasonCode', 'CASH_REGISTER_TRANSFER', 'transferId', p_transfer_id::text,
      'transferReason', btrim(p_reason)
    )
  );

  INSERT INTO public.cash_movements (
    id, idempotency_key, business_id, branch_id, cash_register_id, shift_id, data
  ) VALUES (
    gen_random_uuid(), v_to_key, p_business_id, p_branch_id, p_to_cash_register_id, p_to_shift_id::text,
    jsonb_build_object(
      'id', v_to_key, 'idempotencyKey', v_to_key, 'type', 'IN', 'amount', p_amount,
      'description', 'Transferencia desde caja ' || p_from_cash_register_id::text,
      'date', v_created_at, 'createdAt', v_created_at, 'paymentMethod', 'CASH', 'cashAmount', p_amount,
      'businessId', p_business_id::text, 'branchId', p_branch_id::text,
      'cashRegisterId', p_to_cash_register_id::text, 'shiftId', p_to_shift_id::text,
      'userId', auth.uid()::text, 'reasonCode', 'CASH_REGISTER_TRANSFER', 'transferId', p_transfer_id::text,
      'transferReason', btrim(p_reason)
    )
  );

  RETURN QUERY SELECT
    p_transfer_id,
    p_amount,
    v_from_key,
    v_to_key,
    p_from_cash_register_id,
    p_to_cash_register_id,
    p_from_shift_id,
    p_to_shift_id,
    v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_cash_between_registers_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_cash_between_registers_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,numeric,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. CIERRE CIEGO CON SNAPSHOT
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.close_shift_with_cash_count_atomic(uuid,uuid,uuid,uuid,numeric,jsonb,text,text);

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
SET search_path = public
AS $$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_closed_data jsonb;
  v_closed_version integer;
  v_counted_calculated numeric := 0;
  v_key text;
  v_value text;
  v_denomination numeric;
  v_quantity integer;
  v_closed_at timestamptz := clock_timestamp();
  v_expected numeric;
  v_difference numeric;
  v_count_id uuid;
  v_existing_count public.cash_drawer_counts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SHIFT_AUTH_REQUIRED'; END IF;
  IF p_counted_amount IS NULL OR p_counted_amount < 0 THEN RAISE EXCEPTION 'SHIFT_INVALID_COUNTED_AMOUNT'; END IF;
  IF p_denominations IS NULL OR jsonb_typeof(p_denominations) <> 'object' THEN RAISE EXCEPTION 'CAJA_DENOMINATIONS_INVALID'; END IF;
  IF p_currency_code IS NULL OR char_length(trim(p_currency_code)) NOT BETWEEN 3 AND 6 THEN RAISE EXCEPTION 'CAJA_CURRENCY_INVALID'; END IF;

  SELECT * INTO v_shift
  FROM public.shifts s
  WHERE s.id = p_shift_id
    AND s.business_id = p_business_id
    AND s.branch_id = p_branch_id
    AND s.cash_register_id = p_cash_register_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_SHIFT_REGISTER_MISMATCH'; END IF;
  IF v_shift.cash_register_id IS NULL THEN RAISE EXCEPTION 'CAJA_CASH_REGISTER_REQUIRED_FOR_CLOSE'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_registers r
    WHERE r.id = p_cash_register_id
      AND r.business_id = p_business_id
      AND r.branch_id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'CAJA_REGISTER_CONTEXT_INVALID';
  END IF;

  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','GERENTE','CAJERO']) THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN';
  END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','GERENTE'])
     AND v_shift.cashier_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'SHIFT_OWNER_REQUIRED';
  END IF;

  -- La estructura JSONB es un mapa "denominación -> cantidad".
  FOR v_key, v_value IN SELECT key, value FROM jsonb_each_text(p_denominations)
  LOOP
    IF v_key !~ '^[0-9]+$' THEN RAISE EXCEPTION 'CAJA_DENOMINATION_INVALID'; END IF;
    IF v_value !~ '^[0-9]+$' THEN RAISE EXCEPTION 'CAJA_DENOMINATION_QUANTITY_INVALID'; END IF;
    v_denomination := v_key::numeric;
    v_quantity := v_value::integer;
    IF v_denomination <= 0 OR v_quantity < 0 THEN RAISE EXCEPTION 'CAJA_DENOMINATION_INVALID'; END IF;
    v_counted_calculated := v_counted_calculated + v_denomination * v_quantity;
  END LOOP;

  IF abs(v_counted_calculated - p_counted_amount) > 0.005 THEN
    RAISE EXCEPTION 'CAJA_DENOMINATIONS_TOTAL_MISMATCH';
  END IF;

  -- Cierre idempotente: si el turno ya tiene snapshot, devolvemos el mismo.
  SELECT * INTO v_existing_count
  FROM public.cash_drawer_counts c
  WHERE c.business_id = p_business_id
    AND c.branch_id = p_branch_id
    AND c.shift_id = p_shift_id
    AND c.count_type = 'CLOSING'
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_count.cash_register_id IS DISTINCT FROM p_cash_register_id
       OR abs(v_existing_count.counted_amount - p_counted_amount) > 0.005
       OR v_existing_count.denominations IS DISTINCT FROM p_denominations
       OR upper(v_existing_count.currency_code) IS DISTINCT FROM upper(trim(p_currency_code)) THEN
      RAISE EXCEPTION 'CAJA_CLOSE_IDEMPOTENCY_KEY_REUSED';
    END IF;

    SELECT s.data, s.version INTO v_closed_data, v_closed_version
    FROM public.shifts s
    WHERE s.id = p_shift_id;
    RETURN QUERY SELECT
      p_shift_id,
      v_existing_count.id,
      v_closed_version,
      COALESCE(v_existing_count.expected_amount, 0),
      v_existing_count.counted_amount,
      COALESCE(v_existing_count.difference, 0),
      v_existing_count.blind,
      v_existing_count.denominations,
      v_existing_count.currency_code,
      v_existing_count.created_at,
      v_closed_data;
    RETURN;
  END IF;

  IF v_shift.data->>'status' <> 'OPEN' THEN
    RAISE EXCEPTION 'SHIFT_NOT_OPEN';
  END IF;

  -- close_shift_atomic mantiene la misma fórmula de cálculo usada por el cierre estándar.
  SELECT cs.data, cs.version INTO v_closed_data, v_closed_version
  FROM public.close_shift_atomic(p_shift_id, p_counted_amount, p_notes) cs;

  v_expected := COALESCE((v_closed_data->>'expectedAmount')::numeric, 0);
  v_difference := COALESCE((v_closed_data->>'difference')::numeric, p_counted_amount - v_expected);

  INSERT INTO public.cash_drawer_counts (
    id, business_id, branch_id, cash_register_id, shift_id,
    count_type, currency_code, denominations, counted_amount,
    expected_amount, difference, blind, notes, counted_by, created_at
  ) VALUES (
    gen_random_uuid(), p_business_id, p_branch_id, p_cash_register_id, p_shift_id,
    'CLOSING', upper(trim(p_currency_code)), p_denominations, p_counted_amount,
    v_expected, v_difference, true, p_notes, auth.uid(), v_closed_at
  )
  RETURNING id INTO v_count_id;

  RETURN QUERY SELECT
    p_shift_id,
    v_count_id,
    v_closed_version,
    v_expected,
    p_counted_amount,
    v_difference,
    true,
    p_denominations,
    upper(trim(p_currency_code)),
    v_closed_at,
    v_closed_data;
END;
$$;

REVOKE ALL ON FUNCTION public.close_shift_with_cash_count_atomic(uuid,uuid,uuid,uuid,numeric,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_shift_with_cash_count_atomic(uuid,uuid,uuid,uuid,numeric,jsonb,text,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. ENDURECER close_shift_atomic: GERENTE puede cerrar; CAJERO solo el suyo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_shift_atomic(
  p_shift_id uuid,
  p_counted_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(shift_id uuid,data jsonb,version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF p_counted_amount IS NULL OR p_counted_amount < 0 THEN RAISE EXCEPTION 'SHIFT_INVALID_COUNTED_AMOUNT'; END IF;

  SELECT * INTO v_shift FROM public.shifts s WHERE s.id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_NOT_FOUND'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = v_shift.business_id AND bm.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'SHIFT_NOT_A_MEMBER'; END IF;
  IF NOT public.has_business_role(v_shift.business_id, ARRAY['ADMIN','GERENTE','CAJERO']) THEN RAISE EXCEPTION 'SHIFT_FORBIDDEN'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = v_shift.branch_id AND b.business_id = v_shift.business_id AND b.active = true
  ) THEN RAISE EXCEPTION 'SHIFT_INVALID_BRANCH'; END IF;
  IF v_shift.data->>'status' = 'CLOSED' THEN RAISE EXCEPTION 'SHIFT_ALREADY_CLOSED'; END IF;
  IF v_shift.data->>'status' <> 'OPEN' THEN RAISE EXCEPTION 'SHIFT_NOT_OPEN'; END IF;
  IF v_shift.cash_register_id IS NULL THEN RAISE EXCEPTION 'SHIFT_CASH_REGISTER_REQUIRED'; END IF;
  IF NOT public.has_business_role(v_shift.business_id, ARRAY['ADMIN','GERENTE'])
     AND v_shift.cashier_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'SHIFT_OWNER_REQUIRED';
  END IF;

  -- No permitir cerrar mientras existan movimientos nuevos huérfanos.
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

  SELECT COALESCE(SUM((cm.data->>'amount')::numeric),0),
         COALESCE(SUM(CASE WHEN cm.data->>'type'='OUT' THEN (cm.data->>'amount')::numeric ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN cm.data->>'type'='IN' THEN COALESCE((cm.data->>'cashAmount')::numeric,0) ELSE 0 END),0)
    INTO v_total_income, v_total_expense, v_total_cash_income
  FROM public.cash_movements cm
  WHERE cm.business_id = v_shift.business_id
    AND cm.branch_id = v_shift.branch_id
    AND cm.shift_id = v_shift.id::text;

  SELECT COALESCE(jsonb_object_agg(method, amount), '{}'::jsonb)
    INTO v_income_by_method
  FROM (
    SELECT cm.data->>'paymentMethod' AS method,
           SUM(CASE WHEN cm.data->>'type'='IN' THEN (cm.data->>'amount')::numeric ELSE 0 END) AS amount
    FROM public.cash_movements cm
    WHERE cm.business_id = v_shift.business_id
      AND cm.branch_id = v_shift.branch_id
      AND cm.shift_id = v_shift.id::text
      AND cm.data->>'type'='IN'
      AND cm.data->>'paymentMethod' IS NOT NULL
    GROUP BY cm.data->>'paymentMethod'
  ) t;

  v_expected_amount := COALESCE((v_shift.data->>'openingAmount')::numeric,0) + v_total_cash_income - v_total_expense;
  v_difference := p_counted_amount - v_expected_amount;

  v_new_data := v_shift.data || jsonb_build_object(
    'status','CLOSED',
    'closedAt',v_closed_at,
    'closingNotes',p_notes,
    'totalIncome',v_total_income,
    'totalExpense',v_total_expense,
    'totalCashIncome',v_total_cash_income,
    'incomeByMethod',v_income_by_method,
    'expectedAmount',v_expected_amount,
    'countedAmount',p_counted_amount,
    'difference',v_difference
  );

  UPDATE public.shifts
  SET data=v_new_data, version=v_shift.version+1, updated_at=v_closed_at
  WHERE id=v_shift.id AND version=v_shift.version;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_CLOSE_CONFLICT'; END IF;

  INSERT INTO public.daily_report_jobs(
    business_id,branch_id,shift_id,business_date,opened_at,closed_at,data_cutoff_at,
    cash_expected,cash_counted,cash_difference,status,next_attempt_at
  )
  SELECT
    v_shift.business_id,
    v_shift.branch_id,
    v_shift.id,
    (v_closed_at AT TIME ZONE COALESCE((SELECT timezone FROM public.businesses WHERE id=v_shift.business_id),'UTC'))::date,
    NULLIF(v_shift.data->>'openedAt','')::timestamptz,
    v_closed_at,
    v_closed_at,
    v_expected_amount,
    p_counted_amount,
    v_difference,
    'PENDING',
    v_closed_at
  WHERE NOT EXISTS (SELECT 1 FROM public.daily_report_jobs drj WHERE drj.shift_id=v_shift.id);

  RETURN QUERY SELECT v_shift.id, v_new_data, v_shift.version+1;
END;
$$;

REVOKE ALL ON FUNCTION public.close_shift_atomic(uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_shift_atomic(uuid,numeric,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. VALIDACIÓN HISTÓRICA DE PAYMENT_VERIFICATIONS
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad_count bigint := 0;
BEGIN
  SELECT count(*) INTO v_bad_count
  FROM public.payment_verifications
  WHERE status = 'CONFIRMED'
    AND (verified_at IS NULL OR provider_reference IS NULL);

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION
      'CAJA_PAYMENT_VERIFICATION_HISTORY_INVALID: % filas CONFIRMED carecen de verified_at/provider_reference. Corregir antes de marcar el constraint como VALID.',
      v_bad_count;
  END IF;

  BEGIN
    ALTER TABLE public.payment_verifications
      VALIDATE CONSTRAINT payment_verifications_confirmed_consistency_ck;
  EXCEPTION
    WHEN undefined_object THEN
      RAISE EXCEPTION 'CAJA_PAYMENT_VERIFICATION_CONSTRAINT_MISSING: ejecutar V3 primero.';
  END;
END $$;

COMMIT;