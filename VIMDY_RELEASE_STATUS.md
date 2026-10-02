# VIMDY Colombia F&B — release status

**Última revalidación:** 1 de octubre de 2026  
**Estado de release:** **BLOCKED / NO APTO PARA PRODUCCIÓN**  
**Alcance de producto:** exclusivamente negocios de alimentos y bebidas en Colombia. Ningún cambio de este estado debe habilitar retail, hotelería, servicios u otros sectores. La internacionalización futura debe quedar como configuración/capacidad, no como trabajo de expansión actual.

## Diagnóstico del entorno local (01-10-2026)

- Docker Engine está disponible desde Windows: el contenedor PostgreSQL local `supabase_db_vimdy_gate1_local_20261001` inició saludable.
- La comprobación directa actual de `wsl -d Ubuntu -- bash -lc 'docker ps; docker version'` sigue fallando: `The command 'docker' could not be found in this WSL 2 distro.` `wsl --list --verbose` muestra Ubuntu `Stopped` y `docker-desktop` `Running`; requisito `BLOCKED_ENVIRONMENT`.
- Supabase CLI Windows v2.117.0 ejecutó operaciones **locales** en un proyecto temporal sin proyecto remoto enlazado. Se intentó `supabase start` y también `supabase start --exclude ...`; ambos retornaron sin API/Auth arrancados. `supabase status` y `docker ps` confirman que solo PostgreSQL está corriendo, DB URL `127.0.0.1:54322`.
- PostgreSQL local 17.6 está operativo. `supabase db reset --local --no-seed` aplicó 49 migrations al proyecto temporal aislado (última versión `20261001000000`). No se ejecutó `db push`, migración remota ni operación contra producción.
- La auditoría del árbol fuente encontró 50 migrations y ningún identificador numérico completo duplicado. Prefijos de fecha repetidos (por ejemplo, varios archivos del día `20260829`) son válidos cuando el sufijo horario/versional es distinto. Una revalidación histórica aplicó 49 migrations hasta `20261001000000`; la nueva migration `20261002000000` aún no se ha validado desde cero.
- Se encontró que `20260909_refund_cancel_hardening_v2.sql` elimina `auth_branch_ids()` con `CASCADE`, lo que había eliminado las políticas de tenant dependientes. Una migration nueva restaura políticas de lectura tenant/branch y limita escrituras directas de productos a ADMIN/GERENTE. `public.kitchen_settings` ahora tiene RLS y política de lectura por sucursal en la DB temporal; no se ha desplegado.

**Conclusión de entorno:** el último estado positivo guardado indica que Supabase local en Windows/Docker tenía PostgreSQL, Auth, REST y servicios principales arriba (Auth/REST respondieron HTTP 200). La comprobación más reciente del reset nuevo no produjo salida concluyente; no se usó WSL como requisito y no se debe inferir que el stack siga saludable sin repetir health checks.

## Estado operativo

**Gate 1 (Venta atómica server-side):** `BLOCKED`  
**Causas de bloqueo:** E2E del POS con persistencia y validación de la cadena original de migrations. Venta atómica, concurrencia de stock, doble cobro e invariantes RLS/RBAC seleccionadas sí tienen evidencia en PostgreSQL local aislado; esto no aprueba todo el gate.

## Cambios y validación más recientes

- **Build — PASS:** el primer fallo ocurrió con solo 335–449 MB de RAM física libre y Vite/esbuild agotó memoria después de transformar 3.063 módulos. No aumenté el heap. Separé las rutas públicas de marketing mediante lazy loading y dividí los chunks de charts/Three; limité el paralelismo de esbuild a dos workers en `vite.config.ts`. Quité el chunk OCR manual que estaba vacío/no se usaba. `node ./node_modules/typescript/bin/tsc --noEmit`: PASS; `npm run build` estándar, sin variable externa `GOMAXPROCS`: PASS, 3.063 módulos, 1m08s. Se conserva warning de imports mixtos estático/dinámico de `supabaseClient.ts`; chunks vendor-three 526.35 kB y vendor-charts 353.64 kB (gzipped 131.42/103.86 kB). La base del build quedó corregida mediante control de concurrencia y code splitting, no ampliando heap.
- `PaymentEngine.refund/refundAmount` dejaron de retornar éxito artificial. Los métodos de refund de `SalesEngine` ahora rechazan pagos distintos de CASH y pagos sin estado confirmado antes de ejecutar efectos secundarios; los reembolsos con factura también se bloquean en el flujo parcial. El reembolso CASH solo retorna confirmado después de terminar las escrituras locales de caja, inventario, venta y auditoría; siguen sin estar agrupadas en una RPC, por lo que no es atómico para producción.
- `npm test -- --run tests/unit/caja-payment-consistency.test.ts`: **PASS, 15/15**. Incluye prueba de que un reembolso CARD rechazado no modifica caja, inventario ni venta. Es evidencia unitaria con repositorios fake, no prueba de refund real ni de PostgreSQL.
- Diagnósticos de los tres archivos editados (`PaymentEngine.ts`, `SalesEngine.ts`, test): sin errores encontrados.
- `npm run build`: TypeScript terminó sin errores; Vite falló por agotamiento del heap de Node (~700 MB), así que build **no PASS**.
- `npm run release:guards`: el guard se amplió para requerir un baseline Git válido y revisar migraciones modificadas en el working tree, no solo `HEAD`. `HEAD` y `origin/main` coinciden en el commit real `25a2b360d55e68b5b6fcd6e38c05c9a5498d64be`; uso local: `$env:RELEASE_BASE_REF='origin/main'`. Las migraciones históricas modificadas encontradas deben bloquear release, y `PaymentSessionManager` sigue siendo un bloqueo funcional hasta migrar las sesiones server-side.
- Verificación del guard contra baseline real: `RELEASE_BASE_REF=origin/main npm run release:guards` termina **FAIL intencional** con 8 findings: sesiones aún locales; 4 migraciones históricas modificadas; y 3 migrations nuevas cuyo ID `20260829...` es anterior a la última versión del baseline (`20260930110000`). No se renumeró ni revirtió ninguna migration. Ejecutarlo sin baseline también falla cerrado, confirmando que no omite la protección.
- CI `.github/workflows/release-guards.yml` ahora instala dependencias, corre el build y luego los guards; en PR el baseline es el SHA de base provisto por GitHub. El guard como mecanismo está implementado, pero la verificación de release queda **BLOCKED** por los hallazgos reales anteriores, que requieren reconciliar la cadena antes de aprobar.
- **Migraciones / Supabase local — BLOCKED_ENVIRONMENT (revalidado 01-10-2026 16:08):** aunque la UI informa “Engine running”, `docker ps` seguido de `docker version` no respondió en 45 s; ambos contextos (`desktop-linux` y `default`) agotaron 20 s. `docker context inspect desktop-linux` apunta a `npipe:////./pipe/dockerDesktopLinuxEngine`; los named pipes existen pero no contestan. `com.docker.service` sigue `Stopped`, no aparecen procesos Docker Desktop/backend/dockerd en esta sesión y WSL muestra `docker-desktop Running`, `Ubuntu Stopped`. `supabase status` también agotó 45 s. No se ejecutó `db reset`, no se tocó producción y no se cambió/renumeró migration alguna. Para reanudar, hace falta confirmar `docker ps` con salida válida desde una consola elevada de Windows y luego repetir aquí `docker ps`, `docker version`, `supabase status` y `supabase db reset --local --no-seed` en este repositorio.
- `supabase db reset --local --no-seed` del nuevo migration continúa **sin resultado verificable**; no se ejecutaron operaciones remotas.

------------------------------

## Alcance y evidencia

Se revisaron el código fuente, migrations/RPCs, Edge Functions y suites de `tests/`. Esto confirma qué existe en el árbol de trabajo, **no** qué migrations están desplegadas en Supabase, qué secretos/certificados están configurados, ni qué proveedor está habilitado. No se inspeccionaron archivos `.env`. El árbol ya estaba sucio al iniciar la auditoría; se conservaron todos sus cambios previos. En particular, hay modificaciones locales en motores y pagos y tres migrations sin seguimiento; deben revisarse antes de cualquier despliegue.

Etiquetas:

