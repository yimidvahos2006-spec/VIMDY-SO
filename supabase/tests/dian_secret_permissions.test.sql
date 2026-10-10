-- ============================================================================
-- VIMDY OS — DIAN effective privilege regression test
-- ----------------------------------------------------------------------------
-- Execute AFTER the DIAN privilege hardening migration in a real PostgreSQL /
-- Supabase environment.
--
-- The assertions intentionally inspect EFFECTIVE privileges. In PostgreSQL,
-- a table-level SELECT grant continues to allow SELECT on every column even
-- if a column-level REVOKE is issued, so the broad grant must be absent.
-- ============================================================================

DO $$
DECLARE
  protected_column text;
  safe_business_column text;
  protected_business_columns constant text[] := ARRAY[
    'dian_software_id',
    'dian_software_code',
    'dian_clave_tecnica',
    'dian_environment'
  ];
  safe_business_columns constant text[] := ARRAY[
    'id',
    'name',
    'plan',
    'trial_ends_at',
    'created_at',
    'country',
    'currency',
    'language',
    'timezone',
    'tax_rate',
    'onboarding_completed',
    'business_type',
    'business_type_label',
    'enabled_modules',
    'sales_channels',
    'inventory_type',
    'production_mode',
    'kds_enabled',
    'printer_enabled',
    'service_mode',
    'tables_enabled',
    'waiter_mode_enabled',
    'waiter_photos_enabled',
    'kitchen_enabled',
    'kitchen_output_mode',
    'prep_stations',
    'salida_cocina',
    'trial_used_at',
    'renewal_date',
    'next_charge_at',
    'payment_method',
    'payment_status',
    'subscription_status',
    'tax_identification_number',
    'tax_verification_digit',
    'fiscal_legal_name',
    'fiscal_address',
    'fiscal_city',
    'fiscal_department',
    'fiscal_phone',
    'fiscal_email',
    'fiscal_tax_regime',
    'fiscal_organization_type',
    'electronic_invoicing_enabled',
    'electronic_invoicing_provider',
    'invoice_prefix',
    'invoice_consecutive_from',
    'invoice_consecutive_to',
    'invoice_consecutive_current'
  ];
BEGIN
  IF to_regclass('public.businesses') IS NULL THEN
    RAISE EXCEPTION 'DIAN_PRIVILEGE_TEST: public.businesses does not exist';
  END IF;

  IF to_regclass('public.dian_certificates') IS NULL THEN
    RAISE EXCEPTION 'DIAN_PRIVILEGE_TEST: public.dian_certificates does not exist';
  END IF;

  -- The browser must not retain broad table-level SELECT on businesses.
  IF has_table_privilege('authenticated', 'public.businesses', 'SELECT') THEN
    RAISE EXCEPTION
      'DIAN_PRIVILEGE_TEST: authenticated still has table-level SELECT on public.businesses';
  END IF;

  -- Protected DIAN configuration columns must not be readable by the browser.
  FOREACH protected_column IN ARRAY protected_business_columns LOOP
    IF has_column_privilege(
      'authenticated',
      'public.businesses',
      protected_column,
      'SELECT'
    ) THEN
      RAISE EXCEPTION
        'DIAN_PRIVILEGE_TEST: authenticated can SELECT protected businesses.%',
        protected_column;
    END IF;
  END LOOP;

  -- Normal UI flows must retain SELECT on all non-secret business fields that
  -- were previously exposed by the table-level grant.
  FOREACH safe_business_column IN ARRAY safe_business_columns LOOP
    IF NOT has_column_privilege(
      'authenticated',
      'public.businesses',
      safe_business_column,
      'SELECT'
    ) THEN
      RAISE EXCEPTION
        'DIAN_PRIVILEGE_TEST: authenticated lost SELECT on safe businesses.%',
        safe_business_column;
    END IF;
  END LOOP;

  -- Certificate metadata and secrets are server-side only.
  IF has_any_column_privilege(
    'authenticated',
    'public.dian_certificates',
    'SELECT'
  ) THEN
    RAISE EXCEPTION
      'DIAN_PRIVILEGE_TEST: authenticated still has SELECT on public.dian_certificates';
  END IF;

  IF has_any_column_privilege(
    'authenticated',
    'public.dian_certificates',
    'INSERT'
  )
  OR has_any_column_privilege(
    'authenticated',
    'public.dian_certificates',
    'UPDATE'
  )
  OR has_any_column_privilege(
    'authenticated',
    'public.dian_certificates',
    'DELETE'
  ) THEN
    RAISE EXCEPTION
      'DIAN_PRIVILEGE_TEST: authenticated retains write access to public.dian_certificates';
  END IF;

  -- service_role must retain all access needed by the DIAN Edge Function.
  IF NOT has_table_privilege('service_role', 'public.dian_certificates', 'SELECT')
     OR NOT has_column_privilege('service_role', 'public.dian_certificates', 'pin', 'SELECT')
     OR NOT has_column_privilege(
       'service_role',
       'public.dian_certificates',
       'private_key_encrypted',
       'SELECT'
     )
     OR NOT has_column_privilege(
       'service_role',
       'public.dian_certificates',
       'cert_pem_encrypted',
       'SELECT'
     ) THEN
    RAISE EXCEPTION
      'DIAN_PRIVILEGE_TEST: service_role lost DIAN certificate access';
  END IF;

  IF NOT has_column_privilege(
    'service_role',
    'public.businesses',
    'dian_clave_tecnica',
    'SELECT'
  )
  OR NOT has_column_privilege(
    'service_role',
    'public.businesses',
    'dian_software_id',
    'SELECT'
  )
  OR NOT has_column_privilege(
    'service_role',
    'public.businesses',
    'dian_software_code',
    'SELECT'
  ) THEN
    RAISE EXCEPTION
      'DIAN_PRIVILEGE_TEST: service_role lost businesses DIAN credential access';
  END IF;

  -- RLS must remain enabled as a second protection layer.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.businesses'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'DIAN_PRIVILEGE_TEST: businesses RLS is disabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.dian_certificates'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'DIAN_PRIVILEGE_TEST: dian_certificates RLS is disabled';
  END IF;

  RAISE NOTICE 'DIAN_PRIVILEGE_TEST: PASS';
END $$;
