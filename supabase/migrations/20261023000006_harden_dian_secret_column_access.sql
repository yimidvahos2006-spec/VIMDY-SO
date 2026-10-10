-- ============================================================================
-- VIMDY OS — DIAN secret privilege hardening
-- ----------------------------------------------------------------------------
-- Objetivo:
--   1. Evitar que authenticated lea las credenciales DIAN almacenadas en
--      public.businesses.
--   2. Mantener disponibles para la aplicación todas las columnas públicas
--      necesarias para lectura y configuración operativa.
--   3. Mantener la escritura de secretos DIAN exclusivamente server-side.
--   4. Hacer dian_certificates completamente server-side para authenticated.
--
-- Requisitos previos:
--   - 20260910_business_type_label.sql
--   - 20260916000001_electronic_invoicing_dian.sql
--   - 20260916000002_dian_hardening.sql
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. businesses — quitar privilegios amplios de SELECT/UPDATE/INSERT/DELETE
--    a authenticated. Los privilegios de columnas se conceden explícitamente
--    después para evitar acceso a las cuatro columnas DIAN sensibles.
-- ----------------------------------------------------------------------------
REVOKE SELECT, UPDATE, INSERT, DELETE
  ON TABLE public.businesses
  FROM authenticated;

-- ----------------------------------------------------------------------------
-- 2. businesses — SELECT seguro para authenticated
--
--    Se excluyen deliberadamente:
--      dian_software_id
--      dian_software_code
--      dian_clave_tecnica
--      dian_environment
-- ----------------------------------------------------------------------------
GRANT SELECT (
  id,
  name,
  plan,
  trial_ends_at,
  created_at,
  country,
  currency,
  language,
  timezone,
  tax_rate,
  onboarding_completed,
  business_type,
  business_type_label,
  enabled_modules,
  sales_channels,
  inventory_type,
  production_mode,
  kds_enabled,
  printer_enabled,
  service_mode,
  tables_enabled,
  waiter_mode_enabled,
  waiter_photos_enabled,
  kitchen_enabled,
  kitchen_output_mode,
  prep_stations,
  salida_cocina,
  trial_used_at,
  renewal_date,
  next_charge_at,
  payment_method,
  payment_status,
  subscription_status,
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
)
ON TABLE public.businesses
TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. businesses — UPDATE seguro para authenticated
--
--    No se incluyen:
--      plan
--      payment_method
--      payment_status
--      subscription_status
--      trial_used_at
--      renewal_date
--      next_charge_at
--      dian_software_id
--      dian_software_code
--      dian_clave_tecnica
--      dian_environment
--      invoice_consecutive_current
--
--    invoice_consecutive_current se mueve exclusivamente por el RPC atómico
--    get_next_invoice_consecutive().
-- ----------------------------------------------------------------------------
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
  sales_channels,
  inventory_type,
  production_mode,
  kds_enabled,
  printer_enabled,
  service_mode,
  tables_enabled,
  waiter_mode_enabled,
  waiter_photos_enabled,
  kitchen_enabled,
  kitchen_output_mode,
  prep_stations,
  salida_cocina,
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
  invoice_consecutive_to
)
ON TABLE public.businesses
TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. La creación de negocios es server-side mediante register-business /
--    register_business_atomic. El navegador no debe insertar ni eliminar
--    directamente filas de businesses.
-- ----------------------------------------------------------------------------
REVOKE INSERT, DELETE
  ON TABLE public.businesses
  FROM authenticated;

GRANT ALL
  ON TABLE public.businesses
  TO service_role;

-- ----------------------------------------------------------------------------
-- 5. dian_certificates — server-side only para authenticated
-- ----------------------------------------------------------------------------
REVOKE SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.dian_certificates
  FROM authenticated;

GRANT ALL
  ON TABLE public.dian_certificates
  TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Verificación estructural
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  required_table_exists boolean;
BEGIN
  SELECT
    to_regclass('public.businesses') IS NOT NULL
    AND to_regclass('public.dian_certificates') IS NOT NULL
  INTO required_table_exists;

  IF NOT required_table_exists THEN
    RAISE EXCEPTION
      'DIAN_SECRET_HARDENING_REQUIRED_TABLE_MISSING';
  END IF;
END;
$$;

COMMIT;