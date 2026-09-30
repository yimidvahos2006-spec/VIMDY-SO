-- ============================================================================
-- FASE 6 + FASE 7 — Aislamiento multi-tenant de customers
-- ---------------------------------------------------------------------------
-- Agrega business_id y branch_id a la tabla customers para cerrar el
-- aislamiento a nivel de entidad (además del scope del repositorio y RLS).
-- ============================================================================

alter table customers add column if not exists business_id uuid not null default '00000000-0000-0000-0000-000000000000' references businesses(id) on delete cascade;
alter table customers add column if not exists branch_id uuid references branches(id) on delete set null;

-- Backfill seguro: si la tabla ya tenía datos, asigna el negocio/sucursal
-- principal del usuario propietario (o del primer miembro del negocio).
-- Si no hay miembros aún, queda con el UUID cero (no debería pasar en
-- producción porque el registro del negocio siempre crea el miembro ADMIN).
do $$
declare
  v_business_id uuid;
  v_branch_id uuid;
begin
  select business_id into v_business_id
  from business_members
  limit 1;

  if v_business_id is not null then
    update customers
    set business_id = v_business_id,
        branch_id = ensure_branch_for_business(v_business_id)
    where business_id = '00000000-0000-0000-0000-000000000000';
  end if;
end $$;

alter table customers alter column business_id drop default;

create index if not exists customers_business_id_idx on customers (business_id);
alter table customers enable row level security;

drop policy if exists customers_tenant_isolation on customers;
create policy customers_tenant_isolation on customers
  for all
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
  );
