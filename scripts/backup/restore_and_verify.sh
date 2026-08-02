#!/usr/bin/env bash
# ==============================================================================
# restore_and_verify.sh — El "simulacro de incendio" real.
# ------------------------------------------------------------------------------
# Esto es lo que separa "creo que el backup sirve" de "sé que el backup
# sirve". Cada vez que corre (recomendado: 1 vez por semana vía CI):
#
#   1. Descarga el backup más reciente + su manifiesto.
#   2. Lo descifra.
#   3. Lo restaura en una base de datos DESCARTABLE — nunca en producción,
#      nunca en la misma base de donde salió el backup.
#   4. Compara el conteo de filas de cada tabla crítica en la base
#      restaurada contra lo que decía el manifiesto tomado en el momento
#      del backup. Deben coincidir EXACTO — un restore que "no da error"
#      pero perdió filas es exactamente el escenario que este script existe
#      para atrapar.
#   5. Corre chequeos de integridad referencial básicos (ej: toda venta
#      apunta a un negocio que existe).
#   6. Reporta cuánto tardó el restore completo — eso es tu RTO real (tiempo
#      que tardarías en recuperarte si esto pasara en producción de verdad),
#      no una estimación de escritorio.
#   7. Si CUALQUIER verificación falla, notifica por webhook con el detalle
#      exacto de qué no coincidió, y termina con exit 1 (falla la CI,
#      visible en rojo).
#
# Variables de entorno requeridas:
#   BACKUP_ENCRYPTION_PASSPHRASE   la misma que se usó en backup.sh
#   RESTORE_DB_URL                 conexión a una base VACÍA Y DESCARTABLE
#                                   (en CI: un contenedor postgres efímero;
#                                   nunca la base de producción)
#   WEBHOOK_URL                    alerta — opcional pero muy recomendado
#   STORAGE_BACKEND / S3_* / LOCAL_BACKUP_DIR  igual que en backup.sh
#
# Uso:
#   ./restore_and_verify.sh
# ==============================================================================
set -euo pipefail

STORAGE_BACKEND="${STORAGE_BACKEND:-s3}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

START_TIME=$(date +%s)

log() { echo "[restore_and_verify.sh] $(date -u +%H:%M:%S) - $*"; }

notify() {
  local status="$1"; local message="$2"
  if [ -z "${WEBHOOK_URL:-}" ]; then return 0; fi
  local emoji="✅"
  [ "$status" = "fail" ] && emoji="🚨"
  curl -fsS -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"${emoji} VIMDY restore drill [${status}] — ${message}\"}" \
    >/dev/null 2>&1 || log "advertencia: no se pudo enviar la notificación webhook"
}

