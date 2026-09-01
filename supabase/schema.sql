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
  role text not null default 'MESERO', -- 'ADMIN' | 'CAJERO' | 'MESERO' | 'COCINA'
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);

-- ----------------------------------------------------------------------------
-- 2.1. INVITACIONES A NEGOCIOS — sistema de invitaciones para unirse.
-- ----------------------------------------------------------------------------
create table if not exists business_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'MESERO',
  token text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists business_invitations_business_id_idx on business_invitations (business_id);
create index if not exists business_invitations_token_idx on business_invitations (token);
create index if not exists business_invitations_email_idx on business_invitations (email);
create index if not exists business_invitations_user_id_idx on business_invitations (user_id);

alter table business_invitations enable row level security;
drop policy if exists business_invitations_admin_read on business_invitations;
create policy business_invitations_admin_read on business_invitations
  for select
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
  );

drop policy if exists business_invitations_admin_insert on business_invitations;
create policy business_invitations_admin_insert on business_invitations
  for insert
  with check (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  );

drop policy if exists business_invitations_admin_update on business_invitations;
create policy business_invitations_admin_update on business_invitations
  for update
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  )
  with check (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  );

drop policy if exists business_invitations_admin_delete on business_invitations;
create policy business_invitations_admin_delete on business_invitations
  for delete
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  );

drop policy if exists business_invitations_self_accept on business_invitations;
create policy business_invitations_self_accept on business_invitations
  for select
  using (
    email = (select email from auth.users where id = auth.uid())
    and expires_at > now()
    and accepted_at is null
  );

-- ----------------------------------------------------------------------------
-- 3. FUNCIONES SEGURAS (SECURITY DEFINER) — comprobación de membresía y rol.
--    No confiar en datos enviados desde el frontend para decisiones de seguridad.
-- ----------------------------------------------------------------------------
create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from business_members
    where business_id = target_business_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.has_business_role(
  target_business_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from business_members
    where business_id = target_business_id
      and user_id = auth.uid()
      and role = any(allowed_roles)
  );
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_invitation business_invitations;
  v_business_id uuid;
begin
  select * into v_invitation
  from business_invitations
  where token = p_token
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if not found then
    raise exception 'INVITATION_NOT_FOUND_OR_EXPIRED' using errcode = 'P0002';
  end if;

  if v_invitation.email != (select auth.email from auth.users where id = auth.uid()) then
    raise exception 'INVITATION_EMAIL_MISMATCH' using errcode = 'P0002';
  end if;

  v_business_id := v_invitation.business_id;

  insert into business_members (user_id, business_id, role)
  values (auth.uid(), v_business_id, v_invitation.role)
  on conflict (user_id, business_id) do update set role = excluded.role;

  update business_invitations
  set accepted_at = now()
  where id = v_invitation.id;

  return v_business_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Función auxiliar: negocios a los que pertenece el usuario autenticado.
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
-- 4. SUCURSALES DEL NEGOCIO — cada negocio puede tener una o más
--    sucursales, y los datos operativos deben quedar aislados por negocio +
--    sucursal. La sucursal principal es la que se usa por defecto cuando
--    el usuario no selecciona explícitamente una sucursal distinta.
-- ----------------------------------------------------------------------------
create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  is_main boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.ensure_branch_for_business(p_business_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
begin
  select id into v_branch_id
  from branches
  where business_id = p_business_id and is_main = true
  limit 1;

  if v_branch_id is not null then
    return v_branch_id;
  end if;

  insert into branches (business_id, name, is_main, active)
  values (p_business_id, 'Sucursal principal', true, true)
  returning id into v_branch_id;

  return v_branch_id;
end;
$$;
create index if not exists branches_business_id_idx on branches (business_id);
alter table branches enable row level security;
drop policy if exists branches_tenant_read on branches;
create policy branches_tenant_read on branches
  for select
  using (business_id in (select auth_business_ids()));

drop policy if exists branches_tenant_insert on branches;
create policy branches_tenant_insert on branches
  for insert
  with check (
    business_id in (select auth_business_ids())
    and public.is_business_subscription_active(business_id)
  );

drop policy if exists branches_tenant_update on branches;
create policy branches_tenant_update on branches
  for update
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
  )
  with check (
    business_id in (select auth_business_ids())
    and public.is_business_subscription_active(business_id)
  );

