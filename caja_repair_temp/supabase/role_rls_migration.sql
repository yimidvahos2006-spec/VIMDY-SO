-- ============================================================================
-- role_rls_migration.sql
-- ----------------------------------------------------------------------------
-- CRÍTICO #2 del checklist de lanzamiento: "RLS por rol, no solo por
-- negocio". Hoy TODAS las tablas usan la misma política genérica
-- `<tabla>_tenant_isolation`, creada en el loop de la sección 4 de
-- schema.sql:
--
--     using (business_id in (select auth_business_ids()))
--
-- Esto solo valida "¿eres del negocio?" — un MESERO o COCINA autenticado
-- puede, con su propio token, hacer
-- `supabase.from('business_snapshots').select('*')` (o cualquier otra
-- tabla de reportes/costos) desde la consola del navegador, aunque la UI
-- nunca le muestre ese botón.
--
-- QUÉ HACE ESTA MIGRACIÓN Y QUÉ NO:
--
-- Se restringieron por rol SOLO las tablas de back-office que, revisando
-- el código real (engines, repositories, rutas protegidas), NINGÚN rol
-- operativo (CAJERO/MESERO/COCINA) lee ni escribe hoy:
--   - roles, permissions   → catálogo del viejo RoleEngine, hoy sin
--                             ninguna pantalla que lo use (el rol real
--                             vive en business_members.role). Solo ADMIN.
--   - audit_logs           → log de seguridad, hoy nadie le escribe
--                             desde el cliente. Solo ADMIN puede leerlo.
--   - business_snapshots   → datos del motor de IA/forecasting.
--   - suppliers,
--     purchase_orders      → proveedores y compras (costos, back-office).
--   - inventory_movements  → Kardex: SOLO lectura restringida (el INSERT
--                             se deja abierto a todo el negocio a propósito,
--                             ver nota más abajo).
--
-- A PROPÓSITO NO se tocó `sales`, `receipts`, `kitchen_orders`, `tables`,
-- `orders`, `cash_movements`, `shifts`, `app_users`, `products`,
-- `categories`, `customers`, `alerts`, `notifications`, `waiters`,
-- `business_members` ni `businesses`. Razón: rastreando el código se
-- confirmó que el catálogo de permisos de rolePermissions.ts (el que
-- decide qué botones se muestran en la UI) NO coincide 1:1 con quién
-- necesita escribir cada tabla. Ejemplo real encontrado:
-- TableDetailPanel.tsx tiene un botón "Cobrar mesa" que un MESERO SÍ
-- puede usar (para negocios sin cajero separado) y que termina creando
-- una fila real en `sales` y en `receipts` vía TableEngine — aunque
-- MESERO no tiene "sales.create" en el catálogo. Si hubiera restringido
-- `sales`/`receipts` por ese permiso, un mesero real habría dejado de
-- poder cobrar mesas en producción. Blindar esas tablas por rol es un
-- trabajo aparte que primero necesita una regla de negocio clara (¿puede
-- cualquier mesero cobrar cualquier mesa? ¿solo las suyas?) antes de
-- convertirla en SQL — no es solo "copiar el catálogo".
--
-- Aplicar con: pega TODO este archivo en el SQL Editor de Supabase y
-- dale "Run" — igual que los demás archivos *_migration.sql. Se puede
-- correr las veces que haga falta (usa CREATE OR REPLACE / DROP POLICY
-- IF EXISTS en todos lados).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Función auxiliar: rol del usuario autenticado DENTRO de un negocio
--    específico. Se usa en todas las políticas de abajo, igual que
--    auth_business_ids() ya se usa para el aislamiento por negocio.
-- ----------------------------------------------------------------------------
create or replace function public.auth_role(p_business_id uuid)
returns text
language sql
security definer
stable
as $$
  select role from business_members
  where user_id = auth.uid() and business_id = p_business_id
  limit 1;
$$;

revoke all on function public.auth_role(uuid) from public, anon;
grant execute on function public.auth_role(uuid) to authenticated;

-- ============================================================================
-- 2. roles / permissions — catálogo del RoleEngine viejo (IndexedDB). Hoy
--    ninguna pantalla del producto lo usa (el rol real de cada usuario
--    vive en business_members.role), pero la tabla existe y hoy cualquier
--    miembro del negocio puede leerla/escribirla. Se deja solo para ADMIN
--    para no dejar una puerta abierta a un catálogo de permisos "fantasma".
-- ============================================================================
drop policy if exists roles_tenant_isolation on roles;
drop policy if exists roles_admin_only on roles;
create policy roles_admin_only on roles
  for all
  using (business_id in (select auth_business_ids()) and auth_role(business_id) = 'ADMIN')
  with check (business_id in (select auth_business_ids()) and auth_role(business_id) = 'ADMIN');

drop policy if exists permissions_tenant_isolation on permissions;
drop policy if exists permissions_admin_only on permissions;
create policy permissions_admin_only on permissions
  for all
  using (business_id in (select auth_business_ids()) and auth_role(business_id) = 'ADMIN')
  with check (business_id in (select auth_business_ids()) and auth_role(business_id) = 'ADMIN');

-- ============================================================================
-- 3. audit_logs — log de seguridad. Debe poder registrar acciones de
--    cualquier rol (por eso el INSERT queda abierto a todo el negocio),
--    pero solo ADMIN debe poder LEER el historial, y nadie —ni ADMIN—
--    debe poder editarlo o borrarlo (un log que se puede alterar no sirve
--    como evidencia). Al no crear política de UPDATE/DELETE, Postgres las
--    deniega por defecto.
-- ============================================================================
drop policy if exists audit_logs_tenant_isolation on audit_logs;

