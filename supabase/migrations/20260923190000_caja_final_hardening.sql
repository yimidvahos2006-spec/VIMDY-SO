-- ============================================================================
-- VIMDY CAJA — ENTERPRISE FINAL HARDENING
-- ============================================================================
-- Objetivo:
--   1) Relacionar cada movimiento financiero nuevo con un turno OPEN.
--   2) Impedir escrituras directas de caja desde el Data API.
--   3) Hacer COBRO + CAMBIO + PAID una sola transacción PostgreSQL.
--   4) Blindar idempotencia y concurrencia.
--   5) Hacer que el cierre prefiera shift_id y use fecha solo para históricos.
--
-- No modifica el historial de migrations anteriores. Es una migration nueva.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. RELACIÓN EXPLÍCITA MOVIMIENTO -> TURNO
-- ---------------------------------------------------------------------------
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS shift_id text;

CREATE INDEX IF NOT EXISTS cash_movements_shift_idx
  ON public.cash_movements (business_id, branch_id, shift_id)
  WHERE shift_id IS NOT NULL;

-- Backfill conservador: solo asignamos si existe EXACTAMENTE un turno que
-- contiene temporalmente el movimiento. Si hay cero o más de uno, queda NULL
-- para no inventar una relación histórica.
WITH matches AS (
  SELECT
    cm.id                  AS movement_id,
    s.id::text             AS shift_id,
    count(*) OVER (PARTITION BY cm.id) AS num_matches
  FROM public.cash_movements cm
  JOIN public.shifts s
    ON s.business_id = cm.business_id
   AND s.branch_id     = cm.branch_id
   AND cm.data_date >= (s.data->>'openedAt')::timestamptz
   AND cm.data_date <= COALESCE((s.data->>'closedAt')::timestamptz, 'infinity'::timestamptz)
  WHERE cm.shift_id IS NULL
)
UPDATE public.cash_movements cm
SET shift_id = matches.shift_id
FROM matches
WHERE cm.id = matches.movement_id
  AND matches.num_matches = 1;

-- ---------------------------------------------------------------------------
-- 2. NO ESCRITURA DIRECTA DE CASH_MOVEMENTS DESDE CLIENTES
-- ---------------------------------------------------------------------------
-- Caja real se escribe únicamente mediante RPCs server-side. La lectura
-- permanece disponible para usuarios autorizados mediante las policies ya
-- existentes.
DROP POLICY IF EXISTS cash_movements_tenant_insert ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_tenant_update ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_tenant_delete ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_no_direct_insert ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_no_direct_update ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_no_direct_delete ON public.cash_movements;

CREATE POLICY cash_movements_no_direct_insert
ON public.cash_movements
FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY cash_movements_no_direct_update
ON public.cash_movements
FOR UPDATE TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY cash_movements_no_direct_delete
ON public.cash_movements
FOR DELETE TO authenticated
USING (false);

