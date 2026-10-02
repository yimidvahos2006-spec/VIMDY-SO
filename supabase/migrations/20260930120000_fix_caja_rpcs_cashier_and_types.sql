-- Corrige en una migración nueva (hacia adelante) seis funciones de caja que
-- ya están aplicadas en producción con defectos de ejecución:
--   * v_shift.cashier_id: la tabla shifts no tiene esa columna; el cajero vive en data->>'cashierId'.
--   * register_sale_payment_atomic: p_sale_id llega como texto y se compara con uuid; ambigüedad de variables.
--   * sync_cash_register_link: no leer NEW.shift_id fuera de cash_movements.
-- Los cuerpos son copia literal de las versiones corregidas localmente en
-- caja_enterprise_v2 / v3 / v4. Esas tres migraciones vuelven a su contenido original.
-- Las firmas no cambian, por eso CREATE OR REPLACE conserva permisos y triggers.

-- sync_cash_register_link (fuente: 20260927230000_caja_enterprise_v2.sql)
CREATE OR REPLACE FUNCTION public.sync_cash_register_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.cash_register_id IS NULL AND NULLIF(NEW.data->>'cashRegisterId','') IS NOT NULL THEN
    NEW.cash_register_id := (NEW.data->>'cashRegisterId')::uuid;
  END IF;

  IF NEW.cash_register_id IS NOT NULL THEN
    NEW.data := jsonb_set(NEW.data, '{cashRegisterId}', to_jsonb(NEW.cash_register_id::text), true);
  END IF;

  IF TG_TABLE_NAME = 'cash_movements' THEN
    IF NEW.shift_id IS NOT NULL THEN
      NEW.data := jsonb_set(NEW.data, '{shiftId}', to_jsonb(NEW.shift_id), true);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- register_movement_atomic (fuente: 20260928010000_caja_enterprise_v3_integrity.sql)
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
SET search_path = public
AS $$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_existing public.cash_movements%ROWTYPE;
  v_register_id uuid := p_cash_register_id;
  v_open_shift_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CAJA_AUTH_REQUIRED'; END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'CAJA_IDEMPOTENCY_REQUIRED'; END IF;
  IF p_business_id IS NULL OR p_branch_id IS NULL THEN RAISE EXCEPTION 'CAJA_CONTEXT_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_members bm WHERE bm.business_id = p_business_id AND bm.user_id = auth.uid()) THEN RAISE EXCEPTION 'CAJA_NOT_A_MEMBER'; END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','CAJERO']) THEN RAISE EXCEPTION 'CAJA_FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b.business_id = p_business_id AND b.active = true) THEN RAISE EXCEPTION 'CAJA_INVALID_BRANCH'; END IF;
  IF p_type NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'CAJA_INVALID_TYPE'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'CAJA_INVALID_AMOUNT'; END IF;
  IF p_cash_amount IS NULL OR p_cash_amount < 0 THEN RAISE EXCEPTION 'CAJA_INVALID_CASH_AMOUNT'; END IF;
  IF p_payment_method NOT IN ('CASH','CARD','TRANSFER','QR','MIXED') THEN RAISE EXCEPTION 'CAJA_INVALID_PAYMENT_METHOD'; END IF;
  IF p_payment_method = 'CASH' AND p_verification_source IS DISTINCT FROM 'CASH' THEN RAISE EXCEPTION 'CAJA_CASH_CONFIRMATION_REQUIRED'; END IF;
  IF p_payment_method = 'CARD' AND p_verification_source NOT IN ('EXTERNAL_TERMINAL','PROVIDER') THEN RAISE EXCEPTION 'CAJA_CARD_CONFIRMATION_REQUIRED'; END IF;
  IF p_payment_method IN ('TRANSFER','QR') AND p_verification_source IS DISTINCT FROM 'PROVIDER' THEN RAISE EXCEPTION 'CAJA_PAYMENT_NOT_VERIFIED'; END IF;
  IF p_payment_method = 'MIXED' AND p_verification_source NOT IN ('EXTERNAL_TERMINAL','PROVIDER') THEN RAISE EXCEPTION 'CAJA_MIXED_CONFIRMATION_REQUIRED'; END IF;
  IF p_created_at IS NULL OR p_created_at > clock_timestamp() + interval '5 minutes' THEN RAISE EXCEPTION 'CAJA_INVALID_MOVEMENT_DATE'; END IF;

  SELECT * INTO v_existing
  FROM public.cash_movements cm
  WHERE cm.business_id = p_business_id
    AND cm.branch_id = p_branch_id
    AND cm.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_existing.id::text, v_existing.idempotency_key,
      v_existing.data->>'type', (v_existing.data->>'amount')::numeric,
      v_existing.data->>'description', (v_existing.data->>'date')::timestamptz,
      v_existing.data->>'paymentMethod', COALESCE((v_existing.data->>'cashAmount')::numeric,0),
      v_existing.business_id, v_existing.branch_id, v_existing.data->>'saleId',
      (v_existing.data->>'createdAt')::timestamptz,
      v_existing.cash_register_id, v_existing.shift_id, v_existing.data->>'paymentVerificationSource';
    RETURN;
  END IF;

  IF v_register_id IS NULL THEN
    SELECT count(*) INTO v_open_shift_count
    FROM public.shifts s
    WHERE s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.data->>'status' = 'OPEN';

    IF v_open_shift_count = 0 THEN
      RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT';
    ELSIF v_open_shift_count > 1 THEN
      RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
    END IF;

    SELECT s.cash_register_id INTO v_register_id
    FROM public.shifts s
    WHERE s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.data->>'status' = 'OPEN'
    ORDER BY s.id ASC
    LIMIT 1;

    IF v_register_id IS NULL THEN
      SELECT count(*) INTO v_open_shift_count
      FROM public.cash_registers r
      WHERE r.business_id = p_business_id
        AND r.branch_id = p_branch_id
        AND r.active = true
        AND r.status = 'ACTIVE';

      IF v_open_shift_count = 0 THEN
        PERFORM public.ensure_default_cash_register(p_business_id, p_branch_id);
        SELECT count(*) INTO v_open_shift_count
        FROM public.cash_registers r
        WHERE r.business_id = p_business_id
          AND r.branch_id = p_branch_id
          AND r.active = true
          AND r.status = 'ACTIVE';
      END IF;

      IF v_open_shift_count <> 1 THEN
        RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
      END IF;

      SELECT r.id INTO v_register_id
      FROM public.cash_registers r
      WHERE r.business_id = p_business_id
        AND r.branch_id = p_branch_id
        AND r.active = true
        AND r.status = 'ACTIVE'
      LIMIT 1;
    END IF;

    IF v_register_id IS NULL THEN
      RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
    END IF;
  END IF;

  SELECT * INTO v_shift
  FROM public.shifts s
  WHERE s.business_id = p_business_id
    AND s.branch_id = p_branch_id
    AND s.data->>'status' = 'OPEN'
    AND (s.cash_register_id = v_register_id OR s.cash_register_id IS NULL)
  ORDER BY (s.cash_register_id = v_register_id) DESC, NULLIF(s.data->>'openedAt','')::timestamptz ASC NULLS LAST, s.id ASC
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT'; END IF;

  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN'])
     AND NULLIF(v_shift.data->>'cashierId', '')::uuid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'CAJA_SHIFT_OWNER_REQUIRED';
  END IF;

  -- Compatibilidad segura solo para un turno ABIERTO legado sin caja:
  -- si existe, se vincula al único registro seleccionado de forma explícita.
  IF v_shift.cash_register_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.shifts s2
      WHERE s2.business_id = p_business_id
        AND s2.branch_id = p_branch_id
        AND s2.data->>'status' = 'OPEN'
        AND s2.cash_register_id IS NULL
        AND s2.id <> v_shift.id
    ) THEN
      RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
    END IF;

    UPDATE public.shifts
    SET cash_register_id = v_register_id,
        data = jsonb_set(data, '{cashRegisterId}', to_jsonb(v_register_id::text), true),
        updated_at = clock_timestamp()
    WHERE id = v_shift.id;

    v_shift.cash_register_id := v_register_id;
  END IF;

  IF p_type = 'OUT' THEN
    IF p_payment_method <> 'CASH' OR p_cash_amount <> p_amount THEN RAISE EXCEPTION 'CAJA_INVALID_EXPENSE'; END IF;
  ELSE
    IF p_payment_method = 'CASH' AND p_cash_amount <> p_amount THEN RAISE EXCEPTION 'CAJA_INVALID_CASH_INCOME'; END IF;
    IF p_payment_method IN ('CARD','TRANSFER','QR') AND p_cash_amount <> 0 THEN RAISE EXCEPTION 'CAJA_INVALID_NON_CASH_AMOUNT'; END IF;
    IF p_payment_method = 'MIXED' AND p_cash_amount > p_amount THEN RAISE EXCEPTION 'CAJA_INVALID_MIXED_CASH'; END IF;
  END IF;

  INSERT INTO public.cash_movements(
    id, idempotency_key, business_id, branch_id, cash_register_id, shift_id, data
  ) VALUES (
    gen_random_uuid(), p_idempotency_key, p_business_id, p_branch_id, v_register_id, v_shift.id::text,
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
      'shiftId', v_shift.id::text,
      'cashRegisterId', v_register_id::text,
      'createdAt', p_created_at,
      'businessId', p_business_id::text,
      'branchId', p_branch_id::text,
      'userId', auth.uid()::text,
      'paymentVerificationSource', p_verification_source
    )
  )
  ON CONFLICT (business_id, branch_id, idempotency_key) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.cash_movements cm
  WHERE cm.business_id = p_business_id AND cm.branch_id = p_branch_id AND cm.idempotency_key = p_idempotency_key
  FOR UPDATE;

  RETURN QUERY SELECT
    v_existing.id::text, v_existing.idempotency_key,
    v_existing.data->>'type', (v_existing.data->>'amount')::numeric,
    v_existing.data->>'description', (v_existing.data->>'date')::timestamptz,
    v_existing.data->>'paymentMethod', COALESCE((v_existing.data->>'cashAmount')::numeric,0),
    v_existing.business_id, v_existing.branch_id, v_existing.data->>'saleId',
    (v_existing.data->>'createdAt')::timestamptz,
    v_existing.cash_register_id, v_existing.shift_id, v_existing.data->>'paymentVerificationSource';
