-- ============================================================================
-- Fix: grants de schema public para roles authenticated/anonymous
-- ============================================================================
-- Problema: después de endurecer RLS, el login y consultas públicas
-- empezaron a fallar con:
--   "permission denied for schema public" (42501)
-- porque los roles authenticated/anonymous no tenían USAGE en el schema.
-- ============================================================================

grant usage on schema public to authenticated;
grant usage on schema public to anon;
grant create on schema public to service_role;
