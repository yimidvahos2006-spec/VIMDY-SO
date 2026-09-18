-- ============================================================================
-- VIMDY OS — Migración: Facturación Electrónica — DIAN (Fase 4-C)
-- ----------------------------------------------------------------------------
-- Normativa: Resolución 000165 de 2023 — Anexo Técnico v1.9
-- Este módulo es versionado dentro de supabase/migrations/.
-- Es idempotent (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).
--
-- Alcance:
--   1. Tabla electronic_invoices con columnas estructurales para DIAN
--   2. UNIQUE(business_id, sale_id) — garantía de base de datos
--   3. RLS multi-tenant estricto
--   4. Columnas fiscales en businesses
--
-- FactusProvider sigue funcionando como adaptador opcional. La tabla
-- electronic_invoices es proveedor-agnóstica (provider = 'dian' | 'factus').
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COLUMNAS FISCALES EN businesses (Fase 8 + Fase 9)
--    Reemplazan el companyConfigStore.localStorage para configuración fiscal.
-- ----------------------------------------------------------------------------
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS tax_identification_number text,
  ADD COLUMN IF NOT EXISTS tax_verification_digit text,
  ADD COLUMN IF NOT EXISTS fiscal_legal_name text,
  ADD COLUMN IF NOT EXISTS fiscal_address text,
  ADD COLUMN IF NOT EXISTS fiscal_city text,
  ADD COLUMN IF NOT EXISTS fiscal_department text,
  ADD COLUMN IF NOT EXISTS fiscal_phone text,
  ADD COLUMN IF NOT EXISTS fiscal_email text,
  ADD COLUMN IF NOT EXISTS fiscal_tax_regime text,
  ADD COLUMN IF NOT EXISTS fiscal_organization_type text,
  ADD COLUMN IF NOT EXISTS electronic_invoicing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS electronic_invoicing_provider text NOT NULL DEFAULT 'none' CHECK (
    electronic_invoicing_provider IN ('dian', 'factus', 'none')
  ),
  ADD COLUMN IF NOT EXISTS dian_software_id text,
  ADD COLUMN IF NOT EXISTS dian_clave_tecnica text,
  ADD COLUMN IF NOT EXISTS dian_environment text NOT NULL DEFAULT 'sandbox' CHECK (
    dian_environment IN ('sandbox', 'production')
  ),
  ADD COLUMN IF NOT EXISTS dian_software_code text,
  ADD COLUMN IF NOT EXISTS invoice_prefix text,
  ADD COLUMN IF NOT EXISTS invoice_consecutive_from numeric,
  ADD COLUMN IF NOT EXISTS invoice_consecutive_to numeric,
  ADD COLUMN IF NOT EXISTS invoice_consecutive_current numeric;

-- Reforzar column-level grants para que authenticated solo edite columnas seguras
REVOKE UPDATE ON businesses FROM authenticated;
GRANT UPDATE (
  name,
  country,
  currency,
  language,
  timezone,
  tax_rate,
  onboarding_completed,
  business_type,
  business_type_label,
  enabled_modules,
  salida_cocina,
  sales_channels,
  inventory_type,
  production_mode,
  kds_enabled,
  printer_enabled,
  tax_identification_number,
  tax_verification_digit,
  fiscal_legal_name,
  fiscal_address,
  fiscal_city,
  fiscal_department,
  fiscal_phone,
  fiscal_email,
  fiscal_tax_regime,
  fiscal_organization_type,
  electronic_invoicing_enabled,
  electronic_invoicing_provider,
  invoice_prefix,
  invoice_consecutive_from,
  invoice_consecutive_to,
  invoice_consecutive_current
) ON businesses TO authenticated;

-- Las columnas sensibles (cert, ClTec, environment, software_id, software_code)
-- solo editables vía service_role (Edge Functions / admin).
REVOKE UPDATE ON businesses FROM authenticated;
-- authenticated ya no puede tocar: plan, payment_status, subscription_status,
-- dian_software_id, dian_clave_tecnica, dian_environment, dian_software_code

