#!/usr/bin/env bash
# ============================================================================
# deploy-wompi.sh
# ----------------------------------------------------------------------------
# MISIÓN 3 — Wompi real. Despliega las 4 Edge Functions de la integración de
# Wompi en el orden correcto, con las flags de verificación de JWT que cada
# una necesita:
#   - wompi-create-checkout   -> JWT verificado (lo llama un usuario logueado)
#   - wompi-webhook           -> SIN JWT (lo llama Wompi, servidor a servidor)
#   - wompi-void-transaction  -> JWT verificado (lo llama un usuario logueado)
#   - wompi-refund-transaction-> JWT verificado (lo llama un usuario logueado)
#
# Uso:
#   chmod +x supabase/deploy-wompi.sh
#   ./supabase/deploy-wompi.sh
#
# Requisitos previos (una sola vez):
#   1) supabase login
#   2) supabase link --project-ref <tu-project-ref>
#   3) Tener seteados los secrets (ver checkWompiSecrets abajo). Si falta
#      alguno, este script se detiene ANTES de desplegar nada, para no dejar
#      una función viva sin su configuración real de producción.
# ============================================================================

set -euo pipefail

REQUIRED_SECRETS=(
  "WOMPI_PUBLIC_KEY"
  "WOMPI_PRIVATE_KEY"
  "WOMPI_INTEGRITY_SECRET"
  "WOMPI_EVENTS_SECRET"
  "APP_BASE_URL"
)

echo "== 1/3 — Verificando secrets requeridos en el proyecto vinculado =="
CURRENT_SECRETS="$(supabase secrets list | awk 'NR>2 {print $1}')"

MISSING=0
for secret in "${REQUIRED_SECRETS[@]}"; do
  if ! echo "$CURRENT_SECRETS" | grep -qx "$secret"; then
    echo "  ❌ Falta: $secret"
    MISSING=1
  else
    echo "  ✅ OK: $secret"
  fi
done

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "Faltan secrets. Configúralos así (con tus llaves reales del dashboard de Wompi):"
  echo "  supabase secrets set WOMPI_PUBLIC_KEY=pub_prod_..."
  echo "  supabase secrets set WOMPI_PRIVATE_KEY=prv_prod_..."
  echo "  supabase secrets set WOMPI_INTEGRITY_SECRET=prod_integrity_..."
  echo "  supabase secrets set WOMPI_EVENTS_SECRET=prod_events_..."
  echo "  supabase secrets set APP_BASE_URL=https://tuapp.vimdy.co"
  echo ""
  echo "Deploy cancelado — ninguna función fue tocada."
  exit 1
fi

echo ""
echo "== 2/3 — Desplegando funciones (con JWT verificado) =="
supabase functions deploy wompi-create-checkout
supabase functions deploy wompi-void-transaction
supabase functions deploy wompi-refund-transaction

echo ""
echo "== 3/3 — Desplegando webhook (SIN verificación de JWT — Wompi no manda uno) =="
supabase functions deploy wompi-webhook --no-verify-jwt

echo ""
echo "✅ Listo. Registra esta URL en el dashboard de Wompi > Configuración > Eventos:"
PROJECT_REF="$(supabase status --output json 2>/dev/null | grep -o '\"project_id\":\"[^\"]*\"' | cut -d'\"' -f4 || true)"
if [ -n "$PROJECT_REF" ]; then
  echo "  https://${PROJECT_REF}.supabase.co/functions/v1/wompi-webhook"
else
  echo "  https://<tu-project-ref>.supabase.co/functions/v1/wompi-webhook"
fi