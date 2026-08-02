-- ============================================================================
-- VIMDY OS — Schema multi-tenant para Supabase (Postgres)
-- ----------------------------------------------------------------------------
-- Cómo usarlo:
--   1. Crea un proyecto en https://supabase.com (gratis para empezar).
--   2. Ve a "SQL Editor" en el panel de Supabase.
--   3. Pega TODO este archivo y dale "Run".
--   4. Listo: quedan creadas todas las tablas, con aislamiento automático
--      por negocio (Row Level Security) — un negocio JAMÁS puede leer ni
--      escribir datos de otro, aunque compartan el mismo servidor.
--
-- Diseño: en vez de crear una columna por cada campo de cada entidad
-- (Product, Sale, KitchenOrder...), cada tabla tiene una columna `data`
-- tipo JSONB que guarda la entidad completa tal como ya la define
-- Entities.ts. Esto es intencional: te permite seguir agregando campos
-- (como ya hicimos con `priority`) SIN tener que migrar el esquema SQL
-- cada vez. El día que necesites reportes SQL muy pesados sobre un campo
-- específico, se puede "sacar" esa columna del JSONB a una columna real
-- — pero no es necesario para lanzar.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. NEGOCIOS (tenants) — cada fila es un negocio usando VIMDY
-- ----------------------------------------------------------------------------
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'trial', -- 'trial' | 'monthly' | 'yearly'
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  -- Configuración inteligente por país (ver src/core/config/globalization.ts):
  -- se calculan UNA vez en el registro (register-business) a partir del país
  -- elegido, y quedan editables después desde Configuración.
  country text not null default 'CO',
  currency text not null default 'COP',
  language text not null default 'es',
  timezone text not null default 'America/Bogota',
  tax_rate numeric not null default 19,
  -- Onboarding inteligente (Fase 3): un negocio recién creado arranca en
  -- false. Mientras sea false, el usuario es enviado automáticamente a
  -- /onboarding en vez del Dashboard. Se pasa a true al terminar el
  -- asistente (ver PASO 11 del flujo de onboarding).
  onboarding_completed boolean not null default false,
  -- Tipo de negocio elegido en el PASO 3 del onboarding (ver
  -- src/core/config/businessTypes.ts para los valores válidos: restaurante,
  -- cafeteria, pizzeria, asadero, bar, panaderia, tienda, heladeria, hotel,
  -- food_truck). Null hasta que el negocio pasa por el PASO 3. Determina
  -- qué módulos se activan (PASO 4) y cómo se arma el Sidebar.
  business_type text,
  -- Módulos activos del negocio, calculados en el PASO 4 del onboarding a
  -- partir de business_type (ver src/core/config/modules.ts). El Sidebar
  -- (VimdySidebar.tsx) lee esto para mostrar/ocultar Mesas, Cocina, etc.
  -- Vacío hasta que el negocio pasa por el PASO 4.
  enabled_modules text[] not null default '{}',
  -- Punto 5.5: qué usa este negocio para recibir comandas en Cocina.
  -- 'pantalla' (KDS) o 'impresora' (tiquetera, todavía no implementada
  -- del lado de la app — ver KitchenPrinterOutput). Todo negocio nuevo
  -- arranca en 'pantalla'.
  salida_cocina text not null default 'pantalla'
);

-- Migración segura para bases de datos que ya tenían la tabla `businesses`
-- creada antes de agregar estas columnas (create table if not exists no
-- las agrega si la tabla ya existe).
alter table businesses add column if not exists country text not null default 'CO';
alter table businesses add column if not exists currency text not null default 'COP';
alter table businesses add column if not exists language text not null default 'es';
alter table businesses add column if not exists timezone text not null default 'America/Bogota';
alter table businesses add column if not exists tax_rate numeric not null default 19;
alter table businesses add column if not exists onboarding_completed boolean not null default false;
alter table businesses add column if not exists business_type text;
alter table businesses add column if not exists enabled_modules text[] not null default '{}';
alter table businesses add column if not exists salida_cocina text not null default 'pantalla';

-- ----------------------------------------------------------------------------
-- 2. USUARIOS DE CADA NEGOCIO — conecta el login real (Supabase Auth)
--    con el negocio al que pertenece cada usuario. Un mismo login de
--    Supabase Auth puede en teoría pertenecer a más de un negocio, pero
--    lo normal es 1 a 1.
-- ----------------------------------------------------------------------------
create table if not exists business_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  role text not null default 'ADMIN', -- 'ADMIN' | 'CAJERO' | 'MESERO' | 'COCINA'
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);