-- ----------------------------------------------------------------------------
-- 2. TABLA electronic_invoices
--    Schema con columnas estructurales según Anexo Técnico v1.9.
--    `data jsonb` complementa con información del raw_response DIAN.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS electronic_invoices (
  id text PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sale_id text NOT NULL,
  provider text NOT NULL DEFAULT 'dian'
    CHECK (provider IN ('dian', 'factus', 'none')),
  environment text NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('sandbox', 'production')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('draft', 'pending', 'accepted', 'rejected', 'cancelled', 'error')),
  document_type text NOT NULL DEFAULT 'INVOICE'
    CHECK (document_type IN ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE')),
  prefix text,
  invoice_number text,
  cufe text,
  tracking_code text,
  qr_code text,
  customer_id text,
  customer_document_type text,
  customer_document_number text,
  customer_name text,
  subtotal numeric,
  tax numeric,
  total numeric,
  xml_reference text,
  pdf_reference text,
  raw_response jsonb,
  error_code text,
  error_message text,
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  issued_at timestamptz,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. CONSTRAINTS E ÍNDICES (Fase 2 + Fase 17)
--    UNIQUE(business_id, sale_id) — NUNCA dos facturas para la misma venta.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS electronic_invoices_business_sale_unique
  ON electronic_invoices (business_id, sale_id);

CREATE INDEX IF NOT EXISTS electronic_invoices_business_id_idx
  ON electronic_invoices (business_id);

CREATE INDEX IF NOT EXISTS electronic_invoices_sale_id_idx
  ON electronic_invoices (sale_id);

CREATE INDEX IF NOT EXISTS electronic_invoices_status_idx
  ON electronic_invoices (status);

CREATE INDEX IF NOT EXISTS electronic_invoices_cufe_idx
  ON electronic_invoices (cufe)
  WHERE cufe IS NOT NULL;

CREATE INDEX IF NOT EXISTS electronic_invoices_invoice_number_idx
  ON electronic_invoices (business_id, invoice_number)
  WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS electronic_invoices_created_at_idx
  ON electronic_invoices (business_id, created_at DESC);

-- Trigger updated_at automático
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS electronic_invoices_touch_updated ON electronic_invoices;
CREATE TRIGGER electronic_invoices_touch_updated
  BEFORE UPDATE ON electronic_invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4. RLS — multi-tenant estricto (Fase 2)
--    Un negocio NO puede leer/escribir/borrar facturas de otro negocio.
-- ----------------------------------------------------------------------------
ALTER TABLE electronic_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS electronic_invoices_tenant_read ON electronic_invoices;
CREATE POLICY electronic_invoices_tenant_read ON electronic_invoices
  FOR SELECT
  USING (business_id IN (SELECT auth_business_ids()));

DROP POLICY IF EXISTS electronic_invoices_tenant_insert ON electronic_invoices;
CREATE POLICY electronic_invoices_tenant_insert ON electronic_invoices
  FOR INSERT
  WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND public.is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS electronic_invoices_tenant_update ON electronic_invoices;
CREATE POLICY electronic_invoices_tenant_update ON electronic_invoices
  FOR UPDATE
  USING (
    business_id IN (SELECT auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN'])
  )
  WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN'])
  );

DROP POLICY IF EXISTS electronic_invoices_tenant_delete ON electronic_invoices;
CREATE POLICY electronic_invoices_tenant_delete ON electronic_invoices
  FOR DELETE
  USING (
    business_id IN (SELECT auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN'])
  );

-- ----------------------------------------------------------------------------
-- 5. GRANTS
--    service_role: acceso completo (Edge Functions).
--    authenticated: CRUD sujeto a RLS.
-- ----------------------------------------------------------------------------
GRANT ALL ON electronic_invoices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON electronic_invoices TO authenticated;

GRANT EXECUTE ON FUNCTION public.auth_business_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_business_role(uuid, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_business_subscription_active(uuid) TO authenticated, service_role;

-- ============================================================================
-- VERIFICACIÓN:
-- SELECT 'ei_exists' AS check, to_regclass('electronic_invoices') AS result;
-- SELECT 'uk_exists' AS check, conname FROM pg_constraint WHERE conname = 'electronic_invoices_business_sale_unique';
-- SELECT 'has_fiscal' AS check, column_name FROM information_schema.columns WHERE table_name = 'businesses' AND column_name IN ('tax_identification_number', 'electronic_invoicing_enabled');
-- ============================================================================
