SELECT jsonb_build_object(
  'data_date_column', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cash_movements'
      AND column_name='data_date' AND data_type='timestamp with time zone'
  ),
  'data_date_trigger', EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE t.tgname='cash_movements_data_date_sync'
      AND c.relname='cash_movements'
      AND n.nspname='public'
      AND NOT t.tgisinternal
  ),
  'safe_date_parser', to_regprocedure('public.vimdy_try_timestamptz(text)') IS NOT NULL,
  'composite_idempotency_index', EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public'
      AND indexname='cash_movements_business_branch_idempotency_idx'
  ),
  'old_global_idempotency_index_absent', NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public'
      AND indexname='cash_movements_idempotency_key_idx'
  ),
  'daily_report_settings_updated_at_trigger', EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE t.tgname='daily_report_settings_updated_at'
      AND c.relname='daily_report_settings'
      AND n.nspname='public'
      AND NOT t.tgisinternal
  ),
  'jobs_select_policy', EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='daily_report_jobs'
      AND policyname='daily_report_jobs_management_select'
  ),
  'deliveries_select_policy', EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='daily_report_deliveries'
      AND policyname='daily_report_deliveries_management_select'
  )
) AS dashboard_hardening_verification;

SHOW server_version;
