#!/usr/bin/env bash
# ==============================================================================
# backup.sh — Backup lógico completo de la base de datos de VIMDY.
# ------------------------------------------------------------------------------
# Qué hace, en orden, y por qué cada paso existe:
#
#   1. pg_dump en formato "custom" (-Fc) de TODA la base — no solo tablas
#      sueltas. Custom format ya viene comprimido y permite restore parcial
#      si algún día hace falta (pg_restore -t tabla_x).
#   2. Calcula un MANIFIESTO (manifest.json) con el conteo de filas de cada
#      tabla crítica de negocio en el momento exacto del dump. Este
#      manifiesto es lo que después permite decir "el restore trajo
#      EXACTAMENTE lo mismo que había" en vez de solo "el restore no
#      truena" — un restore puede terminar sin error y aun así haber
#      perdido filas silenciosamente (constraint que se salta con
#      --no-owner, tabla que falla a mitad del restore y sigue después,
#      etc.). Sin manifiesto, ese tipo de pérdida parcial no se detecta.
#   3. Cifra el dump con GPG (AES256 simétrico) ANTES de subirlo. El bucket
#      de backups puede ser robado o mal configurado como público — un
#      backup sin cifrar ahí es una fuga de datos de TODOS los negocios,
#      no solo del que falló.
#   4. Sube dump cifrado + manifiesto a almacenamiento externo a Supabase
#      (S3 / R2 / B2 / Wasabi — cualquiera con API S3). Externo a propósito:
#      si el proyecto de Supabase se borra, se suspende, o se bloquea la
#      cuenta, el backup no puede vivir SOLO adentro del mismo sistema que
#      falló.
#   5. Aplica retención (diario 14 días, semanal 8 semanas, mensual 12
#      meses) borrando lo que ya no corresponde conservar.
#   6. Si CUALQUIER paso falla, notifica por webhook y termina con exit 1
#      — para que el cron/CI que lo llama quede en rojo y visible, nunca
#      en silencio.
#
# Variables de entorno requeridas:
#   SUPABASE_DB_URL              postgres://... (conexión DIRECTA, puerto
#                                 5432 — NO el pooler de transacciones/6543,
#                                 pg_dump necesita funciones que el pooler
#                                 en modo transaction no soporta)
#   BACKUP_ENCRYPTION_PASSPHRASE passphrase para cifrar el dump
#   WEBHOOK_URL                  URL de alerta (Slack/Discord/genérico) —
#                                 opcional pero muy recomendado
#
# Variables para el backend de almacenamiento (una de las dos opciones):
#   STORAGE_BACKEND=s3   (default)  → requiere S3_BUCKET, S3_ENDPOINT
#                                     (opcional, para R2/B2/Wasabi),
#                                     AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
#   STORAGE_BACKEND=local           → requiere LOCAL_BACKUP_DIR (solo para
#                                     pruebas / entornos sin S3 todavía)
#
# Uso:
#   ./backup.sh
# ==============================================================================
set -euo pipefail

STORAGE_BACKEND="${STORAGE_BACKEND:-s3}"
RETAIN_DAILY_DAYS="${RETAIN_DAILY_DAYS:-14}"
RETAIN_WEEKLY_WEEKS="${RETAIN_WEEKLY_WEEKS:-8}"
RETAIN_MONTHLY_MONTHS="${RETAIN_MONTHLY_MONTHS:-12}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DATE_PATH="$(date -u +%Y/%m/%d)"
WORKDIR="$(mktemp -d)"
DUMP_FILE="${WORKDIR}/vimdy-${TIMESTAMP}.dump"
ENC_FILE="${DUMP_FILE}.gpg"
MANIFEST_FILE="${WORKDIR}/vimdy-${TIMESTAMP}.manifest.json"
REMOTE_PREFIX="backups/${DATE_PATH}"

trap 'rm -rf "${WORKDIR}"' EXIT

log() { echo "[backup.sh] $(date -u +%H:%M:%S) - $*"; }

notify() {
  # notify <status: ok|fail> <mensaje>
  local status="$1"; local message="$2"
  if [ -z "${WEBHOOK_URL:-}" ]; then return 0; fi
  local emoji="✅"
  [ "$status" = "fail" ] && emoji="🚨"
  curl -fsS -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"${emoji} VIMDY backup [${status}] — ${message}\"}" \
    >/dev/null 2>&1 || log "advertencia: no se pudo enviar la notificación webhook"
}

on_error() {
  local line="$1"
  log "ERROR en la línea ${line}. Abortando backup."
  notify "fail" "Falló backup.sh en la línea ${line} ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
  exit 1
}
trap 'on_error $LINENO' ERR

require_env() {
  local var="$1"
  if [ -z "${!var:-}" ]; then
    log "ERROR: falta la variable de entorno requerida ${var}"
    notify "fail" "Falta variable de entorno ${var}"
    exit 1
  fi
}

require_env SUPABASE_DB_URL
require_env BACKUP_ENCRYPTION_PASSPHRASE
if [ "$STORAGE_BACKEND" = "s3" ]; then
  require_env S3_BUCKET
  require_env AWS_ACCESS_KEY_ID
  require_env AWS_SECRET_ACCESS_KEY
elif [ "$STORAGE_BACKEND" = "local" ]; then
  require_env LOCAL_BACKUP_DIR
else
  log "ERROR: STORAGE_BACKEND debe ser 's3' o 'local', llegó '${STORAGE_BACKEND}'"
  exit 1
fi

