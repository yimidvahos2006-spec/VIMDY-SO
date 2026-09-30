-- ============================================================================
-- VIMDY OS — Migración: DIAN Hardening (Fase de Cierre)
-- ----------------------------------------------------------------------------
-- Agrega: certificados digitales por empresa, idempotency_key, numeración
-- atómica vía RPC, y campos para firma/transmisión DIAN.
--
-- Esta migración es INCREMENTAL: no modifica la tabla electronic_invoices
-- creada en 20260916000001, agrega columnas complementarias.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COLUMNAS ADICIONALES en electronic_invoices
-- ----------------------------------------------------------------------------
ALTER TABLE electronic_invoices
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS signed_xml text,
  ADD COLUMN IF NOT EXISTS dian_response_status text,
  ADD COLUMN IF NOT EXISTS dian_response_code text,
  ADD COLUMN IF NOT EXISTS transmitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS certificate_id text REFERENCES dian_certificates(id),
  ADD COLUMN IF NOT EXISTS dian_qr_code text;

CREATE UNIQUE INDEX IF NOT EXISTS electronic_invoices_idempotency_key_idx
  ON electronic_invoices (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. TABLA dian_certificates — certificado digital por empresa
--    La clave privada NUNCA vive en Supabase. Este registro solo contiene
--    metadata + referencia al almacen secreto del HSM/secret manager.
--    La firma XAdES se ejecuta en la Edge Function con acceso al certificado.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dian_certificates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  certificate_name text NOT NULL,
  certificate_serial text NOT NULL,
  certificate_expiration timestamptz NOT NULL,
  certificate_issuer text NOT NULL,
  cert_type text NOT NULL DEFAULT 'XAdES' CHECK (cert_type IN ('XAdES', 'XMLDSig')),
  software_id text,
  software_code text,
  pin text,
  private_key_encrypted text,
  cert_pem_encrypted text,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, certificate_serial)
);

CREATE INDEX IF NOT EXISTS dian_certificates_business_id_idx
  ON dian_certificates (business_id);

CREATE INDEX IF NOT EXISTS dian_certificates_active_idx
  ON dian_certificates (active) WHERE active = true;

-- Trigger updated_at para dian_certificates
DROP TRIGGER IF EXISTS dian_certificates_touch_updated ON dian_certificates;
CREATE TRIGGER dian_certificates_touch_updated
  BEFORE UPDATE ON dian_certificates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. TABLA electronic_invoice_jobs — cola de reintentos DIAN
--    Estado: pending, processing, transmitted, accepted, rejected, failed
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS electronic_invoice_jobs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id text NOT NULL REFERENCES electronic_invoices(id) ON DELETE CASCADE,
  attempt_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'transmitted', 'accepted', 'rejected', 'failed')),
  next_retry_at timestamptz,
  last_error text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS electronic_invoice_jobs_business_idx
  ON electronic_invoice_jobs (business_id);