-- ---------------------------------------------------------------------------
-- 3. register_movement_atomic — versión enterprise
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz) CASCADE;
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
  created_at timestamptz,
  shift_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shift_id text;
  v_existing public.cash_movements%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'CAJA_AUTH_REQUIRED';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'CAJA_IDEMPOTENCY_REQUIRED';
  END IF;

  IF p_business_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'CAJA_CONTEXT_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = p_business_id AND bm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'CAJA_NOT_A_MEMBER';
  END IF;

  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','CAJERO']) THEN
    RAISE EXCEPTION 'CAJA_FORBIDDEN';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.business_id = p_business_id
      AND b.active = true
  ) THEN
    RAISE EXCEPTION 'CAJA_INVALID_BRANCH';
  END IF;

  IF p_type NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'CAJA_INVALID_TYPE'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'CAJA_INVALID_AMOUNT'; END IF;
  IF p_cash_amount IS NULL OR p_cash_amount < 0 THEN RAISE EXCEPTION 'CAJA_INVALID_CASH_AMOUNT'; END IF;
  IF p_payment_method NOT IN ('CASH','CARD','TRANSFER','QR','MIXED') THEN
    RAISE EXCEPTION 'CAJA_INVALID_PAYMENT_METHOD';
  END IF;

  IF p_created_at IS NULL OR p_created_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'CAJA_INVALID_MOVEMENT_DATE';
  END IF;

  -- Un retry exacto devuelve la operación original sin modificarla.
  SELECT * INTO v_existing
  FROM public.cash_movements cm
  WHERE cm.business_id = p_business_id
    AND cm.branch_id = p_branch_id
    AND cm.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY
    SELECT
      v_existing.id::text,
      v_existing.idempotency_key,
      v_existing.data->>'type',
      (v_existing.data->>'amount')::numeric,
      v_existing.data->>'description',
      (v_existing.data->>'date')::timestamptz,
      v_existing.data->>'paymentMethod',
      COALESCE((v_existing.data->>'cashAmount')::numeric,0),
      v_existing.business_id,
      v_existing.branch_id,
      v_existing.data->>'saleId',
      (v_existing.data->>'createdAt')::timestamptz,
      v_existing.shift_id;
    RETURN;
  END IF;

  -- El turno se bloquea para que cierre y movimiento nunca puedan cruzarse.
  SELECT s.id INTO v_shift_id
  FROM public.shifts s
  WHERE s.business_id = p_business_id
    AND s.branch_id = p_branch_id
    AND s.data->>'status' = 'OPEN'
  ORDER BY (s.data->>'openedAt')::timestamptz DESC
  LIMIT 1
  FOR UPDATE;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT';
  END IF;

  IF p_type = 'OUT' THEN
    IF p_payment_method <> 'CASH' OR p_cash_amount <> p_amount THEN
      RAISE EXCEPTION 'CAJA_INVALID_EXPENSE';
    END IF;
  ELSE
    IF p_payment_method = 'CASH' AND p_cash_amount <> p_amount THEN
      RAISE EXCEPTION 'CAJA_INVALID_CASH_INCOME';
    END IF;
    IF p_payment_method IN ('CARD','TRANSFER','QR') AND p_cash_amount <> 0 THEN
      RAISE EXCEPTION 'CAJA_INVALID_NON_CASH_AMOUNT';
    END IF;
    IF p_payment_method = 'MIXED' AND p_cash_amount > p_amount THEN
      RAISE EXCEPTION 'CAJA_INVALID_MIXED_CASH';
    END IF;
  END IF;

  INSERT INTO public.cash_movements (
    id, idempotency_key, business_id, branch_id, shift_id, data
  ) VALUES (
    gen_random_uuid()::text,
    p_idempotency_key,
    p_business_id,
    p_branch_id,
    v_shift_id,
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
      'shiftId', v_shift_id,
      'createdAt', p_created_at,
      'businessId', p_business_id::text,
      'branchId', p_branch_id::text
    )
  )
  ON CONFLICT (business_id, branch_id, idempotency_key) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.cash_movements cm
  WHERE cm.business_id = p_business_id
    AND cm.branch_id = p_branch_id
    AND cm.idempotency_key = p_idempotency_key
  FOR UPDATE;

  RETURN QUERY
  SELECT
    v_existing.id::text,
    v_existing.idempotency_key,
    v_existing.data->>'type',
    (v_existing.data->>'amount')::numeric,
    v_existing.data->>'description',
    (v_existing.data->>'date')::timestamptz,
    v_existing.data->>'paymentMethod',
    COALESCE((v_existing.data->>'cashAmount')::numeric,0),
    v_existing.business_id,
    v_existing.branch_id,
    v_existing.data->>'saleId',
    (v_existing.data->>'createdAt')::timestamptz,
    v_existing.shift_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. COBRO DE VENTA ATÓMICO
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_sale_payment_atomic(
  p_sale_id text,
  p_business_id uuid,
  p_branch_id uuid,
  p_payment_id text,
  p_change_id text DEFAULT NULL,
  p_payment_method text DEFAULT 'CASH',
  p_total numeric DEFAULT 0,
  p_cash_amount numeric DEFAULT 0,
  p_received numeric DEFAULT 0,
  p_change numeric DEFAULT 0,
  p_reference text DEFAULT NULL
)
RETURNS TABLE(
  sale_data jsonb,
  sale_version integer,
  payment_idempotency_key text,
  payment_amount numeric,
  payment_description text,
  payment_date timestamptz,
  payment_method text,
  payment_cash_amount numeric,
  change_idempotency_key text,
  change_amount numeric,
  change_description text,
  change_date timestamptz,
  business_id uuid,
  branch_id uuid,
  shift_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_sale_total numeric;
  v_sale_status text;
  v_shift_id text;
  v_payment public.cash_movements%ROWTYPE;
  v_change public.cash_movements%ROWTYPE;
  v_paid_data jsonb;
  v_has_change boolean := false;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CAJA_AUTH_REQUIRED'; END IF;
  IF p_sale_id IS NULL OR p_payment_id IS NULL OR btrim(p_payment_id) = '' THEN
    RAISE EXCEPTION 'CAJA_PAYMENT_IDENTIFIERS_REQUIRED';
  END IF;
  IF p_business_id IS NULL OR p_branch_id IS NULL THEN RAISE EXCEPTION 'CAJA_CONTEXT_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_members bm WHERE bm.business_id=p_business_id AND bm.user_id=auth.uid()) THEN
    RAISE EXCEPTION 'CAJA_NOT_A_MEMBER';
  END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','CAJERO']) THEN RAISE EXCEPTION 'CAJA_FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id=p_branch_id AND b.business_id=p_business_id AND b.active=true) THEN
    RAISE EXCEPTION 'CAJA_INVALID_BRANCH';
  END IF;

  IF p_payment_method NOT IN ('CASH','CARD','TRANSFER','QR','MIXED') THEN RAISE EXCEPTION 'CAJA_INVALID_PAYMENT_METHOD'; END IF;
  IF p_total <= 0 OR p_cash_amount < 0 OR p_received < 0 OR p_change < 0 THEN RAISE EXCEPTION 'CAJA_INVALID_PAYMENT'; END IF;
  IF abs(p_change - greatest(p_received - p_total, 0)) > 0.005 THEN RAISE EXCEPTION 'CAJA_INVALID_CHANGE'; END IF;

  -- Orden de locks estable: VENTA -> TURNO. Evita doble cobro de la misma
  -- venta y reduce riesgos de deadlock con cierres que solo bloquean turno.
  SELECT * INTO v_sale
  FROM public.sales s
  WHERE s.id = p_sale_id
    AND s.business_id = p_business_id
    AND s.branch_id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;

  v_sale_total := (v_sale.data->>'total')::numeric;
  v_sale_status := v_sale.data->>'status';

  IF abs(v_sale_total - p_total) > 0.005 THEN RAISE EXCEPTION 'CAJA_SALE_TOTAL_MISMATCH'; END IF;

  -- Retry exacto: si ya existe el payment key para esta venta, devolver el
  -- resultado confirmado. Si la venta está PAID pero no existe esa clave,
  -- jamás creamos un segundo cobro silenciosamente.
  SELECT * INTO v_payment
  FROM public.cash_movements cm
  WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_payment_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_payment.data->>'saleId' IS DISTINCT FROM p_sale_id THEN RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED'; END IF;
    IF v_sale_status NOT IN ('PAID','CLOSED') THEN RAISE EXCEPTION 'CAJA_PAYMENT_SALE_STATE_MISMATCH'; END IF;
    IF p_change_id IS NOT NULL THEN
      SELECT * INTO v_change FROM public.cash_movements cm WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_change_id FOR UPDATE;
      v_has_change := FOUND;
    END IF;
    RETURN QUERY SELECT
      v_sale.data, v_sale.version,
      v_payment.idempotency_key, (v_payment.data->>'amount')::numeric, v_payment.data->>'description', (v_payment.data->>'date')::timestamptz,
      v_payment.data->>'paymentMethod', COALESCE((v_payment.data->>'cashAmount')::numeric,0),
      CASE WHEN v_has_change THEN v_change.idempotency_key ELSE NULL END,
      CASE WHEN v_has_change THEN (v_change.data->>'amount')::numeric ELSE NULL END,
      CASE WHEN v_has_change THEN v_change.data->>'description' ELSE NULL END,
      CASE WHEN v_has_change THEN (v_change.data->>'date')::timestamptz ELSE NULL END,
      p_business_id, p_branch_id, v_payment.shift_id;
    RETURN;
  END IF;

  IF v_sale_status IN ('PAID','CLOSED') THEN RAISE EXCEPTION 'SALE_ALREADY_PAID'; END IF;
  IF v_sale_status IN ('CANCELLED','REFUNDED') THEN RAISE EXCEPTION 'SALE_NOT_PAYABLE'; END IF;
  IF v_sale_status NOT IN ('PENDING_PAYMENT','OPEN') THEN RAISE EXCEPTION 'SALE_INVALID_STATE'; END IF;

  SELECT * INTO v_shift
  FROM public.shifts s
  WHERE s.business_id=p_business_id AND s.branch_id=p_branch_id AND s.data->>'status'='OPEN'
  ORDER BY (s.data->>'openedAt')::timestamptz DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT'; END IF;
  v_shift_id := v_shift.id;

  -- Reglas de efectivo server-side.
  IF p_payment_method='CASH' THEN
    IF abs(p_cash_amount-p_total)>0.005 OR p_received<p_total THEN RAISE EXCEPTION 'CAJA_INVALID_CASH_PAYMENT'; END IF;
  ELSIF p_payment_method IN ('CARD','TRANSFER','QR') THEN
    IF p_cash_amount<>0 OR abs(p_received-p_total)>0.005 OR p_change<>0 THEN RAISE EXCEPTION 'CAJA_INVALID_NON_CASH_PAYMENT'; END IF;
  ELSE
    IF p_cash_amount>p_received OR p_change>p_cash_amount THEN RAISE EXCEPTION 'CAJA_INVALID_MIXED_PAYMENT'; END IF;
  END IF;

  -- Ingreso de la venta.
  INSERT INTO public.cash_movements(id,idempotency_key,business_id,branch_id,shift_id,data)
  VALUES (
    gen_random_uuid()::text,p_payment_id,p_business_id,p_branch_id,v_shift_id,
    jsonb_build_object(
      'id',p_payment_id,'idempotencyKey',p_payment_id,'type','IN','amount',p_total,
      'description',format('Venta %s (%s)',coalesce(v_sale.data->>'code',p_sale_id),p_payment_method),
      'date',v_now,'paymentMethod',p_payment_method,'cashAmount',p_cash_amount,
      'saleId',p_sale_id,'shiftId',v_shift_id,'createdAt',v_now,
      'businessId',p_business_id::text,'branchId',p_branch_id::text
    )
  )
  ON CONFLICT (business_id,branch_id,idempotency_key) DO NOTHING;

  SELECT * INTO v_payment FROM public.cash_movements cm WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_payment_id FOR UPDATE;

  -- Cambio: segundo movimiento dentro de la MISMA transacción.
  IF p_change>0 THEN
    IF p_change_id IS NULL OR btrim(p_change_id)='' THEN RAISE EXCEPTION 'CAJA_CHANGE_ID_REQUIRED'; END IF;
    INSERT INTO public.cash_movements(id,idempotency_key,business_id,branch_id,shift_id,data)
    VALUES (
      gen_random_uuid()::text,p_change_id,p_business_id,p_branch_id,v_shift_id,
      jsonb_build_object(
        'id',p_change_id,'idempotencyKey',p_change_id,'type','OUT','amount',p_change,
        'description',format('Cambio venta %s',coalesce(v_sale.data->>'code',p_sale_id)),
        'date',v_now,'paymentMethod','CASH','cashAmount',p_change,
        'saleId',p_sale_id,'shiftId',v_shift_id,'createdAt',v_now,
        'businessId',p_business_id::text,'branchId',p_branch_id::text
      )
    )
    ON CONFLICT (business_id,branch_id,idempotency_key) DO NOTHING;
    SELECT * INTO v_change FROM public.cash_movements cm WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_change_id FOR UPDATE;
    v_has_change := FOUND;
    IF NOT v_has_change OR v_change.data->>'saleId' IS DISTINCT FROM p_sale_id THEN RAISE EXCEPTION 'CAJA_CHANGE_KEY_REUSED'; END IF;
  ELSE
    v_has_change := false;
  END IF;

  -- La venta pasa a PAID en la misma transacción financiera.
  v_paid_data := v_sale.data || jsonb_build_object(
    'status','PAID',
    'paymentMethod',p_payment_method,
    'cashAmount',p_cash_amount,
    'paymentReference',NULLIF(p_reference,''),
    'paymentReceived',p_received,
    'changeGiven',p_change,
    'paidAt',v_now,
    'shiftId',v_shift_id
  );

  UPDATE public.sales
  SET data=v_paid_data,
      version=v_sale.version+1,
      updated_at=v_now
  WHERE id=p_sale_id
    AND business_id=p_business_id
    AND branch_id=p_branch_id
    AND version=v_sale.version
    AND data->>'status' IN ('PENDING_PAYMENT','OPEN');

  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_PAYMENT_CONFLICT'; END IF;

  RETURN QUERY SELECT
    v_paid_data, v_sale.version+1,
    v_payment.idempotency_key, (v_payment.data->>'amount')::numeric, v_payment.data->>'description', (v_payment.data->>'date')::timestamptz,
    v_payment.data->>'paymentMethod', COALESCE((v_payment.data->>'cashAmount')::numeric,0),
    CASE WHEN v_has_change THEN v_change.idempotency_key ELSE NULL END,
    CASE WHEN v_has_change THEN (v_change.data->>'amount')::numeric ELSE NULL END,
    CASE WHEN v_has_change THEN v_change.data->>'description' ELSE NULL END,
    CASE WHEN v_has_change THEN (v_change.data->>'date')::timestamptz ELSE NULL END,
    p_business_id,p_branch_id,v_shift_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text) TO authenticated;