drop policy if exists audit_logs_select_admin on audit_logs;
create policy audit_logs_select_admin on audit_logs
  for select
  using (business_id in (select auth_business_ids()) and auth_role(business_id) = 'ADMIN');

drop policy if exists audit_logs_insert_any_member on audit_logs;
create policy audit_logs_insert_any_member on audit_logs
  for insert
  with check (business_id in (select auth_business_ids()));

-- ============================================================================
-- 4. business_snapshots — datos agregados del motor de IA/forecasting
--    (PatternLearningEngine). El motor puede seguir escribiendo desde la
--    sesión de cualquier rol (INSERT/UPDATE quedan abiertos al negocio),
--    pero SOLO roles con acceso a reportes pueden leer el resultado —
--    hoy en producción esto es ADMIN; GERENTE/CONTADOR/SOPORTE se dejan
--    ya habilitados para cuando existan como rol real (ver
--    create-staff-user, VALID_ROLES).
-- ============================================================================
drop policy if exists business_snapshots_tenant_isolation on business_snapshots;

drop policy if exists business_snapshots_select_reports on business_snapshots;
create policy business_snapshots_select_reports on business_snapshots
  for select
  using (
    business_id in (select auth_business_ids())
    and auth_role(business_id) in ('ADMIN', 'GERENTE', 'CONTADOR', 'SOPORTE')
  );

drop policy if exists business_snapshots_write_any_member on business_snapshots;
create policy business_snapshots_write_any_member on business_snapshots
  for insert
  with check (business_id in (select auth_business_ids()));

drop policy if exists business_snapshots_update_any_member on business_snapshots;
create policy business_snapshots_update_any_member on business_snapshots
  for update
  using (business_id in (select auth_business_ids()))
  with check (business_id in (select auth_business_ids()));

-- ============================================================================
-- 5. suppliers / purchase_orders — proveedores y órdenes de compra:
--    costos y datos de negociación con terceros. Solo lo usa el módulo
--    Inventario (PurchaseOrderEngine, usePurchaseOrders) — ningún flujo
--    de Caja, Mesas o Cocina los toca. Igual que arriba, INVENTARIO/
--    GERENTE se dejan listos para cuando existan como rol real.
-- ============================================================================
drop policy if exists suppliers_tenant_isolation on suppliers;
drop policy if exists suppliers_inventory_access on suppliers;
create policy suppliers_inventory_access on suppliers
  for all
  using (
    business_id in (select auth_business_ids())
    and auth_role(business_id) in ('ADMIN', 'GERENTE', 'INVENTARIO')
  )
  with check (
    business_id in (select auth_business_ids())
    and auth_role(business_id) in ('ADMIN', 'GERENTE', 'INVENTARIO')
  );

drop policy if exists purchase_orders_tenant_isolation on purchase_orders;
drop policy if exists purchase_orders_inventory_access on purchase_orders;
create policy purchase_orders_inventory_access on purchase_orders
  for all
  using (
    business_id in (select auth_business_ids())
    and auth_role(business_id) in ('ADMIN', 'GERENTE', 'INVENTARIO')
  )
  with check (
    business_id in (select auth_business_ids())
    and auth_role(business_id) in ('ADMIN', 'GERENTE', 'INVENTARIO')
  );

-- ============================================================================
-- 6. inventory_movements — el Kardex. OJO: cada venta (decreaseStock) le
--    inserta una fila aquí, incluyendo las que crea un CAJERO o un MESERO
--    cobrando una mesa — por eso el INSERT se deja abierto a todo el
--    negocio, igual que hoy. Lo que se cierra es la LECTURA del historial
--    completo (costos, mermas, ajustes) a roles de back-office, y se
--    quita UPDATE/DELETE para todos: un Kardex debe ser de solo-anexar,
--    nadie edita ni borra un movimiento ya registrado (ni siquiera ADMIN
--    desde aquí — una corrección se hace con un movimiento nuevo, no
--    reescribiendo el historial).
-- ============================================================================
drop policy if exists inventory_movements_tenant_isolation on inventory_movements;

drop policy if exists inventory_movements_select_reports on inventory_movements;
create policy inventory_movements_select_reports on inventory_movements
  for select
  using (
    business_id in (select auth_business_ids())
    and auth_role(business_id) in ('ADMIN', 'GERENTE', 'INVENTARIO', 'CONTADOR')
  );

drop policy if exists inventory_movements_insert_any_member on inventory_movements;
create policy inventory_movements_insert_any_member on inventory_movements
  for insert
  with check (business_id in (select auth_business_ids()));

-- ============================================================================
-- Verificación rápida después de correr esto (reemplaza los ids):
--
--   -- Con el token de un MESERO o COCINA:
--   select * from business_snapshots;   -- debe devolver 0 filas (no error)
--   select * from suppliers;            -- debe devolver 0 filas
--   select * from roles;                -- debe devolver 0 filas
--
--   -- Con el token de un CAJERO haciendo una venta normal (o un MESERO
--   -- cobrando una mesa): la venta debe completarse igual que hoy, y
--   -- debe seguir quedando el registro correspondiente en
--   -- inventory_movements (aunque ese mismo cajero/mesero ya no pueda
--   -- LEER esa tabla después).
-- ============================================================================