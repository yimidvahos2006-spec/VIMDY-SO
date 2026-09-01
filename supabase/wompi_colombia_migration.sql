-- ============================================================================
-- VIMDY OS — Wompi Colombia: verificación automática de pagos POS
-- ============================================================================
-- SOLO DISEÑO. NO ejecutar hasta aprobación final.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENDER business_payment_credentials para configuración Wompi
--    Reutiliza la tabla existente. Las columnas *_encrypted almacenan
--    secretos ya cifrados desde la Edge Function (no texto plano).
-- ----------------------------------------------------------------------------
ALTER TABLE business_payment_credentials
  ADD COLUMN IF NOT EXISTS wompi_environment text NOT NULL DEFAULT 'test',
  ADD COLUMN IF NOT EXISTS wompi_accepted_payment_methods text[] NOT NULL DEFAULT ARRAY[
    'CARD','PSE','NEQUI','BANCOLOMBIA_TRANSFER','BANCOLOMBIA_QR','BANCOLOMBIA_COLLECT'
  ],
  ADD COLUMN IF NOT EXISTS wompi_webhook_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS wompi_default_redirect_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS wompi_auto_confirm_on_approved boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS wompi_require_exact_amount boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS wompi_pending_review_on_mismatch boolean NOT NULL DEFAULT true;

-- ----------------------------------------------------------------------------
-- 2. TABLA: wompi_incoming_payments
--    service_role escribe. authenticated solo lee según RLS.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wompi_incoming_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,

  -- Venta asociada (nullable durante la creación del intento de pago)
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,

  -- Identificadores Wompi
  wompi_transaction_id text NOT NULL,
  wompi_reference text NOT NULL,
  parent_transaction_id text,
  child_transaction_id text,

  -- Montos (Wompi entrega en centavos; VIMDY guarda en centavos COP)
  amount_in_cents bigint NOT NULL CHECK (amount_in_cents > 0),
  currency text NOT NULL DEFAULT 'COP',
  amount_paid_in_cents bigint,
  remaining_amount_in_cents bigint,

  -- Método y estado Wompi
  payment_method_type text NOT NULL,
  wompi_status text NOT NULL DEFAULT 'PENDING',
  wompi_status_message text,
  processor_response_code text,

  -- Datos mínimos del cliente (solo lo que Wompi entrega)
  customer_email text,
  customer_full_name text,
  customer_phone text,
  customer_legal_id_type text,
  customer_legal_id text,

  -- URLs y assets generados por Wompi
  redirect_url text,
  async_payment_url text,
  qr_image text,
  qr_id text,
  external_identifier text,

  -- Verificación y auditoría
  webhook_verified boolean NOT NULL DEFAULT false,
  api_verified boolean NOT NULL DEFAULT false,
  verification_attempts integer NOT NULL DEFAULT 0,
  last_verified_at timestamptz,

  -- Evento Wompi sanitizado (solo campos necesarios para auditoría)
  raw_event jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Estado interno VIMDY (independiente del estado Wompi)
  vimdy_status text NOT NULL DEFAULT 'pending',
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  finalized_at timestamptz,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT wompi_incoming_payments_wompi_status_check CHECK (
    wompi_status IN ('APPROVED','DECLINED','VOIDED','ERROR','PENDING')
  ),
  CONSTRAINT wompi_incoming_payments_vimdy_status_check CHECK (
    vimdy_status IN ('pending','verified','rejected','review','confirmed','voided')
  ),
  CONSTRAINT wompi_incoming_payments_currency_check CHECK (currency = 'COP')
);

-- Idempotencia: una transacción Wompi no puede procesarse dos veces
CREATE UNIQUE INDEX IF NOT EXISTS wompi_incoming_payments_transaction_unique
  ON wompi_incoming_payments (business_id, wompi_transaction_id);

-- Una referencia Wompi no puede reutilizarse dentro del mismo negocio
CREATE UNIQUE INDEX IF NOT EXISTS wompi_incoming_payments_reference_unique
  ON wompi_incoming_payments (business_id, wompi_reference);

-- Índices de búsqueda
CREATE INDEX IF NOT EXISTS wompi_incoming_payments_business_wompi_status_idx
  ON wompi_incoming_payments (business_id, wompi_status);

CREATE INDEX IF NOT EXISTS wompi_incoming_payments_business_vimdy_status_idx
  ON wompi_incoming_payments (business_id, vimdy_status);

