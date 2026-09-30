VIMDY Caja Enterprise V4 — implementación

Qué se añade

Esta entrega cierra la capa financiera-operativa de Caja sin rehacer Venta ni el módulo de mesas.

Arqueo ciego: el cajero cuenta billetes/monedas por denominación; el esperado no se muestra antes del envío.

Snapshot de cierre: cash_drawer_counts guarda denominaciones, contado, esperado, diferencia, actor y fecha.

Movimientos manuales tipificados: fondo/cambio, gasto, retiro a caja fuerte, depósito bancario y otros.

Control de efectivo disponible: una salida no puede dejar el turno en efectivo negativo.

Transferencia entre cajas: salida de una caja + entrada en otra dentro de una sola transacción, con bloqueo determinista para evitar deadlocks.

Cierre por rol: ADMIN/GERENTE pueden cerrar; CAJERO solo su propio turno.

Integridad histórica: la constraint de payment_verifications se valida si el histórico ya está consistente.

Archivos nuevos / actualizados

Core

src/core/caja/CajaEnterpriseTypes.ts

src/core/caja/cashDenominations.ts

src/infrastructure/caja/enterpriseCashService.ts

src/core/config/permissions.ts

src/core/engines/RoleEngine.ts

Infraestructura

src/infrastructure/supabase/rolePermissions.ts

src/infrastructure/di/seedIdentity.ts

UI

src/presentation/components/shift/CashDenominationCounter.tsx

src/presentation/components/shift/EnterpriseCashControls.tsx

src/presentation/components/shift/CashRegisterTransferCard.tsx

src/presentation/components/shift/ShiftPanel.tsx

Supabase

supabase/migrations/20260928193000_caja_enterprise_v4_operational.sql

supabase/tests/caja_enterprise_v4_operational.test.sql

Integración de ruta

No hace falta crear una ruta nueva. VIMDY ya usa:

/caja -> CashOperationsPage -> ShiftPanel

El ShiftPanel.tsx incluido en esta entrega ya monta los controles Enterprise cuando existe un turno abierto.

Orden de despliegue

Aplicar V2.

Aplicar V3.

Aplicar V4.

Ejecutar supabase/tests/caja_enterprise_v4_operational.test.sql en el SQL Editor.

Ejecutar typecheck y build con las dependencias instaladas.

Probar dos cajas simultáneas con turnos distintos.

Gate financiero

Antes de vender este módulo se debe probar en un entorno real de prueba:

apertura de turno por caja;

venta en efectivo;

venta no efectivo verificada;

ingreso manual;

gasto/retiro;

transferencia caja 01 -> caja 02;

cierre ciego por denominaciones;

diferencia positiva;

diferencia negativa;

reintento idempotente;

dos cajas operando simultáneamente;

caída/reconexión de red;

reporte diario después del cierre.

Validación histórica

Si existen filas antiguas CONFIRMED en payment_verifications sin verified_at o provider_reference, V4 aborta de forma explícita. No se debe convertir una inconsistencia histórica en una “migración verde”.

Límite de esta V4

V4 fortalece el dinero físico y el cierre. El siguiente bloque grande es el ledger de pagos separados para CASH + CARD + TRANSFER + QR por una misma venta, seguido por split de cuenta y operación gastronómica (mesas/meseros/comandas) 