CREATE INDEX IF NOT EXISTS electronic_invoice_jobs_status_next_retry
  ON electronic_invoice_jobs (status, next_retry_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS electronic_invoice_jobs_invoice_id
  ON electronic_invoice_jobs (invoice_id);

DROP TRIGGER IF EXISTS electronic_invoice_jobs_touch_updated ON electronic_invoice_jobs;
CREATE TRIGGER electronic_invoice_jobs_touch_updated
  BEFORE UPDATE ON electronic_invoice_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_updated_at();

-- ----------------------------------------------------------------------------
-- 4. RPC get_next_invoice_consecutive — numeración atómica
--    Usa SELECT ... FOR UPDATE para garantizar que ningún dos procesos
--    obtengan el mismo consecutivo, incluso con múltiples cajas simultáneas.
--    Devuelve el número con prefijo formateado.
--    Lanza error si el rango está agotado.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_next_invoice_consecutive(p_business_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  prefix_value text;
  current_num numeric;
  from_num numeric;
  to_num numeric;
  next_num numeric;
  formatted_num text;
BEGIN
  -- Lock the business row to prevent race conditions
  PERFORM 1 FROM businesses
  WHERE id = p_business_id
  AND electronic_invoicing_enabled = true
  AND electronic_invoicing_provider = 'dian'
  FOR UPDATE;

  SELECT
    COALESCE(invoice_prefix, 'FV'),
    invoice_consecutive_current,
    invoice_consecutive_from,
    invoice_consecutive_to
  INTO
    prefix_value, current_num, from_num, to_num
  FROM businesses
  WHERE id = p_business_id
  AND electronic_invoicing_enabled = true
  AND electronic_invoicing_provider = 'dian'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DIAN_NOT_CONFIGURED: el negocio no tiene facturación DIAN habilitada';
  END IF;

  from_num := COALESCE(from_num, 1);
  to_num := COALESCE(to_num, 999999999);
  current_num := COALESCE(current_num, from_num - 1);

  next_num := current_num + 1;

  IF next_num < from_num THEN
    next_num := from_num;
  END IF;

  IF next_num > to_num THEN
    RAISE EXCEPTION 'NUMERATION_EXHAUSTED: el rango de numeración (%-%) está agotado.', from_num, to_num;
  END IF;

  formatted_num := prefix_value || LPAD(next_num::text, 8, '0');

  UPDATE businesses
  SET invoice_consecutive_current = next_num
  WHERE id = p_business_id;

  RETURN formatted_num;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_next_invoice_consecutive(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. RLS para dian_certificates y electronic_invoice_jobs
-- ----------------------------------------------------------------------------
ALTER TABLE dian_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE electronic_invoice_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dian_certificates_read ON dian_certificates;
CREATE POLICY dian_certificates_read ON dian_certificates
  FOR SELECT USING (business_id IN (SELECT auth_business_ids()));

DROP POLICY IF EXISTS dian_certificates_insert ON dian_certificates;
CREATE POLICY dian_certificates_insert ON dian_certificates
  FOR INSERT WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS dian_certificates_update ON dian_certificates;
CREATE POLICY dian_certificates_update ON dian_certificates
  FOR UPDATE USING (
    business_id IN (SELECT auth_business_ids())
    AND has_business_role(business_id, ARRAY['ADMIN'])
  )
  WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND has_business_role(business_id, ARRAY['ADMIN'])
  );

DROP POLICY IF EXISTS dian_certificates_delete ON dian_certificates;
CREATE POLICY dian_certificates_delete ON dian_certificates
  FOR DELETE USING (
    business_id IN (SELECT auth_business_ids())
    AND has_business_role(business_id, ARRAY['ADMIN'])
  );

DROP POLICY IF EXISTS electronic_invoice_jobs_read ON electronic_invoice_jobs;
CREATE POLICY electronic_invoice_jobs_read ON electronic_invoice_jobs
  FOR SELECT USING (business_id IN (SELECT auth_business_ids()));

DROP POLICY IF EXISTS electronic_invoice_jobs_insert ON electronic_invoice_jobs;
CREATE POLICY electronic_invoice_jobs_insert ON electronic_invoice_jobs
  FOR INSERT WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS electronic_invoice_jobs_update ON electronic_invoice_jobs;
CREATE POLICY electronic_invoice_jobs_update ON electronic_invoice_jobs
  FOR UPDATE
  USING (
    business_id IN (SELECT auth_business_ids())
    AND has_business_role(business_id, ARRAY['ADMIN'])
  );

DROP POLICY IF EXISTS electronic_invoice_jobs_delete ON electronic_invoice_jobs;
CREATE POLICY electronic_invoice_jobs_delete ON electronic_invoice_jobs
  FOR DELETE USING (
    business_id IN (SELECT auth_business_ids())
    AND has_business_role(business_id, ARRAY['ADMIN'])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON dian_certificates, electronic_invoice_jobs TO authenticated;
GRANT ALL ON dian_certificates, electronic_invoice_jobs TO service_role;

-- Revocar SELECT de columnas encriptadas de authenticated (solo service_role lee la clave privada)
REVOKE SELECT (private_key_encrypted, cert_pem_encrypted) ON dian_certificates FROM authenticated;
GRANT SELECT (private_key_encrypted, cert_pem_encrypted) ON dian_certificates TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Revocar UPDATE de businesses para authenticated en columnas sensibles
--    ya establecidas en migración anterior; reforzar column-level grants
--    para las columnas nuevas de electronic_invoices
-- ----------------------------------------------------------------------------
REVOKE UPDATE (
  signed_xml,
  dian_response_status,
  dian_response_code,
  transmitted_at,
  certificate_id,
  dian_qr_code,
  idempotency_key
) ON electronic_invoices FROM authenticated;

-- authenticated puede leer todo (sujeto a RLS), insertar (sujeto a RLS),
-- pero NO puede escribir columnas de respuesta/transmisión:
-- esas solo las escribe la Edge Function (service_role).

GRANT SELECT ON electronic_invoices TO authenticated;
GRANT INSERT (
  id, business_id, sale_id, provider, environment, status,
  document_type, prefix, invoice_number, cufe, tracking_code,
  qr_code, customer_document_type, customer_document_number,
  customer_name, subtotal, tax, total, error_code, error_message
) ON electronic_invoices TO authenticated;

-- ============================================================================
-- VERIFICACIÓN:
-- SELECT 'certs_exists' AS check, to_regclass('dian_certificates') AS result;
-- SELECT 'jobs_exists' AS check, to_regclass('electronic_invoice_jobs') AS result;
-- SELECT 'rpc_exists' AS check, routine_name FROM pg_proc WHERE routine_name = 'get_next_invoice_consecutive';
-- ============================================================================
