# AGENTS.md — VIMDY OS Engineering Guide

## Project Overview

VIMDY OS es un sistema de gestión para restaurantes: punto de venta, gestión de caja, turnos (shifts), inventario, órdenes de cocina, facturación electrónica DIAN, y más.

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS + Supabase (PostgreSQL + Auth + Edge Functions) + Playwright (e2e).

## Build & Test Commands

```bash
# Type checking (strict TypeScript, no emit)
node ./node_modules/typescript/bin/tsc --noEmit

# Production build
npm run build
# (equivale a: tsc && vite build)

# Unit/integration tests
npm test          # = vitest run
npm run test:watch

# End-to-end tests
npm run test:e2e  # = playwright test

# Dev server
npm run dev
```

## Architecture

### Core (domain + engines)
- `src/core/engines/` — CashEngine, ShiftEngine, SalesEngine, InventoryEngine
- `src/core/config/permissions.ts` — Permisos: `CASH_REGISTER_MOVEMENT`, `SHIFT_CLOSE`, etc.
- `src/core/types/` — Interfaces de dominio

### Infrastructure (repos, supabase, di)
- `src/infrastructure/supabase/` — Client Supabase, `rolePermissions.ts`, `seedIdentity.ts`
- `src/infrastructure/di/` — Inyección de dependidades, `repositories/`
- `src/infrastructure/di/repositories/` — CashMovementRepository, ShiftRepository, etc.

### Presentation (React)
- `src/presentation/components/` — Componentes UI
- `src/presentation/hooks/` — Custom hooks
- `src/presentation/App.tsx` — Routing

### Supabase
- `supabase/migrations/20260821_initial_schema.sql` — Schema base (RLS, políticas, funciones)
- `supabase/migrations/20260831194428_fix_idor_security_rpcs.sql` — Fix IDOR en RPCs
- `supabase/migrations/20260916000001_electronic_invoicing_dian.sql` — Facturación DIAN + grants RBAC
- `supabase/migrations/20260923_cash_hardening.sql` — Índices de caja + constraint shifts (read-only reference)
- `supabase/migrations/20260923190000_caja_final_hardening.sql` — RBAC en RPCs (fuente de verdad)
- `supabase/tests/caja_concurrency.test.sql` — Tests SQL de atomicidad + RBAC

## RBAC System

### Roles (business_members.role)
| Rol | cash.registerMovement | shift.close |
|---|---|---|
| ADMIN | Sí | Sí |
| CAJERO | Sí | Sí |
| GERENTE | No | No |
| MESERO | No | No |
| CONTADOR | No | No |

### Funciones de autorización (server-side)
- `has_business_role(business_id uuid, allowed_roles text[])` — verifica `business_members.role` directamente en DB
- `auth_business_ids()` — retorna business_ids del usuario autenticado
- Ambas concedidas a `authenticated, service_role`

### Permisos
- `CASH_REGISTER_MOVEMENT` (`cash.registerMovement`) → roles: ADMIN, CAJERO
- `SHIFT_CLOSE` (`shift.close`) → roles: ADMIN, CAJERO

### RPCs con RBAC
- `register_movement_atomic()` — línea 152 del hardening: `has_business_role(p_business_id, array['ADMIN', 'CAJERO'])`
- `close_shift_atomic()` — línea 448 del hardening: `has_business_role(v_shift_business_id, array['ADMIN', 'CAJERO'])`

## SQL Test Execution

Los tests en `supabase/tests/*.test.sql` **no son ejecutados por vitest**. Se ejecutan manualmente en el SQL Editor de Supabase. Cada `DO $$` bloque es una transacción independiente que:
1. Inserta business/branch de prueba
2. Configura JWT: `set_config('request.jwt.claim.sub', '<valid-uuid>', true)`
3. Inserta `business_members` con `role='CAJERO'` (o `'MESERO'` para tests de denegación)
4. Ejecuta la RPC y valida con `RAISE EXCEPTION` / `RAISE NOTICE`

UUID de prueba: `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11` (válido, reutilizable).

## Coding Standards

- TypeScript strict mode (tsconfig.json)
- React component patterns: functional components, hooks
- Supabase: usar RPCs con SECURITY DEFINER + validaciones server-side
- Idempotency: usar `idempotency_key` text (no UUID) para ON CONFLICT
- Multi-tenant: cada consulta filtra por `business_id`
- RLS: enabled en todas las tablas tenant

## Release Gate

Ver `.kilo/command/release-gate.md` para el workflow de lanzamiento.
