# VIMDY MASTER RELEASE PLAN

## Objetivo

Cerrar Vimdy para negocios de alimentos y bebidas en Colombia con evidencia real, sin depender de compilación ni UI como aprobación. La operación debe ser verificable en PostgreSQL/Supabase real, con permisos, inventario, caja y pagos certificados server-side.

## Fase 0 — Preparación del entorno local

- Verificar virtualización, WSL2, Docker Desktop y Supabase local.
- Asegurar que `docker` y `supabase start` puedan operar localmente.
- No tocar producción ni ejecutar `db push` remoto.
- Usar una base aislada para pruebas reales del Gate 1.

## Gate 1 — Venta atómica server-side

Objetivo: venta, detalle, inventario, kardex, cocina, auditoría e idempotencia en una sola transacción server-side.

Checklist real:
- PostgreSQL/Supabase local operativo
- migration aplicada local
- `create_sale_fulfillment_atomic` existe y ejecuta
- venta simple, inventario, receta y cocina validados
- rollback, concurrencia, idempotencia, tenant isolation y doble cobro comprobados
- CAJERO puede vender sin permisos arbitrarios de ajuste de inventario
- build y typecheck reales
- E2E del flujo POS validado

## Gate 2 — Pagos + Caja

- payment sessions persistentes
- idempotencia y doble cobro
- webhooks
- reembolsos
- conciliación
- errores de red

## Gate 3 — Inventario

- productos, variantes, tamaños, ingredientes
- recetas, subrecetas, lotes, mermas, kardex
- compras, proveedores, stock real y auditoría

## Gate 4 — Cocina + producción + food cost

- KDS, impresoras, estaciones, comandas
- producción, recetas, ingredient usage, food cost y mermas
- combos, modificadores y promociones aplicables

## Gate 5 — Operación del negocio

- mesas, domicilios, pickup, web, QR, multi-sucursal
- flujo de operación real por capacidad

## Gate 6 — Clientes y fidelización

- clientes, promociones, fidelización, tickets, uso de QR y web

## Gate 7 — Seguridad y rendimiento

- RLS, RBAC, multi-tenant, auditoría, observabilidad, límites de carga, paginación y consultas agregadas

## Gate 8 — Reportes y BI

- dashboards, reportes operativos, KPI y forecasting

## Gate 9 — IA controlada

- análisis, explicación, recomendación y sugerencias
- sin ejecución de operaciones sensibles sin permisos, confirmación y auditoría

## Gate 10 — Release Colombia

- validación final de producción real
- certificados, proveedores, soporte, backups y recuperación

## Regla de salida

No se declara `READY FOR PRODUCTION` ni se aprueba un gate si:
- la prueba no se ejecutó contra PostgreSQL/Supabase real,
- la prueba fue omitida,
- la operación depende de frontend o memoria local,
- la operación no tiene auditoría, permisos y rollback verificables.

## Estado actual

- **Estado de release: BLOCKED.** El flujo E2E POS falló antes de autenticar; no hay evidencia de persistencia de la venta desde UI. No se afirma readiness.
- **Migration versions:** revisión de 50 archivos encontró cero identificadores numéricos completos duplicados. Hay versiones con prefijo de fecha de 8 dígitos y otras de 14 dígitos; mismos prefijos de día no significan colisión. No se deben renumerar migrations liberadas sin evidencia de su estado de despliegue.
- Evidencia SQL histórica: `sale_fulfillment_atomic.test.sql` y `core_tenant_rls.test.sql` pasaron en Postgres local para los casos expresamente anotados en `VIMDY_RELEASE_STATUS.md`; dos llamadas simultáneas de pago con la misma clave tuvieron un efecto financiero. Esto no cierra el conjunto de escenarios actualmente requerido.
- **Última validación de migration:** `supabase db reset --local --no-seed` para incluir `20261002000000_atomic_inventory_transfer_and_production.sql` no produjo salida tras más de 300 segundos y se detuvo; no existe resultado verificable. La última lectura de memoria mostró ~0.2 GB disponibles y `tsc --noEmit` terminó por heap agotado.
- **Tipos:** el onboarding ofrece tipos F&B y conserva valores históricos no F&B solo para compatibilidad de lectura. Los tests unitarios de tipos/perfil pasaron (8). Esto no demuestra enforcement server-side.
- Nunca ejecutar `db push`, migraciones remotas ni comandos contra producción. La migration reciente de transferencia/producción tampoco está validada y el suite de `InventoryEngine` tenía seis fallos en el último resultado disponible.
- Cambio reciente de refunds: `PaymentEngine.refund/refundAmount` ya no retornan éxito artificial. `SalesEngine` ahora falla cerrado para pagos distintos de CASH antes de modificar caja/inventario/venta; la prueba focalizada pasó (15 tests), pero el flujo de efectivo sigue siendo de escrituras separadas, no una RPC transaccional.
- Build: el fallo por memoria se resolvió sin ampliar el heap: marketing ahora se carga por ruta, vendor pesados se separan y esbuild limita paralelismo a dos workers. `npm run build` completó typecheck y Vite (3.063 módulos, 1m08s).
- Baseline Git verificado: `HEAD` y `origin/main` apuntan al commit real `25a2b360d55e68b5b6fcd6e38c05c9a5498d64be`; no se inventó commit/tag. Para ejecución local usar `RELEASE_BASE_REF=origin/main`; en PR, el workflow usa el SHA real de la rama base.
- El árbol contiene modificaciones a migrations existentes (`20260829000004`, `20260927230000`, `20260928010000`, `20260928193000`) y migrations nuevas sin seguimiento. El guard corregido compara también el working tree con el baseline; no se deben descartar ni aprobar esas ediciones sin evidencia de despliegue.
- CI instala dependencias, ejecuta `npm run build` y luego los guards. Estos deben seguir fallando mientras haya hallazgos reales, incluido el almacenamiento local de sesiones financieras.
- **Gate de migrations local: BLOCKED_ENVIRONMENT.** Docker Desktop ya fue lanzado, pero Docker Engine no responde; `com.docker.service` está detenido y no pudo abrirse desde la sesión actual. `supabase status`/`migration list --local` dan conexión rechazada a `127.0.0.1:54322`. No se ejecutó reset ni operación remota. Para continuar, un usuario con privilegios debe iniciar/reiniciar Docker Desktop hasta mostrar Engine running; entonces el reset se ejecutará contra este repositorio.
- Continuar en orden: recuperar resultado verificable del reset; cerrar Gate 1 con SQL/RLS/concurrencia y E2E persistido; después implementar refunds transaccionales y sesiones server-side; cerrar inventario, onboarding, offline y matriz restante. Mantener cada área bloqueada hasta contar con pruebas exigidas.

## Definición oficial del producto

La referencia de alcance y capacidades es [`VIMDY_PRODUCT_DEFINITION_COLOMBIA.md`](./VIMDY_PRODUCT_DEFINITION_COLOMBIA.md). El release se limita a F&B Colombia; el tipo de negocio no autoriza módulos; cada capacidad habilitada debe tener implementación, integración, evidencia de prueba, seguridad y persistencia. El documento es definición y auditoría, no evidencia de readiness.
