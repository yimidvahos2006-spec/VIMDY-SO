-- ============================================================================
-- BLOQUE 1 — Investigación de solo lectura sobre `permissions`
-- ============================================================================
-- Ejecuta este script en el SQL Editor de Supabase para determinar:
--   1. Cuántas filas existen realmente.
--   2. Cuántas tienen `business_id IS NULL`.
--   3. Cuántos `business_id` diferentes existen.
--   4. Qué IDs de permisos existen.
--   5. Si los 88 permisos esperados ya están físicamente presentes.
--   6. Si existen roles igualmente heredados/huérfanos.
--   7. Si esas filas fueron creadas por una versión anterior del sistema.
--   8. Si pueden asignarse legítimamente al negocio actual.
--
-- NO modifica datos. Solo SELECT.
-- ============================================================================

-- 1. Conteo total de filas en permissions
select count(*) as total_permissions from public.permissions;

-- 2. Conteo de filas con business_id NULL
select count(*) as permissions_null_business_id
from public.permissions
where business_id is null;

-- 3. Conteo de business_id distintos
select count(distinct business_id) as distinct_business_ids
from public.permissions
where business_id is not null;

-- 4. Lista de business_id existentes (para verificar si el negocio actual está entre ellos)
select distinct business_id
from public.permissions
where business_id is not null
order by business_id;

-- 5. IDs de permisos existentes (primeros 100)
select id, business_id, version, updated_at
from public.permissions
order by business_id, id
limit 100;

-- 6. Verificar si los 88 permisos esperados existen (sin importar business_id)
--    (lista acortada para ejemplo; completar con los 88 IDs de seedIdentity.ts)
select id, business_id
from public.permissions
where id in (
  'sales.view', 'sales.create', 'sales.edit', 'sales.delete', 'sales.refund',
  'inventory.view', 'inventory.create', 'inventory.edit', 'inventory.delete', 'inventory.adjust',
  'customers.view', 'customers.create', 'customers.edit', 'customers.delete',
  'kitchen.view', 'kitchen.manage',
  'tables.view', 'tables.manage', 'tables.merge',
  'cash.view', 'cash.registerMovement',
  'shift.view', 'shift.open', 'shift.close',
  'reports.view', 'reports.export',
  'users.view', 'users.create', 'users.edit', 'users.delete',
  'roles.view', 'roles.manage',
  'company.settings'
)
order by id;

-- 7. Roles huérfanos (si aplica; ajustar tabla si es necesario)
-- select count(*) as total_roles from public.roles;
-- select count(*) as roles_null_business_id from public.roles where business_id is null;
-- select distinct business_id from public.roles where business_id is not null order by business_id;

-- 8. Fila más antigua (para estimar origen)
select min(created_at) as oldest_permission, max(created_at) as newest_permission
from public.permissions;
