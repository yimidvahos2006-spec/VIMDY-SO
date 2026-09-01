-- ============================================================================
-- Fix RLS: permitir SELECT en business_members por user_id propio
-- ============================================================================
-- Problema: la política original requería business_id in auth_business_ids(),
-- pero al iniciar sesión por primera vez el usuario no tiene negocios aún,
-- generando un catch-22 que bloqueaba el onboarding y el dashboard.
-- ============================================================================

alter table business_members enable row level security;

drop policy if exists business_members_self_read on business_members;
create policy business_members_self_read on business_members
  for select
  using (user_id = auth.uid());
