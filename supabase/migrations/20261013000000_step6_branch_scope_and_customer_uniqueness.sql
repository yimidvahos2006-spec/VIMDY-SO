-- ============================================================================
-- 20261013000000_step6_branch_scope_and_customer_uniqueness.sql
-- ----------------------------------------------------------------------------
-- Paso 6, punto 1 y 3: aislamiento por sucursal real + unicidad de clientes.
--
-- 1) auth_branch_ids() con alcance por sucursal (compatible hacia atras)
-- -----------------------------------------------------------------------
-- Antes devolvia TODAS las sucursales de los negocios del usuario:
--
--   select array_agg(b.id) from branches b
--   join business_members bm on bm.business_id = b.business_id
--   where bm.user_id = auth.uid() and b.business_id in (auth_business_ids())
--
-- Eso hacia que TODO predicate `branch_id = ANY(auth_branch_ids())` (customers,
-- sales, orders, kitchen_orders, tables, products, y los RPC de Paso 2/4)
-- fuera en la practica un filtro de NEGOCIO, no de sucursal.
--
-- Decisión de negocio aplicada:
--   * ADMIN / GERENTE  -> acceso de negocio completo.
--   * CAJERO / MESERO / INVENTARIO -> limitados a app_users.branch_id.
--   * branch_id NULL -> business-wide (modelo actual válido).
--
-- Compatibilidad hacia atrás (no rompe Pasos 1-5):
--   (a) SIN fila en app_users para (negocio, usuario) -> business-wide, igual
--       que antes. Las cuentas legacy / service_role siguen viendo todo.
--   (b) CON alguna fila de app_users y branch_id NULL -> business-wide explícito.
--   (c) CON filas de app_users todas con branch_id -> solo esas sucursales.
--
-- Por qué SECURITY DEFINER: app_users tiene RLS propio que solo deja leer a
-- ADMIN/GERENTE, así que un CAJERO no podría leer su propia fila y la
-- restricción nunca se aplicaría. Como app_users NO tiene FORCE ROW LEVEL
-- SECURITY, el propietario (postgres) no pasa por RLS dentro del definer, lo
-- que ademas corta la recursion: la policy de app_users llama a
-- auth_branch_ids() y esta vuelve a leer app_users.
--
-- auth.uid() sigue leyendose del JWT original (no del definer), asi que la
-- identidad evaluada es la del usuario real.
--
-- 2) Unicidad de clientes por negocio + documento
-- -----------------------------------------------
-- customers.data es jsonb y no existia ninguna restriccion de duplicados: se
-- podian crear N clientes con el mismo documento. Se agrega un indice UNICO
-- PARCIAL:
--   * por negocio (el mismo documento puede existir en dos negocios distintos);
--   * normalizado (upper/btrim) para no duplicar por mayusculas o espacios;
--   * parcial (WHERE documento no vacio) porque los clientes sin documento son
--     validos y pueden repetirse.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) auth_branch_ids() con alcance por sucursal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_branch_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
           array_agg(DISTINCT b.id) FILTER (WHERE b.id IS NOT NULL),
           '{}'::uuid[]
         )
  FROM public.branches AS b
  JOIN public.business_members AS bm
    ON bm.business_id = b.business_id
  WHERE bm.user_id = auth.uid()
    AND b.business_id IN (SELECT public.auth_business_ids())
    AND (
      -- (a) sin asignacion registrada: comportamiento anterior (business-wide).
      NOT EXISTS (
        SELECT 1
        FROM public.app_users AS au
        WHERE au.business_id = b.business_id
          AND au.id = bm.user_id::text
      )
      -- (b) branch_id NULL explicito: business-wide.
      OR EXISTS (
        SELECT 1
        FROM public.app_users AS au
        WHERE au.business_id = b.business_id
          AND au.id = bm.user_id::text
          AND au.branch_id IS NULL
      )
      -- (c) sucursal asignada a este usuario.
      OR EXISTS (
        SELECT 1
        FROM public.app_users AS au
        WHERE au.business_id = b.business_id
          AND au.id = bm.user_id::text
          AND au.branch_id = b.id
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.auth_branch_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_branch_ids() TO authenticated, service_role;

COMMENT ON FUNCTION public.auth_branch_ids() IS
  'Sucursales visibles para el usuario actual. Aplica el alcance de app_users.branch_id: si el usuario tiene filas en app_users y todas tienen branch_id, solo ve esas; si no tiene filas o tiene alguna con branch_id NULL, es business-wide. La asignacion se lee como SECURITY DEFINER porque app_users tiene RLS que solo abre lectura a ADMIN/GERENTE.';

-- ---------------------------------------------------------------------------
-- 2) Unicidad de cliente por (negocio, telefono)
-- -----------------------------------------------
-- MODELO REAL AUDITADO (no se inventa ningun campo):
--   * La interfaz TypeScript Customer declara id, name, email, phone, points.
--     NO existe ningun campo de documento.
--   * useCustomers.createCustomer() asigna id = crypto.randomUUID(): el id es un
--     UUID aleatorio, no un documento. El indice primario ya evita repetidos por id.
--   * La UI busca por "nombre o telefono" (dictionaries pos.customer.searchPlaceholder).
--     El telefono es la identificacion operativa real de un cliente.
--
-- Por eso la unicidad se define sobre PHONE y NO sobre documento: un indice por
-- documento seria un campo que el modelo no tiene.
--
-- El indice es PARCIAL porque el telefono es opcional: los clientes sin
-- telefono son validos y pueden repetirse (menus, clientes de mostrador).
-- Se normaliza para no duplicar por formato (+57 / espacios / guiones).
CREATE UNIQUE INDEX IF NOT EXISTS customers_business_phone_uniq
  ON public.customers (business_id, regexp_replace(COALESCE(data->>'phone', ''), '[^0-9A-Za-z]', '', 'g'))
  WHERE NULLIF(btrim(COALESCE(data->>'phone', '')), '') IS NOT NULL;

COMMENT ON INDEX public.customers_business_phone_uniq IS
  'Un cliente por telefono y negocio (telefono normalizado). Es PARCIAL: los clientes sin telefono siguen siendo validos y pueden repetirse. NO se indexa documento porque el modelo Customer no tiene ese campo.';

COMMIT;