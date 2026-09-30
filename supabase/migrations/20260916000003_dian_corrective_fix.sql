-- ============================================================================
-- VIMDY OS — Migración Correctiva: DIAN Hardening Fix (v3)
-- ----------------------------------------------------------------------------
-- Corrige tres problemas encontrados en 20260916000002_dian_hardening.sql:
--
-- 1. trigger de electronic_invoice_jobs usaba public.touch_updated_updated_at()
--    que NO existe; corregido a public.touch_updated_at()
--
-- 2. certificate_id (FK a dian_certificates) se añadía ANTES de crear la tabla
--    dian_certificates; en instalación limpia eso rompe. Se recrea el FK
--    de forma segura (DROP IF EXISTS → ADD COLUMN IF NOT EXISTS).
--
-- 3. No existía restricción de unicidad para "máximo 1 cert activo por
--    business"; se agrega índice único parcial.
--
-- Esta migración es idempotent: usa IF NOT EXISTS y DROP ... IF EXISTS.
-- ============================================================================

-- 1. Corregir trigger de electronic_invoice_jobs
--    public.touch_updated_updated_at() NO EXISTE — solo hay touch_updated_at()
DROP TRIGGER IF EXISTS electronic_invoice_jobs_touch_updated ON electronic_invoice_jobs;
CREATE TRIGGER electronic_invoice_jobs_touch_updated
  BEFORE UPDATE ON electronic_invoice_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
-- 2. Corregir certificate_id FK en electronic_invoices
ALTER TABLE electronic_invoices DROP CONSTRAINT IF EXISTS electronic_invoices_certificate_id_fkey;
ALTER TABLE electronic_invoices
  ADD COLUMN IF NOT EXISTS certificate_id text;
-- Relacionar con dian_certificates SOLO si la tabla existe (limpio)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dian_certificates'
  ) THEN
    ALTER TABLE electronic_invoices
      ADD CONSTRAINT electronic_invoices_certificate_id_fkey
      FOREIGN KEY (certificate_id) REFERENCES dian_certificates(id);
  END IF;
END
$$;
-- 3. Índice único parcial: máximo 1 certificado activo por negocio
--    Permite múltiples inactivos, pero solo UNO activo.
DROP INDEX IF EXISTS dian_certificates_one_active_per_business;
CREATE UNIQUE INDEX dian_certificates_one_active_per_business
  ON dian_certificates (business_id)
  WHERE active = true;
-- ============================================================
-- VERIFICACIÓN (ejecutar manualmente):
-- SELECT conname FROM pg_constraint WHERE conname = 'electronic_invoices_certificate_id_fkey';
-- SELECT indexname FROM pg_indexes WHERE indexname = 'dian_certificates_one_active_per_business';
-- SELECT tgname FROM pg_trigger WHERE tgname = 'electronic_invoice_jobs_touch_updated';
-- ============================================================;