- **Implementado en código:** existe lógica real identificable; no implica que esté desplegada ni validada contra producción.
- **Parcial:** existe un tramo, pero falta completar el flujo o sus garantías.
- **Simulado/in-memory:** usa valores locales, mapas, mocks o confirmaciones no verificadas por un sistema autoritativo.
- **Solo frontend:** la UI existe, pero no hay enforcement autoritativo en servidor.
- **Bloqueado por configuración externa:** falta una condición real que no se puede suplir con código local (credenciales, certificado, habilitación o contrato de proveedor).
- **No encontrado:** no se halló una implementación de extremo a extremo en el código/migrations inspeccionados.

**Avance P0 del 30-09:** agregado `adjust_stock_batch_with_kardex` en migration nueva y conectado al consumo/restauración de recetas mediante `ProductRepository`; registra ledger idempotente `inventory_batch_operations`, aplica stock+Kardex en una transacción y pasa operation ID desde creación de venta. Incluye test unitario focalizado y test SQL de rollback/reintento. La migration y test SQL **no se ejecutaron contra Postgres/Supabase** y están sin despliegue; este control queda **implementado en árbol, pendiente de validación DB**, no cerrado para producción. Typecheck y build sí se ejecutaron. La suite completa de `inventoryEngine.test.ts` tiene 6 fallas previas/regresiones locales (borrado y validación de productos/recetas, desactivación por historial, batch heredado y transferencias); el test batch nuevo pasa.

**Avance de operación del 30-09:** guardar `OperationConfig` rehidrata el perfil autoritativo de Supabase; rutas, sidebar, navegación móvil y POS consultan capacidades y fallan cerrado durante carga/error. Cocina usa configuración efectiva. Con `waiterModeEnabled`, CAJERO/GERENTE seleccionan responsable desde `/meseros`, abren Caja y conservan `waiterId` online/offline; el cobro mantiene `cash.view`. `TableEngine` usa el repositorio inyectado para lectura, apertura idempotente, edición optimista, comanda y cierre/cobro idempotente. Pasan smokes de dos instancias sobre fake compartido, apertura idempotente, cocina y cierres J/N. Typecheck/build pasan; la tanda focalizada reporta 15 tests pasados y 14 omitidos por filtro. No se probó Supabase/realtime ni offline real de mesas; el bloque sigue parcial/no productivo.

## Resumen ejecutivo

Hay capacidades reales que vale la pena conservar: repositorios Supabase/RLS, RPCs transaccionales de caja y de movimiento individual de inventario, controles de rol server-side en funciones de caja, webhooks de proveedores para pagos de suscripción, soporte básico de DIAN, configuración operativa explícita, flujos offline locales y motores gastronómicos de recetas/forecast.

La configuración operativa ahora gobierna capacidades visibles y rutas desde un perfil rehidratado de Supabase. El motor de mesas dejó de usar un array local: opera sobre el repositorio inyectado, envía KDS/impresora por el pipeline existente y solo libera mesa tras cobro confirmado. Las pruebas locales pasan, pero los dobles no demuestran que la migration, RLS, realtime y caché funcionen en el proyecto Supabase real; el `TableRepository` todavía puede servir caché mientras refresca en segundo plano. `offlineTable` sigue guardando operaciones locales y puede liberar la mesa antes de sincronizar/cobrar; no es offline financiero autoritativo. No existe todavía cola de pedidos sin cobro para usuario MESERO autenticado. `PaymentEngine.payCard/payTransfer/payQR/payMixed` dejan el pago pendiente; la guardia local PAID exige evidencia de proveedor que ningún webhook POS encontrado produce. `PaymentSessionManager` sigue en Map/localStorage y silencia fallos.

Las garantías tampoco están conectadas de extremo a extremo. La RPC de fulfillment en el árbol combina venta, detalles, inventario/Kardex, cocina/outbox y auditoría; el cobro usa `register_sale_payment_atomic` por separado y la migration de fulfillment aún no está validada mediante un reset reproducible. La RPC batch de inventario acepta ADMIN/GERENTE/INVENTARIO; CAJERO solo debe operar mediante la venta validada server-side. La autorización de capacidades todavía no se hace en cada RPC. No existe tabla Postgres `payment_sessions`; las sesiones locales se guardan en `localStorage` y los errores de persistencia se descartan. El envío DIAN a producción está explícitamente bloqueado.

Por tanto, **no se declara terminado ni probado en producción ningún flujo financiero o gastronómico end-to-end**. La compilación verde únicamente demuestra tipos y bundle; no acredita concurrencia, RLS desplegado, conexión con proveedor, integración DIAN ni recuperación multi-dispositivo.

## Comparación competitiva y orden de cierre

**Base de comparación:** el análisis competitivo compartido por el usuario y páginas públicas consultadas el 30-09-2026. Las páginas describen funcionalidades ofrecidas por sus proveedores, no pruebas independientes de calidad. Vendty bloqueó la consulta automatizada (HTTP 403), por lo que sus capacidades se conservan como afirmaciones del material compartido y no como verificación directa.