drop policy if exists branches_tenant_delete on branches;
create policy branches_tenant_delete on branches
  for delete
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  );

grant all on branches to service_role;

create or replace function auth_branch_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select id from branches where business_id in (select auth_business_ids());
$$;

-- ----------------------------------------------------------------------------
-- 5. Tabla genérica reutilizada para cada "store" que ya tienes en
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
        branch_id uuid references branches(id) on delete set null,
        version integer not null default 1,
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
        for select
        using (
          business_id in (select auth_business_ids())
          and (
            branch_id is null
            or branch_id in (select auth_branch_ids())
          )
        );
    ',
      store_name || '_tenant_read', store_name,
      store_name || '_tenant_read', store_name
    );

    execute format('
      drop policy if exists %I on %I;
      create policy %I on %I
        for insert
        with check (
          business_id in (select auth_business_ids())
          and (
            branch_id is null
            or branch_id in (select auth_branch_ids())
          )
          and public.is_business_subscription_active(business_id)
        );
    ',
      store_name || '_tenant_insert', store_name,
      store_name || '_tenant_insert', store_name
    );

    execute format('
      drop policy if exists %I on %I;
      create policy %I on %I
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
    ',
      store_name || '_tenant_update', store_name,
      store_name || '_tenant_update', store_name
    );

    execute format('
      drop policy if exists %I on %I;
      create policy %I on %I
        for delete
        using (
          business_id in (select auth_business_ids())
          and (
            branch_id is null
            or branch_id in (select auth_branch_ids())
          )
          and public.is_business_subscription_active(business_id)
        );
    ',
      store_name || '_tenant_delete', store_name,
      store_name || '_tenant_delete', store_name
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
  branch_id uuid references branches(id) on delete set null,
  version integer not null default 1,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_users_business_id_idx on app_users (business_id);
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
-- 6. Seguridad extra: los negocios y sus miembros también quedan aislados.
-- ----------------------------------------------------------------------------
alter table businesses enable row level security;
drop policy if exists businesses_member_access on businesses;
create policy businesses_member_access on businesses
  for select
  using (id in (select auth_business_ids()));

-- Cualquier persona ya logueada en Supabase Auth puede CREAR un negocio
-- nuevo (es el paso "Crear cuenta" / registerBusiness()) SIEMPRE QUE
-- todavía no haya usado su trial gratuito de por vida. Esto cierra la
-- ruta de bypass por la que un usuario podía crear negocios ilimitados
-- con trials ilimitados insertando directamente desde el cliente.
drop policy if exists businesses_insert_own on businesses;
create policy businesses_insert_own on businesses
  for insert
  with check (
    auth.uid() is not null
    and not public.has_user_used_trial(auth.uid())
  );

-- Solo ADMIN puede actualizar la fila de SU propio negocio, y SOLO columnas
-- seguras (no plan, payment_status, ni datos de suscripción).
-- Si la suscripción está vencida, no se permiten modificaciones operativas.
drop policy if exists businesses_update_own on businesses;
create policy businesses_update_own on businesses
  for update
  using (
    id in (select auth_business_ids())
    and public.has_business_role(id, array['ADMIN'])
  )
  with check (
    id in (select auth_business_ids())
    and public.has_business_role(id, array['ADMIN'])
    and public.is_business_subscription_active(id)
  );

-- Un miembro del negocio puede ver los datos de membresía de SU propio negocio.
alter table business_members enable row level security;
drop policy if exists business_members_self_read on business_members;
create policy business_members_self_read on business_members
  for select
  using (
    business_id in (select auth_business_ids())
    and user_id = auth.uid()
  );

-- Un usuario solo puede insertarse como miembro de un negocio SI existe una
-- invitación válida para ese correo en ese negocio, o si la operación la
-- realiza la Edge Function con service_role (que bypassea RLS).
drop policy if exists business_members_self_insert on business_members;
create policy business_members_self_insert on business_members
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from business_invitations
      where business_id = business_members.business_id
        and (email = (select email from auth.users where id = auth.uid())
             or user_id = auth.uid())
        and accepted_at is null
        and expires_at > now()
    )
    and public.is_business_subscription_active(business_members.business_id)
  );

