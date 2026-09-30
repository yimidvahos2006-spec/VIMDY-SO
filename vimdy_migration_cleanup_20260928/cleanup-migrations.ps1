$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
# Run this script from any location; it expects the script to be placed in the VIMDY repo root under this folder.
$migrations = Join-Path $repo 'supabase\migrations'
$legacy = Join-Path $repo 'supabase\legacy-migrations'

if (-not (Test-Path $migrations)) {
  throw "No se encontró $migrations. Coloca este script dentro de tu proyecto VIMDY."
}

New-Item -ItemType Directory -Force -Path $legacy | Out-Null

$stale = @(
  '000_PRODUCTION_APPLY_INSTRUCTIONS.sql',
  '001_PRODUCTION_DEPLOY_SCRIPT.sql',
  '20260821_initial_schema.sql',
  '20260821200020_fix_schema_grants.sql',
  '20260826_normalize_requires_kitchen.sql',
  '20260826_operation_config.sql',
  '20260829_consolidate_subscription_functions.sql',
  '20260829_fix_businesses_insert_policies.sql',
  '20260829_revoke_trial_usage_grants.sql',
  '20260829_test_trial_multitenant.sql'
)

foreach ($name in $stale) {
  $src = Join-Path $migrations $name
  $dst = Join-Path $legacy $name

  if (-not (Test-Path $src)) {
    Write-Host "[OK/NO EXISTE] $name" -ForegroundColor DarkGray
    continue
  }

  if (Test-Path $dst) {
    $hashSrc = (Get-FileHash $src -Algorithm SHA256).Hash
    $hashDst = (Get-FileHash $dst -Algorithm SHA256).Hash
    if ($hashSrc -eq $hashDst) {
      Remove-Item $src -Force
      Write-Host "[LIMPIO] $name (ya existía igual en legacy)" -ForegroundColor Yellow
      continue
    }
    throw "Ya existe un archivo distinto en legacy-migrations: $name. Revisión manual requerida."
  }

  Move-Item -LiteralPath $src -Destination $dst
  Write-Host "[MOVIDO] $name -> supabase\legacy-migrations\$name" -ForegroundColor Green
}

Write-Host "" 
Write-Host "Limpieza terminada." -ForegroundColor Cyan
Write-Host "NO ejecutes --include-all." -ForegroundColor Yellow
Write-Host "Ahora ejecuta:" -ForegroundColor Cyan
Write-Host "  supabase migration list"
Write-Host "  supabase db push --dry-run"