| Referencia | Capacidades gastronómicas/operativas anunciadas en las fuentes consultadas | Brecha concreta frente a Vimdy |
|---|---|---|
| [Vendty](https://www.vendty.com/) | El análisis compartido le atribuye POS/facturación, inventario, cajas, promociones, puntos, tienda virtual, operación híbrida, mesas, domicilios, comandas, menú digital, recetas e ingredientes. | No se confirma en esta auditoría qué funciones están incluidas por plan ni cómo operan técnicamente. Vimdy no debe competir por conteo de módulos: primero debe probar venta/caja/stock atómicos, DIAN habilitada y operación offline consistente. |
| [Siigo POS Restaurantes](https://www.siigo.com/sistema-pos/restaurantes/) | La página consultada anuncia mesas, pedidos, pagos, gastos, reservas, inventario, reportes, facturación electrónica, fidelización y análisis de datos. | Vimdy tiene componentes para mesas, inventario, reportes y clientes, pero no evidencia E2E de producción; pagos externos siguen pendientes de verificación server-side y DIAN no está habilitada para producción. |
| [Alegra POS Restobar](https://colombia.alegra.com/colombia/pos/restaurantes/) | La página consultada anuncia mesas, comandas a pantalla/impresora, permisos, cierres, terminales, sedes, medios de pago, propinas y conexión contable/facturación. | Vimdy tiene capacidades y configuración operativa parciales; falta validar permisos en cada mutación/RPC, multi-sucursal real, pagos verificables, DIAN productiva e integración contable operativa. |
| [Rappi POS](https://merchants.rappi.com/es-co/que-ofrecemos/sistema-pos) | La página consultada anuncia integración de pedidos con proveedores POS asociados. | No se encontró en el estado auditado una integración de pedidos Rappi completa. Debe abordarse después de cerrar confiabilidad transaccional y canales propios. |

**Conclusión:** el umbral competitivo no es agregar una lista de pantallas. Es demostrar una jornada completa de restaurante, desde pedido hasta pago/cierre, con datos durables y controles del servidor. La comparación refuerza esta secuencia, sin cambiar el gate activo:

1. **Cerrar Gate 1** con Postgres aislado, pruebas de rollback/concurrencia/idempotencia/RBAC y E2E persistido. Sigue **BLOCKED** y es el único bloque de implementación activo.
2. **P0 operativo:** pago POS verificable y persistente, caja/reembolsos, inventario y offline/sincronización con garantías server-side; DIAN solo se considera productiva tras credenciales, numeración, certificado/proveedor y habilitación reales.
3. **Núcleo gastronómico:** completar combos/modificadores, recetas/subrecetas, producción/lotes, mermas, food cost y compras, con movimientos auditables.
4. **Operación empresarial F&B:** capacidades por configuración, roles/RBAC, multi-sucursal/caja/dispositivo, KDS/impresora, mesas opcionales y reportes escalables.
5. **Canales y crecimiento:** menú web/QR, domicilio/pickup, integraciones de agregadores, promociones y fidelización; cada canal debe crear pedidos en el mismo flujo autoritativo.
6. **Diferenciación:** IA para análisis, explicación y recomendaciones; cualquier acción sensible requiere permisos, políticas, confirmación explícita, comando validado y auditoría. No es sustituto de la operación transaccional.

No se inicia Gate 2 ni se declara producción lista por esta comparación; el orden de gates y la evidencia de salida continúan siendo obligatorios.

## Hechos verificados por área

| Área | Estado exacto en código | Riesgo / trabajo pendiente |
|---|---|---|
| Capacidades y módulos | **Parcialmente real en runtime.** Configuración > Operación persiste `OperationConfig` y módulos juntos, rehidrata el perfil tras guardar, y el perfil gobierna rutas, sidebar, barra móvil y controles de cocina/mesero. Mesas/cocina se derivan de sus flags operativos aunque `enabled_modules` esté desactualizado. No hay enforcement de todas las capacidades en mutaciones/RPC. | Completar permisos por capacidad en backend. Con mesas=false y waiterMode=true, CAJERO/GERENTE seleccionan responsable y navegan al POS existente; no hay pedido persistente sin cobro para usuario MESERO autenticado. El tipo sigue descriptivo. |
| Tipos de negocio | **Selector F&B corregido; compatibilidad legacy retenida.** El onboarding selecciona categorías de alimentos y bebidas y no ofrece tipos genéricos/no-F&B. El parser conserva IDs históricos únicamente para leer registros existentes. Los tests de tipos/perfil pasaron (8). | Falta verificar enforcement de alcance fuera del selector; `business_type` debe seguir siendo descriptivo y no autorizar módulos. |
| Venta y cobro | **RPC de fulfillment implementada en el árbol; Gate 1 BLOCKED.** `SalesEngine.createSale` enruta primero a `create_sale_fulfillment_atomic`; la RPC recalcula precios/impuestos, consume stock/Kardex, crea detalle, KDS/print outbox y auditoría en una transacción, con ledger idempotente. El cobro queda en `register_sale_payment_atomic`. | Migration y tests SQL/integración/E2E no se ejecutaron en una base aislada. Concurrencia, rollback, permisos/RLS y persistencia real no están demostrados; ver Gate 1 al final. |
| Payment Engine del POS | **Parcial y fail-closed.** Efectivo se valida localmente antes del RPC de caja; tarjeta, transferencia, QR y mixto con tender externo devuelven `PENDING_VERIFICATION`. `PaymentEngine.refund/refundAmount` ya no afirman éxito por sí solos. `SalesEngine` bloquea refunds de método distinto de CASH antes de caja/inventario/venta; la confirmación CASH se devuelve solo después del registro local del movimiento, inventario, venta y auditoría. La prueba focalizada verifica que un refund CARD no deja efectos secundarios. | Aún no es transaccional server-side: falta RPC de refund que cubra caja, inventario/Kardex, venta/auditoría e idempotencia. No se soportan refunds de proveedor hasta tener confirmación real, ni refunds de ventas facturadas hasta nota crédito. |
| Payment sessions | **No aptas.** [`PaymentSessionManager.ts`](./src/core/payments/PaymentSessionManager.ts) usa `Map` + `localStorage`, no es multi-dispositivo ni persistencia financiera; captura y suprime fallos. [`VimdyPayments.ts`](./src/core/payments/VimdyPayments.ts) crea sesiones sin guardar business/branch/idempotency/reference/expiry y no vincula después el resultado a la sesión. | Tabla/RPC/repositorio server-side con índice de idempotencia, lifecycle y reconciliación por webhook. |
| Caja | **Parcial; hay RPCs reales.** Migrations `20260923190000`, `20260927230000`, `20260928010000`, `20260928193000` incluyen movimientos, cobro, apertura/cierre, conteo y transferencias. Pruebas SQL están en `supabase/tests/`. | Verificar deployment/orden de migrations, cubrir concurrencia sobre BD limpia y corregir confianza en confirmaciones externas. |
| Inventario/kardex | **Parcial; atomicidad batch implementada en árbol, pendiente DB.** `InventoryEngine` expande receta y variantes por IDs con `findMany`; `ProductRepository` manda un batch al RPC nuevo. Migration crea `inventory_batch_operations` con RLS, hash de payload, locks por operación y movimientos stock+Kardex en una transacción. `transferStock/produceBatch` tienen cambios de implementación en árbol, pero su migration no ha sido aplicada y la suite `inventoryEngine.test.ts` falló (6 fallos en la última ejecución conocida). Métodos de catálogo/kardex aún descargan todo en algunos caminos. | Resolver fallos de suite; aplicar migration en DB local aislada y correr test SQL/concurrencia/roles; revisar stock por sucursal/permiso server-side y paginar consultas. |
| Mesas | **Persistencia implementada en el motor; validación real pendiente.** `TableEngine` usa `IRepository<Table>` para CRUD, conflicto optimista de ítems, apertura idempotente, comanda existente, cierre/cobro idempotentes. Los smokes multi-dispositivo/cierre/kitchen pasan contra `InMemoryRepository`, no contra Supabase. `TableRepository.findAll` puede devolver caché y refrescar después. | Validar RLS, migraciones, realtime/caché, rollback de apertura fallida, transiciones estructurales concurrentes y offline. No habilitar producción sin prueba DB/E2E real. |
| Meseros | **Parcial.** `waiterModeEnabled` es independiente de mesas. Sin mesas, CAJERO/GERENTE seleccionan un mesero ligero y atribuyen la venta rápida, incluso al encolarla offline. No representa un pedido abierto de mesero separado del pago ni permite a MESERO entrar a Caja. | Pedido sin cobro persistido, vista de pedidos pendientes para Caja y permisos de lectura/creación por rol, reutilizando `OrderEngine`. |
| Cocina/KDS | **Parcial.** Hay UI, repositorio, transiciones/auditoría; POS, `OrderEngine` y ahora `TableEngine` resuelven la salida desde `OperationConfig`. Smokes POS/mesa filtran productos sin preparación; la mesa persiste la comanda en el repositorio de cocina. | Validar impresora/KDS real, fallo/reintento de dispositivo, permisos en backend, outbox durable y E2E con Supabase; TableRepository/realtime aún no está validado. |
| Offline | **Cola local parcial.** Ventas, mesas, cocina, inventario y clientes tienen colas IndexedDB/sincronizadores bajo [`src/core/offline/`](./src/core/offline). | Cola no compartida entre dispositivos; no crea una venta/caja financiera autoritativa offline. Asegurar orden, exclusión, límites/reintentos, conflictos, dispositivo y reconciliación server-side. |
| DIAN | **Código parcial; producción bloqueada.** Edge Functions de DIAN/Factus, XML/UBL, CUFE, firma, jobs/certificados y migrations existen. [`dian-invoice/index.ts`](./supabase/functions/dian-invoice/index.ts) detiene explícitamente `dian_environment=production`. | No se puede afirmar habilitación, validez legal ni transmisión de producción sin habilitación DIAN, certificado válido, software ID/clave técnica, proveedor/acuerdo aplicable y pruebas de homologación. |
| Proveedores de pago | **Parcial; evidencia POS no conectada.** Existen funciones Wompi, Mercado Pago y PayPal con checkout/webhook/refund; en el código revisado no encontré función que inserte evidencia POS en `payment_verifications`. La migration local de guardia PAID exige esa evidencia y authenticated no tiene INSERT. | Integrar eventos POS firmados/idempotentes, vinculados a venta/tenant/sucursal/monto/moneda; validar retries, replay, fuera de orden, conciliación y secretos reales. No confundir suscripción con venta F&B. |
| E2E | **Insuficiente.** Hay 10 entradas bajo `tests/e2e`; cubren login, aislamiento, onboarding y algunos flujos POS. [`venta.spec.ts`](./tests/e2e/pos/venta.spec.ts) contiene esperas y asserts débiles (p. ej. solo no volver a login), no prueba recibo/estado/stock/caja persistidos. | Crear matriz de aceptación completa abajo y ejecutar contra stack real aislado con asserts de BD, no solo navegación. |

## Clasificación priorizada

### P0 — Bloquea producción

1. **Mesas no validadas en producción.** `TableEngine` ahora utiliza `TableRepository`, pero solo hay pruebas con repositorio fake compartido. Falta aplicar/probar RLS, realtime, cache coherente, carrera de apertura/cierre y fallo parcial en Supabase real; offline continúa siendo cola local no autoritativa.
2. **Consumo de receta: implementación local parcial, DB/venta pendiente.** Existe `adjust_stock_batch_with_kardex` y ledger idempotente en migration nueva; el test unitario pasa. El SQL rechaza anónimos y verifica rol, tenant, suscripción y sucursal. Solo ADMIN/GERENTE/INVENTARIO pueden llamar el batch; el flujo CAJERO queda bloqueado hasta crear venta+consumo server-side. No desplegar hasta derivar deltas de una venta validada y correr `inventory_batch_atomic.test.sql` con RLS/concurrencia.
3. **Pagos externos bloqueados hasta integrar servidor.** El motor actual falla cerrado y la migration local requiere verificación server-side; falta el webhook/Edge Function POS que genere la evidencia confiable.
4. **Gate 1 — venta y fulfillment atómicos/idempotentes.** La RPC y el cableado POS están en el árbol; Gate 1 sigue bloqueado porque migration, rollback, concurrencia, autorización y E2E no se han ejecutado en un Supabase aislado. El pago usa `register_sale_payment_atomic` como operación separada y requiere su propia evidencia concurrente.
5. **Sesiones de pago durables y conciliables.** No existe `payment_sessions` en migrations; `localStorage`/Map no son ledger y fallos de persistencia se ocultan.
6. **Cerrar el camino de producción DIAN antes de venderlo como disponible.** El endpoint bloquea producción por código. No habilitarlo cambiando solo el flag; completar requisitos legales/técnicos y pruebas de homologación.
7. **Verificar RLS/RBAC sobre el esquema realmente desplegado.** Hay policies y controles server-side en migrations, pero el árbol no prueba su aplicación al proyecto activo. Requiere migración reproducible + pruebas negativas por rol/tenant/branch en Postgres.
8. **Offline sin falsa confirmación financiera.** Operación desconectada debe marcar cobros “pendientes”, no pagados; prevenir doble cobro al reconciliar y resolver conflictos de inventario/turnos. La cola IndexedDB actual no es una transacción distribuida ni permite continuidad multi-dispositivo.
9. **Recuperación de datos/operación.** No se encontró evidencia versionada de política probada de backups, PITR, restauración, RPO/RTO y recuperación de colas. Configuración del proveedor no se considera verificada.

### P1 — Necesario para operación gastronómica completa

- Operación configurable real en UI/runtime para mesas/meseros independientes, cocina/no cocina, KDS/impresora/ambos/ninguno y canales; falta validación de capacidades en backend y flujo de pedido sin cobro para MESERO autenticado.
- Entidades/operaciones transaccionales de recetas, ingredientes, subrecetas, producción, lotes, mermas, costos y transferencias por sucursal.
- Compras/recepción atómica, precios históricos de proveedor, devoluciones y conciliación de inventario.
- Flujo completo de pedido, domicilio/pickup, preparación, despacho, cancelación, pago y trazabilidad.
- Gestión de impresoras/estaciones con cola persistente, acknowledgements y recuperación.
- DIAN producción completa cuando se aporten los requisitos externos (P0 por bloqueo legal/venta del módulo; desarrollo funcional adicional P1).
- Auditoría financiera inmutable, estados de reembolso/notas crédito, conciliación de proveedores y reportes fiscales.
- Offline recuperable, sincronización de varios dispositivos y conflictos explícitos.

### P2 — Necesario para competitividad

- Menú web/QR con catálogo publicable, disponibilidad y pedido/checkout integrados.
- Promociones configurables, combos y modificadores composables con precios/recetas y consumo de inventario.
- CRM segmentable, campañas y fidelización con reversión ante cancelaciones/reembolsos.
- Analítica de margen real, food cost, desperdicio y rentabilidad por producto/turno/sucursal.
- Forecast y recomendaciones que usan agregados server-side con muestras/confianza y explicación; aprobación humana antes de mutaciones.
- Integraciones de domicilios/plataformas, conciliación de comisiones y estado del courier.
- Reportes exportables, multi-sucursal comparativo y vistas agregadas.

### P3 — Mejoras futuras

- Expansión internacional: locales/monedas/impuestos/proveedores por país bajo capacidad/configuración. No ampliar el catálogo de negocio fuera de F&B ni desarrollar otros países ahora.
- IA avanzada de visión/voz, automatización asistida y sugerencias personalizadas, siempre sin ejecutar acciones sensibles directamente.
- Predicción avanzada, materialized views incrementales, optimización de costos y capacidades de autoservicio.

## Inventario funcional gastronómico

| Capacidad | Estado | Hecho observable / siguiente paso |
|---|---|---|
| Productos | **Parcial** | Entidad, formularios y repositorio Supabase/IndexedDB existen. `listAll/search/getLowStockProducts` cargan y filtran el catálogo completo; falta búsqueda/paginación server-side. `deleteProduct` activo no protege ingredientes referenciados ni desactiva producto con historial, según pruebas unitarias existentes fallidas. |
| Variantes / tamaños | **Parcial** | `Product.sizes` y selector POS existen; confirmar la selección llega a venta, factura, receta, precio e inventario con snapshot inmutable. |
| Extras / modificadores | **Parcial** | `Product.extras`, UI y receta de extras existen. Falta catálogo relacional/validación server-side, precio snapshot y restricciones combinatorias. |
| Combos | **No encontrado como dominio ejecutable** | No hay modelo/tabla/operación de combo trazable; no deducir que múltiples extras equivalen a combos. |
| Ingredientes | **Parcial** | Se modelan como productos/insumos. No hay control de unidad/merma/valoración por lote suficiente para costeo auditable. |
| Recetas | **Parcial** | `RecipeEngine` calcula costo/capacidad a partir de `Product.recipe`; receta embebida en producto y consulta productos completos. |
| Subrecetas | **No encontrado como modelo** | No se halló grafo de recetas anidado con detección de ciclos/consumo y explosión de BOM. |
| Producción | **No implementada en motor activo** | Hay UI/hook, pero `InventoryEngine.produceBatch()` lanza `BATCH_PRODUCTION_NOT_IMPLEMENTED`; faltan consumo de receta, output, lote y costo atómicos. |
| Lotes | **No encontrado** | No se halló esquema de lotes con costo, vencimiento, FEFO, recepción/consumo y trazabilidad. |
| Mermas | **Parcial** | `LossCategory` y movimientos de inventario aparecen; no se halló ledger de merma separado con motivo, autorización, costo y aprobación/atómico. |
| Food cost | **Parcial** | Se calcula costo estimado de receta con `purchasePrice`; faltan costo por lote/último costo vs promedio, cambios históricos, merma, empaque, mano de obra y margen real verificado. |
| Inventario y kardex | **Parcial / P0** | RPC individual previa y batch+ledger nuevos conectados en código; batch no se ha probado en DB. Consumo acepta tamaños/extras y expande receta con `findMany`; otras pantallas/kardex siguen con `findAll()` y filtros JS. El permiso server-side bloquea CAJERO, así que falta venta+consumo atómicos y validación desde DB; además faltan pruebas de sucursal/RBAC y paginación. |
| Compras | **Parcial** | Orden/IA de compras existe; creación revisa duplicados leyendo todas las órdenes en cliente y recepción incrementa stock por item en llamadas separadas. |
| Proveedores | **Parcial** | CRUD/repositorios e historial existen; faltan integración de recepción atómica, precios/versionado y pagos/conciliación. |
| Mesas | **Persistencia implementada en el motor; validación real pendiente.** `TableEngine` usa `IRepository<Table>` para CRUD, conflicto optimista de ítems, apertura idempotente, comanda existente, cierre/cobro idempotentes. Los smokes multi-dispositivo/cierre/cocina pasan con repositorios fake, no contra Supabase. `TableRepository.findAll` puede devolver caché y refrescar después. |
| Pedidos | **Parcial** | Entidades de ventas/comandas y motores existen; estados y persistencia multi-dispositivo no cubren de extremo a extremo el lifecycle operativo. |
| Cocina/KDS | **Parcial** | Pantalla y transiciones están; enrutamiento configurable y durabilidad de eventos/cola requieren terminarse. |
| Impresoras/estaciones | **Parcial** | Impresión navegador/documentos y configuración existen; no hay confirmación durable ni manejo de caída de dispositivo/impresora. |
| Domicilios | **Parcial** | `DELIVERY`, dirección y tarifa aparecen en venta; no se halló gestión completa de zona, tarifa, despacho, courier y entrega. |
| Menú online / web / QR | **No encontrado como flujo transaccional completo** | No se encontró checkout público integral que tome pedido/pago y lo convierta con seguridad en orden. |
| Clientes | **Parcial** | Repositorio, perfiles e historial existen; historial trae ventas por cliente, pero campañas/consentimiento/privacidad y paginación siguen pendientes. |
| Promociones | **Parcial/no encontrado como motor** | El POS acepta descuento manual; no se halló un motor server-side de campañas, reglas, vigencias, límites e idempotencia. |
| Fidelización | **Parcial** | Hay actualización de puntos desde ventas; completar reversión atómica por devolución/cancelación, reglas versionadas y auditoría de redención. |
| Multi-sucursal | **Parcial** | `business_id`/`branch_id`, filtros y pruebas de aislamiento existen. Inventario/mesas/offline y agregados no demuestran consistencia por sucursal. |
| IA | **Asistiva, no autónoma** | Forecast/reglas y Copilot/Edge Function existen. No se certifica cadena universal IA → permiso server-side → confirmación explícita → comando validado → auditoría. Acciones revisadas son principalmente navegación/intents, no ejecución sensible completa. |

## Controles críticos: implementación exacta

| Control | Implementado | Falta para cerrar |
|---|---|---|
| Venta atómica | **Código presente; no verificado en DB.** `create_sale_fulfillment_atomic` combina venta/detalles/stock+Kardex/comanda/outbox/auditoría y ledger de idempotencia dentro de una función transaccional. | Aplicar y probar migration en Postgres aislado; demostrar errores forzados, autorización, RLS, concurrencia y E2E. Gate 1 continúa BLOCKED. |
| Pagos atómicos | **Parcial.** `register_sale_payment_atomic` bloquea venta/turno y persiste ingreso+cambio+estado en transacción. La migration local de guardia PAID exige `payment_verifications`, pero el productor POS no fue encontrado. | Verificación webhook/terminal del lado servidor y persistencia del intento; probar doble evento y cambio de estado concurrente. |
| Caja atómica | **Parcial-real.** RPCs de movimiento, pago, apertura/cierre, conteo y traslado; tests SQL. | Probar migrations aplicadas, concurrencia y segregación branch/role; no confiar en UI. |
| Inventario atómico | **Batch administrativo y fulfillment de venta presentes en árbol, ninguno validado en DB.** `adjust_stock_batch_with_kardex` conserva rol ADMIN/GERENTE/INVENTARIO; la RPC de venta consume BOM bajo autoridad de venta para CAJERO, sin otorgarle permiso de ajuste. | Ejecutar las migrations/test SQL en DB aislada; comprobar simultaneidad con stock 1, RLS, rollback y consistencia de unidades/sucursal. |
| Idempotencia | **Parcial-real.** Cash usa claves business+branch; ventas consultan id; colas generan IDs; migrations incluyen claves para pagos, caja e invoices. | Restricciones únicas en todos los comandos; las búsquedas previas cliente no evitan carreras; webhook/evento debe ser idempotente y out-of-order-safe. |
| Offline real | **Parcial local.** IndexedDB, cola y reintentos por entidades. | No hay aceptación financiera offline autoritativa; dispositivo compartido/no, conflictos, aislamiento, recuperación y reconexión multi-terminal faltan. |
| Sincronización multi-dispositivo | **Parcial.** TableEngine ya usa repositorio compartido/versionado y sus pruebas con fake pasan. No se validó dos navegadores reales contra Supabase ni refresco del grid con la caché local/realtime actual. | E2E con dos clientes/branches reales de prueba, realtime/optimistic-lock, eventos deduplicados y recuperación tras desconexión. |
| Seguridad server-side | **Parcial.** Supabase RLS; RPCs de caja con membresía/rol; Edge Functions con Service Role para integraciones. | Inventariar todas las mutaciones directas y exigir autorización server-side; proteger rol/branch y validar entradas/totales en transacción. |
| RLS/RBAC | **Código presente, despliegue desconocido.** Policies tenant y helpers `has_business_role`/`auth_business_ids`; `security-role-escalation.test.ts` y pruebas SQL. | Aplicar/verificar en BD activa; probar anon/member/mesero/cajero/admin y cross-business/branch. No afirmar “RLS completo” solo por migration. |
| Webhooks | **Parcial-real.** Wompi/MercadoPago/PayPal subscription webhooks verifican firma (según proveedor), tienen deduplicación/reconciliación parcial; hay `payments-reconcile`. | Comprobar cobertura de pagos POS, retries/replay, eventos fuera de orden, payloads persistidos y estado terminal, con tests de proveedor. |
| Payment sessions persistentes | **No.** `Map` y `localStorage`; no existe migration `payment_sessions`. | Tabla Postgres, RLS, índices idempotencia/expiry, RPC transiciones, proveedor/ref, webhook y job de expiración. |
| Auditoría | **Parcial.** `AuditEngine`, audit log y auditoría DIAN/cocina/caja. | Hacer financiero append-only, vinculado a actor/dispositivo/comando e idempotencia; migraciones/policies para impedir edición/borrado por clientes. |
| DIAN Colombia | **Parcial y bloqueada en producción.** Código UBL/XML/CUFE/firma/job y endpoint presentes; test unitario de CUFE/XML. | Habilitación, certificados y secretos externos, validación técnica/legal, pruebas end-to-end de envío/consulta/rechazo/nota crédito y backup de certificados. |
| Backups/recuperación | **No verificado.** No se encontró prueba versionada de restauración ni RPO/RTO. | Política Supabase/PITR/backups fuera de banda, restore drill, claves/certificados y recuperación de outboxes/dispositivos. |
| Manejo de errores | **Parcial.** `translateBusinessError`, ErrorBoundary, logging y mensajes existen. | `PaymentSessionManager` silencia errores de storage; eliminar fallback success-shaped, hacer visibles fallos financieros y probar fallos parciales/timeout/retry. |
| Observabilidad | **Parcial.** Sentry, `opsLogger`, funciones `ops-health-check`/`ops-monitor`, métricas y reportes programados existen. | Confirmar DSN/alertas/SLOs reales, trazas correlacionadas por sale/payment/idempotency, PII redaction y alertas ensayadas. |

## Consultas grandes: reemplazos necesarios

No se debe usar `findAll()` o `listAll()` para construir dashboards/históricos sin límite. La búsqueda estática en `src/**` encontró 168 ocurrencias en 73 archivos, incluyendo declaraciones, contratos, repositorios cache/local y consumidores. Los caminos de datos de negocio verificados que deben cambiar son:

| Camino actual | Impacto | Diseño destino |
|---|---|---|
| [`DashboardEngine.ts`](./src/core/engines/DashboardEngine.ts) carga productos, todas las ventas, clientes, cocina y alertas y calcula KPIs en navegador. | Crece con todo el histórico; manda datos irrelevantes al cliente. | RPC de snapshot por negocio/sucursal/rango, SQL aggregates y read model/cache; detalle paginado aparte. |
| [`BusinessAnalyzer.ts`](./src/core/engines/BusinessAnalyzer.ts) agrega productos, órdenes, mesas y usuarios completos para señales/IA. | Lee colecciones sin ventana ni límite antes de resumir. | Read model/RPC con filtros por business/branch/periodo; excluir PII que no requiera el análisis. |
| [`ForecastEngine.ts`](./src/core/engines/ForecastEngine.ts) usa `saleRepository.findAll()` y producto completo para forecast. | Descarga historial íntegro para ventanas cortas; forecast sesgado por incluir estados no pertinentes si no filtra. | RPC/SQL por ventana y agregados diarios/producto; materialized view solo si volumen/medición lo justifica. |
| [`SalesEngine.ts`](./src/core/engines/SalesEngine.ts) `getAllSales`, agregados y consumo de venta usan `findAll`/`listAll` en más de una ruta; [`SaleRepository.ts`](./src/infrastructure/di/repositories/SaleRepository.ts) sí ofrece filtros/estadísticas en algunos métodos. | La ruta global sigue disponible pese a alternativas SQL. | Eliminar del flujo operativo global, usar filtro server-side por rango/estado/sucursal y cursor en historial. |
| [`CashEngine.ts`](./src/core/engines/CashEngine.ts) y [`ShiftEngine.ts`](./src/core/engines/ShiftEngine.ts) recomputan resúmenes/turnos desde colecciones completas. | Costo crece con historia de caja y turnos. | RPC de cierre/snapshot con agregados SQL; cursor para auditoría/movimientos detallados. |
| [`PurchaseIntelligenceEngine.ts`](./src/core/engines/PurchaseIntelligenceEngine.ts) trae productos y ventas enteros y recalcula consumo/receta en JS. | Memoria/CPU y crecimiento lineal histórico. | SQL por consumo de 7/14 días y receta, agregación server-side con índice por sucursal/fecha/producto. |
| [`PurchaseOrderEngine.ts`](./src/core/engines/PurchaseOrderEngine.ts) lista todas las órdenes para deduplicar/filtrar y vuelve a listar productos al recibir. | Duplicidad con carrera y crecimiento por histórico; recepción hace varios ajustes. | Unicidad/RPC para crear; `receive_purchase_order_atomic`; cursor en listas. |
| [`KardexEngine.ts`](./src/core/engines/KardexEngine.ts) hace `findAll()` para historia por producto, reciente y todas las pérdidas. | Lee todos los movimientos; página de pérdidas ilimitada. | RPC/query filtrada por producto/sucursal/fecha + cursor; agregado SQL por categoría/periodo. |
| [`KitchenEngine.ts`](./src/core/engines/KitchenEngine.ts), [`OrderEngine.ts`](./src/core/engines/OrderEngine.ts) y [`ReceiptEngine.ts`](./src/core/engines/ReceiptEngine.ts) tienen listados/historiales que cargan colecciones antes de filtrar por mesa/estado/venta/fecha. | KDS activo puede crecer con órdenes históricas. | Filtrar y paginar por estación, branch, estado y ventana temporal; índices de estado/created_at. |
| [`InventoryDashboard.tsx`](./src/presentation/components/inventory/InventoryDashboard.tsx), [`Meseros.tsx`](./src/presentation/pages/Meseros.tsx), [`SalesHistoryPanel.tsx`](./src/presentation/components/shift/SalesHistoryPanel.tsx), `InsumosPanel.tsx` usan `listAll()`. | Productos, categorías, proveedores y ventas descargados completos. | `limit/cursor`, búsqueda/filtros en DB; no convertir paginación visual en descarga global. |
| [`CustomerEngine.ts`](./src/core/engines/CustomerEngine.ts), `useCustomers` y perfiles | Existe `findByCustomer`/`get_customer_purchase_stats`, pero algunas rutas cargan ventas o catálogo completo. | Cursor de historial por fecha/id; RPC de LTV/agregados por cliente. |
| `useInventory`, `useLossCenter`, `useProfitCenter`, `useReports`, hooks de cocina/productos/proveedores/categorías | Varios stores/hooks piden listas completas para filtros, catálogo y joins en JS. | Catálogo con query paginada; reportes y profit/loss como agregados SQL/read models. Mantener `findAll` solo para cache/offline local acotado y tablas realmente pequeñas. |
| `CashRegisterRepository`, repositorios de auditoría/usuarios/roles/permisos y repositorios `Pending*` | También usan `findAll`; parte son catálogos chicos o colas locales, otros historiales no están acotados. | Confirmar volumen y finalidad por repositorio; cursor para auditoría/historial, índices/estado para colas; no migrar por coincidencia textual sin medir. |
| Reportes / caja / profit/loss / IA | Código de UI/engine también consume colecciones para sumar y filtrar. | RPCs parametrizadas por periodo/sucursal/rol, SQL VIEW para consultas operativas, materialized view solo para rollups costosos; nunca millones al navegador. |

**Criterio de selección:** RPC para operaciones con autorización/consistencia o lógica parametrizada; SQL/VIEW para joins y métricas simples reutilizables; materialized view para agregado caro con estrategia probada de refresh; paginación/cursor para listas de detalle; agregado/read model para dashboard, IA y reportes. Evitar sumar `sale_total` fila por fila en JS cuando debe ser `SUM()` en SQL.

## Tablas/RPCs: estado y brechas

**Presentes en migrations/código** (falta verificar aplicación al entorno): `businesses` con `sales_channels`, `inventory_type`, `production_mode`, `kds_enabled`, `printer_enabled`; `sales`, `cash_movements`, `cash_registers`, `payment_verifications`, `shifts`, `inventory_movements`, `tables`/`TableRepository`, nueva `inventory_batch_operations`, `electronic_invoices`, `electronic_invoice_jobs`, `dian_certificates`, `daily_report_*`, suscripciones y tablas base. `TableEngine` activo no usa el repositorio. Migrations locales recientes, incluida la batch, no están verificadas como aplicadas.

**No encontradas como esquema dedicado**: `payment_sessions`; `payment_webhook_events` unificado para ventas; RPC batch multi-insumo; catálogo normalizado de variantes/modificadores/combos; recetas/subrecetas versionadas; `production_batches` y consumos; lotes/vencimientos; ledger de mermas; entregas/courier/zonas; menú público/QR checkout; promociones/redenciones. Algunas tienen estructuras parciales en JSONB/modelos TypeScript, no constraints/índices/RLS relacionales.

**RPCs disponibles relevantes:** `register_sale_payment_atomic`, `register_movement_atomic`, `close_shift_atomic`, `open_shift_atomic`, `adjust_product_stock`, `adjust_stock_with_kardex`, `adjust_stock_with_kardex_and_fields`, nueva `adjust_stock_batch_with_kardex` (no aplicada/probada en DB), `refund_sale_atomic`, `cancel_sale_atomic`, `get_customer_purchase_stats`, RPCs DIAN y de reportes. Revisar firmas y versión efectiva antes de invocar: hay migrations antiguas/nuevas con sobrecargas y reemplazos.

**RPCs/contratos a crear o completar (no duplicar funciones ya presentes):**

1. Validar/desplegar `adjust_stock_batch_with_kardex`: probar RLS, rollback, concurrencia, mismo/diferente hash; cerrar mutación de producto por rol y stock por sucursal.
2. `create_sale_fulfillment_atomic`: insertar venta/ítems, reservar o descontar stock/recetas+kardex y crear orden cocina/pedido con `idempotency_key`; falla completa si una parte falla.
3. Productor POS confiable para `payment_verifications`: evento webhook firmado e idempotente asociado a intento/venta; la guardia `PAID` ya está en migration local pero no verificada en despliegue.
4. `payment_sessions` + RPCs autenticados para crear/leer/expirar con scope tenant, transición monotónica y clave idempotente; transición webhook solo service role.
5. `receive_purchase_order_atomic`: bloquear orden, validar estado/clave, actualizar existencias+kardex+precios proveedor y cerrar recepción en una transacción.
6. `produce_batch_atomic`: consumir BOM recursiva versionada y registrar output/lote/costeo en una transacción.
7. Consultas server-side por cursor y RPCs de agregación para dashboard/forecast/kardex/reportes/IA cuando no exista ya una función equivalente.

## Archivos concretos por bloque

**P0 primero:**

- [`src/core/engines/InventoryEngine.ts`](./src/core/engines/InventoryEngine.ts), [`TableEngine.ts`](./src/core/engines/TableEngine.ts), [`PaymentEngine.ts`](./src/core/engines/PaymentEngine.ts), [`SalesEngine.ts`](./src/core/engines/SalesEngine.ts), [`CashEngine.ts`](./src/core/engines/CashEngine.ts), [`CompositionRoot.ts`](./src/infrastructure/di/CompositionRoot.ts), `IProductRepository.ts` y `ProductRepository.ts`.
- [`CashMovementRepository.ts`](./src/infrastructure/di/repositories/CashMovementRepository.ts), [`SaleRepository.ts`](./src/infrastructure/di/repositories/SaleRepository.ts), [`SupabaseRepository.ts`](./src/infrastructure/di/repositories/SupabaseRepository.ts).
- Migrations existentes `20260927230000_caja_enterprise_v2.sql`, `20260928010000_caja_enterprise_v3_integrity.sql`, `20260928193000_caja_enterprise_v4_operational.sql`, `20260930110000_harden_cash_register_select_permissions.sql`, `20260908000003_inventory_atomic_stock_kardex.sql` y `20260930190000_atomic_inventory_batch.sql`; test SQL `supabase/tests/inventory_batch_atomic.test.sql`.
- [`src/core/payments/PaymentSessionManager.ts`](./src/core/payments/PaymentSessionManager.ts), [`VimdyPayments.ts`](./src/core/payments/VimdyPayments.ts) y webhook/reconciliación de pagos.
- Edge DIAN [`dian-invoice/index.ts`](./supabase/functions/dian-invoice/index.ts), [`factus-invoice/index.ts`](./supabase/functions/factus-invoice/index.ts), UI/config de facturación, más gate de despliegue documentado; no activar prod sin certificación externa.
- Offline [`pendingSalesStore.ts`](./src/core/offline/pendingSalesStore.ts), sincronizadores `syncPending*`, servicios `offlineSale.ts`/`offlineTable.ts`.

**P1 dominio F&B:**

- [`RecipeEngine.ts`](./src/core/engines/RecipeEngine.ts), [`PurchaseOrderEngine.ts`](./src/core/engines/PurchaseOrderEngine.ts), [`KardexEngine.ts`](./src/core/engines/KardexEngine.ts), `InventoryEngine.ts`, `ProductionSection.tsx`, `InventoryDashboard.tsx`, `LossCenterDashboard.tsx`; schema/migrations nuevas para lotes/mermas/recetas solo tras revisar modelo existente.
- [`KitchenEngine.ts`](./src/core/engines/KitchenEngine.ts), `OrderEngine.ts`, `KitchenOrderRepository.ts`, [`KitchenPrinterOutput.ts`](./src/core/services/KitchenPrinterOutput.ts), [`TableEngine.ts`](./src/core/engines/TableEngine.ts), `SalesEngine.ts`; mesas y cocina deben dejar de usar side effects de memoria.
- `SupplierEngine.ts`, `PurchaseIntelligenceEngine.ts`, repositorios supplier/purchase e integración con recepción.
- DIAN provider, jobs, RLS y pruebas de homologación para habilitar operación fiscal real.

**P2/P3, después de consistencia:** `Menu`/QR/checkout público (crear la superficie si no existe), configurador de combo/promoción, modelo fidelización/reversos, `DashboardEngine`, `ForecastEngine`, `CustomerEngine`, repositorios paginados y `CopilotService`/`CommandEngine`.

## Matriz E2E de release (mínimo)

“Pendiente” significa que no se encontró un E2E de aceptación con aserciones de resultado persistido. Los tests unitarios/smoke/SQL existentes son regresiones útiles, pero no reemplazan esta matriz. Reusar módulos actuales; no crear motores paralelos.

| Escenario | Cobertura actual relacionada | E2E de release requerido |
|---|---|---|
| Restaurante con mesas + KDS | Smoke `mesa-multi-dispositivo`, `mesa-open-idempotencia` y `requiere-cocina` pasan con repositorios fake y KDS configurado explícitamente | Ejecutar en Supabase/Playwright con dos sesiones, confirmar fila/orden/pago/recibo/caja/inventario persistidos y refresco realtime. **Pendiente** |
| Restaurante sin mesas | POS genérico | Capacidad `tables=false`; venta pickup sin crear mesa y sin ruta/CTA de mesa. **Pendiente** |
| Restaurante con meseros, sin mesas | Perfil permite `waiterModeEnabled=true`/`tablesEnabled=false`; atribución POS online/offline tiene cobertura focalizada | CAJERO/GERENTE eligen responsable, cobran desde POS y verifican `waiterId` persistido y en cola offline; no debe aparecer grid de mesas. **E2E pendiente** |
| Restaurante sin cocina | Tests de `requiresKitchen` | Venta no genera comanda ni exige KDS/impresora; inventario/cobro persisten. **Pendiente** |
| Heladería | Variantes/pruebas de producto parciales | Mostrador sin cocina/mesas, tamaños/extras, costos e inventario opcional. **Pendiente** |
| Cafetería | Ninguna E2E específica | Venta de bebida y alimento con rutas distintas de cocina, modificadores, recibo y arqueo. **Pendiente** |
| Panadería con producción | Smoke de producción por tandas | Consumir receta/lote de insumos una vez, producir lote, venta descuenta output y no vuelve a consumir receta. **Pendiente** |
| Pizzería | Sin E2E específica | Tamaños, mitad/mitad si aplica, extras/combos, receta, cocina y delivery opcional. **Pendiente** |
| Comida rápida | POS genérico | Venta alta concurrencia, cola cocina, combos/modificadores y retiro. **Pendiente** |
| Dark kitchen | Sin E2E específica | Sin mesas, cocina configurable, pedidos externos/online, despacho y cierre. **Pendiente** |
| Domicilio | `SalesEngine` parcial | Zona/tarifa/dirección/estado despacho, pago y cancelación/refund; sin mesa. **Pendiente** |
| QR | Sin checkout público E2E | QR firmado/no manipulable, menú publicado, pedido, verificación de pago servidor y comanda. **Pendiente** |
| Web | Sin checkout público E2E | Menú/catálogo disponibilidad, checkout, idempotencia de reintentos y orden vinculada al tenant. **Pendiente** |
| Offline | Smoke/regression offline parcial | Desconectar antes/después de crear pedido y durante pago; indicar pending, reiniciar navegador, reconectar, reintentar y probar sin doble cargo/stock. **Pendiente** |
| Multi-sucursal/dispositivo | E2E aislamiento tenant existente; smoke multi-dispositivo | Dos sucursales y dos dispositivos con permisos distintos; no fuga ni mezcla de stock, caja, ventas o colas. **Pendiente** |
| Doble cobro | Test unitario/smoke simultáneo | Dos requests concurrentes mismos/diferentes idempotency keys; exactamente un pago/venta/caja, evidencia BD. **Pendiente** |
| Reembolso | Smoke reembolso parcial | Parcial+completo, doble webhook/retry, caja, inventario según política, saldo restante y factura/nota crédito. **Pendiente** |
| Cierre de caja | Smoke/SQL de caja | Conteo concurrente, diferencias, movimientos tardíos, segundo cierre y rol denegado. **Pendiente** |
| Inventario | Smoke/kardex | Carrera de dos ventas contra stock final, no stock negativo, un kardex por evento e idempotencia. **Pendiente** |
| Facturación electrónica | Unit CUFE/XML/preflight | Sandbox proveedor/DIAN: firma, envío, aceptación/rechazo, consulta, reintento, NC, secuencial y tenant aislado. **Pendiente** |

## Pruebas existentes y gates

- **Unit/smoke de esta tanda:** perfil/bootstrap, meseros sin mesas, atribución offline, venta POS con cocina y mesas persistentes/idempotentes: 15 tests focalizados pasan; 14 se omitieron por filtro. Typecheck y build pasan.
- **Mesas/offline:** mesa multi-dispositivo fake, apertura idempotente, KDS de mesa y cierres online J/N pasan. No ejecuté Supabase/Playwright; esto no demuestra deployment ni sincronización entre navegadores reales. Offline de mesas sigue en cola local.
- **Unit:** hay suites para atomicidad de caja, seguridad de trials/roles, offline, recetas/inventario, DIAN CUFE/XML/provider, pagos y reportes. Su presencia no prueba RPC desplegada.
- **SQL:** `supabase/tests/caja_concurrency.test.sql`, pruebas `caja_*`, reportes y suscripciones se ejecutan en SQL Editor/stack DB; no forman parte de `npm test`.
- **E2E:** 10 archivos/specs de Playwright; evidencia de E2E transaccional incompleta y fixtures dependen de entorno/datos.
- Antes de cerrar cada bloque: typecheck (`node ./node_modules/typescript/bin/tsc --noEmit`), pruebas focalizadas, `npm run build`; Playwright en cada flujo afectado. SQL contra Supabase local/entorno de prueba y verificación de migrations. No borrar/relajar pruebas.

## Orden de ejecución propuesto

**Gate activo:** cerrar Gate 1 — venta atómica server-side. No avanzar a mesas, pagos como módulo independiente, promociones ni módulos secundarios hasta que se aprueben todos sus criterios verificables.

1. **Gate 1 (activo):** validar `create_sale_fulfillment_atomic` en Postgres aislado; cerrar SQL/integración concurrente, rollback, idempotencia, autorización y E2E persistido. No abrir el Gate 2 antes del reporte explícito de Gate 1.
2. Los gates siguientes permanecen sin iniciar hasta cerrar Gate 1; esta actualización no los modifica.
3. Cerrar P1 gastronómico con APIs/entidades existentes, luego P2. Actualizar este documento por cada bloque con commit/migration/test y estado observado. Ninguna etiqueta pasa a “terminado” solo por compilar.

## GATE 1 — VENTA ATÓMICA SERVER-SIDE

**Estado: BLOCKED**

Hay evidencia parcial contra PostgreSQL 17.6 local aislado. No se declara `PASS`: faltan pruebas con rol PostgreSQL `authenticated`, carrera de inventario con stock=1, E2E POS persistido y ejecución de la cadena original de migrations. El estado de release continúa **NO APTO PARA PRODUCCIÓN**.

### Implementación en el árbol

- Migration: [`20260930193000_atomic_sale_fulfillment.sql`](./supabase/migrations/20260930193000_atomic_sale_fulfillment.sql).
- RPC: `public.create_sale_fulfillment_atomic(uuid, uuid, text, jsonb)`.
- La RPC autentica con `auth.uid()`, valida membresía, rol ADMIN/CAJERO/GERENTE, suscripción y sucursal activa. No concede al CAJERO permiso general de ajuste: `adjust_stock_batch_with_kardex` conserva su lista independiente ADMIN/GERENTE/INVENTARIO.
- El servidor obtiene precios, tamaños, extras, impuestos y recetas desde datos del negocio; ignora el precio/total/actor/tenant incluidos dentro del JSON del cliente. Valida cantidad, producto activo, configuración de inventario/cocina y configuración de sucursal.
- En la misma transacción crea venta, detalle, descuento de stock y movimientos Kardex, comanda KDS y/o printer outbox según `kitchen_enabled` + `kitchen_output_mode`, auditoría y ledger idempotente. Una excepción en venta/stock/comanda/auditoría revierte las escrituras exitosas; el handler registra el fallo en auditoría y devuelve resultado rechazado.
- Idempotencia: clave compuesta por negocio/sucursal y hash del payload; el mismo payload recupera resultado, el mismo key con payload diferente se rechaza.
- `SalesEngine.createSale` enruta primero al repositorio RPC, antes de calcular/validar la venta en frontend. El cargo de domicilio viaja para que el servidor rechace importes no configurados; no se descarta silenciosamente. El modo `deferFulfillment` se rechaza en esta ruta segura.
- El cobro permanece en el RPC existente `register_sale_payment_atomic`; el SQL/integración del Gate 1 prueba que reintentar/concurrir sobre una venta no produce más de un movimiento de pago.

### Archivos de este Gate

- [`SalesEngine.ts`](./src/core/engines/SalesEngine.ts)
- [`ISaleFulfillmentRepository.ts`](./src/infrastructure/di/repositories/ISaleFulfillmentRepository.ts)
- [`SaleRepository.ts`](./src/infrastructure/di/repositories/SaleRepository.ts)
- [`20260930193000_atomic_sale_fulfillment.sql`](./supabase/migrations/20260930193000_atomic_sale_fulfillment.sql)
- [`20261001000000_restore_core_tenant_rls.sql`](./supabase/migrations/20261001000000_restore_core_tenant_rls.sql)
- [`sale_fulfillment_atomic.test.sql`](./supabase/tests/sale_fulfillment_atomic.test.sql)
- [`core_tenant_rls.test.sql`](./supabase/tests/core_tenant_rls.test.sql)
- [`saleFulfillment.concurrent.test.ts`](./tests/integration/saleFulfillment.concurrent.test.ts)
- [`venta-fulfillment-atomic.spec.ts`](./tests/e2e/pos/venta-fulfillment-atomic.spec.ts)

### Evidencia ejecutada y pendiente

| Requisito | Evidencia actual | Resultado |
|---|---|---|
| PostgreSQL local / migrations | Un reset histórico aplicó 49 migrations hasta `20261001000000`; verificación actual de nombres halló cero IDs numéricos completos repetidos. El reset iniciado para incluir `20261002000000` seguía sin resultado después de 300 s. | Histórico: **PASS para esa cadena/estado**. Migration nueva y reset actual: **BLOCKED**, sin resultado verificable. |
| SQL venta atómica | `supabase/tests/sale_fulfillment_atomic.test.sql`, ejecutado con `psql` contra DB local y fixture Auth local. Resultado: `PASS Gate 1 sale atomicity, server price, inventory, kitchen, audit, idempotency, authorization, tenant isolation, and rollback`. | **PASS para los casos de esa suite**; no sustituye E2E ni pruebas completas como rol `authenticated`. |
| Pago simultáneo / idempotencia | Dos procesos PostgreSQL simultáneos llamaron `register_sale_payment_atomic` con la misma venta y clave. Ambas llamadas retornaron la misma clave; consulta posterior confirmó venta `PAID`, exactamente un movimiento y total COP 1.000. | **PASS para el escenario probado**. Se corrigieron cast UUID y resolución de nombres ambiguos de la RPC en `20260928010000_caja_enterprise_v3_integrity.sql`. |
| RLS / seguridad DB | `supabase/tests/core_tenant_rls.test.sql` ejecutado con `SET LOCAL ROLE authenticated`: producto/venta propia visible, producto de otro tenant oculto, CAJERO sin UPDATE directo de stock, INSERT directo a sales denegado y venta RPC permitida. `kitchen_settings.rowsecurity = true`. | **PASS para estos controles en DB local**; falta cubrir el universo de tablas/políticas y roles adicionales. |
| Concurrencia de stock | Dos conexiones reales ejecutaron `create_sale_fulfillment_atomic` en paralelo contra `stock=1`; una creó venta, la otra devolvió `INSUFFICIENT_STOCK`; verificación posterior: stock=0, una venta, un movimiento Kardex y stock no negativo. | **PASS para este escenario local**. |
| Typecheck | `node ./node_modules/typescript/bin/tsc --noEmit` | **PASS**, exit code 0. |
| Tests unitarios focalizados | `npm test -- --run tests/unit/caja-payment-consistency.test.ts` | **PASS**, 15 tests passed. Incluye que refunds CARD se bloquean antes de efectos locales; usa repositorios fake y no prueba PostgreSQL ni aprueba por sí solo Gate 1. |
| Build | `npm run build` | **PASS**, Vite completó en 55.18 s; emitió advertencia de tamaño de chunks. |
| E2E POS persistido | `tests/e2e/pos/venta-fulfillment-atomic.spec.ts` con UI real y verificación posterior en Postgres. | **BLOCKED**; el entorno API/Auth local no está arriba. |

**Corrección local de RLS:** [20261001000000_restore_core_tenant_rls.sql](./supabase/migrations/20261001000000_restore_core_tenant_rls.sql) repone lectura tenant/branch para ventas, inventario, caja y cocina; limita escritura directa de productos a ADMIN/GERENTE y activa RLS para `kitchen_settings` con lectura por sucursal. La causa raíz fue el `DROP FUNCTION ... CASCADE` de `auth_branch_ids()` en `20260909_refund_cancel_hardening_v2.sql`. Validado en la DB temporal; no desplegado.

Las pruebas SQL se ejecutaron únicamente contra el contenedor local aislado sin proyecto remoto enlazado. No se ejecutó `db push`, no se aplicó ninguna migration remota ni se tocó producción.

### Evidencia de aceptación que falta

- **Rollback:** stock insuficiente y rollback de venta parcial están cubiertos por `sale_fulfillment_atomic.test.sql`; faltan fallos inducidos específicamente en inserción de comanda y escritura de auditoría, con verificación de ausencia de efectos parciales.
- **Idempotencia:** ejecutar retry concurrente de misma clave/payload y colisión de misma clave con payload distinto; comprobar una venta, un descuento, un Kardex y una comanda como máximo.
- **Doble cobro:** el caso de la misma clave está validado (una fila, venta `PAID`); falta repetir con clave distinta contra la misma venta y validar rechazo de segundo cobro, además de reintentos tras desconexión.
- **Autorización/tenant:** ya pasó el test enfocado como `authenticated` para lectura tenant, ocultamiento de otro negocio, bloqueo de UPDATE directo de stock/INSERT directo de venta y venta autorizada vía RPC. Aún faltan pruebas de MESERO/anon denegados, branch scope y resto de tablas/policies.
- **Configuración de inventario/cocina:** la suite SQL probó producto sin inventario, receta/ingrediente, cocina OFF y salida KDS/impresora. Falta matriz adicional de producto con stock + KDS y KDS+impresora combinados, además de escenarios de estaciones.
- **E2E:** confirmar en UI y volver a leer de Postgres venta pagada, detalle, stock, Kardex, caja y comanda condicional con persistencia final.

**Criterio de salida:** mantener **BLOCKED** hasta ejecutar todas las pruebas anteriores en un entorno Supabase aislado, corregir cualquier fallo y repetir typecheck, suites, E2E y build. No avanzar al Gate 2 antes de reportar claramente el resultado.
