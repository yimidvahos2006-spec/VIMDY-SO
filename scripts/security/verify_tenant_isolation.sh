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
# cualquier proyecto real (anon, authenticated, service_role). Un Postgres
# vacío de CI no los tiene — sin esto, la primera línea de schema.sql que
# hace "grant ... to authenticated" falla con "role does not exist" y todo
# lo demás ni siquiera llega a aplicarse.
echo "==> Creando roles de Supabase (anon, authenticated, service_role) en la base de prueba..."
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
SQL

echo "==> Aplicando schema.sql real del proyecto a la base de prueba..."
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -q -f "$SCHEMA_FILE"

echo "==> Corriendo la prueba de aislamiento entre negocios (forzando el error a propósito)..."
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -q -f "$SCRIPT_DIR/verify_tenant_isolation.sql"

echo "==> OK: el aislamiento entre negocios quedó verificado con datos reales, no solo leyendo el SQL."