BEGIN;

ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS refunded_amount numeric NOT NULL DEFAULT 0;

UPDATE public.subscription_payments
SET provider = CASE
  WHEN wompi_reference IS NOT NULL THEN 'wompi'
  WHEN mercadopago_reference IS NOT NULL THEN 'mercadopago'
  WHEN paypal_order_id IS NOT NULL THEN 'paypal'
  ELSE provider
END
WHERE provider IS NULL;

UPDATE public.subscription_payments
SET refunded_amount = amount
WHERE status = 'refunded' AND refunded_amount = 0;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscription_payments'::regclass
      AND conname = 'subscription_payments_refunded_amount_range_ck'
  ) THEN
    ALTER TABLE public.subscription_payments
      ADD CONSTRAINT subscription_payments_refunded_amount_range_ck
      CHECK (refunded_amount >= 0 AND refunded_amount <= amount) NOT VALID;
  END IF;
END;
$constraint$;

ALTER TABLE public.subscription_payments
  VALIDATE CONSTRAINT subscription_payments_refunded_amount_range_ck;

CREATE TABLE IF NOT EXISTS public.payment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT,
  sale_id uuid REFERENCES public.sales(id) ON DELETE CASCADE,
  subscription_payment_id uuid UNIQUE REFERENCES public.subscription_payments(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN (
    'wompi', 'mercadopago', 'paypal', 'external_terminal', 'external_provider'
  )),
  payment_method text,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (char_length(currency) BETWEEN 3 AND 6),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'declined', 'cancelled', 'expired', 'error',
    'partially_refunded', 'refunded'
  )),
  provider_reference text,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_sessions_target_ck CHECK (
    (sale_id IS NOT NULL AND subscription_payment_id IS NULL)
    OR (sale_id IS NULL AND subscription_payment_id IS NOT NULL)
  ),
  CONSTRAINT payment_sessions_business_branch_id_uq UNIQUE (id, business_id, branch_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_sessions_business_idempotency_uq
  ON public.payment_sessions (business_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS payment_sessions_provider_reference_uq
  ON public.payment_sessions (business_id, provider, provider_reference)
  WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_sessions_tenant_status_created_idx
  ON public.payment_sessions (business_id, branch_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_sessions_sale_idx
  ON public.payment_sessions (business_id, branch_id, sale_id)
  WHERE sale_id IS NOT NULL;

ALTER TABLE public.payment_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_sessions TO authenticated;
GRANT ALL ON public.payment_sessions TO service_role;
DROP POLICY IF EXISTS payment_sessions_tenant_read ON public.payment_sessions;
CREATE POLICY payment_sessions_tenant_read ON public.payment_sessions
  FOR SELECT TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
  );

CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT,
  sale_id uuid REFERENCES public.sales(id) ON DELETE CASCADE,
  subscription_payment_id uuid REFERENCES public.subscription_payments(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.payment_sessions(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN (
    'cash', 'wompi', 'mercadopago', 'paypal', 'external_terminal', 'external_provider'
  )),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  payload_hash text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (char_length(currency) BETWEEN 3 AND 6),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
  provider_reference text,
  reason text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CONSTRAINT payment_refunds_target_ck CHECK (
    (sale_id IS NOT NULL AND subscription_payment_id IS NULL)
    OR (sale_id IS NULL AND subscription_payment_id IS NOT NULL)
  ),
  CONSTRAINT payment_refunds_business_idempotency_uq UNIQUE (business_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_provider_reference_uq
  ON public.payment_refunds (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_refunds_tenant_sale_idx
  ON public.payment_refunds (business_id, branch_id, sale_id, created_at DESC)
  WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_refunds_subscription_idx
  ON public.payment_refunds (business_id, subscription_payment_id, status)
  WHERE subscription_payment_id IS NOT NULL;

ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_refunds TO authenticated;
GRANT ALL ON public.payment_refunds TO service_role;
DROP POLICY IF EXISTS payment_refunds_tenant_read ON public.payment_refunds;
CREATE POLICY payment_refunds_tenant_read ON public.payment_refunds
  FOR SELECT TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
  );

CREATE OR REPLACE FUNCTION public.sync_subscription_payment_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_provider text;
  v_provider_reference text;
  v_session_status text;
BEGIN
  v_provider := COALESCE(
    NEW.provider,
    CASE
      WHEN NEW.wompi_reference IS NOT NULL THEN 'wompi'
      WHEN NEW.mercadopago_reference IS NOT NULL THEN 'mercadopago'
      WHEN NEW.paypal_order_id IS NOT NULL THEN 'paypal'
      ELSE NULL
    END
  );
  IF v_provider IS NULL THEN
    RETURN NEW;
  END IF;

  v_provider_reference := CASE v_provider
    WHEN 'wompi' THEN NEW.wompi_reference
    WHEN 'mercadopago' THEN NEW.mercadopago_reference
    WHEN 'paypal' THEN NEW.paypal_order_id
    ELSE NULL
  END;
  v_session_status := CASE
    WHEN NEW.status = 'approved' AND NEW.refunded_amount > 0
      AND NEW.refunded_amount < NEW.amount THEN 'partially_refunded'
    WHEN NEW.status = 'approved' THEN 'approved'
    WHEN NEW.status = 'refunded' THEN 'refunded'
    WHEN NEW.status = 'declined' THEN 'declined'
    WHEN NEW.status = 'cancelled' THEN 'cancelled'
    WHEN NEW.status = 'error' THEN 'error'
    WHEN NEW.status = 'pending' THEN 'pending'
    ELSE 'error'
  END;

  INSERT INTO public.payment_sessions (
    id, business_id, branch_id, subscription_payment_id, provider, payment_method,
    amount, currency, status, provider_reference, idempotency_key, actor_id,
    metadata, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.business_id, NULL, NEW.id, v_provider, NEW.payment_method,
    NEW.amount, NEW.currency, v_session_status, v_provider_reference,
    COALESCE(NEW.idempotency_key, NEW.id::text), auth.uid(),
    jsonb_build_object('plan', NEW.plan, 'renewalNumber', NEW.renewal_number),
    NEW.created_at, clock_timestamp()
  )
  ON CONFLICT (subscription_payment_id) DO UPDATE
  SET provider = EXCLUDED.provider,
      payment_method = COALESCE(EXCLUDED.payment_method, public.payment_sessions.payment_method),
      provider_reference = COALESCE(EXCLUDED.provider_reference, public.payment_sessions.provider_reference),
      status = CASE
        WHEN public.payment_sessions.status IN ('refunded', 'partially_refunded')
          AND EXCLUDED.status IN ('pending', 'approved', 'declined', 'error')
          THEN public.payment_sessions.status
        WHEN public.payment_sessions.status = 'approved'
          AND EXCLUDED.status IN ('pending', 'declined', 'error')
          THEN public.payment_sessions.status
        ELSE EXCLUDED.status
      END,
      metadata = public.payment_sessions.metadata || EXCLUDED.metadata,
      updated_at = clock_timestamp();

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_subscription_payment_session() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_subscription_payment_session_write ON public.subscription_payments;
CREATE TRIGGER sync_subscription_payment_session_write
AFTER INSERT OR UPDATE OF provider, status, payment_method, wompi_reference,
  mercadopago_reference, paypal_order_id, refunded_amount
ON public.subscription_payments
FOR EACH ROW EXECUTE FUNCTION public.sync_subscription_payment_session();

UPDATE public.subscription_payments
SET provider = COALESCE(provider,
  CASE
    WHEN wompi_reference IS NOT NULL THEN 'wompi'
    WHEN mercadopago_reference IS NOT NULL THEN 'mercadopago'
    WHEN paypal_order_id IS NOT NULL THEN 'paypal'
    ELSE NULL
  END)
WHERE provider IS NULL;

INSERT INTO public.payment_sessions (
  id, business_id, branch_id, subscription_payment_id, provider, payment_method,
  amount, currency, status, provider_reference, idempotency_key, metadata,
  created_at, updated_at
)
SELECT
  payment.id, payment.business_id, NULL, payment.id, payment.provider,
  payment.payment_method, payment.amount, payment.currency,
  CASE
    WHEN payment.status = 'approved' AND payment.refunded_amount > 0
      AND payment.refunded_amount < payment.amount THEN 'partially_refunded'
    WHEN payment.status = 'approved' THEN 'approved'
    WHEN payment.status = 'refunded' THEN 'refunded'
    WHEN payment.status = 'declined' THEN 'declined'
    WHEN payment.status = 'cancelled' THEN 'cancelled'
    WHEN payment.status = 'error' THEN 'error'
    ELSE 'pending'
  END,
  CASE payment.provider
    WHEN 'wompi' THEN payment.wompi_reference
    WHEN 'mercadopago' THEN payment.mercadopago_reference
    WHEN 'paypal' THEN payment.paypal_order_id
  END,
  COALESCE(payment.idempotency_key, payment.id::text),
  jsonb_build_object('plan', payment.plan, 'renewalNumber', payment.renewal_number),
  payment.created_at, clock_timestamp()
FROM public.subscription_payments AS payment
WHERE payment.provider IN ('wompi', 'mercadopago', 'paypal')
ON CONFLICT (subscription_payment_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_sale_payment_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.data->>'paymentStatus' = 'CONFIRMED'
     AND NEW.data->>'status' IN ('PAID', 'CLOSED') THEN
    v_status := 'approved';
  ELSIF NEW.data->>'status' = 'REFUNDED' THEN
    v_status := 'refunded';
  ELSIF jsonb_array_length(COALESCE(NEW.data->'refunds', '[]'::jsonb)) >
        jsonb_array_length(COALESCE(OLD.data->'refunds', '[]'::jsonb)) THEN
    v_status := 'partially_refunded';
  ELSE
    RETURN NEW;
  END IF;

  UPDATE public.payment_sessions AS session
  SET status = v_status,
      provider_reference = COALESCE(NEW.data->>'paymentReference', session.provider_reference),
      updated_at = clock_timestamp()
  WHERE session.business_id = NEW.business_id
    AND session.branch_id IS NOT DISTINCT FROM NEW.branch_id
    AND session.sale_id = NEW.id
    AND session.status IN ('pending', 'approved', 'partially_refunded');

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_sale_payment_session() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sync_sale_payment_session_state ON public.sales;
CREATE TRIGGER sync_sale_payment_session_state
AFTER UPDATE OF data ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.sync_sale_payment_session();

CREATE OR REPLACE FUNCTION public.create_sale_payment_session_atomic(
  p_sale_id text,
  p_payment_method text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_sale public.sales%ROWTYPE;
  v_existing public.payment_sessions%ROWTYPE;
  v_sale_id uuid;
  v_method text := upper(COALESCE(p_payment_method, ''));
  v_provider text;
  v_amount numeric;
  v_currency text;
  v_session public.payment_sessions%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_SESSION_AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_idempotency_key), '') IS NULL OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_IDEMPOTENCY_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF v_method NOT IN ('CARD', 'TRANSFER', 'QR', 'MIXED') THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_METHOD_INVALID' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_sale_id := NULLIF(btrim(p_sale_id), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_SALE_ID_INVALID' USING ERRCODE = '22023';
  END;
  IF v_sale_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_SESSION_SALE_ID_REQUIRED' USING ERRCODE = '22023'; END IF;

  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.id = v_sale_id
    AND sale.business_id IN (SELECT public.auth_business_ids())
    AND (sale.branch_id IS NULL OR sale.branch_id = ANY (public.auth_branch_ids()))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members AS member
    WHERE member.business_id = v_sale.business_id AND member.user_id = v_actor_id
  ) OR NOT public.has_business_role(v_sale.business_id, ARRAY['ADMIN', 'GERENTE', 'CAJERO']) THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_sale.data->>'status' NOT IN ('PENDING_PAYMENT', 'OPEN') THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_SALE_STATE_INVALID';
  END IF;

  v_amount := NULLIF(v_sale.data->>'total', '')::numeric;
  SELECT business.currency INTO v_currency
  FROM public.businesses AS business WHERE business.id = v_sale.business_id;
  IF v_amount IS NULL OR v_amount <= 0 OR v_currency IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_FINANCIAL_CONTEXT_INVALID';
  END IF;
  v_provider := CASE WHEN v_method = 'CARD' THEN 'external_terminal' ELSE 'external_provider' END;

  SELECT session.* INTO v_existing
  FROM public.payment_sessions AS session
  WHERE session.business_id = v_sale.business_id
    AND session.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.sale_id IS DISTINCT FROM v_sale_id
       OR v_existing.payment_method IS DISTINCT FROM v_method
       OR v_existing.amount IS DISTINCT FROM v_amount
       OR v_existing.branch_id IS DISTINCT FROM v_sale.branch_id THEN
      RAISE EXCEPTION 'PAYMENT_SESSION_IDEMPOTENCY_KEY_REUSED';
    END IF;
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'session', to_jsonb(v_existing));
  END IF;

  INSERT INTO public.payment_sessions (
    business_id, branch_id, sale_id, provider, payment_method, amount, currency,
    status, idempotency_key, actor_id, metadata, expires_at
  ) VALUES (
    v_sale.business_id, v_sale.branch_id, v_sale_id, v_provider, v_method,
    v_amount, v_currency, 'pending', p_idempotency_key, v_actor_id,
    jsonb_build_object('origin', 'pos_sale'), clock_timestamp() + interval '30 minutes'
  ) RETURNING * INTO v_session;

  RETURN jsonb_build_object('success', true, 'idempotent', false, 'session', to_jsonb(v_session));
END;
$$;
REVOKE ALL ON FUNCTION public.create_sale_payment_session_atomic(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_payment_session_atomic(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_subscription_refund_atomic(
  p_subscription_payment_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_reason text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.subscription_payments%ROWTYPE;
  v_existing public.payment_refunds%ROWTYPE;
  v_refund public.payment_refunds%ROWTYPE;
  v_amount numeric;
  v_reserved numeric;
  v_hash text;
BEGIN
  IF p_subscription_payment_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REFUND_CONTEXT_REQUIRED';
  END IF;
  IF NULLIF(btrim(p_idempotency_key), '') IS NULL OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'REFUND_IDEMPOTENCY_KEY_REQUIRED';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'REFUND_ACTOR_MISMATCH' USING ERRCODE = '42501';
  END IF;

  SELECT payment.* INTO v_payment
  FROM public.subscription_payments AS payment
  WHERE payment.id = p_subscription_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_PAYMENT_NOT_FOUND'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members AS member
    WHERE member.business_id = v_payment.business_id
      AND member.user_id = p_actor_id AND member.role = 'ADMIN'
  ) THEN RAISE EXCEPTION 'REFUND_FORBIDDEN' USING ERRCODE = '42501'; END IF;

  v_hash := pg_catalog.encode(extensions.digest(
    concat_ws('|', p_subscription_payment_id::text, COALESCE(p_amount::text, 'FULL'), COALESCE(p_reason, '')),
    'sha256'
  ), 'hex');
  SELECT refund.* INTO v_existing
  FROM public.payment_refunds AS refund
  WHERE refund.business_id = v_payment.business_id
    AND refund.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.subscription_payment_id IS DISTINCT FROM p_subscription_payment_id
       OR v_existing.payload_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'REFUND_IDEMPOTENCY_KEY_REUSED';
    END IF;
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'refund', to_jsonb(v_existing));
  END IF;

  IF v_payment.status NOT IN ('approved', 'partially_refunded') THEN
    RAISE EXCEPTION 'PAYMENT_NOT_REFUNDABLE';
  END IF;
  SELECT COALESCE(sum(refund.amount), 0) INTO v_reserved
  FROM public.payment_refunds AS refund
  WHERE refund.subscription_payment_id = p_subscription_payment_id
    AND refund.status IN ('pending', 'confirmed');
  v_amount := COALESCE(p_amount, v_payment.amount - v_reserved);
  IF v_amount <= 0 OR v_amount > v_payment.amount - v_reserved THEN
    RAISE EXCEPTION 'REFUND_AMOUNT_EXCEEDS_REMAINING';
  END IF;

  INSERT INTO public.payment_refunds (
    business_id, subscription_payment_id, session_id, provider,
    idempotency_key, payload_hash, amount, currency, status, reason, actor_id,
    metadata
  ) VALUES (
    v_payment.business_id, v_payment.id,
    (SELECT session.id FROM public.payment_sessions AS session WHERE session.subscription_payment_id = v_payment.id),
    v_payment.provider, p_idempotency_key, v_hash, v_amount, v_payment.currency,
    'pending', COALESCE(NULLIF(btrim(p_reason), ''), 'Refund requested'), p_actor_id,
    jsonb_build_object('plan', v_payment.plan)
  ) RETURNING * INTO v_refund;

  INSERT INTO public.subscription_audit_log (business_id, action, actor_type, actor_id, details)
  VALUES (v_payment.business_id, 'SUBSCRIPTION_REFUND_REQUESTED', 'user', p_actor_id,
    jsonb_build_object('refundId', v_refund.id, 'paymentId', v_payment.id,
      'amount', v_amount, 'currency', v_payment.currency, 'idempotencyKey', p_idempotency_key));

  RETURN jsonb_build_object('success', true, 'idempotent', false, 'refund', to_jsonb(v_refund));
END;
$$;
REVOKE ALL ON FUNCTION public.request_subscription_refund_atomic(uuid, numeric, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_subscription_refund_atomic(uuid, numeric, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.settle_subscription_refund_atomic(
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
  v_payment public.subscription_payments%ROWTYPE;
  v_refunded numeric;
  v_payment_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'REFUND_PROVIDER_SETTLEMENT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('pending', 'confirmed', 'failed') THEN RAISE EXCEPTION 'REFUND_STATUS_INVALID'; END IF;
  SELECT refund.* INTO v_refund
  FROM public.payment_refunds AS refund WHERE refund.id = p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_refund.subscription_payment_id IS NULL THEN RAISE EXCEPTION 'REFUND_NOT_FOUND'; END IF;
  SELECT payment.* INTO v_payment
  FROM public.subscription_payments AS payment
  WHERE payment.id = v_refund.subscription_payment_id FOR UPDATE;

  IF v_refund.status = 'confirmed' THEN
    IF p_status = 'confirmed' AND v_refund.provider_reference IS NOT DISTINCT FROM p_provider_reference THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true,
        'status', v_refund.status, 'refundedAmount', v_payment.refunded_amount);
    END IF;
    RAISE EXCEPTION 'REFUND_ALREADY_SETTLED';
  END IF;
  IF v_refund.status = 'failed' THEN
    IF p_status = 'failed' THEN RETURN jsonb_build_object('success', true, 'idempotent', true, 'status', 'failed'); END IF;
    RAISE EXCEPTION 'REFUND_ALREADY_SETTLED';
  END IF;

  IF p_status = 'pending' THEN
    UPDATE public.payment_refunds
    SET provider_reference = COALESCE(NULLIF(btrim(p_provider_reference), ''), provider_reference),
        updated_at = p_now
    WHERE id = p_refund_id;
    RETURN jsonb_build_object('success', true, 'idempotent', false, 'status', 'pending');
  ELSIF p_status = 'failed' THEN
    UPDATE public.payment_refunds SET status = 'failed',
      provider_reference = COALESCE(NULLIF(btrim(p_provider_reference), ''), provider_reference),
      updated_at = p_now
    WHERE id = p_refund_id;
    INSERT INTO public.subscription_audit_log (business_id, action, actor_type, actor_id, details)
    VALUES (v_payment.business_id, 'SUBSCRIPTION_REFUND_FAILED', 'payment_provider', v_refund.actor_id,
      jsonb_build_object('refundId', p_refund_id, 'paymentId', v_payment.id,
        'providerReference', p_provider_reference));
    RETURN jsonb_build_object('success', true, 'idempotent', false, 'status', 'failed');
  END IF;

  IF NULLIF(btrim(p_provider_reference), '') IS NULL THEN
    RAISE EXCEPTION 'REFUND_PROVIDER_REFERENCE_REQUIRED';
  END IF;
  IF v_payment.status NOT IN ('approved', 'partially_refunded') THEN
    RAISE EXCEPTION 'PAYMENT_NOT_REFUNDABLE';
  END IF;

  v_refunded := v_payment.refunded_amount + v_refund.amount;
  IF v_refunded > v_payment.amount THEN RAISE EXCEPTION 'REFUND_AMOUNT_EXCEEDS_ORIGINAL'; END IF;
  v_payment_status := CASE WHEN v_refunded >= v_payment.amount THEN 'refunded' ELSE 'partially_refunded' END;

  UPDATE public.payment_refunds SET status = 'confirmed',
    provider_reference = p_provider_reference, updated_at = p_now, confirmed_at = p_now
  WHERE id = p_refund_id;
  UPDATE public.subscription_payments SET
    refunded_amount = v_refunded,
    status = v_payment_status,
    provider_refund_id = p_provider_reference,
    refunded_at = CASE WHEN v_payment_status = 'refunded' THEN p_now ELSE refunded_at END
  WHERE id = v_payment.id;
  IF v_payment_status = 'refunded' THEN
    UPDATE public.businesses SET payment_status = 'declined' WHERE id = v_payment.business_id;
  END IF;

  INSERT INTO public.subscription_audit_log (business_id, action, actor_type, actor_id, details)
  VALUES (v_payment.business_id, 'SUBSCRIPTION_REFUND_CONFIRMED', 'payment_provider', v_refund.actor_id,
    jsonb_build_object('refundId', p_refund_id, 'paymentId', v_payment.id,
      'amount', v_refund.amount, 'totalRefunded', v_refunded, 'currency', v_payment.currency,
      'providerReference', p_provider_reference, 'status', v_payment_status));

  RETURN jsonb_build_object('success', true, 'idempotent', false,
    'status', 'confirmed', 'paymentStatus', v_payment_status, 'refundedAmount', v_refunded);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_subscription_refund_atomic(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_subscription_refund_atomic(uuid, text, text, timestamptz) TO service_role;

COMMIT;