-- Solo ADMIN puede cambiar roles de otros miembros.
drop policy if exists business_members_update_role on business_members;
create policy business_members_update_role on business_members
  for update
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  )
  with check (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  );

-- Solo ADMIN puede eliminar miembros (o el propio usuario puede retirarse).
drop policy if exists business_members_delete_member on business_members;
create policy business_members_delete_member on business_members
  for delete
  using (
    business_id in (select auth_business_ids())
    and (
      public.has_business_role(business_id, array['ADMIN'])
      or user_id = auth.uid()
    )
    and public.is_business_subscription_active(business_id)
  );

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

-- ============================================================================
-- 6.1. AUDITORÍA — triggers para cambios sensibles en business_members.
-- ============================================================================
create or replace function public.audit_business_members_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into audit_logs (id, business_id, data, version, created_at, updated_at)
    values (
      gen_random_uuid()::text,
      NEW.business_id,
      jsonb_build_object(
        'action', 'BUSINESS_MEMBER_ADDED',
        'user_id', NEW.user_id,
        'role', NEW.role,
        'business_id', NEW.business_id,
        'timestamp', now()
      ),
      1,
      now(),
      now()
    );
    return NEW;
  elsif TG_OP = 'UPDATE' then
    insert into audit_logs (id, business_id, data, version, created_at, updated_at)
    values (
      gen_random_uuid()::text,
      NEW.business_id,
      jsonb_build_object(
        'action', 'BUSINESS_MEMBER_ROLE_CHANGED',
        'user_id', NEW.user_id,
        'old_role', OLD.role,
        'new_role', NEW.role,
        'business_id', NEW.business_id,
        'timestamp', now()
      ),
      1,
      now(),
      now()
    );
    return NEW;
  elsif TG_OP = 'DELETE' then
    insert into audit_logs (id, business_id, data, version, created_at, updated_at)
    values (
      gen_random_uuid()::text,
      OLD.business_id,
      jsonb_build_object(
        'action', 'BUSINESS_MEMBER_REMOVED',
        'user_id', OLD.user_id,
        'role', OLD.role,
        'business_id', OLD.business_id,
        'timestamp', now()
      ),
      1,
      now(),
      now()
    );
    return OLD;
  end if;
  return null;
end;
$$;

drop trigger if exists audit_business_members on business_members;
create trigger audit_business_members
  after insert or update or delete on business_members
  for each row execute function public.audit_business_members_change();

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
grant select on business_members to authenticated;

grant all on business_invitations to service_role;
grant select, insert, update, delete on business_invitations to authenticated;

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
  p_allow_negative boolean default false,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_updated jsonb;
  v_branch_stock numeric;
begin
  if p_branch_id is not null then
    select data into v_updated from products where id = p_product_id;

    v_branch_stock := coalesce((v_updated->'branchStocks'->>p_branch_id::text)::numeric, 0) + p_delta;

    if not p_allow_negative and v_branch_stock < 0 then
      return null;
    end if;

    update products
    set data = jsonb_set(
                 case
                   when branch_id = p_branch_id then
                     jsonb_set(data, '{stock}', to_jsonb(v_branch_stock))
                   else
                     data
                 end,
                 '{branchStocks, ' || p_branch_id::text || '}',
                 to_jsonb(v_branch_stock)
               ) || p_extra_fields,
        updated_at = now()
    where id = p_product_id
    returning data into v_updated;
  else
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
  end if;

  if v_updated is null then
    if not exists (select 1 from products where id = p_product_id) then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    else
      raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;
  end if;

  return v_updated;
end;
$$;

revoke all on function public.adjust_product_stock(text, numeric, jsonb, boolean, uuid) from public, anon;
grant execute on function public.adjust_product_stock(text, numeric, jsonb, boolean, uuid) to authenticated;

