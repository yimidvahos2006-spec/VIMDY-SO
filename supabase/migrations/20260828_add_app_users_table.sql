-- ============================================================================
-- FASE 2: Crear tabla app_users faltante en producción
-- ----------------------------------------------------------------------------
-- La tabla app_users (directorio de empleados: dueño, cajeros, meseros,
-- cocineros) se definió en schema.sql pero NUNCA se incluyó en ninguna
-- migration. Resulta que en producción NO existe, lo que causa:
--   - register-business -> OWNER_PROFILE_FAILED -> revierte todo el negocio
--   - create-staff-user  -> PROFILE_FAILED -> revierte empleado creado
--   - UserRepository.findAll() -> error "table app_users does not exist"
--   - ensureOwnerProfile() (authBusinessContext.ts) -> catch silencioso,
--     el owner nunca se auto-repara
--
-- Esta migration crea app_users con la MISMA estructura que schema.sql
-- define, más RLS y policies consistentes con el resto del esquema
-- multi-tenant.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabla app_users
-- ----------------------------------------------------------------------------
-- NOTA: `id` es TEXT (no uuid) para ser compatible con auth.users.id
-- (que en Supabase Auth puede ser uuid, pero almacenado como texto en
-- algunos contextos). El insert de register-business pasa authUser.id
-- (string) directamente.
-- ----------------------------------------------------------------------------
create table if not exists app_users (
  id text primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  version integer not null default 1,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_users_business_id_idx on app_users (business_id);

-- ----------------------------------------------------------------------------
-- 2. RLS + Policies (multi-tenant: el usuario solo ve/empleados de SU negocio)
-- ----------------------------------------------------------------------------
alter table app_users enable row level security;

drop policy if exists app_users_tenant_read on app_users;
create policy app_users_tenant_read on app_users
  for select
  using (
    business_id in (select auth_business_ids())
    and (
      branch_id is null
      or branch_id in (select auth_branch_ids())
    )
  );

drop policy if exists app_users_tenant_insert on app_users;
create policy app_users_tenant_insert on app_users
  for insert
  with check (
    business_id in (select auth_business_ids())
    and (
      branch_id is null
      or branch_id in (select auth_branch_ids())
    )
    and public.is_business_subscription_active(business_id)
  );

drop policy if exists app_users_tenant_update on app_users;
create policy app_users_tenant_update on app_users
  for update
  using (
    business_id in (select auth_business_ids())
    and (
      branch_id is null
      or branch_id in (select auth_branch_ids())
    )
  )
  with check (
    business_id in (select auth_business_ids())
    and (
      branch_id is null
      or branch_id in (select auth_branch_ids())
    )
    and public.is_business_subscription_active(business_id)
  );

drop policy if exists app_users_tenant_delete on app_users;
create policy app_users_tenant_delete on app_users
  for delete
  using (
    business_id in (select auth_business_ids())
    and (
      branch_id is null
      or branch_id in (select auth_branch_ids())
    )
    and public.is_business_subscription_active(business_id)
  );

-- ----------------------------------------------------------------------------
-- 3. GRANTS
--    - service_role: acceso completo (usado por register-business,
--      create-staff-user, ensureOwnerProfile).
--    - authenticated: acceso completo SUJETO a RLS (solo filas de su negocio).
-- ----------------------------------------------------------------------------
grant all on app_users to service_role;
grant select, insert, update, delete on app_users to authenticated;

-- ----------------------------------------------------------------------------
-- 4. GRANTS para funciones auxiliares (ya definidas en migrations previas,
--    pero se reiteran aquí por si la migration se aplica en un entorno
--    donde APPLY_PERMISSIONS.sql no se ha ejecutado).
-- ----------------------------------------------------------------------------
-- auth_business_ids() y auth_branch_ids() se usan en las policies de app_users.
-- Si no existen grants para authenticated, las policies fallan con 42501.
-- Estas GRANTS ya están en APPLY_PERMISSIONS.sql, pero se repiten aquí como
-- defensa en profundidad (idempotente):
grant execute on function public.auth_business_ids() to authenticated, service_role;
grant execute on function public.auth_branch_ids() to authenticated, service_role;
grant execute on function public.is_business_subscription_active(uuid) to authenticated, service_role;
grant execute on function public.has_user_used_trial(uuid) to authenticated, service_role;
grant execute on function public.record_trial_usage(uuid, uuid) to service_role;

-- ============================================================================
-- FIN DE MIGRACIÓN
-- ============================================================================
