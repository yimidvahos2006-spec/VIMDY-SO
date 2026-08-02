#!/usr/bin/env bash
# ==============================================================================
# prune_backups.sh — Aplica retención sobre los backups ya subidos.
# ------------------------------------------------------------------------------
# Regla (igual a la que usan la mayoría de proveedores serios de backup):
#   - Se conserva TODO backup de los últimos RETAIN_DAILY_DAYS días.
#   - Después de eso, se conserva solo 1 por semana (el del domingo) hasta
#     RETAIN_WEEKLY_WEEKS semanas atrás.
#   - Después de eso, se conserva solo 1 por mes (el del día 1) hasta
#     RETAIN_MONTHLY_MONTHS meses atrás.
#   - Todo lo demás se borra.
#
# Se llama automáticamente al final de backup.sh. También se puede correr
# suelto para limpiar backups viejos sin generar uno nuevo.
# ==============================================================================
set -euo pipefail

STORAGE_BACKEND="${STORAGE_BACKEND:-s3}"
RETAIN_DAILY_DAYS="${RETAIN_DAILY_DAYS:-14}"
RETAIN_WEEKLY_WEEKS="${RETAIN_WEEKLY_WEEKS:-8}"
RETAIN_MONTHLY_MONTHS="${RETAIN_MONTHLY_MONTHS:-12}"

log() { echo "[prune_backups.sh] $*"; }

python3 - "$STORAGE_BACKEND" "$RETAIN_DAILY_DAYS" "$RETAIN_WEEKLY_WEEKS" "$RETAIN_MONTHLY_MONTHS" "${S3_BUCKET:-}" "${S3_ENDPOINT:-}" "${LOCAL_BACKUP_DIR:-}" << 'PYEOF'
import sys, subprocess, re, json
from datetime import datetime, timezone

backend, daily_days, weekly_weeks, monthly_months, bucket, endpoint, local_dir = sys.argv[1:8]
daily_days, weekly_weeks, monthly_months = int(daily_days), int(weekly_weeks), int(monthly_months)

def list_objects():
    """Devuelve lista de (key, datetime) de todos los .dump.gpg existentes."""
    entries = []
    pattern = re.compile(r"vimdy-(\d{8})T(\d{6})Z\.dump\.gpg$")
    if backend == "s3":
        cmd = ["aws", "s3api", "list-objects-v2", "--bucket", bucket, "--prefix", "backups/"]
        if endpoint:
            cmd += ["--endpoint-url", endpoint]
        out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
        data = json.loads(out) if out.strip() else {}
        for obj in data.get("Contents", []):
            key = obj["Key"]
            m = pattern.search(key)
            if m:
                dt = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                entries.append((key, dt))
    else:
        import os
        for root, _, files in os.walk(local_dir):
            for f in files:
                m = pattern.search(f)
                if m:
                    dt = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                    entries.append((os.path.join(root, f), dt))
    return sorted(entries, key=lambda e: e[1], reverse=True)

def delete(key):
    if backend == "s3":
        cmd = ["aws", "s3", "rm", f"s3://{bucket}/{key}"]
        if endpoint:
            cmd += ["--endpoint-url", endpoint]
        subprocess.run(cmd, check=True)
    else:
        import os
        os.remove(key)
    print(f"[prune_backups.sh] borrado: {key}")

now = datetime.now(timezone.utc)
entries = list_objects()
keep = set()

for key, dt in entries:
    age_days = (now - dt).days
    if age_days <= daily_days:
        keep.add(key)
    elif age_days <= weekly_weeks * 7 and dt.weekday() == 6:  # domingo
        keep.add(key)
    elif age_days <= monthly_months * 30 and dt.day == 1:
        keep.add(key)

deleted = 0
for key, dt in entries:
    if key not in keep:
        delete(key)
        deleted += 1

print(f"[prune_backups.sh] total: {len(entries)}, conservados: {len(keep)}, borrados: {deleted}")
PYEOF