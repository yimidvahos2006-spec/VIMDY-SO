<#
.SYNOPSIS
Migracion Wompi Colombia para VIMDY - Script definitivo.
Ejecuta la migracion, verifica objetos y reporta el resultado.
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ServiceRoleKey
)

$ErrorActionPreference = "Stop"
$supabaseUrl = "https://upoztxlcudrqhnjwjgho.supabase.co"
$sqlFile = Join-Path $PSScriptRoot "wompi_colombia_migration.sql"

function Invoke-SupabaseQuery {
    param([string]$Sql)
    $headers = @{
        "apikey" = $ServiceRoleKey
        "Authorization" = "Bearer $ServiceRoleKey"
        "Content-Type" = "application/json"
    }
    $body = @{ query = $Sql } | ConvertTo-Json -Compress
    return Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/rpc/exec_sql" -Method Post -Headers $headers -Body $body
}

Write-Host "=== Paso 1: Verificar estado actual ===" -ForegroundColor Cyan

try {
    $check = Invoke-SupabaseQuery -Sql @"
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'wompi%';
SELECT proname FROM pg_proc WHERE proname LIKE 'wompi%';
SELECT indexname FROM pg_indexes WHERE tablename LIKE 'wompi%';
"@
    Write-Host "Objetos Wompi existentes:"
    $check | ConvertTo-Json -Depth 3 | Write-Host
} catch {
    Write-Host "No se pudo verificar (puede que no existan objetos Wompi todavia): $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "`n=== Paso 2: Limpiar objetos parciales si existen ===" -ForegroundColor Cyan

$cleanupSql = @"
DROP TABLE IF EXISTS wompi_payment_audit_log CASCADE;
DROP TABLE IF EXISTS wompi_incoming_payments CASCADE;
DROP FUNCTION IF EXISTS public.confirm_wompi_payment_and_sale(uuid, text, uuid, inet, text) CASCADE;
DROP FUNCTION IF EXISTS public.review_wompi_payment(uuid, text, uuid, inet, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.link_wompi_payment_to_sale(uuid, uuid, uuid, text, uuid, inet, text) CASCADE;
DROP FUNCTION IF EXISTS public.update_wompi_payment_from_webhook(text, uuid, text, bigint, bigint, bigint, text, text, text, jsonb, boolean, text[]) CASCADE;
DROP FUNCTION IF EXISTS public.create_wompi_payment_intent(uuid, uuid, uuid, text, text, bigint, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.sanitize_wompi_raw_event(jsonb) CASCADE;
"@

try {
    Invoke-SupabaseQuery -Sql $cleanupSql | Out-Null
    Write-Host "Objetos parciales eliminados (si existian)." -ForegroundColor Green
} catch {
    Write-Host "Error limpiando (puede ser normal si no habia objetos): $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "`n=== Paso 3: Ejecutar migracion ===" -ForegroundColor Cyan

if (-not (Test-Path $sqlFile)) {
    Write-Error "No se encontro el archivo de migracion: $sqlFile"
    exit 1
}

$sql = Get-Content -Raw -Path $sqlFile

try {
    $result = Invoke-SupabaseQuery -Sql $sql
    Write-Host "Migracion ejecutada correctamente." -ForegroundColor Green
} catch {
    Write-Host "Error al ejecutar migracion:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.ErrorDetails) {
        Write-Host "Detalles del error:" -ForegroundColor Red
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    }
    exit 1
}

Write-Host "`n=== Paso 4: Verificar objetos creados ===" -ForegroundColor Cyan

try {
    $verify = Invoke-SupabaseQuery -Sql @"
SELECT 'tablas' AS tipo, table_name AS nombre FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('wompi_incoming_payments','wompi_payment_audit_log')
UNION ALL
SELECT 'funciones' AS tipo, proname AS nombre FROM pg_proc WHERE proname IN ('confirm_wompi_payment_and_sale','create_wompi_payment_intent','update_wompi_payment_from_webhook','link_wompi_payment_to_sale','review_wompi_payment','sanitize_wompi_raw_event')
UNION ALL
SELECT 'indices' AS tipo, indexname AS nombre FROM pg_indexes WHERE tablename IN ('wompi_incoming_payments','wompi_payment_audit_log');
"@
    Write-Host "Objetos Wompi verificados:"
    $verify | ConvertTo-Json -Depth 3 | Write-Host
} catch {
    Write-Host "Error verificando: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== Paso 5: Verificar RLS ===" -ForegroundColor Cyan

try {
    $rls = Invoke-SupabaseQuery -Sql @"
SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('wompi_incoming_payments','wompi_payment_audit_log');
"@
    Write-Host "Policies RLS:"
    $rls | ConvertTo-Json -Depth 3 | Write-Host
} catch {
    Write-Host "Error verificando RLS: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== MIGRACION COMPLETADA ===" -ForegroundColor Green
Write-Host "Ahora puedes continuar con el webhook y el codigo de pagos."
