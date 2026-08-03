#!/usr/bin/env bash
# ==============================================================================
# verify_tenant_isolation.sh — Corre verify_tenant_isolation.sql contra un
# Postgres DESCARTABLE, aplicando el schema.sql REAL del proyecto primero.
# ------------------------------------------------------------------------------
# Por qué aplica schema.sql real en vez de una copia recortada: si alguien
# agrega una tabla nueva de negocio en el futuro y la olvida meter en el
# bucle de RLS de schema.sql, este script lo agarra automáticamente la
# próxima vez que corra en CI — no depende de que alguien se acuerde de
# actualizar también un script de prueba aparte.
#
# Variables de entorno requeridas:
#   TEST_DB_URL   conexión a una base VACÍA Y DESCARTABLE (en CI: un
#                 contenedor postgres efímero; nunca producción)
#
# Uso:
#   TEST_DB_URL=postgresql://postgres:pass@localhost:5432/vimdy_isolation_test \
#     ./verify_tenant_isolation.sh
# ==============================================================================
set -euo pipefail

if [ -z "${TEST_DB_URL:-}" ]; then
  echo "ERROR: falta TEST_DB_URL (conexión a una base descartable, nunca producción)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_FILE="$SCRIPT_DIR/../../supabase/schema.sql"

if [ ! -f "$SCHEMA_FILE" ]; then
  echo "ERROR: no se encontró schema.sql en $SCHEMA_FILE" >&2
  exit 1
fi

# schema.sql asume los roles que Supabase ya trae creados por defecto en
# cualquier proyecto real (anon, authenticated, service_role), Y ADEMÁS
# asume que el esquema `auth` de Supabase ya existe (lo referencia
# directamente en su propio contenido, no solo esta prueba). Un Postgres
# vacío de CI no tiene ninguna de las dos cosas — sin esto, la aplicación
# de schema.sql falla a medio camino con "schema auth does not exist" o
# "role does not exist", antes de siquiera llegar a la parte que nos
# interesa probar.
echo "==> Creando roles y esquema auth de Supabase en la base de prueba..."
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

-- schema.sql tiene "user_id uuid references auth.users(id)" en
-- business_members — necesita una tabla auth.users REAL (aunque sea
-- mínima) para que esa llave foránea se pueda crear, no solo el rol.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid()
);

-- Stub de auth.uid(): en Supabase real lee el JWT de la conexión; acá lo
-- reemplazamos por una variable de sesión que verify_tenant_isolation.sql
-- controla con set_config(), para poder simular "estoy logueado como el
-- usuario X" en este Postgres de prueba.
create or replace function auth.uid() returns uuid
language sql stable
as $func$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$func$;
SQL

echo "==> Aplicando schema.sql real del proyecto a la base de prueba..."
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -q -f "$SCHEMA_FILE"

echo "==> Corriendo la prueba de aislamiento entre negocios (forzando el error a propósito)..."
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -q -f "$SCRIPT_DIR/verify_tenant_isolation.sql"

echo "==> OK: el aislamiento entre negocios quedó verificado con datos reales, no solo leyendo el SQL."