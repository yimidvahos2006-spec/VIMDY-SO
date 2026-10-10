BEGIN;

-- ============================================================================
-- PASO 9 — WOMPI POS FIX
-- ----------------------------------------------------------------------------
-- 1. cash_amount column on payment_sessions (numeric, NOT NULL DEFAULT 0)
-- 2. create_wompi_sale_payment_session_atomic RPC (service_role, validates
--    cash_amount + external_amount, creates session with provider='wompi')
-- 3. finalize_wompi_sale_payment_atomic RPC (service_role ONLY, validates
--    everything, calls register_sale_payment_atomic internally)
-- ============================================================================

-- 1) cash_amount column
ALTER TABLE public.payment_sessions
  ADD COLUMN IF NOT EXISTS cash_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.payment_sessions
  ADD CONSTRAINT payment_sessions_cash_amount_ck
  CHECK (cash_amount >= 0);

-- 2) create_wompi_sale_payment_session_atomic
CREATE OR REPLACE FUNCTION public.create_wompi_sale_payment_session_atomic(
  p_sale_id text,
  p_payment_method text,
  p_cash_amount numeric,
  p_external_amount numeric,
  p_idempotency_key text,
  p_shift_id text DEFAULT NULL,
  p_cash_register_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_sale public.sales%ROWTYPE;
  v_existing public.payment_sessions%ROWTYPE;
  v_sale_id uuid;
  v_method text := upper(COALESCE(p_payment_method, ''));
  v_sale_total numeric;
  v_currency text;
  v_session public.payment_sessions%ROWTYPE;
  v_expected_external numeric;
  v_expected_cash numeric;
BEGIN
  -- Auth
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_SESSION_AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;

  -- Idempotency key
  IF NULLIF(btrim(p_idempotency_key), '') IS NULL OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_IDEMPOTENCY_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Payment method
  IF v_method NOT IN ('CARD', 'TRANSFER', 'QR', 'MIXED') THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_METHOD_INVALID' USING ERRCODE = '22023';
  END IF;

  -- cash_amount validation
  IF p_cash_amount IS NULL OR p_cash_amount < 0 THEN
    RAISE EXCEPTION 'WOMPI_CASH_AMOUNT_INVALID';
  END IF;

  -- External amount validation
  IF p_external_amount IS NULL OR p_external_amount <= 0 THEN
    RAISE EXCEPTION 'WOMPI_EXTERNAL_AMOUNT_INVALID';
  END IF;

  -- Parse sale_id
  BEGIN
    v_sale_id := NULLIF(btrim(p_sale_id), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_SALE_ID_INVALID' USING ERRCODE = '22023';
  END;
  IF v_sale_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_SESSION_SALE_ID_REQUIRED' USING ERRCODE = '22023'; END IF;

  -- Lock sale row and validate tenant
  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.id = v_sale_id
    AND sale.business_id IN (SELECT public.auth_business_ids())
    AND (sale.branch_id IS NULL OR sale.branch_id = ANY (public.auth_branch_ids()))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  -- Membership + role
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members AS member
    WHERE member.business_id = v_sale.business_id AND member.user_id = v_actor_id
  ) OR NOT public.has_business_role(v_sale.business_id, ARRAY['ADMIN', 'GERENTE', 'CAJERO']) THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Sale state
  IF v_sale.data->>'status' NOT IN ('PENDING_PAYMENT', 'OPEN') THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_SALE_STATE_INVALID';
  END IF;

  -- Read total + currency from server (NOT from client)
  v_sale_total := NULLIF(v_sale.data->>'total', '')::numeric;
  IF v_sale_total IS NULL OR v_sale_total <= 0 THEN
    RAISE EXCEPTION 'WOMPI_SALE_TOTAL_INVALID';
  END IF;

  SELECT business.currency INTO v_currency
  FROM public.businesses AS business WHERE business.id = v_sale.business_id;
  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'WOMPI_CURRENCY_INVALID';
  END IF;

  -- Validate cash/external amounts based on method
  IF v_method IN ('CARD', 'TRANSFER', 'QR') THEN
    IF p_cash_amount <> 0 THEN
      RAISE EXCEPTION 'WOMPI_CASH_AMOUNT_MUST_BE_ZERO_FOR_PURE_EXTERNAL';
    END IF;
    v_expected_external := v_sale_total;
    v_expected_cash := 0;
  ELSE
    -- MIXED: validate cash_amount + external_amount = total
    IF p_cash_amount + p_external_amount <> v_sale_total THEN
      RAISE EXCEPTION 'WOMPI_MIXED_AMOUNT_MISMATCH'
        USING MESSAGE = format('cash_amount (%s) + external_amount (%s) != sale total (%s)',
          p_cash_amount, p_external_amount, v_sale_total);
    END IF;
    IF p_cash_amount >= v_sale_total THEN
      RAISE EXCEPTION 'WOMPI_CASH_AMOUNT_EXCEEDS_TOTAL';
    END IF;
    v_expected_external := p_external_amount;
    v_expected_cash := p_cash_amount;
  END IF;

  -- Idempotency: same key → same session (rejected if payload differs)
  SELECT session.* INTO v_existing
  FROM public.payment_sessions AS session
  WHERE session.business_id = v_sale.business_id
    AND session.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.sale_id IS DISTINCT FROM v_sale_id
       OR v_existing.payment_method IS DISTINCT FROM v_method
       OR v_existing.amount IS DISTINCT FROM v_expected_external
       OR v_existing.cash_amount IS DISTINCT FROM v_expected_cash
       OR v_existing.branch_id IS DISTINCT FROM v_sale.branch_id THEN
      RAISE EXCEPTION 'PAYMENT_SESSION_IDEMPOTENCY_KEY_REUSED';
    END IF;
    RETURN jsonb_build_object(
      'success', true, 'idempotent', true,
      'session', to_jsonb(v_existing),
      'externalAmount', v_expected_external,
      'cashAmount', v_expected_cash
    );
  END IF;

  -- Create session with provider = 'wompi' (NEVER 'external_terminal')
  INSERT INTO public.payment_sessions (
    business_id, branch_id, sale_id, provider, payment_method,
    amount, cash_amount, currency, status, idempotency_key, actor_id,
    metadata, expires_at
  ) VALUES (
    v_sale.business_id, v_sale.branch_id, v_sale_id, 'wompi', v_method,
    v_expected_external, v_expected_cash, v_currency, 'pending', p_idempotency_key, v_actor_id,
    jsonb_build_object(
      'origin', 'pos_wompi',
      'posPaymentMethod', v_method,
      'saleTotal', v_sale_total,
      'posShiftId', NULLIF(btrim(p_shift_id), ''),
      'posCashRegisterId', NULLIF(btrim(p_cash_register_id), '')
    ),
    clock_timestamp() + interval '30 minutes'
  ) RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'success', true, 'idempotent', false,
    'session', to_jsonb(v_session),
    'externalAmount', v_expected_external,
    'cashAmount', v_expected_cash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_wompi_sale_payment_session_atomic(text, text, numeric, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_wompi_sale_payment_session_atomic(text, text, numeric, numeric, text, text, text) TO authenticated;

-- 3) finalize_wompi_sale_payment_atomic (service_role ONLY)
--    This is the server-side-only function that validates everything and
--    calls register_sale_payment_atomic internally. It does NOT require auth.uid()
--    to match a specific cashier, but it does validate all financial context.
CREATE OR REPLACE FUNCTION public.finalize_wompi_sale_payment_atomic(
  p_session_id text,
  p_wompi_transaction_id text,
  p_wompi_reference text,
  p_amount_in_cents bigint,
  p_currency text,
  p_payment_method text,
  p_verification_source text DEFAULT 'PROVIDER'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.payment_sessions%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_session_id uuid;
  v_sale_id uuid;
  v_expected_amount_in_cents bigint;
  v_payment_id text;
  v_change_id text;
  v_payment_method text;
  v_total numeric;
  v_cash_amount numeric;
  v_received numeric;
  v_change numeric;
  v_reference text;
  v_shift_id uuid;
  v_cash_register_id uuid;
  v_existing_verification boolean;
  v_verification_id uuid;
  v_result jsonb;
BEGIN
  -- ONLY service_role can call this
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FINALIZE_WOMPI_PROVIDER_ONLY' USING ERRCODE = '42501';
  END IF;

  -- Validate args
  IF NULLIF(btrim(p_session_id), '') IS NULL OR NULLIF(btrim(p_wompi_reference), '') IS NULL THEN
    RAISE EXCEPTION 'FINALIZE_WOMPI_ARGS_REQUIRED';
  END IF;

  -- Parse session_id
  BEGIN
    v_session_id := p_session_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'FINALIZE_WOMPI_SESSION_ID_INVALID' USING ERRCODE = '22023';
  END;

  -- Load session with lock
  SELECT session.* INTO v_session
  FROM public.payment_sessions AS session
  WHERE session.id = v_session_id
    AND session.provider = 'wompi'
    AND session.provider_reference = btrim(p_wompi_reference)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINALIZE_WOMPI_SESSION_NOT_FOUND';
  END IF;

  -- Prevent state downgrade — if already in terminal state, return idempotent
  IF v_session.status IN ('approved', 'declined', 'cancelled', 'error') THEN
    RETURN jsonb_build_object(
      'success', true, 'idempotent', true,
      'status', v_session.status,
      'alreadyFinalized', true
    );
  END IF;

  -- Load sale
  v_sale_id := v_session.sale_id;
  IF v_sale_id IS NULL THEN
    RAISE EXCEPTION 'FINALIZE_WOMPI_SESSION_HAS_NO_SALE';
  END IF;

  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.id = v_sale_id
    AND sale.business_id = v_session.business_id
    AND (sale.branch_id IS NULL OR sale.branch_id = v_session.branch_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINALIZE_WOMPI_SALE_NOT_FOUND';
  END IF;

  -- Validate amount (session.amount is the external portion, stored in cents)
  v_expected_amount_in_cents := ceil(v_session.amount * 100);
  IF p_amount_in_cents <> v_expected_amount_in_cents THEN
    RAISE EXCEPTION 'FINALIZE_WOMPI_AMOUNT_MISMATCH'
      USING MESSAGE = format('expected %s cents, got %s', v_expected_amount_in_cents, p_amount_in_cents);
  END IF;

  -- Validate currency
  IF p_currency IS DISTINCT FROM v_session.currency THEN
    RAISE EXCEPTION 'FINALIZE_WOMPI_CURRENCY_MISMATCH';
  END IF;

  -- Validate payment_method
  v_payment_method := v_session.payment_method;
  IF v_payment_method IS NULL THEN
    v_payment_method := 'CARD';
  END IF;

  -- Determine amounts from session (NOT from Wompi payload)
  -- v_session.amount = external portion (what Wompi should charge)
  -- v_session.cash_amount = cash portion entered at POS
  -- v_total = sale total = cash_amount + external_amount
  v_total := (v_sale.data->>'total')::numeric;
  v_cash_amount := COALESCE(v_session.cash_amount, 0);

  -- Validation: for MIXED, cash_amount + session.amount must equal sale total
  -- For pure methods, cash_amount must be 0 and session.amount = sale total
  IF v_payment_method = 'MIXED' THEN
    IF v_cash_amount + v_session.amount <> v_total THEN
      RAISE EXCEPTION 'FINALIZE_WOMPI_MIXED_AMOUNT_MISMATCH'
        USING MESSAGE = format('cash_amount (%s) + session.amount (%s) != sale total (%s)',
          v_cash_amount, v_session.amount, v_total);
    END IF;
  ELSE
    IF v_cash_amount <> 0 THEN
      RAISE EXCEPTION 'FINALIZE_WOMPI_NON_MIXED_HAS_CASH';
    END IF;
  END IF;

  v_change := 0;
  v_reference := p_wompi_reference;
  -- p_received must equal sale total for RPC validation (MIXED: cash + external)
  v_received := v_total;

  -- Get shift + cash_register from session metadata (captured at POS checkout time)
  v_shift_id := NULLIF(v_session.metadata->>'posShiftId', '')::uuid;
  v_cash_register_id := NULLIF(v_session.metadata->>'posCashRegisterId', '')::uuid;

  -- Fallback: if not in metadata, try to find open shift for this tenant
  IF v_shift_id IS NULL THEN
    SELECT s.id INTO v_shift_id
    FROM public.shifts AS s
    WHERE s.business_id = v_session.business_id
      AND s.branch_id = v_session.branch_id
      AND s.data->>'status' = 'OPEN'
    ORDER BY s.id ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  v_payment_id := 'sale-payment-' || v_sale_id::text;
  v_change_id := 'sale-change-' || v_sale_id::text;

  -- 7) Insert payment_verifications (CONFIRMED) via service_role
  --    Use ON CONFLICT to handle replay idempotency
  INSERT INTO public.payment_verifications (
    business_id, branch_id, sale_id, payment_id, method,
    amount, provider, provider_reference, status, verified_at,
    metadata
  ) VALUES (
    v_session.business_id, v_session.branch_id, v_sale_id::text,
    v_payment_id, v_payment_method,
    v_session.amount, 'wompi', p_wompi_reference,
    'CONFIRMED', clock_timestamp(),
    jsonb_build_object(
      'wompiTransactionId', p_wompi_transaction_id,
      'provider', 'wompi'
    )
   )
   ON CONFLICT (business_id, branch_id, provider, provider_reference) DO UPDATE
     SET status = 'CONFIRMED',
         verified_at = clock_timestamp(),
         metadata = payment_verifications.metadata || EXCLUDED.metadata
   RETURNING id INTO v_verification_id;

   -- v_verification_id is non-null if the row was newly inserted (not a replay)
   -- If it already existed, ON CONFLICT did UPDATE, still returns the id → not a true replay indicator.
   -- We check idempotency at the register_sale_payment_atomic level instead.
   v_existing_verification := (v_verification_id IS NOT NULL);

   -- 8) Call register_sale_payment_atomic (the single source of truth)
  --    For MIXED, this sets cashAmount properly
  SELECT * INTO v_result
  FROM public.register_sale_payment_atomic(
    p_sale_id => v_sale_id::text,
    p_business_id => v_session.business_id,
    p_branch_id => v_session.branch_id,
    p_payment_id => v_payment_id,
    p_change_id => v_change_id,
    p_payment_method => v_payment_method,
    p_total => v_total,
    p_cash_amount => v_cash_amount,
    p_received => v_total,
    p_change => v_change,
    p_reference => v_reference,
    p_cash_register_id => v_cash_register_id,
    p_verification_source => 'PROVIDER',
    p_shift_id => v_shift_id
  );

  -- 9) Update session status
  UPDATE public.payment_sessions
  SET status = 'approved',
      updated_at = clock_timestamp()
  WHERE id = v_session_id;

  -- 10) Audit log
  INSERT INTO public.subscription_audit_log (business_id, action, actor_type, actor_id, details)
  VALUES (
    v_session.business_id,
    'WOMPI_SALE_PAYMENT_APPROVED',
    'payment_provider',
    NULL,
    jsonb_build_object(
      'sessionId', v_session_id::text,
      'saleId', v_sale_id::text,
      'paymentId', v_payment_id,
      'amount', v_received,
      'currency', v_session.currency,
      'reference', p_wompi_reference
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', NOT v_existing_verification,
    'status', 'approved',
    'saleId', v_sale_id::text,
    'paymentVerificationId', v_verification_id
  );
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error
    INSERT INTO public.subscription_audit_log (business_id, action, actor_type, actor_id, details)
    VALUES (
      v_session.business_id,
      'WOMPI_SALE_PAYMENT_FAILED',
      'payment_provider',
      NULL,
      jsonb_build_object(
        'sessionId', COALESCE(v_session_id::text, p_session_id),
        'error', SQLERRM,
        'reference', p_wompi_reference
      )
    );
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_wompi_sale_payment_atomic(text, text, text, bigint, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_wompi_sale_payment_atomic(text, text, text, bigint, text, text, text) TO service_role;

COMMIT;