-- ----------------------------------------------------------------------------
-- 3. Función auxiliar: negocios a los que pertenece el usuario autenticado.
--    Se usa en TODAS las políticas de seguridad de abajo.
-- ----------------------------------------------------------------------------
create or replace function auth_business_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select business_id from business_members where user_id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- 4. Tabla genérica reutilizada para cada "store" que ya tienes en
--    indexedDbCore.ts (products, sales, customers, kitchenOrders, etc).
--    Se crea una tabla real por cada una, todas con la misma forma.
-- ----------------------------------------------------------------------------
do $$
declare
  store_name text;
  store_names text[] := array[
    'products', 'sales', 'customers', 'kitchen_orders', 'alerts',
    'inventory_movements', 'cash_movements', 'tables', 'orders',
    'shifts', 'roles', 'permissions', 'audit_logs', 'categories', 'suppliers',
    'business_snapshots', 'purchase_orders', 'waiters',
    -- 'receipts': persistencia real de recibos (antes vivían solo en RAM,
    -- en ReceiptEngine.history, y se perdían al recargar la página).
    -- 'notifications': ya tenía su NotificationRepository apuntando a esta
    -- tabla, pero nunca se creaba con CREATE TABLE en ningún script — solo
    -- se mencionaba en notifications_migration.sql (que solo la agrega a
    -- Realtime, asumiendo que ya existe). Se agrega aquí para que exista de
    -- verdad.
    'receipts', 'notifications'
  ];