-- ============================================================================
-- 7. VERIFICACIÓN DE SUSCRIPCIÓN — backend enforcement
-- ============================================================================
-- No confiar en el frontend para bloquear negocios vencidos.
-- Esta función devuelve true si el negocio tiene suscripción activa
-- (trial, monthly, yearly) y false si está expired o suspended.
-- Se usa en RLS policies y en Edge Functions.
-- ============================================================================
create or replace function public.is_business_subscription_active(p_business_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from businesses
    where id = p_business_id
      and (
        (
          plan = 'trial'
          and trial_ends_at is not null
          and trial_ends_at > CURRENT_TIMESTAMP
        )
        or (
          plan in ('monthly', 'yearly')
          and (
            renewal_date is null
            or renewal_date > CURRENT_TIMESTAMP
          )
        )
      )
  );
$$;

revoke all on function public.is_business_subscription_active(uuid) from public, anon;
grant execute on function public.is_business_subscription_active(uuid) to authenticated;

-- Permitir que service_role (Edge Functions) también la use
grant execute on function public.is_business_subscription_active(uuid) to service_role;

-- ============================================================================
-- 7.1. HELPER PARA EDGE FUNCTIONS — obtener estado de suscripción
-- ============================================================================
-- Devuelve el plan y si está activo. Las Edge Functions usan esto para
-- decidir si permitir operaciones que generen datos.
-- ============================================================================
create or replace function public.get_business_subscription_status(p_business_id uuid)
returns table(plan text, is_active boolean)
language sql
security definer
stable
set search_path = public
as $$
  select
    plan,
    case
      when plan = 'trial' and trial_ends_at is not null and trial_ends_at > CURRENT_TIMESTAMP then true
      when plan in ('monthly', 'yearly') and (renewal_date is null or renewal_date > CURRENT_TIMESTAMP) then true
      else false
    end as is_active
  from businesses
  where id = p_business_id;
$$;

revoke all on function public.get_business_subscription_status(uuid) from public, anon;
grant execute on function public.get_business_subscription_status(uuid) to authenticated, service_role;

-- ============================================================================
-- 8. TRIAL USAGE — control de trial por persona (uno de por vida)
-- ============================================================================
-- Tabla que registra qué usuarios ya usaron su trial gratuito. Se usa en
-- la política de inserción de businesses para evitar que un usuario cree
-- múltiples negocios con trials ilimitados.
-- ============================================================================
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

-- Función: verificar si un usuario ya usó su trial
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

-- Función: registrar uso de trial (idempotente)
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
-- 9. SISTEMA DE SUSCRIPCIONES — migración v2 consolidada
-- ============================================================================
-- Columnas de suscripción en businesses
alter table businesses add column if not exists renewal_date timestamptz;
alter table businesses add column if not exists next_charge_at timestamptz;
alter table businesses add column if not exists payment_method text;
alter table businesses add column if not exists payment_status text not null default 'none';
alter table businesses add column if not exists subscription_status text not null default 'trial';
alter table businesses add column if not exists trial_used_at timestamptz;

-- Tabla de auditoría de suscripciones
create table if not exists subscription_audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  action text not null,
  actor_type text not null default 'system',
  actor_id uuid,
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists subscription_audit_log_business_id_idx on subscription_audit_log (business_id);
create index if not exists subscription_audit_log_action_idx on subscription_audit_log (action);
create index if not exists subscription_audit_log_created_at_idx on subscription_audit_log (created_at);

alter table subscription_audit_log enable row level security;

drop policy if exists subscription_audit_log_tenant_isolation on subscription_audit_log;
create policy subscription_audit_log_tenant_isolation on subscription_audit_log
  for select
  using (business_id in (select auth_business_ids()));

drop policy if exists subscription_audit_log_service_insert on subscription_audit_log;
create policy subscription_audit_log_service_insert on subscription_audit_log
  for insert
  with check (false);

grant all on subscription_audit_log to service_role;
grant select on subscription_audit_log to authenticated;

-- Columnas de idempotencia y referencias en subscription_payments
create table if not exists subscription_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  plan text not null,
  amount numeric not null,
  currency text not null,
  status text not null default 'pending',
  idempotency_key text,
  wompi_reference text,
  mercadopago_reference text,
  paypal_order_id text,
  paypal_capture_id text,
  renewal_number integer not null default 0,
  provider_refund_id text,
  refunded_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- Constraints únicos