on_error() {
  local line="$1"
  log "ERROR en la línea ${line}."
  notify "fail" "Restore drill falló en la línea ${line}. Revisar logs de CI de inmediato — esto significa que si el backup real se necesitara HOY, no sabemos si serviría."
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

require_env BACKUP_ENCRYPTION_PASSPHRASE
require_env RESTORE_DB_URL
if [ "$STORAGE_BACKEND" = "s3" ]; then
  require_env S3_BUCKET
  require_env AWS_ACCESS_KEY_ID
  require_env AWS_SECRET_ACCESS_KEY
else
  require_env LOCAL_BACKUP_DIR
fi

log "1/6 — Ubicando el backup más reciente..."
ENC_FILE="${WORKDIR}/latest.dump.gpg"
MANIFEST_FILE="${WORKDIR}/latest.manifest.json"
if [ "$STORAGE_BACKEND" = "s3" ]; then
  S3_ARGS=()
  [ -n "${S3_ENDPOINT:-}" ] && S3_ARGS+=(--endpoint-url "${S3_ENDPOINT}")
  POINTER=$(aws s3 cp "s3://${S3_BUCKET}/backups/latest.pointer.txt" - "${S3_ARGS[@]}")
  aws s3 cp "s3://${S3_BUCKET}/${POINTER}" "${ENC_FILE}" "${S3_ARGS[@]}"
  aws s3 cp "s3://${S3_BUCKET}/backups/latest.manifest.json" "${MANIFEST_FILE}" "${S3_ARGS[@]}"
else
  POINTER=$(cat "${LOCAL_BACKUP_DIR}/backups/latest.pointer.txt")
  cp "${LOCAL_BACKUP_DIR}/${POINTER}" "${ENC_FILE}"
  cp "${LOCAL_BACKUP_DIR}/backups/latest.manifest.json" "${MANIFEST_FILE}"
fi
BACKUP_AGE_H=$(python3 -c "
import json,datetime
m=json.load(open('${MANIFEST_FILE}'))
ts=datetime.datetime.strptime(m['timestamp_utc'],'%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
print(round((datetime.datetime.now(datetime.timezone.utc)-ts).total_seconds()/3600,1))
")
log "   backup encontrado: ${POINTER} (antigüedad: ${BACKUP_AGE_H}h)"
if python3 -c "exit(0 if ${BACKUP_AGE_H} > 26 else 1)"; then
  log "ERROR: el backup más reciente tiene más de 26h — el backup diario no está corriendo."
  notify "fail" "El último backup disponible tiene ${BACKUP_AGE_H}h de antigüedad. El cron de backup diario parece estar fallando silenciosamente."
  exit 1
fi

log "2/6 — Descifrando..."
DUMP_FILE="${WORKDIR}/latest.dump"
gpg --batch --yes --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" --decrypt \
  --output "${DUMP_FILE}" "${ENC_FILE}"

log "3/6 — Verificando checksum del dump contra el manifiesto..."
EXPECTED_SHA=$(python3 -c "import json;print(json.load(open('${MANIFEST_FILE}'))['dump_sha256'])")
ACTUAL_SHA=$(sha256sum "${DUMP_FILE}" | awk '{print $1}')
if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
  log "ERROR: checksum no coincide. Esperado ${EXPECTED_SHA}, obtuvo ${ACTUAL_SHA}."
  notify "fail" "Checksum del backup no coincide con el manifiesto — el archivo pudo corromperse en tránsito o almacenamiento."
  exit 1
fi
log "   checksum OK."

log "4/6 — Restaurando en base descartable (${RESTORE_DB_URL%%@*}@...)..."
RESTORE_START=$(date +%s)
pg_restore "${DUMP_FILE}" \
  --dbname="${RESTORE_DB_URL}" \
  --clean --if-exists --no-owner --no-privileges \
  --exit-on-error \
  2> "${WORKDIR}/restore_stderr.log" || {
    log "ERROR: pg_restore terminó con errores:"
    cat "${WORKDIR}/restore_stderr.log"
    notify "fail" "pg_restore falló. Ver log de CI para el detalle."
    exit 1
  }
RESTORE_SECONDS=$(( $(date +%s) - RESTORE_START ))
log "   restore completado en ${RESTORE_SECONDS}s (este es tu RTO real hoy)."

log "5/6 — Comparando conteos de filas contra el manifiesto..."
MISMATCHES=""
python3 -c "
import json
m = json.load(open('${MANIFEST_FILE}'))
for table, expected in m['table_row_counts'].items():
    print(f'{table}={expected}')
" > "${WORKDIR}/expected_counts.txt"

while IFS='=' read -r table expected; do
  [ -z "$table" ] && continue
  actual=$(psql "${RESTORE_DB_URL}" -t -A -c "select count(*) from ${table};" 2>/dev/null || echo "ERROR")
  if [ "$actual" != "$expected" ]; then
    MISMATCHES="${MISMATCHES}\n   - ${table}: esperado ${expected}, restaurado ${actual}"
    log "   ✗ ${table}: esperado ${expected}, obtuvo ${actual}"
  else
    log "   ✓ ${table}: ${actual} filas"
  fi
done < "${WORKDIR}/expected_counts.txt"

if [ -n "$MISMATCHES" ]; then
  log "ERROR: hay tablas con conteos que no coinciden."
  notify "fail" "El restore terminó SIN ERROR pero con datos incompletos:${MISMATCHES}"
  exit 1
fi

log "   chequeo de integridad referencial (ventas -> negocios existentes)..."
ORPHAN_SALES=$(psql "${RESTORE_DB_URL}" -t -A -c \
  "select count(*) from sales s left join businesses b on b.id = s.business_id where b.id is null;")
if [ "$ORPHAN_SALES" != "0" ]; then
  log "ERROR: ${ORPHAN_SALES} ventas quedaron huérfanas (sin negocio) tras el restore."
  notify "fail" "${ORPHAN_SALES} filas de 'sales' quedaron sin negocio asociado tras el restore — posible corrupción de integridad referencial."
  exit 1
fi
log "   ✓ integridad referencial OK (0 ventas huérfanas)."

TOTAL_SECONDS=$(( $(date +%s) - START_TIME ))
log "6/6 — Restore drill exitoso. Tiempo total: ${TOTAL_SECONDS}s, restore puro: ${RESTORE_SECONDS}s."
notify "ok" "Restore drill exitoso. Backup de ${BACKUP_AGE_H}h de antigüedad, restaurado y verificado en ${RESTORE_SECONDS}s. Todas las tablas coinciden con el manifiesto."