# ------------------------------------------------------------------------
# Tablas críticas de negocio sobre las que se calcula el manifiesto de
# integridad. Si agregás una tabla nueva de negocio al schema, agregala
# también acá — si no, el restore drill no la va a poder verificar.
# ------------------------------------------------------------------------
CRITICAL_TABLES=(
  businesses business_members app_users
  sales receipts orders kitchen_orders tables
  products categories customers
  cash_movements shifts inventory_movements
  suppliers purchase_orders
  subscription_payments electronic_invoices
  notifications alerts audit_logs business_snapshots
)

log "1/6 — Ejecutando pg_dump (formato custom) de la base completa..."
pg_dump "${SUPABASE_DB_URL}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${DUMP_FILE}"

DUMP_SIZE_BYTES=$(stat -c%s "${DUMP_FILE}" 2>/dev/null || stat -f%z "${DUMP_FILE}")
if [ "${DUMP_SIZE_BYTES}" -lt 1024 ]; then
  log "ERROR: el dump generado pesa sospechosamente poco (${DUMP_SIZE_BYTES} bytes)."
  notify "fail" "Dump de ${DUMP_SIZE_BYTES} bytes — probablemente vacío o truncado. No se sube."
  exit 1
fi
log "   dump generado: ${DUMP_SIZE_BYTES} bytes"

log "2/6 — Calculando manifiesto de integridad (conteo de filas por tabla)..."
{
  echo "{"
  echo "  \"timestamp_utc\": \"${TIMESTAMP}\","
  echo "  \"dump_size_bytes\": ${DUMP_SIZE_BYTES},"
  echo "  \"dump_sha256\": \"$(sha256sum "${DUMP_FILE}" | awk '{print $1}')\","
  echo "  \"table_row_counts\": {"
  first=true
  for t in "${CRITICAL_TABLES[@]}"; do
    count=$(psql "${SUPABASE_DB_URL}" -t -A -c "select count(*) from ${t};" 2>/dev/null || echo "null")
    if [ "$first" = true ]; then first=false; else echo ","; fi
    printf "    \"%s\": %s" "$t" "$count"
  done
  echo ""
  echo "  }"
  echo "}"
} > "${MANIFEST_FILE}"
log "   manifiesto: ${MANIFEST_FILE}"

# Validación mínima: ninguna tabla crítica de negocio (businesses, sales,
# products) puede dar "null" (= la query falló) en el manifiesto. Si eso
# pasa, el backup se considera sospechoso y no se sube.
for critical in businesses sales products; do
  val=$(python3 -c "import json;print(json.load(open('${MANIFEST_FILE}'))['table_row_counts']['${critical}'])")
  if [ "$val" = "null" ]; then
    log "ERROR: no se pudo contar filas de la tabla crítica '${critical}'."
    notify "fail" "Manifiesto inválido: no se pudo leer la tabla '${critical}'."
    exit 1
  fi
done

log "3/6 — Cifrando el dump (AES256)..."
gpg --batch --yes --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" \
  --symmetric --cipher-algo AES256 \
  --output "${ENC_FILE}" "${DUMP_FILE}"
rm -f "${DUMP_FILE}"  # nunca dejar el dump sin cifrar en disco más de lo necesario

log "4/6 — Subiendo backup cifrado + manifiesto (${STORAGE_BACKEND})..."
if [ "$STORAGE_BACKEND" = "s3" ]; then
  S3_ARGS=()
  [ -n "${S3_ENDPOINT:-}" ] && S3_ARGS+=(--endpoint-url "${S3_ENDPOINT}")
  aws s3 cp "${ENC_FILE}" "s3://${S3_BUCKET}/${REMOTE_PREFIX}/$(basename "${ENC_FILE}")" "${S3_ARGS[@]}"
  aws s3 cp "${MANIFEST_FILE}" "s3://${S3_BUCKET}/${REMOTE_PREFIX}/$(basename "${MANIFEST_FILE}")" "${S3_ARGS[@]}"
  aws s3 cp "${MANIFEST_FILE}" "s3://${S3_BUCKET}/backups/latest.manifest.json" "${S3_ARGS[@]}"
  echo "${REMOTE_PREFIX}/$(basename "${ENC_FILE}")" > "${WORKDIR}/latest_pointer.txt"
  aws s3 cp "${WORKDIR}/latest_pointer.txt" "s3://${S3_BUCKET}/backups/latest.pointer.txt" "${S3_ARGS[@]}"
else
  mkdir -p "${LOCAL_BACKUP_DIR}/${REMOTE_PREFIX}"
  cp "${ENC_FILE}" "${LOCAL_BACKUP_DIR}/${REMOTE_PREFIX}/"
  cp "${MANIFEST_FILE}" "${LOCAL_BACKUP_DIR}/${REMOTE_PREFIX}/"
  cp "${MANIFEST_FILE}" "${LOCAL_BACKUP_DIR}/backups/latest.manifest.json" 2>/dev/null || {
    mkdir -p "${LOCAL_BACKUP_DIR}/backups"; cp "${MANIFEST_FILE}" "${LOCAL_BACKUP_DIR}/backups/latest.manifest.json"; }
  echo "${REMOTE_PREFIX}/$(basename "${ENC_FILE}")" > "${LOCAL_BACKUP_DIR}/backups/latest.pointer.txt"
fi
log "   subido correctamente."

log "5/6 — Aplicando política de retención..."
"$(dirname "$0")/prune_backups.sh" || log "advertencia: la poda de retención falló (no aborta el backup ya hecho)"

log "6/6 — Backup completo."
notify "ok" "Backup completado (${DUMP_SIZE_BYTES} bytes, $(date -u +%Y-%m-%dT%H:%M:%SZ))"