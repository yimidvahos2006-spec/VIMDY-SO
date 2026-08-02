#!/usr/bin/env bash
# ==============================================================================
# extract_single_business.sh — Recuperar UN negocio sin restaurar todo.
# ------------------------------------------------------------------------------
# POR QUÉ EXISTE ESTE SCRIPT (léelo, es importante para "miles de negocios"):
#
# backup.sh / restore_and_verify.sh resuelven "la base entera se perdió".
# Pero a escala, el incidente más probable NO es ese — es "un bug borró por
# error las ventas de ESTE negocio", o "un negocio pisó sus propios datos
# con una sincronización rara". Restaurar la base COMPLETA para arreglar a
# un solo negocio:
#   (a) le pisaría los datos nuevos a los OTROS miles de negocios que sí
#       están bien, y
#   (b) tarda tanto como restaurar todo, no lo que debería tardar arreglar
#       a uno solo.
#
# Este script resuelve eso: restaura el backup más reciente en una base
# DESCARTABLE (igual que restore_and_verify.sh), y de ahí extrae SOLO las
# filas de un business_id específico, tabla por tabla, como INSERTs listos
# para revisar y aplicar de vuelta a producción a mano (a propósito no se
# auto-aplican — esto es una herramienta de rescate para un incidente real,
# tú decides qué de lo recuperado hace falta pisar en producción).
#
# Uso:
#   ./extract_single_business.sh <business_id>
#
# Requiere las mismas variables de entorno que restore_and_verify.sh
# (BACKUP_ENCRYPTION_PASSPHRASE, RESTORE_DB_URL, STORAGE_BACKEND, S3_*).
#
# Salida: un archivo .sql en el directorio actual con los INSERTs de todas
# las tablas de negocio para ese business_id, listo para inspección manual.
# ==============================================================================
set -euo pipefail

BUSINESS_ID="${1:-}"
if [ -z "$BUSINESS_ID" ]; then
  echo "Uso: ./extract_single_business.sh <business_id>"
  exit 1
fi

STORAGE_BACKEND="${STORAGE_BACKEND:-s3}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

log() { echo "[extract_single_business.sh] $(date -u +%H:%M:%S) - $*"; }

require_env() {
  local var="$1"
  if [ -z "${!var:-}" ]; then
    log "ERROR: falta la variable de entorno requerida ${var}"
    exit 1
  fi
}

require_env BACKUP_ENCRYPTION_PASSPHRASE
require_env RESTORE_DB_URL
if [ "$STORAGE_BACKEND" = "s3" ]; then
  require_env S3_BUCKET
  require_env AWS_ACCESS_KEY_ID
  require_env AWS_SECRET_ACCESS_KEY
else
  require_env LOCAL_BACKUP_DIR
fi

# Mismas tablas de negocio que backup.sh vigila en el manifiesto (menos las
# que no tienen business_id, como app_users que se relaciona distinto).
BUSINESS_TABLES=(
  sales receipts orders kitchen_orders tables
  products categories customers
  cash_movements shifts inventory_movements
  suppliers purchase_orders notifications alerts
)

log "1/4 — Ubicando el backup más reciente..."
ENC_FILE="${WORKDIR}/latest.dump.gpg"
if [ "$STORAGE_BACKEND" = "s3" ]; then
  S3_ARGS=()
  [ -n "${S3_ENDPOINT:-}" ] && S3_ARGS+=(--endpoint-url "${S3_ENDPOINT}")
  POINTER=$(aws s3 cp "s3://${S3_BUCKET}/backups/latest.pointer.txt" - "${S3_ARGS[@]}")
  aws s3 cp "s3://${S3_BUCKET}/${POINTER}" "${ENC_FILE}" "${S3_ARGS[@]}"
else
  POINTER=$(cat "${LOCAL_BACKUP_DIR}/backups/latest.pointer.txt")
  cp "${LOCAL_BACKUP_DIR}/${POINTER}" "${ENC_FILE}"
fi
log "   backup encontrado: ${POINTER}"

log "2/4 — Descifrando y restaurando en base descartable..."
DUMP_FILE="${WORKDIR}/latest.dump"
gpg --batch --yes --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" --decrypt \
  --output "${DUMP_FILE}" "${ENC_FILE}"
pg_restore "${DUMP_FILE}" \
  --dbname="${RESTORE_DB_URL}" \
  --clean --if-exists --no-owner --no-privileges \
  --exit-on-error

log "3/4 — Confirmando que el negocio ${BUSINESS_ID} existe en el backup..."
BUSINESS_ROW_COUNT=$(psql "${RESTORE_DB_URL}" -t -A -c \
  "select count(*) from businesses where id = '${BUSINESS_ID}';")
if [ "$BUSINESS_ROW_COUNT" != "1" ]; then
  log "ERROR: no se encontró el negocio ${BUSINESS_ID} en este backup (o hay más de una fila, algo está mal)."
  exit 1
fi

log "4/4 — Extrayendo filas de ese negocio, tabla por tabla..."
OUT_FILE="./rescate_${BUSINESS_ID}_$(date -u +%Y%m%dT%H%M%SZ).sql"
{
  echo "-- Datos de rescate para business_id = ${BUSINESS_ID}"
  echo "-- Extraídos de: ${POINTER}"
  echo "-- Generado: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "-- REVISAR ANTES DE APLICAR A PRODUCCIÓN. Esto NO se aplica solo."
  echo ""
  for table in "${BUSINESS_TABLES[@]}"; do
    row_count=$(psql "${RESTORE_DB_URL}" -t -A -c \
      "select count(*) from ${table} where business_id = '${BUSINESS_ID}';")
    echo "-- ${table}: ${row_count} filas"
    if [ "$row_count" != "0" ]; then
      psql "${RESTORE_DB_URL}" -t -A -c \
        "select 'insert into ${table} (id, business_id, data, created_at, updated_at) values (' || quote_literal(id) || ', ' || quote_literal(business_id) || ', ' || quote_literal(data::text) || '::jsonb, ' || quote_literal(created_at::text) || '::timestamptz, ' || quote_literal(updated_at::text) || '::timestamptz) on conflict (id) do nothing;' from ${table} where business_id = '${BUSINESS_ID}';"
    fi
    echo ""
  done
} > "${OUT_FILE}"

log "Listo: ${OUT_FILE}"
log "Revisa el archivo, y aplícalo a mano contra producción con psql cuando confirmes que es lo que hace falta."