create unique index if not exists subscription_payments_idempotency_key_unique
  on subscription_payments (business_id, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists subscription_payments_wompi_reference_unique
  on subscription_payments (business_id, wompi_reference)
  where wompi_reference is not null;
create unique index if not exists subscription_payments_mercadopago_reference_unique
  on subscription_payments (business_id, mercadopago_reference)
  where mercadopago_reference is not null;
create unique index if not exists subscription_payments_paypal_order_id_unique
  on subscription_payments (business_id, paypal_order_id)
  where paypal_order_id is not null;

-- RLS y grants para subscription_payments
alter table subscription_payments enable row level security;

drop policy if exists subscription_payments_tenant_isolation on subscription_payments;
create policy subscription_payments_tenant_isolation on subscription_payments
  for select
  using (business_id in (select auth_business_ids()));

drop policy if exists subscription_payments_service_insert on subscription_payments;
create policy subscription_payments_service_insert on subscription_payments
  for insert
  with check (false);

grant all on subscription_payments to service_role;
grant select on subscription_payments to authenticated;

-- Función: verificar si un negocio puede empezar trial
create or replace function public.can_start_trial(p_business_id uuid)
returns boolean
language plpgsql
security definer
as $$
begin
  return not exists (
    select 1 from businesses
    where id = p_business_id
      and trial_used_at is not null
  );
end;
$$;

revoke all on function public.can_start_trial(uuid) from public, anon;
grant execute on function public.can_start_trial(uuid) to service_role, authenticated;

-- Función: marcar trial como usado
create or replace function public.mark_trial_used(p_business_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update businesses
  set trial_used_at = now()
  where id = p_business_id
    and trial_used_at is null;
end;
$$;

revoke all on function public.mark_trial_used(uuid) from public, anon;
grant execute on function public.mark_trial_used(uuid) to service_role, authenticated;

-- Función: calcular días de acceso para plan anual (12 pagados + 2 gratis)
create or replace function public.get_plan_period_days(p_plan text)
returns integer
language plpgsql
immutable
as $$
begin
  if p_plan = 'monthly' then
    return 30;
  elsif p_plan = 'yearly' then
    return 30 * 14;
  else
    raise exception 'Plan inválido: %', p_plan;
  end if;
end;
$$;

revoke all on function public.get_plan_period_days(text) from public, anon;
grant execute on function public.get_plan_period_days(text) to service_role, authenticated;

-- Función: activar suscripción (server-side, idempotente)
create or replace function public.activate_subscription_server_side(
  p_business_id uuid,
  p_plan text,
  p_payment_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_payment record;
  v_period_days integer;
  v_renewal_date timestamptz;
  v_next_charge_at timestamptz;
  v_result jsonb;
  v_audit_id uuid;
begin
  if p_plan not in ('monthly', 'yearly') then
    raise exception 'Plan inválido: %', p_plan;
  end if;

  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) as bid where bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  select * into v_payment
  from subscription_payments
  where id = p_payment_id
    and business_id = p_business_id;

  if not found then
    raise exception 'Pago no encontrado: %', p_payment_id;
  end if;

  if v_payment.status = 'approved' then
    return jsonb_build_object(
      'ok', true,
      'already_activated', true,
      'renewal_number', v_payment.renewal_number
    );
  end if;

  if v_payment.status = 'declined' then
    raise exception 'El pago % ya fue declinado. No se puede activar.', p_payment_id;
  end if;

  v_period_days := public.get_plan_period_days(p_plan);
  if v_payment.paid_at is not null then
    v_renewal_date := (v_payment.paid_at + (v_period_days || ' days')::interval);
  else
    v_renewal_date := (p_now + (v_period_days || ' days')::interval);
  end if;
  v_next_charge_at := v_renewal_date;

  if exists (
    select 1 from businesses
    where id = p_business_id
      and renewal_date > v_renewal_date
  ) then
    return jsonb_build_object(
      'ok', true,
      'already_activated', true,
      'renewal_number', v_payment.renewal_number,
      'reason', 'obsolete_payment'
    );
  end if;

  update businesses
  set
    plan = p_plan,
    renewal_date = v_renewal_date,
    next_charge_at = v_next_charge_at,
    payment_status = 'approved',
    subscription_status = p_plan
  where id = p_business_id;

  update subscription_payments
  set
    status = 'approved',
    paid_at = p_now,
    renewal_number = coalesce(renewal_number, 0) + 1
  where id = p_payment_id;

  if v_payment.renewal_number is null or v_payment.renewal_number = 0 then
    perform public.mark_trial_used(p_business_id);
  end if;

  insert into subscription_audit_log (business_id, action, actor_type, details)
  values (
    p_business_id,
    'SUBSCRIPTION_ACTIVATED',
    'payment_provider',
    jsonb_build_object(
      'plan', p_plan,
      'payment_id', p_payment_id,
      'renewal_number', coalesce(v_payment.renewal_number, 0) + 1,
      'renewal_date', to_char(v_renewal_date, 'YYYY-MM-DD HH24:MI:SS')
    )
  )
  returning id into v_audit_id;

  v_result := jsonb_build_object(
    'ok', true,
    'already_activated', false,
    'renewal_number', coalesce(v_payment.renewal_number, 0) + 1,
    'renewal_date', to_char(v_renewal_date, 'YYYY-MM-DD HH24:MI:SS'),
    'audit_id', v_audit_id
  );

  return v_result;
end;
$$;

revoke all on function public.activate_subscription_server_side(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.activate_subscription_server_side(uuid, text, uuid, timestamptz) to service_role, authenticated;

-- Función: renovar suscripción (server-side, idempotente)
create or replace function public.renew_subscription_server_side(
  p_business_id uuid,
  p_plan text,
  p_payment_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_payment record;
  v_period_days integer;
  v_renewal_date timestamptz;
  v_next_charge_at timestamptz;
  v_audit_id uuid;
begin
  if p_plan not in ('monthly', 'yearly') then
    raise exception 'Plan inválido: %', p_plan;
  end if;

  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) as bid where bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  if exists (
    select 1 from businesses
    where id = p_business_id
      and subscription_status = 'cancelled'
  ) then
    return jsonb_build_object(
      'ok', true,
      'already_renewed', false,
      'reason', 'subscription_cancelled'
    );
  end if;

  select * into v_payment
  from subscription_payments
  where id = p_payment_id
    and business_id = p_business_id;

  if not found then
    raise exception 'Pago no encontrado: %', p_payment_id;
  end if;

  if v_payment.status = 'approved' then
    return jsonb_build_object(
      'ok', true,
      'already_renewed', true,
      'renewal_number', v_payment.renewal_number
    );
  end if;

  if v_payment.status = 'declined' then
    raise exception 'El pago % ya fue declinado. No se puede renovar.', p_payment_id;
  end if;

  v_period_days := public.get_plan_period_days(p_plan);
  if v_payment.paid_at is not null then
    v_renewal_date := (v_payment.paid_at + (v_period_days || ' days')::interval);
  else
    v_renewal_date := (p_now + (v_period_days || ' days')::interval);
  end if;
  v_next_charge_at := v_renewal_date;

  if exists (
    select 1 from businesses
    where id = p_business_id
      and renewal_date > v_renewal_date
  ) then
    return jsonb_build_object(
      'ok', true,
      'already_renewed', true,
      'renewal_number', v_payment.renewal_number,
      'reason', 'obsolete_payment'
    );
  end if;

  update businesses
  set
    plan = p_plan,
    renewal_date = v_renewal_date,
    next_charge_at = v_next_charge_at,
    payment_status = 'approved',
    subscription_status = p_plan
  where id = p_business_id;

  update subscription_payments
  set
    status = 'approved',
    paid_at = p_now,
    renewal_number = coalesce(renewal_number, 0) + 1
  where id = p_payment_id;

  insert into subscription_audit_log (business_id, action, actor_type, details)
  values (
    p_business_id,
    'SUBSCRIPTION_RENEWED',
    'payment_provider',
    jsonb_build_object(
      'plan', p_plan,
      'payment_id', p_payment_id,
      'renewal_number', coalesce(v_payment.renewal_number, 0) + 1,
      'renewal_date', to_char(v_renewal_date, 'YYYY-MM-DD HH24:MI:SS')
    )
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true,
    'already_renewed', false,
    'renewal_number', coalesce(v_payment.renewal_number, 0) + 1,
    'renewal_date', to_char(v_renewal_date, 'YYYY-MM-DD HH24:MI:SS'),
    'audit_id', v_audit_id
  );
end;
$$;

revoke all on function public.renew_subscription_server_side(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.renew_subscription_server_side(uuid, text, uuid, timestamptz) to service_role, authenticated;

-- Función: marcar suscripción como vencida
create or replace function public.expire_subscription_server_side(
  p_business_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_audit_id uuid;
  v_business record;
begin
  select * into v_business from businesses where id = p_business_id;

  if not found then
    raise exception 'Negocio no encontrado: %', p_business_id;
  end if;

  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) as bid where bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  update businesses
  set
    payment_status = 'past_due',
    subscription_status = 'suspended'
  where id = p_business_id
    and subscription_status <> 'suspended';

  if not found then
    return jsonb_build_object('ok', true, 'already_expired', true);
  end if;

  insert into subscription_audit_log (business_id, action, actor_type, details)
  values (
    p_business_id,
    'SUBSCRIPTION_EXPIRED',
    'cron',
    jsonb_build_object('expired_at', to_char(p_now, 'YYYY-MM-DD HH24:MI:SS'))
  )
  returning id into v_audit_id;

  return jsonb_build_object('ok', true, 'already_expired', false, 'audit_id', v_audit_id);
end;
$$;

revoke all on function public.expire_subscription_server_side(uuid, timestamptz) from public, anon;
grant execute on function public.expire_subscription_server_side(uuid, timestamptz) to service_role, authenticated;

-- Función: cancelar suscripción (server-side, idempotente)
create or replace function public.cancel_subscription_server_side(
  p_business_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_business record;
  v_audit_id uuid;
begin
  select * into v_business
  from businesses
  where id = p_business_id;

  if not found then
    raise exception 'Negocio no encontrado: %', p_business_id;
  end if;

  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) as bid where bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  if v_business.subscription_status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true);
  end if;

  update businesses
  set
    subscription_status = 'cancelled',
    payment_status = case
      when payment_status = 'approved' then 'past_due'
      else payment_status
    end,
    next_charge_at = null
  where id = p_business_id;

  insert into subscription_audit_log (business_id, action, actor_type, details)
  values (
    p_business_id,
    'SUBSCRIPTION_CANCELLED',
    'user',
    jsonb_build_object('cancelled_at', to_char(p_now, 'YYYY-MM-DD HH24:MI:SS'))
  )
  returning id into v_audit_id;

  return jsonb_build_object('ok', true, 'already_cancelled', false, 'audit_id', v_audit_id);
end;
$$;

revoke all on function public.cancel_subscription_server_side(uuid, timestamptz) from public, anon;
grant execute on function public.cancel_subscription_server_side(uuid, timestamptz) to service_role, authenticated;

-- Trigger: mantener subscription_status sincronizado
create or replace function public.sync_subscription_status()
returns trigger
language plpgsql
as $$
declare
  v_days_remaining integer;
  v_new_status text;
begin
  if NEW.plan = 'trial' then
    if NEW.trial_ends_at is not null then
      v_days_remaining := ceil(extract(epoch from (NEW.trial_ends_at - now())) / 86400);
      if v_days_remaining > 0 then
        v_new_status := 'trial';
      else
        v_new_status := 'suspended';
      end if;
    else
      v_new_status := 'suspended';
    end if;
  elsif NEW.payment_status in ('approved') then
    v_new_status := NEW.plan;
  elsif NEW.payment_status in ('declined', 'past_due') then
    v_new_status := 'suspended';
  else
    v_new_status := NEW.plan;
  end if;

  NEW.subscription_status := v_new_status;
  return NEW;
end;
$$;

drop trigger if exists sync_subscription_status_trigger on businesses;
create trigger sync_subscription_status_trigger
  before insert or update of plan, trial_ends_at, payment_status on businesses
  for each row
  execute function public.sync_subscription_status();