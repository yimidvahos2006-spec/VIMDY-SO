-- ============================================================================
-- error_logging_migration.sql
-- ----------------------------------------------------------------------------
-- FASE 3.5 #2: "que tú te enteres antes que el cliente".
--
-- Hoy los errores del frontend viven en 35 `console.warn`/`console.error`
-- sueltos por el código — solo sirven si alguien tiene la consola del
-- navegador de ESE usuario abierta en ESE momento. Esta migración crea el
-- lugar donde esos errores quedan de verdad, centralizados, para que un
-- error en el negocio #340 mientras tú duermes no se pierda.
--
-- QUÉ CREA:
--   - Tabla `system_errors`: un error por fila, con contexto suficiente
--     para diagnosticar sin tener que pedirle capturas de pantalla al
--     dueño del negocio.
--
-- SEGURIDAD (importante, léelo antes de correr esto):
--   - RLS activo. Un usuario autenticado (cajero, mesero, admin de un
--     negocio) puede INSERTAR errores de SU PROPIO negocio — así el
--     logger del frontend (ver src/infrastructure/logging/opsLogger.ts)
--     puede escribir sin exponer una service_role key en el navegador.
--   - NADIE puede LEER esta tabla con su token de usuario normal — ni
--     siquiera el ADMIN de su propio negocio. Es intencional: esta tabla
--     es tuya (el operador de VIMDY), no del negocio. Solo se lee con la
--     service_role key, que vive únicamente en el backend (Edge
--     Functions / GitHub Actions), nunca en el navegador.
--   - Nadie puede UPDATE ni DELETE desde el cliente. Los errores quedan
--     inmutables; la limpieza de errores viejos se hace aparte si hace
--     falta (no incluida aquí a propósito, para no perder evidencia por
--     accidente).
--
-- Aplicar: pega TODO este archivo en el SQL Editor de Supabase y dale
-- "Run" — igual que los demás *_migration.sql. Se puede correr las veces
-- que haga falta.
-- ============================================================================

create table if not exists system_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- De qué negocio vino (null si pasó antes de resolver el negocio, ej.
  -- en la pantalla de login/registro).
  business_id uuid references businesses(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,

  -- 'error' = algo se rompió de verdad. 'warning' = algo raro pero no
  -- bloqueante. Se usa para decidir si dispara alerta inmediata o no.
  severity text not null default 'error' check (severity in ('error', 'warning')),

  -- Categoría corta para poder filtrar/agrupar (ej. 'payment', 'sync',
  -- 'kitchen', 'auth', 'unknown'). Libre pero conviene mantener un
  -- catálogo corto y reusarlo — ver opsLogger.ts.
  category text not null default 'unknown',

  message text not null,
  stack text,

  -- Contexto libre en JSON: qué pantalla, qué acción se intentaba, ids
  -- relevantes (ej. sale_id, order_id) — lo que ayude a reproducir sin
  -- tener que preguntarle al negocio qué estaba haciendo.
  context jsonb not null default '{}'::jsonb,

  -- De dónde vino: 'web' (navegador del negocio) o 'edge_function'
  -- (backend). Los de edge_function los inserta el propio backend con
  -- service_role, no pasan por la política de INSERT de abajo.
  source text not null default 'web' check (source in ('web', 'edge_function'))
);

create index if not exists system_errors_created_at_idx on system_errors (created_at desc);
create index if not exists system_errors_business_id_idx on system_errors (business_id);
create index if not exists system_errors_severity_idx on system_errors (severity) where severity = 'error';

alter table system_errors enable row level security;

-- Un usuario autenticado solo puede insertar errores marcados con un
-- business_id al que de verdad pertenece (o null, para errores previos al
-- login). Reusa auth_business_ids(), ya definida en schema.sql.
drop policy if exists system_errors_insert_own_business on system_errors;
create policy system_errors_insert_own_business on system_errors
  for insert
  with check (
    business_id is null or business_id in (select auth_business_ids())
  );

-- A propósito: NO se crea ninguna policy de SELECT/UPDATE/DELETE para
-- 'authenticated' ni 'anon'. Sin una policy que lo permita, RLS deniega
-- por defecto — así queda blindado con leer solo por service_role.

comment on table system_errors is
  'Log centralizado de errores del sistema (frontend + edge functions). Solo legible con service_role — ver error_logging_migration.sql.';