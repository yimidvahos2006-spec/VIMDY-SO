-- ============================================================================
-- VIMDY — FASE 7.2: Cierre definitivo del sistema de Trial por persona
-- ============================================================================
-- Regla comercial: UN SOLO TRIAL DE POR VIDA POR PERSONA (auth.users.id).
-- No importa cuántos negocios cree, cuántas veces cambie de dispositivo,
-- navegador, IP o sesión. Una vez usado, no hay más trials gratuitos.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabla de uso de trial por persona
-- ----------------------------------------------------------------------------
create table if not exists user_trial_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  plan text not null default 'trial',
  used_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists user_trial_usage_used_at_idx
  on user_trial_usage (used_at);

alter table user_trial_usage enable row level security;

drop policy if exists user_trial_usage_service_all on user_trial_usage;
create policy user_trial_usage_service_all on user_trial_usage
  for all
  using (false)
  with check (false);

grant all on user_trial_usage to service_role;
revoke all on user_trial_usage from authenticated, anon, public;

-- ----------------------------------------------------------------------------
-- 2. Función: verificar si un usuario ya usó su trial
-- ----------------------------------------------------------------------------
create or replace function public.has_user_used_trial(p_user_id uuid)
returns boolean
language plpgsql
security definer
stable
as $$
begin
  return exists (
    select 1 from user_trial_usage
    where user_id = p_user_id
  );
end;
$$;

revoke all on function public.has_user_used_trial(uuid) from public, anon, authenticated;
grant execute on function public.has_user_used_trial(uuid) to service_role, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Función: registrar uso de trial (idempotente)
-- ----------------------------------------------------------------------------
create or replace function public.record_trial_usage(
  p_user_id uuid,
  p_business_id uuid
)
returns void
language plpgsql
security definer
as $$
begin
  insert into user_trial_usage (user_id, business_id, plan, used_at)
  values (p_user_id, p_business_id, 'trial', now())
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.record_trial_usage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_trial_usage(uuid, uuid) to service_role;

-- ============================================================================
-- FIN DE MIGRACIÓN
-- ============================================================================