END;
$$;

-- register_sale_payment_atomic (fuente: 20260928010000_caja_enterprise_v3_integrity.sql)
CREATE OR REPLACE FUNCTION public.register_sale_payment_atomic(
  p_sale_id text,
  p_business_id uuid,
  p_branch_id uuid,
  p_payment_id text,
  p_change_id text,
  p_payment_method text,
  p_total numeric,
  p_cash_amount numeric,
  p_received numeric,
  p_change numeric,
  p_reference text DEFAULT NULL,
  p_cash_register_id uuid DEFAULT NULL,
  p_verification_source text DEFAULT NULL,
  p_shift_id uuid DEFAULT NULL
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
  cash_register_id uuid,
  shift_id text,
  payment_verification_source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_sale public.sales%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_payment public.cash_movements%ROWTYPE;
  v_change public.cash_movements%ROWTYPE;
  v_cash_register_id uuid := p_cash_register_id;
  v_open_shift_count integer := 0;
  v_payment_date timestamptz := clock_timestamp();
  v_paid_data jsonb;
  v_has_change boolean := false;
  v_verified_provider_reference text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CAJA_AUTH_REQUIRED'; END IF;
  IF p_sale_id IS NULL OR p_payment_id IS NULL OR btrim(p_payment_id) = '' THEN RAISE EXCEPTION 'CAJA_PAYMENT_IDENTIFIERS_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_members bm WHERE bm.business_id=p_business_id AND bm.user_id=auth.uid()) THEN RAISE EXCEPTION 'CAJA_NOT_A_MEMBER'; END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','CAJERO']) THEN RAISE EXCEPTION 'CAJA_FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id=p_branch_id AND b.business_id=p_business_id AND b.active=true) THEN RAISE EXCEPTION 'CAJA_INVALID_BRANCH'; END IF;
  IF p_payment_method NOT IN ('CASH','CARD','TRANSFER','QR','MIXED') THEN RAISE EXCEPTION 'CAJA_INVALID_PAYMENT_METHOD'; END IF;
  IF p_total IS NULL OR p_total <= 0 OR p_cash_amount IS NULL OR p_cash_amount < 0 OR p_received IS NULL OR p_received < 0 OR p_change IS NULL OR p_change < 0 THEN RAISE EXCEPTION 'CAJA_INVALID_PAYMENT'; END IF;
  IF abs(p_change - greatest(p_received - p_total,0)) > 0.005 THEN RAISE EXCEPTION 'CAJA_INVALID_CHANGE'; END IF;

  -- Nunca se permite confirmar una transferencia/QR por una referencia sola.
  IF p_payment_method IN ('TRANSFER','QR') AND p_verification_source <> 'PROVIDER' THEN
    RAISE EXCEPTION 'CAJA_PAYMENT_NOT_VERIFIED';
  END IF;
  IF p_payment_method = 'CARD' AND p_verification_source NOT IN ('EXTERNAL_TERMINAL','PROVIDER') THEN
    RAISE EXCEPTION 'CAJA_CARD_CONFIRMATION_REQUIRED';
  END IF;
  IF p_payment_method = 'CASH' AND p_verification_source IS DISTINCT FROM 'CASH' THEN
    RAISE EXCEPTION 'CAJA_CASH_CONFIRMATION_REQUIRED';
  END IF;
  IF p_payment_method = 'MIXED' AND p_verification_source NOT IN ('EXTERNAL_TERMINAL','PROVIDER') THEN
    RAISE EXCEPTION 'CAJA_MIXED_CONFIRMATION_REQUIRED';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales s
  WHERE s.id = p_sale_id::uuid AND s.business_id = p_business_id AND s.branch_id = p_branch_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;

  IF abs((v_sale.data->>'total')::numeric - p_total) > 0.005 THEN RAISE EXCEPTION 'CAJA_SALE_TOTAL_MISMATCH'; END IF;

  IF p_payment_method IN ('TRANSFER','QR') THEN
    SELECT pv.provider_reference
      INTO v_verified_provider_reference
    FROM public.payment_verifications pv
    WHERE pv.business_id = p_business_id
      AND pv.branch_id = p_branch_id
      AND pv.sale_id = p_sale_id
      AND pv.payment_id = p_payment_id
      AND pv.method = p_payment_method
      AND pv.amount = p_total
      AND pv.status = 'CONFIRMED'
      AND pv.verified_at IS NOT NULL
      AND pv.provider_reference IS NOT NULL
    FOR UPDATE;

    IF v_verified_provider_reference IS NULL THEN
      RAISE EXCEPTION 'CAJA_PAYMENT_NOT_VERIFIED';
    END IF;

    IF NULLIF(btrim(p_reference), '') IS NOT NULL
       AND btrim(p_reference) IS DISTINCT FROM btrim(v_verified_provider_reference) THEN
      RAISE EXCEPTION 'CAJA_PAYMENT_REFERENCE_MISMATCH';
    END IF;
  END IF;

  SELECT * INTO v_payment
  FROM public.cash_movements cm
  WHERE cm.business_id = p_business_id AND cm.branch_id = p_branch_id AND cm.idempotency_key = p_payment_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_payment.data->>'saleId' IS DISTINCT FROM p_sale_id THEN RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED'; END IF;
    IF p_shift_id IS NOT NULL AND v_payment.shift_id IS DISTINCT FROM p_shift_id::text THEN RAISE EXCEPTION 'CAJA_SHIFT_MISMATCH'; END IF;
    IF p_cash_register_id IS NOT NULL AND v_payment.cash_register_id IS DISTINCT FROM p_cash_register_id THEN RAISE EXCEPTION 'CAJA_CASH_REGISTER_MISMATCH'; END IF;
    IF v_sale.data->>'status' NOT IN ('PAID','CLOSED') THEN RAISE EXCEPTION 'CAJA_PAYMENT_SALE_STATE_MISMATCH'; END IF;
    IF p_change_id IS NOT NULL THEN
      SELECT * INTO v_change
      FROM public.cash_movements cm
      WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_change_id
      FOR UPDATE;
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
      p_business_id,p_branch_id,v_payment.cash_register_id,v_payment.shift_id,
      v_payment.data->>'paymentVerificationSource';
    RETURN;
  END IF;

  IF v_sale.data->>'status' IN ('PAID','CLOSED') THEN RAISE EXCEPTION 'SALE_ALREADY_PAID'; END IF;
  IF v_sale.data->>'status' IN ('CANCELLED','REFUNDED') THEN RAISE EXCEPTION 'SALE_NOT_PAYABLE'; END IF;
  IF v_sale.data->>'status' NOT IN ('PENDING_PAYMENT','OPEN') THEN RAISE EXCEPTION 'SALE_INVALID_STATE'; END IF;

  IF p_shift_id IS NOT NULL THEN
    SELECT * INTO v_shift
    FROM public.shifts s
    WHERE s.id = p_shift_id
      AND s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.data->>'status' = 'OPEN'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CAJA_SHIFT_NOT_FOUND_OR_CLOSED';
    END IF;

    IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN'])
       AND NULLIF(v_shift.data->>'cashierId', '')::uuid IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'CAJA_SHIFT_OWNER_REQUIRED';
    END IF;

    IF v_shift.cash_register_id IS NULL THEN
      IF v_cash_register_id IS NULL THEN
        RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
      END IF;
      UPDATE public.shifts
      SET cash_register_id = v_cash_register_id,
          data = jsonb_set(data, '{cashRegisterId}', to_jsonb(v_cash_register_id::text), true),
          updated_at = clock_timestamp()
      WHERE id = v_shift.id AND cash_register_id IS NULL;
      v_shift.cash_register_id := v_cash_register_id;
    ELSIF v_cash_register_id IS NOT NULL AND v_shift.cash_register_id <> v_cash_register_id THEN
      RAISE EXCEPTION 'CAJA_CASH_REGISTER_MISMATCH';
    ELSE
      v_cash_register_id := v_shift.cash_register_id;
    END IF;
  ELSIF v_cash_register_id IS NULL THEN
    SELECT count(*) INTO v_open_shift_count
    FROM public.shifts s
    WHERE s.business_id=p_business_id
      AND s.branch_id=p_branch_id
      AND s.data->>'status'='OPEN';

    IF v_open_shift_count = 0 THEN
      RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT';
    ELSIF v_open_shift_count > 1 THEN
      RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
    END IF;

    SELECT s.cash_register_id INTO v_cash_register_id
    FROM public.shifts s
    WHERE s.business_id=p_business_id
      AND s.branch_id=p_branch_id
      AND s.data->>'status'='OPEN'
    ORDER BY s.id ASC
    LIMIT 1;

    IF v_cash_register_id IS NULL THEN
      SELECT count(*) INTO v_open_shift_count
      FROM public.cash_registers r
      WHERE r.business_id=p_business_id
        AND r.branch_id=p_branch_id
        AND r.active=true
        AND r.status='ACTIVE';

      IF v_open_shift_count = 0 THEN
        PERFORM public.ensure_default_cash_register(p_business_id, p_branch_id);
        SELECT count(*) INTO v_open_shift_count
        FROM public.cash_registers r
        WHERE r.business_id=p_business_id
          AND r.branch_id=p_branch_id
          AND r.active=true
          AND r.status='ACTIVE';
      END IF;

      IF v_open_shift_count <> 1 THEN
        RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
      END IF;

      SELECT r.id INTO v_cash_register_id
      FROM public.cash_registers r
      WHERE r.business_id=p_business_id
        AND r.branch_id=p_branch_id
        AND r.active=true
        AND r.status='ACTIVE'
      LIMIT 1;
    END IF;

    IF v_cash_register_id IS NULL THEN
      RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
    END IF;
  END IF;

  IF p_shift_id IS NULL THEN
    SELECT * INTO v_shift
    FROM public.shifts s
    WHERE s.business_id=p_business_id
      AND s.branch_id=p_branch_id
      AND s.cash_register_id=v_cash_register_id
      AND s.data->>'status'='OPEN'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT'; END IF;

    IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN'])
       AND NULLIF(v_shift.data->>'cashierId', '')::uuid IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'CAJA_SHIFT_OWNER_REQUIRED';
    END IF;
  END IF;

  IF p_payment_method='CASH' THEN
    IF abs(p_cash_amount-p_total)>0.005 OR p_received<p_total THEN RAISE EXCEPTION 'CAJA_INVALID_CASH_PAYMENT'; END IF;
  ELSIF p_payment_method IN ('CARD','TRANSFER','QR') THEN
    IF p_cash_amount<>0 OR abs(p_received-p_total)>0.005 OR p_change<>0 THEN RAISE EXCEPTION 'CAJA_INVALID_NON_CASH_PAYMENT'; END IF;
  ELSE
    IF p_cash_amount>p_received OR p_change>p_cash_amount THEN RAISE EXCEPTION 'CAJA_INVALID_MIXED_PAYMENT'; END IF;
  END IF;

  INSERT INTO public.cash_movements(id,idempotency_key,business_id,branch_id,cash_register_id,shift_id,data)
  VALUES (
    gen_random_uuid(),p_payment_id,p_business_id,p_branch_id,v_cash_register_id,v_shift.id::text,
    jsonb_build_object(
      'id',p_payment_id,'idempotencyKey',p_payment_id,'type','IN','amount',p_total,
      'description',format('Venta %s (%s)',coalesce(v_sale.data->>'code',p_sale_id),p_payment_method),
      'date',v_payment_date,'paymentMethod',p_payment_method,'cashAmount',p_cash_amount,
      'saleId',p_sale_id,'shiftId',v_shift.id::text,'cashRegisterId',v_cash_register_id::text,
      'createdAt',v_payment_date,'businessId',p_business_id::text,'branchId',p_branch_id::text,
      'userId',auth.uid()::text,
      'paymentVerificationSource',p_verification_source
    )
  ) ON CONFLICT (business_id,branch_id,idempotency_key) DO NOTHING;

  SELECT * INTO v_payment FROM public.cash_movements cm
  WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_payment_id
  FOR UPDATE;

  IF p_change>0 THEN
    IF p_change_id IS NULL OR btrim(p_change_id)='' THEN RAISE EXCEPTION 'CAJA_CHANGE_ID_REQUIRED'; END IF;
    INSERT INTO public.cash_movements(id,idempotency_key,business_id,branch_id,cash_register_id,shift_id,data)
    VALUES (
      gen_random_uuid(),p_change_id,p_business_id,p_branch_id,v_cash_register_id,v_shift.id::text,
      jsonb_build_object(
        'id',p_change_id,'idempotencyKey',p_change_id,'type','OUT','amount',p_change,
        'description',format('Cambio venta %s',coalesce(v_sale.data->>'code',p_sale_id)),
        'date',v_payment_date,'paymentMethod','CASH','cashAmount',p_change,
        'saleId',p_sale_id,'shiftId',v_shift.id::text,'cashRegisterId',v_cash_register_id::text,
        'createdAt',v_payment_date,'businessId',p_business_id::text,'branchId',p_branch_id::text,
        'userId',auth.uid()::text
      )
    ) ON CONFLICT (business_id,branch_id,idempotency_key) DO NOTHING;
    SELECT * INTO v_change FROM public.cash_movements cm
    WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_change_id
    FOR UPDATE;
    v_has_change := FOUND;
    IF NOT v_has_change OR v_change.data->>'saleId' IS DISTINCT FROM p_sale_id THEN RAISE EXCEPTION 'CAJA_CHANGE_KEY_REUSED'; END IF;
  END IF;

  v_paid_data := v_sale.data || jsonb_build_object(
    'status','PAID','paymentMethod',p_payment_method,'cashAmount',p_cash_amount,
    'paymentReference',COALESCE(v_verified_provider_reference,NULLIF(p_reference,'')),'paymentReceived',p_received,'changeGiven',p_change,
    'paymentStatus','CONFIRMED','paymentVerificationSource',p_verification_source,
    'paymentVerifiedAt',v_payment_date,'paidAt',v_payment_date,'shiftId',v_shift.id::text,
    'cashRegisterId',v_cash_register_id::text
  );

  UPDATE public.sales
  SET data=v_paid_data,version=v_sale.version+1,updated_at=v_payment_date
  WHERE id=p_sale_id::uuid AND business_id=p_business_id AND branch_id=p_branch_id
    AND version=v_sale.version AND data->>'status' IN ('PENDING_PAYMENT','OPEN');
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_PAYMENT_CONFLICT'; END IF;

  RETURN QUERY SELECT
    v_paid_data,v_sale.version+1,
    v_payment.idempotency_key,(v_payment.data->>'amount')::numeric,v_payment.data->>'description',(v_payment.data->>'date')::timestamptz,
    v_payment.data->>'paymentMethod',COALESCE((v_payment.data->>'cashAmount')::numeric,0),
    CASE WHEN v_has_change THEN v_change.idempotency_key ELSE NULL END,
    CASE WHEN v_has_change THEN (v_change.data->>'amount')::numeric ELSE NULL END,
    CASE WHEN v_has_change THEN v_change.data->>'description' ELSE NULL END,
    CASE WHEN v_has_change THEN (v_change.data->>'date')::timestamptz ELSE NULL END,
    p_business_id,p_branch_id,v_cash_register_id,v_shift.id::text,
    v_payment.data->>'paymentVerificationSource';
END;
$$;

-- register_cash_movement_enterprise (fuente: 20260928193000_caja_enterprise_v4_operational.sql)
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
     AND NULLIF(v_shift.data->>'cashierId', '')::uuid IS DISTINCT FROM auth.uid() THEN
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

-- close_shift_with_cash_count_atomic (fuente: 20260928193000_caja_enterprise_v4_operational.sql)
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
     AND NULLIF(v_shift.data->>'cashierId', '')::uuid IS DISTINCT FROM auth.uid() THEN
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

-- close_shift_atomic (fuente: 20260928193000_caja_enterprise_v4_operational.sql)
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
     AND NULLIF(v_shift.data->>'cashierId', '')::uuid IS DISTINCT FROM auth.uid() THEN
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