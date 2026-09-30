# Release Gate

Workflow de validación antes de merge a `main`. Ejecuta todos los checks críticos en paralelo donde es posible.

## Pre-requisitos

- Node.js 20+
- Dependencias instaladas: `npm install`

## Steps

### 1. Type Check (obligatorio)
```bash
node ./node_modules/typescript/bin/tsc --noEmit
```
Debe pasar sin errores. Falla el release gate si hay errores de tipado.

### 2. Build de Producción (obligatorio)
```bash
npm run build
```
Debe completarse sin errores. Falla el release gate si el build falla.

### 3. Tests Unitarios (obligatorio)
```bash
npm test
```
Debe pasar el 100% de los tests. Falla el release gate si hay tests fallando.

### 4. Tests SQL (manual, NOT VERIFIED automáticamente)
Los tests en `supabase/tests/*.test.sql` requieren ejecución manual en el SQL Editor de Supabase.
- Verificar que todos los `DO $$` bloques terminan con `RAISE NOTICE 'PASS: ...'`
- Cada test debe crear y limpiar sus propios datos (FK-safe)
- UUIDs válidos: usar `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11` como `request.jwt.claim.sub`
- Tests de RBAC: usar `role='CAJERO'` para tests positivos, `role='MESERO'` para denegación

### 5. Auditoría Manual (recomendado)
Consultar al agente `vimdy-auditor` con: `auditar todo`

## Decision Matrix

| Check | Tipo | Bloqueo |
|---|---|---|
| tsc --noEmit | automático | Sí |
| npm run build | automático | Sí |
| npm test | automático | Sí |
| Tests SQL | manual | Sí (pre-release) |
| Auditoría | manual | Recomendado |

## Estado del Release Gate

Este release passa si: tsc limpio, build exitoso, todos los tests unitarios pasan, y tests SQL verificados manualmente.

## Uso

```bash
# Ejecutar checks automáticos
npm run typecheck && npm run build && npm test

# Ver el workflow completo
cat AGENTS.md
```
