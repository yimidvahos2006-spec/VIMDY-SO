# Plan — Bindi Colombia: Agenda universal + alineación enterprise real

## Objetivo
Hacer que la promesa de “Bindi universal” sea 100% real en código:
1. Completar el módulo **Agenda/Appointments** que el documento dice implementado pero no existe.
2. Alinear el **perfil operativo universal** con los campos reales de `businesses` y eliminar discrepancias.
3. Dejar el sistema listo para adaptarse por configuración, no por `business_type`.

## Alcance incluido
- Dominio: agenda completa (entidad, engine, repositorio Supabase, RPCs, RLS, migración SQL, UI, permisos).
- Perfil operativo: `operationConfig`, `enabled_modules`, persistencia, onboarding, ausencia de `commerce_mode`/`appointments_enabled`/`customers_enabled` como campos mágicos.
- Roles/permisos: catálogo único, sin duplicación.
- Validación: tests unitarios + SQL de RBAC/atomicidad para agenda.

## Alcance excluido
- Facturación DIAN avanzada, pagos internacionales, loyalty/CRM, omnicanal web/domicilio, release pipeline CI/CD.
- Se registran como follow-ups enterprise.

## Estado actual confirmado
- Perfil operativo parcialmente implementado: `business_types`, `sales_channels`, `inventory_type`, `production_mode`, `service_mode`, `tables_enabled`, `waiter_mode_enabled`, `kitchen_enabled`.
- Agenda/Appointments **no existe** en código ni en Supabase.
- Campos `appointments_enabled`, `customers_enabled`, `commerce_mode` no existen en `businesses`.

## Fase 1 — Alinear modelo de negocio universal
1.1. Eliminar referencias a `commerce_mode`, `appointments_enabled`, `customers_enabled` como campos de BD.
1.2. Confirmar fuente de verdad: `enabled_modules` + `operation_config` determinan capacidades.
1.3. Ajustar `businessOperatingProfileRepository`, `authBusinessContext`, onboarding y UI para leer solo lo que existe.

## Fase 2 — Implementar Agenda completa
2.1. Dominio: entidad `Appointment` con estados `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`.
2.2. Engine: `AppointmentEngine` con detección de cruces por responsable y validación de horarios.
2.3. Repositorio Supabase + RPCs atómicas: crear, reprogramar, cancelar, marcar no-show, listar por rango.
2.4. Migración SQL: tabla `appointments`, RLS multi-tenant, grants, índices por fecha y responsable.
2.5. Permisos: `agenda.view`, `agenda.manage` en `rolePermissions.ts` y mapas de UI.
2.6. UI: pantalla de agenda semanal/quincenal, routing, módulo condicional por `enabled_modules`.

## Fase 3 — Cerrar brechas enterprise
3.1. Unificar catálogo de permisos: eliminar duplicación entre `src/core/config/permissions.ts` y `src/infrastructure/supabase/rolePermissions.ts`.
3.2. Depurar `seedIdentity` muerto o eliminar su llamada en `CompositionRoot`.
3.3. Reemplazar `findAll()` en lecturas críticas por RPCs/read models paginados.

## Validación
- TypeScript estricto: `tsc --noEmit` verde.
- Tests unitarios para `AppointmentEngine` y perfil operativo.
- Tests SQL manuales en Supabase para RLS/atomicidad de agenda.
- Smoke test de onboarding para servicio híbrido sin cocina/mesas.

## Riesgos
- Agenda introduce un nuevo módulo condicional; debe apagarse completamente cuando no está en `enabled_modules`.
- Si se agregan columnas a `businesses`, asegurar defaults seguros y backfill idempotente.

## Próximo paso
Ejecutar Fase 1 para despejar el modelo, luego Fase 2 completa de agenda.
