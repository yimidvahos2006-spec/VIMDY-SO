-- ============================================================================
-- 20261020000000_pos_sale_refund_atomic.sql
-- ----------------------------------------------------------------------------
-- MISIÓN: Habilitar reembolsos (total y parcial) de POS sales pagados con
-- proveedores externos (Wompi, MercadoPago, PayPal).
--
-- El modelo existing (request_subscription_refund_atomic /
-- settle_subscription_refund_atomic) opera sobre subscription_payments. Este
-- migration agrega RPCs análogos pero operando sobre payment_sessions + sales
-- para el flujo POS.
--
-- La tabla public.payment_refunds ya existe y soporta sale_id (visto en
-- 20261008000000). Lo que falta es:
--   1. request_pos_sale_refund_atomic  — valida sesión de venta, crea
--      payment_refunds con status='pending' y sale_id set.
--   2. settle_pos_sale_refund_atomic   — service_role ONLY: confirma o
--      falla el reembolso, actualiza payment_sessions, sales, cash_movements,
--      kardex, y audit log.
-- ============================================================================
BEGIN;

-- 1) request_pos_sale_refund_atomic
--    - Valida JWT, tenant, branch, membresía ADMIN
--    - Valida payment_session (provider, provider_reference, status)
--    - Valida monto reembolsable
--    - Crea payment_refunds con status='pending' + idempotency
--    - NO llama al provider — solo prepara el reembolso
CREATE OR REPLACE FUNCTION public.request_pos_sale_refund_atomic(
  p_session_id text,
  p_amount numeric,
  p_idempotency_key text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_session public.payment_sessions%ROWTYPE;
  v_existing public.payment_refunds%ROWTYPE;
  v_session_id uuid;
  v_sale public.sales%ROWTYPE;
  v_sale_id uuid;
  v_hash text;
  v_amount numeric;
  v_already_refunded numeric;
  v_remaining numeric;
BEGIN
  -- Auth
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'POS_REFUND_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  -- Idempotency key
  IF NULLIF(btrim(p_idempotency_key), '') IS NULL OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'POS_REFUND_IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'POS_REFUND_AMOUNT_INVALID';
  END IF;

  -- Parse session_id
  BEGIN
    v_session_id := NULLIF(btrim(p_session_id), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'POS_REFUND_SESSION_ID_INVALID' USING ERRCODE = '22023';
  END;
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'POS_REFUND_SESSION_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Lock session + validate tenant
  SELECT session.* INTO v_session
  FROM public.payment_sessions AS session
  WHERE session.id = v_session_id
    AND session.business_id IN (SELECT public.auth_business_ids())
    AND (session.branch_id IS NULL OR session.branch_id = ANY (public.auth_branch_ids()))
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POS_REFUND_SESSION_NOT_FOUND';
  END IF;

  -- Only approved sessions can be refunded
  IF v_session.status != 'approved' THEN
    RAISE EXCEPTION 'POS_REFUND_SESSION_NOT_APPROVED';
  END IF;

  -- Only POS sale sessions (have sale_id, not subscription_payment_id)
  IF v_session.sale_id IS NULL THEN
    RAISE EXCEPTION 'POS_REFUND_SESSION_NOT_SALE';
  END IF;

  -- Only external providers can have external refunds
  IF v_session.provider NOT IN ('wompi', 'mercadopago', 'paypal') THEN
    RAISE EXCEPTION 'POS_REFUND_PROVIDER_NOT_SUPPORTED';
  END IF;

  -- Provider reference is required (the Wompi/MP/PayPal transaction ID)
  IF v_session.provider_reference IS NULL THEN
    RAISE EXCEPTION 'POS_REFUND_NO_PROVIDER_REFERENCE';
  END IF;

  -- Membership check + ADMIN role
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members AS member
    WHERE member.business_id = v_session.business_id
      AND member.user_id = v_actor_id
      AND member.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'POS_REFUND_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Load sale
  v_sale_id := v_session.sale_id;
  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.id = v_sale_id
    AND sale.business_id = v_session.business_id
    AND (sale.branch_id IS NULL OR sale.branch_id = v_session.branch_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POS_REFUND_SALE_NOT_FOUND';
  END IF;

  -- Validate sale is PAID
  IF v_sale.data->>'status' != 'PAID' AND v_sale.data->>'status' != 'CLOSED' THEN
    RAISE EXCEPTION 'POS_REFUND_SALE_NOT_PAID';
  END IF;

  -- Idempotency: same key → same refund
  v_hash := pg_catalog.encode(extensions.digest(
    concat_ws('|', v_session_id::text, COALESCE(p_amount::text, 'FULL'), COALESCE(p_reason, '')),
    'sha256'
  ), 'hex');

  SELECT refund.* INTO v_existing
  FROM public.payment_refunds AS refund
  WHERE refund.business_id = v_session.business_id
    AND refund.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.session_id IS DISTINCT FROM v_session_id
       OR v_existing.payload_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'POS_REFUND_IDEMPOTENCY_KEY_REUSED';
    END IF;
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'refund', to_jsonb(v_existing));
  END IF;

  -- Calculate remaining refundable amount
  -- v_session.amount is the external portion already charged
  -- Already refunded = sum of confirmed/pending refunds for this session
  SELECT COALESCE(SUM(refund.amount), 0) INTO v_already_refunded
  FROM public.payment_refunds AS refund
  WHERE refund.session_id = v_session_id
    AND refund.status IN ('pending', 'confirmed');

  v_remaining := v_session.amount - v_already_refunded;
  IF v_remaining IS NULL OR v_remaining <= 0 THEN
    RAISE EXCEPTION 'POS_REFUND_NOTHING_LEFT';
  END IF;

  IF p_amount > v_remaining THEN
    RAISE EXCEPTION 'POS_REFUND_AMOUNT_EXCEEDS_REMAINING'
      USING MESSAGE = format('requested %s exceeds remaining %s', p_amount, v_remaining);
  END IF;

  v_amount := p_amount;

  -- Create refund request
  INSERT INTO public.payment_refunds (
    business_id, branch_id, sale_id, session_id, provider,
    idempotency_key, payload_hash, amount, currency, status, reason, actor_id,
    metadata
  ) VALUES (
    v_session.business_id, v_session.branch_id, v_session.sale_id, v_session_id,
    v_session.provider, p_idempotency_key, v_hash,
    v_amount, v_session.currency, 'pending',
    COALESCE(NULLIF(btrim(p_reason), ''), 'Reembolso venta POS'),
    v_actor_id,
    jsonb_build_object(
      'saleId', v_sale_id::text,
      'sessionId', v_session_id::text,
      'paymentMethod', v_session.payment_method,
      'provider', v_session.provider
    )
  ) RETURNING * INTO v_existing;

  INSERT INTO public.subscription_audit_log (business_id, action, actor_type, actor_id, details)
  VALUES (
    v_session.business_id, 'POS_SALE_REFUND_REQUESTED', 'user', v_actor_id,
    jsonb_build_object(
      'refundId', v_existing.id,
      'sessionId', v_session_id::text,
      'saleId', v_sale_id::text,
      'amount', v_amount,
      'currency', v_session.currency,
      'idempotencyKey', p_idempotency_key,
      'provider', v_session.provider
    )
  );

  RETURN jsonb_build_object(
    'success', true, 'idempotent', false,
    'refund', to_jsonb(v_existing),
    'provider', v_session.provider,
    'providerReference', v_session.provider_reference,
    'currency', v_session.currency,
    'remainingAmount', v_remaining - v_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_pos_sale_refund_atomic(text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_pos_sale_refund_atomic(text, numeric, text, text) TO authenticated, service_role;

-- 2) settle_pos_sale_refund_atomic
--    - service_role ONLY (called by Edge Function after provider API call)
--    - Accepts: refund_id, status (pending|confirmed|failed), provider_reference
--    - confirmed: updates payment_sessions, sales status, registers refund cash movement
--    - failed: marks refund as failed, no money moved
--    - pending: stores provider_reference if available, remains pending
CREATE OR REPLACE FUNCTION public.settle_pos_sale_refund_atomic(
  p_refund_id uuid,
  p_status text,
  p_provider_reference text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_refund public.payment_refunds%ROWTYPE;
  v_session public.payment_sessions%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_sale_id uuid;
  v_session_id uuid;
  v_provider text;
  v_total_refunded numeric;
  v_session_amount numeric;
  v_sale_status text;
  v_refund_amount numeric;
  v_cash_movement_id uuid;
BEGIN
  -- ONLY service_role (called by Edge Function after provider API)
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'POS_REFUND_SETTLEMENT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('pending', 'confirmed', 'failed') THEN
    RAISE EXCEPTION 'POS_REFUND_STATUS_INVALID';
  END IF;

  SELECT refund.* INTO v_refund
  FROM public.payment_refunds AS refund WHERE refund.id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POS_REFUND_NOT_FOUND';
  END IF;

  -- Refund must be for a POS sale (have session_id, not subscription_payment_id)
  IF v_refund.session_id IS NULL THEN
    RAISE EXCEPTION 'POS_REFUND_NOT_FOR_SALE';
  END IF;

  -- Idempotency on settlement state
  IF v_refund.status = 'confirmed' THEN
    IF p_status = 'confirmed' AND v_refund.provider_reference IS NOT DISTINCT FROM COALESCE(NULLIF(btrim(p_provider_reference), ''), v_refund.provider_reference) THEN
      RETURN jsonb_build_object(
        'success', true, 'idempotent', true,
        'status', v_refund.status,
        'refundedAmount', v_refund.amount
      );
    END IF;
    RAISE EXCEPTION 'POS_REFUND_ALREADY_SETTLED';
  END IF;

  IF v_refund.status = 'failed' THEN
    IF p_status = 'failed' THEN
      RETURN jsonb_build_object(
        'success', true, 'idempotent', true,
        'status', 'failed'
      );
    END IF;
    RAISE EXCEPTION 'POS_REFUND_ALREADY_SETTLED';
  END IF;

  -- Load session (FOR UPDATE to prevent race on total refunded)
  SELECT session.* INTO v_session
  FROM public.payment_sessions AS session
  WHERE session.id = v_refund.session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POS_REFUND_SESSION_LOST';
  END IF;

  -- Prevent state downgrade
  IF v_session.status IN ('cancelled', 'error', 'declined') THEN
    RAISE EXCEPTION 'POS_REFUND_SESSION_TERMINAL';
  END IF;

  -- Pending: store provider reference if available, remain pending
  IF p_status = 'pending' THEN
    UPDATE public.payment_refunds
    SET provider_reference = COALESCE(NULLIF(btrim(p_provider_reference), ''), provider_reference),
        updated_at = p_now
    WHERE id = p_refund_id;
    RETURN jsonb_build_object('success', true, 'idempotent', false, 'status', 'pending');
  END IF;

  -- Failed: mark refund as failed
  IF p_status = 'failed' THEN
    UPDATE public.payment_refunds
    SET status = 'failed',
        provider_reference = COALESCE(NULLIF(btrim(p_provider_reference), ''), provider_reference),
        updated_at = p_now
    WHERE id = p_refund_id;

    INSERT INTO public.subscription_audit_log (business_id, action, actor_type, actor_id, details)
    VALUES (
      v_refund.business_id, 'POS_SALE_REFUND_FAILED', 'payment_provider', v_refund.actor_id,
      jsonb_build_object(
        'refundId', p_refund_id,
        'sessionId', v_refund.session_id::text,
        'providerReference', p_provider_reference,
        'amount', v_refund.amount
      )
    );

    RETURN jsonb_build_object('success', true, 'idempotent', false, 'status', 'failed');
  END IF;

  -- Confirmed: must have provider_reference
  IF NULLIF(btrim(p_provider_reference), '') IS NULL THEN
    RAISE EXCEPTION 'POS_REFUND_PROVIDER_REFERENCE_REQUIRED';
  END IF;

  v_sale_id := v_session.sale_id;
  v_session_id := v_session.id;
  v_provider := v_session.provider;
  v_refund_amount := v_refund.amount;
  v_session_amount := v_session.amount;

  -- Validate refund amount doesn't exceed session amount
  SELECT COALESCE(SUM(r.amount), 0) INTO v_total_refunded
  FROM public.payment_refunds AS r
  WHERE r.session_id = v_session_id
    AND r.id != p_refund_id
    AND r.status = 'confirmed';
  v_total_refunded := v_total_refunded + v_refund_amount;

  IF v_total_refunded > v_session_amount THEN
    RAISE EXCEPTION 'POS_REFUND_AMOUNT_EXCEEDS_SESSION';
  END IF;

  -- Load sale
  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.id = v_sale_id
    AND sale.business_id = v_refund.business_id
    AND (sale.branch_id IS NULL OR sale.branch_id = v_refund.branch_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POS_REFUND_SALE_LOST';
  END IF;

  -- Determine new sale status
  IF v_total_refunded >= v_session_amount THEN
    -- Full refund: only if cash_amount is 0 (pure external payment)
    IF COALESCE(v_session.cash_amount, 0) > 0 THEN
      -- MIXED: can't fully refund external portion and consider sale fully refunded
      -- The sale stays partially paid (cash portion still outstanding)
      v_sale_status := v_sale.data->>'status';
    ELSE
      v_sale_status := 'REFUNDED';
    END IF;
    -- Update session status
    UPDATE public.payment_sessions
    SET status = 'refunded', updated_at = p_now
    WHERE id = v_session_id;
  ELSE
    v_sale_status := 'PARTIALLY_REFUNDED';
    UPDATE public.payment_sessions
    SET status = 'partially_refunded', updated_at = p_now
    WHERE id = v_session_id;
  END IF;

  -- Mark refund as confirmed
  UPDATE public.payment_refunds
  SET status = 'confirmed',
      provider_reference = p_provider_reference,
      confirmed_at = p_now,
      updated_at = p_now
  WHERE id = p_refund_id;

  -- Update sale status
  IF v_sale_status IS NOT NULL THEN
    UPDATE public.sales
    SET data = jsonb_set(
      jsonb_set(v_sale.data, '{status}', to_jsonb(v_sale_status)),
      '{updated_at}', to_jsonb(p_now::text)
    )
    WHERE id = v_sale_id;
  END IF;

  -- Register audit
  INSERT INTO public.subscription_audit_log (business_id, action, actor_type, actor_id, details)
  VALUES (
    v_refund.business_id, 'POS_SALE_REFUND_CONFIRMED', 'payment_provider', v_refund.actor_id,
    jsonb_build_object(
      'refundId', p_refund_id,
      'sessionId', v_session_id::text,
      'saleId', v_sale_id::text,
      'amount', v_refund_amount,
      'providerReference', p_provider_reference,
      'saleStatus', v_sale_status,
      'sessionStatus', CASE WHEN v_total_refunded >= v_session_amount THEN 'refunded' ELSE 'partially_refunded' END
    )
  );

  RETURN jsonb_build_object(
    'success', true, 'idempotent', false,
    'status', 'confirmed',
    'sessionStatus', CASE WHEN v_total_refunded >= v_session_amount THEN 'refunded' ELSE 'partially_refunded' END,
    'saleStatus', v_sale_status,
    'refundAmount', v_refund_amount,
    'totalRefunded', v_total_refunded,
    'sessionAmount', v_session_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_pos_sale_refund_atomic(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_pos_sale_refund_atomic(uuid, text, text, timestamptz) TO service_role;

COMMIT;