begin
  foreach store_name in array store_names loop
    execute format('
      create table if not exists %I (
        id text primary key,
        business_id uuid not null references businesses(id) on delete cascade,
        data jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    ', store_name);

    execute format('
      create index if not exists %I on %I (business_id);
    ', store_name || '_business_id_idx', store_name);

    execute format('alter table %I enable row level security;', store_name);

    execute format('
      drop policy if exists %I on %I;
      create policy %I on %I
        for all
        using (business_id in (select auth_business_ids()))
        with check (business_id in (select auth_business_ids()));
    ',
      store_name || '_tenant_isolation', store_name,
      store_name || '_tenant_isolation', store_name
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. `users` de VIMDY (meseros, cajeros, cocineros) es DISTINTO de
--    auth.users (el login). auth.users es quién puede entrar al sistema;
--    esta tabla es el directorio de empleados de cada negocio (lo que ya
--    modela tu entidad User en Entities.ts). Se maneja igual que las demás.
-- ----------------------------------------------------------------------------
create table if not exists app_users (
  id text primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_users_business_id_idx on app_users (business_id);
alter table app_users enable row level security;
drop policy if exists app_users_tenant_isolation on app_users;
create policy app_users_tenant_isolation on app_users
  for all
  using (business_id in (select auth_business_ids()))
  with check (business_id in (select auth_business_ids()));

-- ----------------------------------------------------------------------------
-- 6. Seguridad extra: los negocios y sus miembros también quedan aislados.
-- ----------------------------------------------------------------------------
alter table businesses enable row level security;
drop policy if exists businesses_member_access on businesses;
create policy businesses_member_access on businesses
  for select
  using (id in (select auth_business_ids()));

-- Cualquier persona ya logueada en Supabase Auth puede CREAR un negocio
-- nuevo (es el paso "Crear cuenta" / registerBusiness()). Antes de este
-- insert todavía no existe la fila en business_members, así que no se
-- puede exigir auth_business_ids() aquí — se exige en el insert de
-- business_members de abajo, que es lo que realmente ata ese negocio
-- al usuario que lo creó.
drop policy if exists businesses_insert_own on businesses;
create policy businesses_insert_own on businesses
  for insert
  with check (auth.uid() is not null);

-- Un miembro del negocio (cualquier rol, ya que hoy solo el ADMIN llega al
-- onboarding) puede actualizar la fila de SU propio negocio. Esto es lo
-- que permite marcar onboarding_completed = true desde el cliente al
-- terminar el asistente, y en general editar datos del negocio desde
-- Configuración más adelante.
drop policy if exists businesses_update_own on businesses;
create policy businesses_update_own on businesses
  for update
  using (id in (select auth_business_ids()))
  with check (id in (select auth_business_ids()));

alter table business_members enable row level security;
drop policy if exists business_members_self_access on business_members;
create policy business_members_self_access on business_members
  for select
  using (user_id = auth.uid());

-- Un usuario solo puede insertarse a SÍ MISMO como miembro de un negocio
-- (no puede meter a otro usuario ni asignarse a un negocio ajeno editando
-- el user_id). Esto es lo que cierra el registro de forma segura.
drop policy if exists business_members_insert_self on business_members;
create policy business_members_insert_self on business_members
  for insert
  with check (user_id = auth.uid());

-- ============================================================================
-- Listo. A partir de aquí, cualquier consulta hecha con el token de un
-- usuario autenticado SOLO puede ver/escribir filas de SU propio negocio.
-- Esto es lo que hace seguro tener miles de negocios en la misma base de
-- datos sin que se mezclen ni se filtren datos entre ellos.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 7. Soporte para registro autorreparable (usado por la Edge Function
--    register-business). Si un intento de registro anterior se cortó a
--    medias (se creó el auth.user pero no llegó a crear el negocio, por
--    ejemplo por un error de red), el siguiente intento con el mismo correo
--    NO debe fallar con "usuario ya existe" — debe detectar que está
--    huérfano y completar el registro donde se quedó.
--
--    security definer porque auth.users no es legible desde el cliente ni
--    siquiera con service_role vía PostgREST directo sobre el schema auth;
--    esta función expone SOLO lo mínimo necesario (id + si ya tiene negocio).
-- ----------------------------------------------------------------------------
create or replace function public.admin_get_user_business_status(p_email text)
returns table(user_id uuid, has_business boolean)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  return query
    select u.id,
           exists(select 1 from business_members bm where bm.user_id = u.id)
    from auth.users u
    where u.email = p_email
    limit 1;
end;
$$;

-- Solo la Edge Function (que llama con la service_role key) puede usar esto.
revoke all on function public.admin_get_user_business_status(text) from public, anon, authenticated;
grant execute on function public.admin_get_user_business_status(text) to service_role;

-- ----------------------------------------------------------------------------
-- 8. GRANTS explícitos (esto es lo que faltaba y causaba
--    "permission denied for table businesses").
--
--    RLS y los permisos de tabla son DOS capas distintas:
--    - RLS (arriba) filtra QUÉ FILAS puede ver/tocar cada rol.
--    - GRANT (aquí abajo) da el permiso base para tocar la tabla, sin el
--      cual RLS ni siquiera llega a evaluarse — Postgres corta antes con
--      "permission denied for table X".
--
--    service_role: usada por la Edge Function con la service_role key.
--    Por diseño BYPASSEA RLS por completo, pero igual necesita el GRANT
--    de tabla para poder tocarla.
--
--    authenticated: usada por el navegador de cualquier usuario ya
--    logueado. SÍ está sujeta a RLS, así que aunque le demos GRANT de
--    tabla completa aquí, las policies de arriba siguen filtrando para
--    que solo vea/edite lo de su propio negocio.
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant all on businesses to service_role;
grant select, insert, delete on businesses to authenticated;

-- FASE 0 — seguridad de la suscripción: sin este bloque, cualquier usuario
-- logueado podía hacer supabase.from('businesses').update({ plan: 'yearly',
-- payment_status: 'approved' }) desde la consola del navegador y ponerse
-- plan pagado gratis, porque `businesses_update_own` (arriba) solo filtra
-- QUÉ FILA se puede tocar, no QUÉ COLUMNAS. Por eso el UPDATE se resuelve
-- aparte, a nivel de columna, en vez de con el `grant ... update ...`
-- genérico de las demás tablas de este archivo.
--
-- Le quita a los usuarios normales el permiso de editar CUALQUIER columna
-- de su negocio.
revoke update on businesses from authenticated;

-- Le devuelve el permiso de editar SOLO las columnas seguras (datos del
-- negocio y configuración) — nunca las de dinero/plan/suscripción.
grant update (
  name,
  country,
  currency,
  language,
  timezone,
  tax_rate,
  onboarding_completed,
  business_type,
  enabled_modules
) on businesses to authenticated;

-- Estas columnas quedan SIN permiso de update desde el cliente — solo se
-- podrán cambiar con la Service Role Key en la Fase 2 (pagos reales):
-- plan, trial_ends_at, renewal_date, next_charge_at,
-- payment_method, payment_status

grant all on business_members to service_role;
grant select, insert, update, delete on business_members to authenticated;

grant all on app_users to service_role;
grant select, insert, update, delete on app_users to authenticated;

do $$
declare
  store_name text;
  store_names text[] := array[
    'products', 'sales', 'customers', 'kitchen_orders', 'alerts',
    'inventory_movements', 'cash_movements', 'tables', 'orders',
    'shifts', 'roles', 'permissions', 'audit_logs', 'categories', 'suppliers',
    'business_snapshots', 'purchase_orders', 'waiters',
    'receipts', 'notifications'
  ];
begin
  foreach store_name in array store_names loop
    execute format('grant all on %I to service_role;', store_name);
    execute format('grant select, insert, update, delete on %I to authenticated;', store_name);
  end loop;
end $$;

-- ============================================================================
-- 9. FASE 1 — Blindar VIMDY: descuento/aumento de stock ATÓMICO.
-- ----------------------------------------------------------------------------
-- Problema que resuelve: InventoryEngine.decreaseStock() (llamado por
-- consumeForSale en cada venta) antes hacía "leer stock -> calcular
-- stock nuevo en JavaScript -> escribir stock nuevo", en dos pasos
-- separados. Si dos cajas (o caja + mesero) venden el mismo producto casi
-- al mismo instante y solo queda poco stock, las dos lecturas ven el mismo
-- número, las dos aprueban la venta y las dos descuentan -> sobreventa
-- (stock queda negativo, o se vende algo que ya no había).
--
-- Esta función hace la verificación Y el descuento en UNA sola sentencia
-- SQL (UPDATE ... WHERE stock + delta >= 0 ...), que Postgres ejecuta con
-- bloqueo de fila: si dos ventas concurrentes llegan a la vez, Postgres
-- serializa el acceso a esa fila — la segunda ve el stock YA descontado
-- por la primera antes de decidir si alcanza. Ya no es posible que dos
-- ventas "lean" el mismo stock disponible a la vez.
--
-- p_delta: positivo para aumentar stock (compras/reposición), negativo
-- para descontar (ventas). p_extra_fields: campos adicionales a fusionar
-- en la misma operación atómica (ej. purchasePrice, lastPurchaseDate al
-- comprar) — así increaseStock no necesita un segundo UPDATE separado que
-- podría pisar un descuento concurrente hecho entre medio.
--
-- security invoker (no definer): corre con los permisos del usuario que
-- llama, así que sigue estando sujeta a la Row Level Security de
-- `products` — un cajero jamás puede tocar stock de otro negocio con esto.
-- ============================================================================
create or replace function public.adjust_product_stock(
  p_product_id text,
  p_delta numeric,
  p_extra_fields jsonb default '{}'::jsonb,
  -- BLOQUEANTE #4 (auditoría Fase 2): antes esta función rechazaba SIEMPRE
  -- cualquier descuento que dejara el stock en negativo, sin importar el
  -- switch "Permitir stock negativo" de Ajustes (companyConfigStore) — por
  -- eso el switch "no hacía nada": la guardia real vivía acá, ignorando por
  -- completo la preferencia del negocio. Default `false` para que cualquier
  -- llamada vieja (o de un cliente desactualizado) siga siendo tan estricta
  -- como siempre.
  p_allow_negative boolean default false
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_updated jsonb;
begin
  update products
  set data = jsonb_set(
               data,
               '{stock}',
               to_jsonb(((data->>'stock')::numeric + p_delta))
             ) || p_extra_fields,
      updated_at = now()
  where id = p_product_id
    and (p_allow_negative or (data->>'stock')::numeric + p_delta >= 0)
  returning data into v_updated;

  if v_updated is null then
    -- El UPDATE de arriba no afectó ninguna fila: o el producto no existe
    -- (o no pertenece al negocio del usuario, lo que RLS ve igual que "no
    -- existe"), o sí existe pero no había stock suficiente. Se distingue
    -- con una lectura aparte SOLO para dar un mensaje de error útil — el
    -- UPDATE de arriba ya falló como transacción completa, así que esta
    -- lectura no reintroduce ninguna condición de carrera real.
    if not exists (select 1 from products where id = p_product_id) then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    else
      raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;
  end if;

  return v_updated;
end;
$$;

revoke all on function public.adjust_product_stock(text, numeric, jsonb, boolean) from public, anon;
grant execute on function public.adjust_product_stock(text, numeric, jsonb, boolean) to authenticated;