COMMENT ON FUNCTION public.register_sale_payment_atomic IS
'Caja Enterprise: bloquea venta+turno y confirma ingreso+cambio+PAID en una sola transacción. Idempotente, multi-tenant, RBAC y fail-closed.';

-- ---------------------------------------------------------------------------
-- 5. CIERRE: shift_id primero, fecha solo para históricos sin relación.
-- ---------------------------------------------------------------------------
-- Reemplazamos la lógica de cálculo de close_shift_atomic mediante una versión
-- completa que conserva el contrato existente y evita mezclar movimientos de
-- otro turno en límites temporales.
CREATE OR REPLACE FUNCTION public.close_shift_atomic(
  p_shift_id uuid,
  p_counted_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(shift_id uuid,data jsonb,version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SHIFT_AUTH_REQUIRED'; END IF;
  IF p_counted_amount IS NULL OR p_counted_amount < 0 THEN RAISE EXCEPTION 'SHIFT_INVALID_COUNTED_AMOUNT'; END IF;

  SELECT s.business_id,s.branch_id,s.data,s.version
  INTO v_shift_business_id,v_shift_branch_id,v_shift_data,v_shift_version
  FROM public.shifts s WHERE s.id=p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_NOT_FOUND'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.business_members bm WHERE bm.business_id=v_shift_business_id AND bm.user_id=auth.uid()) THEN RAISE EXCEPTION 'SHIFT_NOT_A_MEMBER'; END IF;
  IF NOT public.has_business_role(v_shift_business_id,ARRAY['ADMIN','CAJERO']) THEN RAISE EXCEPTION 'SHIFT_FORBIDDEN'; END IF;
  IF v_shift_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id=v_shift_branch_id AND b.business_id=v_shift_business_id AND b.active=true) THEN RAISE EXCEPTION 'SHIFT_INVALID_BRANCH'; END IF;

  v_status:=v_shift_data->>'status';
  IF v_status='CLOSED' THEN RAISE EXCEPTION 'SHIFT_ALREADY_CLOSED'; END IF;
  IF v_status<>'OPEN' THEN RAISE EXCEPTION 'SHIFT_NOT_OPEN'; END IF;
  v_opened_at:=(v_shift_data->>'openedAt')::timestamptz;
  IF v_opened_at IS NULL THEN RAISE EXCEPTION 'SHIFT_INVALID_OPENED_AT'; END IF;

  SELECT COALESCE(SUM((cm.data->>'amount')::numeric) FILTER (WHERE cm.data->>'type'='IN'),0),
         COALESCE(SUM((cm.data->>'amount')::numeric) FILTER (WHERE cm.data->>'type'='OUT'),0),
         COALESCE(SUM(COALESCE((cm.data->>'cashAmount')::numeric,0)) FILTER (WHERE cm.data->>'type'='IN'),0)
  INTO v_total_income,v_total_expense,v_total_cash_income
  FROM public.cash_movements cm
  WHERE cm.business_id=v_shift_business_id AND cm.branch_id=v_shift_branch_id
    AND (cm.shift_id=p_shift_id::text OR (cm.shift_id IS NULL AND cm.data_date>=v_opened_at AND cm.data_date<=v_closed_at));

  SELECT COALESCE(jsonb_object_agg(method,total),'{}'::jsonb) INTO v_income_by_method
  FROM (
    SELECT COALESCE(cm.data->>'paymentMethod','CASH') method,SUM((cm.data->>'amount')::numeric) total
    FROM public.cash_movements cm
    WHERE cm.business_id=v_shift_business_id AND cm.branch_id=v_shift_branch_id
      AND (cm.shift_id=p_shift_id::text OR (cm.shift_id IS NULL AND cm.data_date>=v_opened_at AND cm.data_date<=v_closed_at))
      AND cm.data->>'type'='IN'
    GROUP BY COALESCE(cm.data->>'paymentMethod','CASH')
  ) methods;

  v_expected_amount=COALESCE((v_shift_data->>'openingAmount')::numeric,0)+v_total_cash_income-v_total_expense;
  v_difference=p_counted_amount-v_expected_amount;

  v_new_data=v_shift_data || jsonb_build_object(
    'status','CLOSED','totalIncome',v_total_income,'totalExpense',v_total_expense,
    'totalCashIncome',v_total_cash_income,'incomeByMethod',v_income_by_method,
    'expectedAmount',v_expected_amount,'countedAmount',p_counted_amount,
    'difference',v_difference,'closedAt',v_closed_at,'closingNotes',p_notes
  );

  UPDATE public.shifts SET data=v_new_data,version=v_shift_version+1,updated_at=v_closed_at
  WHERE id=p_shift_id AND version=v_shift_version AND business_id=v_shift_business_id AND branch_id=v_shift_branch_id AND data->>'status'='OPEN';
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_CLOSE_CONFLICT'; END IF;

  RETURN QUERY SELECT p_shift_id,v_new_data,v_shift_version+1;
END;
$$;

REVOKE ALL ON FUNCTION public.close_shift_atomic(uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_shift_atomic(uuid,numeric,text) TO authenticated;

COMMIT;