CREATE INDEX IF NOT EXISTS wompi_incoming_payments_sale_id_idx
  ON wompi_incoming_payments (sale_id) WHERE sale_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS wompi_incoming_payments_transaction_id_idx
  ON wompi_incoming_payments (wompi_transaction_id);

-- ----------------------------------------------------------------------------
-- 3. TABLA: wompi_payment_audit_log
--    Registro inmutable de cambios de estado.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wompi_payment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  incoming_payment_id uuid NOT NULL REFERENCES wompi_incoming_payments(id) ON DELETE CASCADE,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,

  field_changed text NOT NULL,
  old_value text,
  new_value text,

  actor_type text NOT NULL DEFAULT 'system',
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address inet,
  user_agent text,

  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum_valid boolean,
  signature_properties text[],

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wompi_payment_audit_log_business_created_idx
  ON wompi_payment_audit_log (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wompi_payment_audit_log_payment_id_idx
  ON wompi_payment_audit_log (incoming_payment_id);

-- ----------------------------------------------------------------------------
-- 4. RLS — wompi_incoming_payments
--    service_role escribe todo. authenticated solo lee su negocio.
-- ----------------------------------------------------------------------------
ALTER TABLE wompi_incoming_payments ENABLE ROW LEVEL SECURITY;

GRANT ALL ON wompi_incoming_payments TO service_role;

-- authenticated: solo lectura de su negocio
CREATE POLICY wompi_incoming_payments_tenant_read ON wompi_incoming_payments
  FOR SELECT USING (
    business_id IN (SELECT auth_business_ids())
    AND (
      branch_id IS NULL
      OR branch_id IN (SELECT auth_branch_ids())
    )
  );

-- Denegar escritura desde authenticated (solo service_role / Edge Functions)
CREATE POLICY wompi_incoming_payments_no_client_write ON wompi_incoming_payments
  FOR INSERT WITH CHECK (false);

CREATE POLICY wompi_incoming_payments_no_client_update ON wompi_incoming_payments
  FOR UPDATE USING (false);

CREATE POLICY wompi_incoming_payments_no_client_delete ON wompi_incoming_payments
  FOR DELETE USING (false);

-- ----------------------------------------------------------------------------
-- 5. RLS — wompi_payment_audit_log
-- ----------------------------------------------------------------------------
ALTER TABLE wompi_payment_audit_log ENABLE ROW LEVEL SECURITY;

GRANT ALL ON wompi_payment_audit_log TO service_role;
GRANT SELECT ON wompi_payment_audit_log TO authenticated;

CREATE POLICY wompi_payment_audit_log_tenant_read ON wompi_payment_audit_log
  FOR SELECT USING (
    business_id IN (SELECT auth_business_ids())
  );

-- Denegar escritura desde authenticated
CREATE POLICY wompi_payment_audit_log_no_client_write ON wompi_payment_audit_log
  FOR INSERT WITH CHECK (false);

CREATE POLICY wompi_payment_audit_log_no_client_update ON wompi_payment_audit_log
  FOR UPDATE USING (false);

CREATE POLICY wompi_payment_audit_log_no_client_delete ON wompi_payment_audit_log
  FOR DELETE USING (false);

-- ----------------------------------------------------------------------------
-- 6. FUNCIÓN: sanitize_wompi_raw_event
--    Extrae solo los campos necesarios para auditoría del evento Wompi.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sanitize_wompi_raw_event(p_raw jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'event', p_raw->>'event',
    'environment', p_raw->>'environment',
    'timestamp', p_raw->>'timestamp',
    'sent_at', p_raw->>'sent_at',
    'transaction', jsonb_build_object(
      'id', p_raw->'data'->'transaction'->>'id',
      'status', p_raw->'data'->'transaction'->>'status',
      'amount_in_cents', (p_raw->'data'->'transaction'->>'amount_in_cents')::bigint,
      'reference', p_raw->'data'->'transaction'->>'reference',
      'currency', p_raw->'data'->'transaction'->>'currency',
      'payment_method_type', p_raw->'data'->'transaction'->>'payment_method_type',
      'customer_email', p_raw->'data'->'transaction'->>'customer_email',
      'status_message', p_raw->'data'->'transaction'->>'status_message',
      'processor_response_code', (p_raw->'data'->'transaction'->'payment_method'->'extra'->>'processor_response_code'),
      'amount_paid_in_cents', (p_raw->'data'->'transaction'->'payment_method'->'extra'->>'amount_paid_in_cents')::bigint,
      'remaining_amount_in_cents', (p_raw->'data'->'transaction'->'payment_method'->'extra'->>'remaining_amount_in_cents')::bigint,
      'parent_transaction_id', p_raw->'data'->'transaction'->'payment_method'->>'parent_transaction_id',
      'child_transaction_id', p_raw->'data'->'transaction'->'payment_method'->'extra'->>'child_transaction_id',
      'qr_id', p_raw->'data'->'transaction'->'payment_method'->'extra'->>'qr_id',
      'external_identifier', p_raw->'data'->'transaction'->'payment_method'->'extra'->>'external_identifier'
    ),
    'signature', jsonb_build_object(
      'properties', p_raw->'signature'->'properties',
      'checksum', p_raw->'signature'->>'checksum'
    )
  );
$$;

-- ----------------------------------------------------------------------------
-- 7. FUNCIÓN: create_wompi_payment_intent
--     Crea el intento de pago en BD (solo service_role).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_wompi_payment_intent(
  p_business_id uuid,
  p_branch_id uuid,
  p_sale_id uuid,
  p_wompi_transaction_id text,
  p_wompi_reference text,
  p_amount_in_cents bigint,
  p_payment_method_type text,
  p_customer_email text DEFAULT NULL,
  p_customer_full_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_customer_legal_id_type text DEFAULT NULL,
  p_customer_legal_id text DEFAULT NULL,
  p_redirect_url text DEFAULT NULL,
  p_async_payment_url text DEFAULT NULL,
  p_qr_image text DEFAULT NULL,
  p_qr_id text DEFAULT NULL,
  p_external_identifier text DEFAULT NULL,
  p_raw_event jsonb DEFAULT '{}'::jsonb,
  p_parent_transaction_id text DEFAULT NULL,
  p_child_transaction_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO wompi_incoming_payments (
    business_id, branch_id, sale_id,
    wompi_transaction_id, wompi_reference,
    parent_transaction_id, child_transaction_id,
    amount_in_cents, currency, payment_method_type,
    customer_email, customer_full_name, customer_phone,
    customer_legal_id_type, customer_legal_id,
    redirect_url, async_payment_url, qr_image, qr_id, external_identifier,
    raw_event
  ) VALUES (
    p_business_id, p_branch_id, p_sale_id,
    p_wompi_transaction_id, p_wompi_reference,
    p_parent_transaction_id, p_child_transaction_id,
    p_amount_in_cents, 'COP', p_payment_method_type,
    p_customer_email, p_customer_full_name, p_customer_phone,
    p_customer_legal_id_type, p_customer_legal_id,
    p_redirect_url, p_async_payment_url, p_qr_image, p_qr_id, p_external_identifier,
    public.sanitize_wompi_raw_event(p_raw_event)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_wompi_payment_intent(uuid, uuid, uuid, text, text, bigint, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_wompi_payment_intent(uuid, uuid, uuid, text, text, bigint, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 8. FUNCIÓN: update_wompi_payment_from_webhook
--     Actualiza el estado de un pago desde el webhook (solo service_role).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_wompi_payment_from_webhook(
  p_wompi_transaction_id text,
  p_business_id uuid,
  p_wompi_status text,
  p_amount_in_cents bigint,
  p_amount_paid_in_cents bigint DEFAULT NULL,
  p_remaining_amount_in_cents bigint DEFAULT NULL,
  p_wompi_status_message text DEFAULT NULL,
  p_processor_response_code text DEFAULT NULL,
  p_child_transaction_id text DEFAULT NULL,
  p_raw_event jsonb DEFAULT '{}'::jsonb,
  p_checksum_valid boolean DEFAULT NULL,
  p_signature_properties text[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_old_status text;
BEGIN
  IF p_wompi_status NOT IN ('APPROVED','DECLINED','VOIDED','ERROR','PENDING') THEN
    RAISE EXCEPTION 'WOMPI_INVALID_STATUS: %', p_wompi_status USING ERRCODE = 'P0001';
  END IF;

  SELECT id, wompi_status INTO v_id, v_old_status
  FROM wompi_incoming_payments
  WHERE wompi_transaction_id = p_wompi_transaction_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOMPI_PAYMENT_NOT_FOUND: transaction_id=%', p_wompi_transaction_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE wompi_incoming_payments
  SET wompi_status = p_wompi_status,
      amount_paid_in_cents = COALESCE(p_amount_paid_in_cents, amount_paid_in_cents),
      remaining_amount_in_cents = COALESCE(p_remaining_amount_in_cents, remaining_amount_in_cents),
      wompi_status_message = COALESCE(p_wompi_status_message, wompi_status_message),
      processor_response_code = COALESCE(p_processor_response_code, processor_response_code),
      child_transaction_id = COALESCE(p_child_transaction_id, child_transaction_id),
      webhook_verified = COALESCE(p_checksum_valid, webhook_verified),
      raw_event = public.sanitize_wompi_raw_event(p_raw_event),
      updated_at = now(),
      finalized_at = CASE
        WHEN p_wompi_status IN ('APPROVED','DECLINED','VOIDED','ERROR') THEN now()
        ELSE finalized_at
      END
  WHERE id = v_id;

  IF v_old_status <> p_wompi_status THEN
    INSERT INTO wompi_payment_audit_log (
      business_id, incoming_payment_id,
      field_changed, old_value, new_value,
      actor_type, event_data, checksum_valid, signature_properties
    ) VALUES (
      p_business_id, v_id,
      'wompi_status', v_old_status, p_wompi_status,
      'webhook',
      jsonb_build_object(
        'wompi_transaction_id', p_wompi_transaction_id,
        'amount_in_cents', p_amount_in_cents,
        'amount_paid_in_cents', p_amount_paid_in_cents,
        'remaining_amount_in_cents', p_remaining_amount_in_cents,
        'processor_response_code', p_processor_response_code
      ),
      p_checksum_valid, p_signature_properties
    );
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_wompi_payment_from_webhook(text, uuid, text, bigint, bigint, bigint, text, text, text, jsonb, boolean, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_wompi_payment_from_webhook(text, uuid, text, bigint, bigint, bigint, text, text, text, jsonb, boolean, text[]) TO service_role;

-- ----------------------------------------------------------------------------
-- 9. FUNCIÓN: link_wompi_payment_to_sale
--     Asocia un pago Wompi a una venta (solo service_role).
--     Soporta múltiples pagos por venta (MIXED/parcial).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_wompi_payment_to_sale(
  p_incoming_payment_id uuid,
  p_sale_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_actor_type text DEFAULT 'api',
  p_actor_id uuid DEFAULT NULL,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment wompi_incoming_payments%ROWTYPE;
  v_sale sales%ROWTYPE;
BEGIN
  SELECT * INTO v_payment
  FROM wompi_incoming_payments
  WHERE id = p_incoming_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOMPI_PAYMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_sale
  FROM sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_payment.business_id <> v_sale.business_id THEN
    RAISE EXCEPTION 'BUSINESS_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF p_branch_id IS NOT NULL AND v_sale.branch_id IS NOT NULL
     AND p_branch_id <> v_sale.branch_id THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  UPDATE wompi_incoming_payments
  SET sale_id = p_sale_id,
      branch_id = COALESCE(p_branch_id, v_payment.branch_id, v_sale.branch_id),
      updated_at = now()
  WHERE id = p_incoming_payment_id;

  INSERT INTO wompi_payment_audit_log (
    business_id, incoming_payment_id, sale_id,
    field_changed, old_value, new_value,
    actor_type, actor_id, ip_address, user_agent
  ) VALUES (
    v_payment.business_id, p_incoming_payment_id, p_sale_id,
    'sale_id', v_payment.sale_id::text, p_sale_id::text,
    p_actor_type, p_actor_id, p_ip_address, p_user_agent
  );

  RETURN jsonb_build_object(
    'ok', true,
    'payment_id', p_incoming_payment_id,
    'sale_id', p_sale_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_wompi_payment_to_sale(uuid, uuid, uuid, text, uuid, inet, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.link_wompi_payment_to_sale(uuid, uuid, uuid, text, uuid, inet, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 10. FUNCIÓN: review_wompi_payment
--     Permite a un admin resolver incidencias (cambiar vimdy_status entre
--     review, verified, rejected, voided). NUNCA puede establecer 'confirmed'
--     sin que haya pasado por la validación automática.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_wompi_payment(
  p_incoming_payment_id uuid,
  p_new_vimdy_status text,
  p_actor_id uuid DEFAULT NULL,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment wompi_incoming_payments%ROWTYPE;
  v_old_status text;
BEGIN
  IF p_new_vimdy_status NOT IN ('verified','rejected','review','voided') THEN
    RAISE EXCEPTION 'WOMPI_INVALID_REVIEW_STATUS: %', p_new_vimdy_status USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_payment
  FROM wompi_incoming_payments
  WHERE id = p_incoming_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOMPI_PAYMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_old_status := v_payment.vimdy_status;

  UPDATE wompi_incoming_payments
  SET vimdy_status = p_new_vimdy_status,
      updated_at = now()
  WHERE id = p_incoming_payment_id;

  INSERT INTO wompi_payment_audit_log (
    business_id, incoming_payment_id, sale_id,
    field_changed, old_value, new_value,
    actor_type, actor_id, ip_address, user_agent,
    event_data
  ) VALUES (
    v_payment.business_id, p_incoming_payment_id, v_payment.sale_id,
    'vimdy_status', v_old_status, p_new_vimdy_status,
    'admin', p_actor_id, p_ip_address, p_user_agent,
    jsonb_build_object('reason', p_reason)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'payment_id', p_incoming_payment_id,
    'old_status', v_old_status,
    'new_status', p_new_vimdy_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_wompi_payment(uuid, text, uuid, inet, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.review_wompi_payment(uuid, text, uuid, inet, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 11. FUNCIÓN ATÓMICA: confirm_wompi_payment_and_sale
--     Confirma el pago Wompi, actualiza la venta y registra auditoría.
--     Solo acepta fuentes 'webhook' o 'api'. Un admin NUNCA puede forzar
--     la confirmación desde aquí.
--
--     Validaciones atómicas:
--     1. Fuente autorizada (webhook/api)
--     2. vimdy_status = verified
--     3. wompi_status = APPROVED
--     4. sale_id presente
--     5. Moneda COP
--     6. Monto exacto (venta en pesos -> centavos vs amount_in_cents Wompi)
--     7. Negocio y sucursal coherentes
--     8. Actualizar pago -> confirmed
--     9. Actualizar venta -> status = paid
--     10. Auditoría
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_wompi_payment_and_sale(
  p_incoming_payment_id uuid,
  p_source text DEFAULT 'webhook', -- 'webhook' | 'api'
  p_confirmed_by uuid DEFAULT NULL,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment wompi_incoming_payments%ROWTYPE;
  v_sale sales%ROWTYPE;
  v_sale_total_pesos numeric;
  v_wompi_total_paid_cents bigint;
BEGIN
  -- 1. Fuente autorizada
  IF p_source NOT IN ('webhook','api') THEN
    RAISE EXCEPTION 'WOMPI_INVALID_SOURCE: %', p_source USING ERRCODE = 'P0001';
  END IF;

  -- 2. Obtener el pago entrante
  SELECT * INTO v_payment
  FROM wompi_incoming_payments
  WHERE id = p_incoming_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOMPI_PAYMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Validar estado interno VIMDY
  IF v_payment.vimdy_status <> 'verified' THEN
    RAISE EXCEPTION 'WOMPI_PAYMENT_NOT_VERIFIED: vimdy_status=%, expected=verified', v_payment.vimdy_status
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Validar estado Wompi
  IF v_payment.wompi_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'WOMPI_TRANSACTION_NOT_APPROVED: wompi_status=%', v_payment.wompi_status
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Validar moneda
  IF v_payment.currency <> 'COP' THEN
    RAISE EXCEPTION 'WOMPI_INVALID_CURRENCY: %', v_payment.currency USING ERRCODE = 'P0001';
  END IF;

  -- 6. Validar que tenga sale_id
  IF v_payment.sale_id IS NULL THEN
    RAISE EXCEPTION 'SALE_ID_REQUIRED: el pago Wompi debe estar asociado a una venta antes de confirmar'
      USING ERRCODE = 'P0001';
  END IF;

  -- 7. Obtener la venta
  SELECT * INTO v_sale
  FROM sales
  WHERE id = v_payment.sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND: sale_id=%', v_payment.sale_id USING ERRCODE = 'P0002';
  END IF;

  -- 8. Si la venta ya está pagada, idempotencia
  IF v_sale.data->>'status' = 'paid' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_confirmed', true,
      'sale_id', v_sale.id,
      'payment_id', v_payment.id
    );
  END IF;

  -- 9. Validar negocio
  IF v_payment.business_id <> v_sale.business_id THEN
    RAISE EXCEPTION 'BUSINESS_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- 10. Validar sucursal
  IF v_payment.branch_id IS NOT NULL AND v_sale.branch_id IS NOT NULL
     AND v_payment.branch_id <> v_sale.branch_id THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH: payment.branch_id=%, sale.branch_id=%',
      v_payment.branch_id, v_sale.branch_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 11. Validar monto exacto
  --     sales.data.total está en pesos COP. Wompi entrega amount_in_cents en centavos.
  v_sale_total_pesos := COALESCE((v_sale.data->>'total')::numeric, 0);
  IF v_sale_total_pesos <= 0 THEN
    RAISE EXCEPTION 'SALE_INVALID_TOTAL: sale_id=%', v_sale.id USING ERRCODE = 'P0001';
  END IF;

  -- Sumar pagos Wompi confirmados previos para esta venta (soporte MIXED/parcial)
  SELECT COALESCE(SUM(amount_paid_in_cents), 0)
  INTO v_wompi_total_paid_cents
  FROM wompi_incoming_payments
  WHERE business_id = v_payment.business_id
    AND sale_id = v_payment.sale_id
    AND id <> v_payment.id
    AND vimdy_status = 'confirmed'
    AND wompi_status = 'APPROVED';

  IF (v_wompi_total_paid_cents + v_payment.amount_in_cents) <> (v_sale_total_pesos * 100) THEN
    -- No confirmar automáticamente; marcar review
    UPDATE wompi_incoming_payments
    SET vimdy_status = 'review',
        updated_at = now()
    WHERE id = v_payment.id;

    INSERT INTO wompi_payment_audit_log (
      business_id, incoming_payment_id, sale_id,
      field_changed, old_value, new_value,
      actor_type, actor_id, ip_address, user_agent,
      event_data
    ) VALUES (
      v_payment.business_id, v_payment.id, v_payment.sale_id,
      'vimdy_status', 'verified', 'review',
      p_source, p_confirmed_by, p_ip_address, p_user_agent,
      jsonb_build_object(
        'reason', 'AMOUNT_MISMATCH',
        'sale_total_cents', (v_sale_total_pesos * 100)::bigint,
        'wompi_total_paid_cents', v_wompi_total_paid_cents + v_payment.amount_in_cents
      )
    );

    RETURN jsonb_build_object(
      'ok', false,
      'review', true,
      'reason', 'AMOUNT_MISMATCH',
      'sale_total_cents', (v_sale_total_pesos * 100)::bigint,
      'wompi_total_paid_cents', v_wompi_total_paid_cents + v_payment.amount_in_cents
    );
  END IF;

  -- 12. Confirmar pago y actualizar venta (atómicamente)
  UPDATE wompi_incoming_payments
  SET vimdy_status = 'confirmed',
      sale_id = v_sale.id,
      confirmed_at = now(),
      confirmed_by = p_confirmed_by,
      finalized_at = now(),
      updated_at = now()
  WHERE id = v_payment.id;

  UPDATE sales
  SET data = jsonb_set(data, '{status}', '"paid"'),
      updated_at = now()
  WHERE id = v_sale.id;

  -- 13. Auditoría
  INSERT INTO wompi_payment_audit_log (
    business_id, incoming_payment_id, sale_id,
    field_changed, old_value, new_value,
    actor_type, actor_id, ip_address, user_agent,
    event_data
  ) VALUES (
    v_payment.business_id, v_payment.id, v_sale.id,
    'vimdy_status', 'verified', 'confirmed',
    p_source, p_confirmed_by, p_ip_address, p_user_agent,
    jsonb_build_object(
      'wompi_transaction_id', v_payment.wompi_transaction_id,
      'wompi_reference', v_payment.wompi_reference,
      'amount_in_cents', v_payment.amount_in_cents,
      'payment_method_type', v_payment.payment_method_type,
      'sale_total_cents', (v_sale_total_pesos * 100)::bigint,
      'sale_id', v_sale.id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_confirmed', false,
    'sale_id', v_sale.id,
    'payment_id', v_payment.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_wompi_payment_and_sale(uuid, text, uuid, inet, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.confirm_wompi_payment_and_sale(uuid, text, uuid, inet, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 12. GRANTS finales
-- ----------------------------------------------------------------------------
GRANT ALL ON wompi_incoming_payments TO service_role;
GRANT SELECT ON wompi_incoming_payments TO authenticated;

GRANT ALL ON wompi_payment_audit_log TO service_role;
GRANT SELECT ON wompi_payment_audit_log TO authenticated;
