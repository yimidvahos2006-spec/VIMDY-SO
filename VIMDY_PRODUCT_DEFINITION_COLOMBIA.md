# VIMDY — Definición de producto F&B Colombia

**Fecha de corte:** 1 de octubre de 2026  
**Estado:** definición de producto para revisión; Vimdy no está declarado listo para producción.  
**Alcance:** punto de venta y gestión para negocios de alimentos y bebidas que operan en Colombia. No incluye hotelería, retail general, supermercado ni servicios.  
**Regla de evidencia:** “Existe” significa que se encontró código, UI, migration o prueba en el árbol actual. No demuestra por sí solo que esté desplegado, conectado al flujo completo, protegido en servidor o probado con datos persistidos.

## 1. VISIÓN DEL PRODUCTO

Vimdy es una plataforma operativa F&B que ayuda a vender, preparar, cobrar y controlar la operación gastronómica desde un negocio de una sucursal hasta una empresa con varias sucursales.

El producto debe ser sencillo cuando el negocio solo necesita mostrador, productos y caja, y habilitar capacidades adicionales únicamente cuando esa operación las necesita. Un tipo de negocio sirve para describir y sugerir configuración inicial; **no** debe ser la autoridad que habilita módulos. La autoridad funcional debe ser una configuración explícita por negocio/sucursal, aplicada tanto en UI como en servidor.

La fuente de verdad de pagos, ventas, caja e inventario es el servidor. El navegador puede presentar datos en caché y encolar trabajo claramente pendiente, pero no debe afirmar que dinero, stock, factura o pedido remoto quedó confirmado si no existe confirmación autoritativa.

Vimdy 100% no significa que cada negocio use cada módulo. Significa que las capacidades seleccionadas para su operación están integradas, protegidas y probadas, y que las capacidades no seleccionadas no bloquean el uso normal.

## 2. TIPOS DE NEGOCIO F&B

Tipos descriptivos permitidos para Colombia:

| Tipo | Ejemplos de perfil inicial, no de módulos obligatorios |
|---|---|
| Restaurante | Mesa, mostrador, pickup o domicilio; cocina según operación |
| Restaurante rápido | Mostrador, retiro y cocina; mesa opcional |
| Pizzería | Tamaños, receta, extras y cocina; mesa y domicilio opcionales |
| Hamburguesería | Modificadores, receta y cocina; mesa opcional |
| Cafetería / café | Bebidas, alimentos, barra/café y servicio configurable |
| Panadería | Venta de mostrador; producción por lotes y recetas cuando aplique |
| Pastelería / repostería | Productos terminados, pedidos anticipados y producción configurable |
| Heladería | Mostrador, tamaños/extras e inventario; mesas/cocina opcionales |
| Bar | Barra, mesas opcionales, turnos y control de productos |
| Bebidas / juguería | Preparación o entrega directa según producto |
| Food truck | Operación compacta, mostrador y conectividad variable |
| Dark kitchen | Sin mesas por defecto como sugerencia; cocina y despacho configurables |
| Catering | Cotización/pedido y producción programada; flujo completo aún por definir |
| Comedor / cafetería empresarial | Servicio por turnos o volumen; precios y reportes configurables |
| Cadena / multi-sucursal | Empresa con sucursales, roles, cajas, almacenes y reportes consolidados |

**Hallazgo y cambio reciente:** el onboarding ofrece tipos F&B únicamente. Los identificadores anteriores `tienda`, `hotel`, `minimercado`, `pequeno_supermercado`, `negocio_productos`, `negocio_servicios` y `otro` se conservan como valores legacy para leer negocios ya existentes, pero no se ofrecen al registrar uno nuevo. `business_type` es descriptivo; los defaults de módulos deben ser neutrales y nunca convertirse en autorización ni obligación operativa. Hay prueba unitaria focalizada para la lista y compatibilidad legacy; falta E2E de onboarding.

## 3. CONFIGURACIÓN OPERACIONAL

La configuración debe ser independiente del tipo descriptivo y permitir, por negocio y cuando el modelo lo requiera por sucursal:

| Capacidad | Decisión |
|---|---|
| Mesas | Sí / no |
| Meseros | Sí / no, independiente de mesas |
| Cocina | Sí / no |
| KDS | Sí / no, solo si cocina está activa |
| Impresora de cocina | Sí / no, solo si cocina está activa |
| Salida cocina | Ninguna / KDS / impresora / ambos |
| Inventario | Sí / no |
| Recetas | Sí / no |
| Producción | Bajo pedido / por lotes / ambas |
| Delivery | Sí / no |
| Pickup / mostrador | Sí / no |
| QR | Sí / no |
| Menú online / web | Sí / no |

**Implementado parcialmente:** `OperationConfig`, `buildBusinessOperatingProfile`, `calculateModulesFromAnswers` y `OperationSettings` representan varias de estas decisiones. El perfil de UI deriva capabilities de `enabledModules + operationConfig`; el tipo de negocio no habilita por sí mismo una capability en esa función. El modelo funcional actual no representa explícitamente QR como canal/capability ni una capability completa de menú online. Delivery/web aparecen en `SalesChannel`, pero eso no prueba un checkout público integrado. `prepStations` existe como configuración, sin garantía de asignación y routing de órdenes por estación de extremo a extremo.

**Condición de terminado:** cada configuración guardada debe rehidratarse desde servidor, gobernar rutas y acciones en cliente y ser validada por las RPC/Edge Functions relevantes. Ocultar un botón o ruta no es autorización.

## 4. EXPERIENCIA DEL DUEÑO

El dueño debe poder conocer, en un tablero claro y con periodo/sucursal visibles:

- ventas netas, número de transacciones, ticket promedio y comparación temporal;
- margen/food cost con fórmula, fecha del costo y calidad de los datos explícitas;
- productos más y menos vendidos, disponibilidad y alertas de stock;
- compras pendientes, vencimientos, diferencias de recepción y variación de costos;
- caja abierta, ventas por medio de pago, pagos pendientes, diferencias y cierres;
- empleados/turnos y actividad auditable;
- clientes recurrentes y fidelización si está habilitada;
- pedidos abiertos, tiempos y carga por estación si hay cocina;
- comparación consolidada y por sucursal;
- problemas que requieren acción, no solo gráficas;
- tendencias y pronósticos que expliquen muestra, periodo, supuestos e incertidumbre.

**Hallazgo:** existen `DashboardEngine`, métricas/reportes, `BusinessAnalyzer` y `ForecastEngine`, pero varios recorren `findAll()` y filtran/agrupan en JavaScript. Un dashboard con cifras completas no queda confiable si no excluye correctamente estados pendientes/anulados, mezcla sucursales o usa costos estimados como margen real. Los agregados y filtros de grandes volúmenes deben ser server-side.

## 5. POS

El POS debe cubrir los siguientes flujos dentro del mismo motor de pedido/venta, sin implementar una venta paralela para cada canal:

| Flujo/capacidad | Definición final |
|---|---|
| Venta rápida / mostrador | Crear pedido, confirmar disponibilidad, cobrar, persistir y emitir recibo |
| Mesa | Abrir pedido asociado a mesa, enviar cambios y cerrar/cobrar con control multi-dispositivo |
| Pickup | Registrar hora/estado de retiro y entregar al cliente |
| Delivery | Capturar datos necesarios, costo/tarifa configurada, estado de despacho y entrega |
| QR / online | Catálogo publicado, disponibilidad, pedido firmado/validado y pago servidor; no confiar en importes enviados por cliente |
| Modificadores, extras, tamaños | Precio y receta snapshot, validación server-side y reglas combinatorias |
| Combos | Componentes, opciones, precio, descuentos, impuestos e inventario explícitos |
| Descuentos | Roles/límites, motivo, cálculo servidor y auditoría |
| Propinas | Importe separado, política de distribución y conciliación explícita |
| Pagos mixtos | Componentes por medio de pago, referencias e idempotencia por operación |
| Devoluciones / anulaciones | Estados y saldos parciales, inventario, caja, evidencia del proveedor y documento fiscal correctivo |
| Factura / documento | Distinguir recibo POS, documento equivalente y factura electrónica; estado DIAN/proveedor persistido |
| Recibo | Reimpresión trazable, estado de impresión y no duplicar la venta al reintentar |

**Código observado:** hay motores de venta/pedidos, tamaños/extras, modos de venta y una RPC `create_sale_fulfillment_atomic` en una migration reciente. La RPC de venta y el RPC de pago son operaciones distintas; no se ha acreditado una transacción distribuida que permita afirmar que venta, pago externo y caja se confirman juntos. En esta definición, “venta atómica” no se confunde con “pago externo atómico”.

## 6. INVENTARIO F&B

El inventario gastronómico objetivo debe soportar:

- productos vendibles e ingredientes con unidad base y conversiones explícitas;
- recetas y subrecetas con cantidades/unidades versionadas;
- tamaños, extras y modificadores que afecten receta o consumo cuando corresponda;
- stock por sucursal y almacén; disponibilidad independiente del stock contable;
- entradas, salidas, ajustes, transferencias y Kardex inmutable;
- compras, recepción parcial/completa, diferencias y trazabilidad de proveedor;
- mermas/desperdicios con causa, responsable, costo y aprobación;
- lotes, vencimientos, trazabilidad y política de rotación cuando aplique;
- mínimos/máximos y alertas;
- producción por lotes: consumo de insumos, lote terminado, stock, costo y auditoría, todo atómico.

**Implementado parcialmente:** productos, `Product.recipe`, unidades como valor de producto, movimientos/Kardex, compras/proveedores y categorías tienen modelos/UI/repositorios. Las recetas están embebidas en JSON del producto. No se encontró un modelo completo y normalizado de unidades/conversiones, lotes/vencimientos, costeo por lote o recepción/producción completa.

**Importante sobre el árbol de trabajo:** hay una migration nueva `20261002000000_atomic_inventory_transfer_and_production.sql` y cambios recientes en `InventoryEngine`/`ProductRepository` para transferencia y producción por RPC. Se añadieron durante el turno inmediatamente anterior a esta pausa, pero el `db reset` de validación fue interrumpido y no produjo evidencia de aplicación ni prueba SQL. Se consideran **trabajo no validado**, no una capacidad lista, y no forman parte de una declaración de completitud.

## 7. COSTOS Y RENTABILIDAD

Definición de métricas:

- **Costo por receta/producto:** cantidades de ingredientes por unidad × costo de adquisición con método de valoración y fecha visibles.
- **Food cost:** costo de consumo atribuible / ventas correspondientes, con tratamiento explícito de impuestos, mermas, anulaciones y cortesías.
- **Margen:** venta neta menos costos atribuibles; no usar `purchasePrice` actual como si fuera necesariamente costo histórico de cada venta.
- **Precio sugerido:** objetivo configurable de margen, impuestos, comisiones/canal y redondeo; recomendación no autoriza cambios automáticos.
- **Variación de costos:** historial de compras y efecto en recetas/margen.
- **Mermas:** costo y porcentaje con causa, periodo y sucursal.
- **Rentabilidad:** por producto, canal, turno y sucursal solo si los datos de costos son completos y se explica la cobertura.

**Hallazgo:** `RecipeEngine` estima costo/rentabilidad/capacidad desde recetas y `purchasePrice`. No se encontró evidencia de costo histórico por lote, costeo real de producción, empaque/mano de obra/merma completo o reconciliación del margen a nivel de venta. La UI no debe llamar “utilidad real” a una estimación.

## 8. COCINA

La cocina debe poder recibir una comanda idempotente y persistida; distinguir estados y prioridades; medir tiempos; y separar preparación por estación (barra, plancha, fritura, café, postres y despacho). KDS, impresoras o ambas deben ser capacidades opcionales. Reimpresiones, caída de dispositivo, acknowledgements y recuperación deben ser trazables y no duplicar órdenes.

**Código observado:** hay órdenes de cocina, items, estados, UI KDS, selección de salida y tabla/outbox de trabajos de impresora en la ruta de fulfillment. La RPC reciente permite configuración de cocina y genera comanda/job según configuración. Falta demostrar de extremo a extremo que el dispositivo recibe, confirma, recupera y no duplica; estaciones/routing y operación real de hardware no quedan validados por tener UI, filas SQL o impresión del navegador.

## 9. MESAS Y MESEROS

El flujo de mesa debe permitir abrir, editar, enviar a cocina, mover, fusionar, dividir mesa, dividir productos/cuenta, cambiar mesero y cerrar/cobrar con control de versión y conflicto multi-dispositivo.

**Estado:** existe modelo/UI/engine/repository y trabajo reciente para persistencia/idempotencia en TableEngine. Los tests reportados para esta tanda usan fakes/in-memory; no demuestran persistencia real, realtime ni sincronización entre dos navegadores conectados al backend. Offline de mesa puede encolar cambios y no es una garantía de cobro o liberación financiera. Este módulo es opcional; el flujo sin mesas debe ser igualmente válido.

## 10. CLIENTES Y CRECIMIENTO

El núcleo esperado es cliente, historial consultable y privacidad/consentimiento adecuados. Como capacidades posteriores se definen puntos, promociones, cupones, recompensas, gift cards, referidos y segmentación, con reversión por cancelación/refund y auditoría de redenciones.

**Estado:** `CustomerEngine`, repositorio, perfiles/historial y puntos existen parcialmente. No se verificó un motor completo server-side de campañas, cupones, gift cards, referidos o segmentación; ni reversión integral de puntos ante reversos. La carga de clientes/ventas debe paginarse.

## 11. PAGOS Y CAJA

Debe distinguirse entre pago local registrado, autorización/captura del proveedor, abono a caja, conciliación y reembolso.

Requisitos de producto:

- efectivo, tarjeta, transferencia y QR; pago mixto con componentes persistidos;
- sesión de pago persistente con estado, caducidad y referencia externa;
- estados monotónicos e idempotentes: pendiente, aprobado, rechazado, cancelado, expirado, reembolso parcial/total;
- webhooks autenticados/verificados, idempotentes y reintentables;
- protección frente a doble cobro con la misma y con distinta clave;
- conciliación interna contra proveedor y contra movimientos de caja;
- apertura/cierre de turno y caja, conteo/arqueo y diferencias auditables;
- ninguna operación financiera crítica depende de memoria de navegador/proceso.

**Hallazgos:** hay RPCs de caja/turnos/pagos; `PaymentSessionManager` conserva sesión en `Map` y `localStorage`, no en una tabla autoritativa. Wompi, Mercado Pago y PayPal tienen funciones server-side de checkout/webhook/refund en el árbol, pero ello no verifica credenciales, despliegue, contrato ni conciliación real. Mercado Pago/PayPal tienen comentarios que identifican endpoints faltantes en parte de la implementación. Se corrigió `PaymentEngine.refund/refundAmount` para que no declaren éxito sin ejecutar un reembolso; además, `SalesEngine` bloquea antes de mutaciones los refunds de método distinto a CASH, que requieren confirmación real del proveedor. El refund en efectivo sigue siendo un conjunto de escrituras no atómicas, y la guardia `PAID`/`payment_verifications` requiere productor confiable y prueba de proveedor real.

## 12. MULTI-SUCURSAL

La empresa debe gestionar sucursales, cajas, almacenes, cocinas, dispositivos, usuarios, roles y permisos. Los precios pueden compartirse o diferenciarse según política; inventario y ventas deben ser por sucursal; reportes deben poder filtrarse y consolidarse sin perder origen.

**Implementado parcialmente:** `business_id`/`branch_id`, membresías, roles, policies/RPCs y filtros de repositorio existen. No se considera completo mientras haya lecturas masivas con filtros en JS, operaciones offline sin conflicto/scope verificado, u operaciones multi-sucursal sin test real de aislamiento por branch y rol.

## 13. OFFLINE

| Offline permitido | Estado final requerido |
|---|---|
| Ver catálogo previamente sincronizado | Mostrar fecha/estado de frescura |
| Preparar pedido o borrador | Identificarlo como local/no enviado |
| Operaciones no financieras que tengan política de conflicto | Encolar idempotentemente y mostrar sincronización pendiente |
| Cobro en efectivo desconectado | Solo si se aprueba un protocolo de riesgo explícito; nunca mostrar conciliado/servidor confirmado antes de sync |
| Tarjeta/QR/transferencia de proveedor | No confirmar sin respuesta verificable del proveedor |
| Cierre de caja y refund | No cerrar/reembolsar como confirmado offline |

La sincronización debe persistir el outbox, usar claves estables, reintentar de forma segura, ser idempotente server-side, detectar conflicto de stock/turno/mesa, identificar fallos permanentes y permitir resolverlos sin duplicar dinero/stock. Una cola en IndexedDB no equivale a una base compartida, transacción distribuida ni garantía de multi-dispositivo.

**Implementado parcialmente:** colas IndexedDB para ventas, inventario, mesas, clientes y cocina, con estados de sync/retry. No se validó el ciclo completo con caída de red, reinicio de navegador, conflicto, dispositivos concurrentes y verificación de dinero no duplicado. La promesa de venta offline todavía debe distinguir claramente venta pendiente de venta cobrada/confirmada.

## 14. DIAN / COLOMBIA

El alcance colombiano es facturación electrónica/documentos aplicables a F&B en Colombia, con identificación del emisor, impuestos, consecutivos, representación, firma, envío, respuesta, consulta, contingencia y documentos correctivos según el flujo que corresponda. Debe distinguirse recibo de venta de factura/documento aceptado.

**Código:** existen builders XML, firma/certificados, SOAP DIAN y Edge Functions `dian-invoice` y `factus-invoice`; hay migrations de certificados, jobs y hardening. El código marca producción DIAN como bloqueada por `PRODUCTION_BLOCKED`; Factus tiene rutas no implementadas para algunos casos (por ejemplo cancelación de factura no validada devuelve HTTP 501).

**BLOCKED_EXTERNAL:** credenciales, certificado vigente y contraseña, autorización/habilitación DIAN, resolución/rangos, proveedor tecnológico/contrato si se usa, secretos de despliegue y pruebas de homologación/producción. El código local no sustituye esos requisitos. No declarar facturación de producción lista mientras no exista evidencia externa real y legal.

## 15. SEGURIDAD

Condiciones obligatorias:

- aislamiento por tenant y sucursal en SQL/RPC, no solo filtros frontend;
- RLS en tablas sensibles, pruebas negativas con `anon` y roles autenticados;
- RBAC y autorización de negocio/sucursal dentro de cada RPC/Edge Function;
- revisión de capacidad/módulo en servidor para operaciones restringidas;
- auditoría de operaciones críticas con actor, scope, resultado y correlación idempotente;
- secretos únicamente server-side, rotación y separación sandbox/producción;
- operación financiera con amount/moneda/venta validados server-side, autorización de proveedor y reconciliación;
- fallar explícitamente ante falta de contexto, permisos o proveedor; no convertir error en éxito.

**Hallazgo:** existe hardening RLS/RBAC en migrations, roles y funciones `has_business_role`/`auth_business_ids`/`auth_branch_ids`, y RPCs de caja/venta. Se reportó que pruebas de SQL locales selectivas pasaron, pero eso no certifica todas las políticas ni el despliegue. La configuración de capacidades no es un sustituto de RBAC. El árbol contiene migrations recientes con cambio de protección de tender/pago cuya aplicación local y vigencia deben verificarse antes de release.

## 16. IA DE VIMDY

La IA debe analizar datos del negocio, explicar métricas, detectar anomalías, predecir con incertidumbre, recomendar y proponer acciones revisables. Las consultas de millones de filas no deben construirse enviando todas las entidades al LLM ni descargándolas al navegador.

Para acciones:

`IA propone → servidor valida permiso/política → usuario confirma explícitamente → comando tipado/idempotente → servidor ejecuta → auditoría registra`

**Estado:** `BusinessAnalyzer`, `ForecastEngine`, `CopilotService`/tipos y `CommandEngine` existen. `CommandEngine` observado convierte lenguaje en navegación e intents locales deterministas; no constituye por sí solo una cadena de ejecución sensible con autorización, confirmación, comando servidor y auditoría. El análisis actual usa `findAll()` en varias fuentes y filtra/agrega en cliente. La ejecución autónoma financiera no es una capacidad aceptada.

## 17. EXPERIENCIA DE USUARIO

La experiencia final debe reducir pasos, mostrar rutas y acciones claras, ofrecer estados vacíos que enseñen el siguiente paso, errores accionables y no ocultar errores de persistencia. El onboarding debe terminar en negocio/sucursal/configuración/primer producto/caja con estados guardados y recuperar sesión/logout de manera fiable.

Debe validarse en móvil, tablet y computador, en tamaños reales de pantalla y condiciones de red distintas. Navegación, botones, permisos, menús, modales, confirmación de cobro, impresión y errores deben compartir estados con el servidor.

**Estado:** React 19 con rutas/componentes funcionales, wizard de onboarding, auth/OTP, ajustes operacionales y layouts responsive existen. El E2E de POS del historial terminó en login con “Correo o contraseña incorrectos”; no llegó a ejecutar venta/persistencia. Por tanto, no hay evidencia de flujo completo de usuario nuevo en UI.

## 18. DIFERENCIACIÓN

La diferencia buscada no es afirmar superioridad, sino combinar configuración F&B por capacidad y datos confiables con flujo operativo sencillo. Posibles ventajas a construir y probar:

- perfil pequeño que no obliga a inventario/mesas/cocina;
- extensión progresiva a recetas, producción y multi-sucursal sin cambiar de sistema;
- seguridad y trazabilidad para venta, caja, inventario y pago;
- métricas de margen basadas en costos y calidad de datos explícitos;
- sincronización resiliente sin aparentar cobros confirmados;
- soporte colombiano y flujo DIAN solo cuando esté habilitado legal y técnicamente.

**Límite de esta auditoría competitiva:** no se afirma que una función sea exclusiva de Vimdy ni se atribuyen características no verificadas a competidores. La navegación de fuentes externas durante esta tarea no permitió obtener páginas verificables de Fudo/Vendty/Siigo. La página oficial de Poster accesible en esta consulta enlaza contenido sobre reportes/ventas, ABC, bonos, fichas tecnológicas y QR menú, pero es evidencia promocional/testimonial del proveedor, no una comparación funcional independiente ni prueba de disponibilidad en Colombia. Para una comparación competitiva formal se requieren fuentes oficiales actuales por producto/plan/país y prueba del flujo comprado; hasta entonces, no usar claims de competidor en marketing.

| Referencia consultada | Evidencia disponible en esta revisión | Qué no se concluye |
|---|---|---|
| [Poster](https://joinposter.com/) | Página oficial alcanzada; un testimonio enlazado menciona reportes/ventas, ingresos/utilidad, saldos, análisis ABC, bonos, fichas tecnológicas y menú QR. | Disponibilidad, precio/plan y soporte para Colombia/DIAN no verificados; el testimonio no es una prueba independiente. |
| [Fudo Colombia](https://www.fudo.com.co/) | La página no se pudo recuperar desde esta sesión (host no resuelto). | No se le atribuye ninguna función específica. |
| [Vendty](https://www.vendty.com/) | La página devolvió HTTP 403 en esta consulta. | No se le atribuye ninguna función específica. |
| [Siigo POS](https://www.siigo.com/pos/) | La ruta consultada devolvió HTTP 404. | No se le atribuye ninguna función específica. |

La categoría de POS gastronómico que Vimdy define como objetivo suele evaluarse por velocidad de caja, catálogo/modificadores, mesas/comandas, reportes e inventario; esta lista es un marco de evaluación del producto, no una afirmación de que cada competidor ofrezca cada función ni de que Vimdy ya la complete. En el código de Vimdy se hallaron POS/caja, recetas básicas, KDS, pagos y reportes parciales; las brechas concretas están clasificadas en la matriz anterior. Un benchmarking por competidor, plan y país queda pendiente de fuentes accesibles y verificadas.

## 19. DEFINICIÓN DE TERMINADO — VIMDY 100%

Release Candidate Colombia solo se declara cuando las capacidades incluidas en el perfil de release están:

- **IMPLEMENTADAS:** lógica completa de dominio/UI/servidor y requisitos F&B acordados; sin stub, placeholder o botón sin acción.
- **INTEGRADAS:** un único flujo de pedido/venta y repositorios/RPCs coherentes; pagos, inventario, caja, cocina y documentos no divergen.
- **PROBADAS:** unit/integration, SQL con Postgres real aislado, concurrencia y E2E UI con lectura posterior de datos persistidos. Un test omitido es pendiente, nunca PASS.
- **SEGURAS:** tenant/branch, RLS/RBAC negativos, permisos server-side, verificación de webhooks, secretos y auditoría probados.
- **PERSISTENTES:** reinicio, retry, doble envío, error intermedio y rehidratación multi-dispositivo no pierden ni duplican información financiera.
- **ESCALABLES:** límites, paginación/cursor para detalles, agregados server-side para dashboard/IA/reportes y consultas revisadas con volumen representativo.
- **DOCUMENTADAS:** límites, configuración por capacidad, recuperación, operación, integraciones externas, rollback y evidencia de gates actualizados.

La matriz mínima de acceptance debe cubrir: restaurante con mesas+KDS, mesas+impresora, sin mesas+KDS, sin cocina, solo delivery, comida rápida, pizzería, cafetería, panadería con producción, heladería, dark kitchen, food truck, múltiples sucursales, doble cobro, refund, cierre de caja, inventario, onboarding, offline y facturación. Cada escenario debe terminar con evidencia de persistencia/denegación esperada.

**No es terminado:** compilar, mostrar UI, pasar solo tests fake, crear migration sin reset desde cero, registrar webhook sin validar firma, marcar pago aprobado desde cliente o probar únicamente un tenant/rol feliz.

## 20. MATRIZ FINAL

Estados descriptivos de auditoría: **Sí**, **Parcial**, **No**, **No probado**, **Externo**. “Completa/Integrada/Probada” requieren evidencia de extremo a extremo; no se infieren de compilación.

| Área | Existe | Completa | Integrada | Probada | Falta | Prioridad |
|---|---|---|---|---|---|---|
| Tipos F&B / alcance | Sí; catálogo también tiene sectores fuera de alcance | No | Parcial | Parcial | Limitar oferta a F&B y conservar tipo como descripción | P1 |
| Perfil operativo / capacidades | Sí; módulos y OperationConfig en UI/core | Parcial | Parcial | Tests de perfil; no toda autorización server-side | QR/menú online, validación de capabilities en backend y flujo de cada perfil | P0/P1 |
| Onboarding / primer usuario | Sí; auth, OTP, wizard, negocio y configuración | Parcial | No demostrado | E2E falló en login; flujo de primer usuario pendiente | E2E desde registro hasta cierre, errores/rehidratación y aislamiento | P0 |
| POS / venta | Sí; engines y RPC de fulfillment | Parcial | Parcial; pago es operación separada | SQL local selectivo reportado PASS; Playwright no llegó a vender | E2E persistido final y vínculo consistente con pago/caja | P0 |
| Pagos / sessions | Sí; engines/providers/Edge Functions | No | Parcial | No probado end-to-end con proveedor | Sessions server-side, no doble cobro, webhook, refund y conciliación real | P0 |
| Caja / turnos | Sí; engines/RPCs/migrations | Parcial | Parcial | Pruebas SQL/locales selectivas; matriz integral no probada | Confirmar cadena aplicada, concurrencia, reconciliación y E2E | P0 |
| Productos / catálogo | Sí; Supabase + caché local | Parcial | Parcial | Unit tests tienen fallos observados | CRUD seguro, paginación/búsqueda y política de historial | P0/P1 |
| Variantes / tamaños / extras | Sí; JSON y UI | Parcial | Parcial | No acceptance persistida completa | Snapshot server-side de precio/receta/consumo | P1 |
| Combos | No como dominio verificable | No | No | No | Modelo/flujo si se confirma como requisito de release | P2 |
| Recetas / ingredientes | Sí; receta embebida y expansión en engine | Parcial | Parcial | Casos unitarios; evidencia DB limitada | Unidades, conversiones, versionado, subrecetas, costo auditable | P1 |
| Producción / lotes | UI y trabajo RPC nuevo en árbol | No | No validado | No; migration de 20261002 no aplicada por prueba | Batch, lotes, vencimiento, consumo/output/Kardex/auditoría probados | P1 |
| Inventario / Kardex / mermas | Sí; RPC individual, batch en migration reciente, categorías de pérdida | Parcial | Parcial | SQL reportado para venta; batch nuevo pendiente | Validar atomicidad, tenant/branch, lotes, merma y paginación | P0/P1 |
| Transferencias | Trabajo nuevo en árbol | No probado | No probado | No | Migration/RPC y tests locales aún sin resultado | P1 |
| Compras / proveedores | Sí; órdenes, repositorios y sugerencias | Parcial | No; recepción itemizada/separada | No end-to-end | Recepción atómica, costo proveedor/historial, autorización | P1 |
| Cocina / KDS / impresión | Sí; UI, RPC de venta, cola/impresora | Parcial | Parcial | Matriz SQL local selectiva; hardware no | ACK/recuperación, estaciones y E2E configuración/hardware | P1 |
| Mesas / meseros | Sí; UI/engine/repositorio y operaciones offline | Parcial | Parcial | Fakes/smokes; no multi-dispositivo real acreditado | Conflictos/versionado/realtime y cierre persistido E2E | P1 |
| Pickup / delivery / canales | Sí; tipos de canal y campos de venta | Parcial | Parcial | No flujo E2E completo | Zonas, tarifas, despacho, lifecycle y canal unificado | P1 |
| Menú web / QR | Parcial como configuraciones/canales; checkout completo no hallado | No | No | No | Catálogo publicado y pedido/pago server-side | P2 |
| Clientes / fidelización | Sí; CRUD/historial/puntos parciales | No | Parcial | No aceptación completa | Consentimiento, reglas, reversos, campañas/cupones/gift cards | P2 |
| Multi-sucursal | Sí; tenant/branch/roles | Parcial | Parcial | Pruebas RLS selectivas reportadas | Pruebas completas de branch isolation/operación consolidada | P0/P1 |
| Reportes / escala | Sí; Dashboard/Forecast/Analyzer/RPCs | Parcial | Parcial | Unit/SQL selectivos | Eliminar full scans client-side, cursor/aggregates y validar volúmenes | P0/P1 |
| IA | Sí; analyzer/forecast/copilot/commands | Parcial | No para acción sensible completa | Parcial | Datos agregados y pipeline permiso-confirmación-comando-auditoría | P2 |
| Offline / sincronización | Sí; colas locales IndexedDB | Parcial | No demostrado multi-dispositivo | Regresiones/smokes, no ciclo real completo | Política financiera, conflictos, reinicio, idempotencia y replay real | P0 |
| DIAN / facturación | Sí; XML/firma/Edge Functions y Factus | Parcial | Parcial | Unit/preflight; homologación/producción no | Certificados, habilitación/proveedor, sandbox/UAT y aceptación real | P0 externo |
| Seguridad / auditoría | Sí; RLS/RBAC, RPCs y logs | Parcial | Parcial | SQL selectivo en Postgres local reportado | Matriz por rol/tabla/sucursal, autorización capability, revisión deployment | P0 |
| Observabilidad / recuperación | Parcial; health/monitor/logging | No demostrada | Parcial | No evidencia restore/RPO/RTO | Alertas, backups y restauración ensayados | P0 |
| E2E / release | Playwright y SQL tests existen | No | No | E2E POS falló antes de venta; última prueba de reset fue interrumpida | Matriz completa con evidencia persistida y gate documentado | P0 |

### A. YA ESTÁ

- Aplicación React/TypeScript con dominios de caja, venta, productos, inventario, clientes, cocina, reportes, autenticación y onboarding.
- Configuración operativa explícita para varias decisiones (mesas, cocina, salida de cocina, inventario, canales y producción).
- Repositorios Supabase con filtros de tenant/branch, RLS/RBAC y RPCs atómicas existentes en el código/migrations.
- Motores/modelos de recetas, tamaños/extras, pedidos, clientes, turnos y colas offline.
- Integraciones/código de proveedores de pago y de facturación; su presencia no prueba credenciales o habilitación.

### B. ESTÁ INCOMPLETO

- E2E de primer usuario y venta POS con lectura posterior de Postgres.
- Integración indivisible de venta, tender, caja y confirmación de proveedor.
- Sesiones financieras persistentes server-side y conciliación de todos los estados/reintentos/refunds.
- Inventario F&B con unidades, valoración, lotes, mermas y producción verificables.
- Mesas, kitchen output/hardware, multi-sucursal y offline con persistencia/conflicto real.
- Métricas de rentabilidad fiables y consultas paginadas/agregadas para escala.
- Certificación de seguridad completa y evidencia de backup/restore.

### C. ESTÁ MAL O ES INCONSISTENTE

- El catálogo de tipos ofrece tipos no F&B prohibidos por el alcance actual.
- Parte de la interfaz/engine puede presentar éxito local o guardar estado sin evidencia del proveedor; un `success: true` no significa pago real.
- Las capacidades configurables en frontend no garantizan que RPC/Edge Function aplique la misma policy.
- Métodos `findAll()` y filtros/agrupaciones en JavaScript descargan colecciones completas en dashboard, forecast, inventario, Kardex, caja, compras, clientes y análisis.
- Costos estimados pueden no representar costo histórico de los insumos usados en la venta.
- Existen documentos de estado con afirmaciones históricas contradictorias sobre migrations, DB temporal y E2E; deben considerarse la evidencia fechada y la última ejecución, no una frase antigua aislada.

### D. FALTA

- Matriz E2E y SQL integral por perfil operativo, rol, tenant, sucursal, red y resultado persistido.
- Combos/modificadores como operación server-side completa si se aprueban para el release.
- Versionado de recetas/subrecetas, unidades/conversiones, lotes/vencimientos, costeo y recepción/producción atómicos.
- Canales web/QR públicos y delivery con el mismo motor de pedido, si quedan en el alcance del primer release.
- Agregación/paginación/cursor, observabilidad operacional y práctica documentada de restauración.

### E. NO NECESITAMOS PARA EL PRIMER RELEASE

- Hotel, supermercado, minimercado, retail genérico y servicios.
- Expansión internacional y reglas fiscales de otros países.
- IA autónoma, análisis avanzado de visión/voz o ejecución directa de acciones sensibles.
- Loyalty avanzada, referidos, gift cards, campañas sofisticadas y funcionalidades de marketplace, salvo que se definan expresamente como requisito de piloto.

### F. DEPENDE DE EXTERNO

- DIAN en producción: habilitación, resolución/consecutivos, certificado vigente/clave, configuración de emisor y pruebas legales/técnicas requeridas.
- Wompi/Mercado Pago/PayPal: cuentas activas, credenciales server-side, webhooks registrados/firmados, permisos de refund y conciliación en sandbox/UAT/prod.
- Impresoras, cajones/dispositivos y hardware de cocina: modelos, drivers/red, acceso y pruebas en hardware real.
- Hosting/Supabase de producción: secretos, dominio, backups/PITR, monitorización, límites y procedimiento de recuperación.

Hasta aportar y verificar cada dependencia, el área correspondiente permanece **BLOCKED_EXTERNAL**; no se sustituye por una respuesta simulada.

## Evidencia revisada y límites de esta definición

- Código de perfil operativo, configuración de negocio/tipos, motores de inventario/pagos/venta/caja/mesas/Kardex/reportes/forecast/IA, repositorios Supabase/offline, Edge Functions de pago/DIAN y migrations/tests en el árbol.
- `VIMDY_RELEASE_STATUS.md` y `VIMDY_MASTER_RELEASE_PLAN.md`, que incluyen resultados de pruebas anteriores. Se conservaron como afirmaciones históricas y se actualizaron aquí cuando el historial más reciente las contradice.
- Evidencia reciente previa a esta definición: E2E POS alcanzó Login y falló antes de autenticar; `tests/unit/inventoryEngine.test.ts` reportó 3 pasados/6 fallidos en la última ejecución; `tsc --noEmit` terminó con heap agotado (exit code 134). El intento más reciente de `supabase db reset --local --no-seed`, iniciado antes de esta solicitud, seguía sin resultado tras 300 segundos; no aporta resultado para la migration nueva de transferencia/producción. Tras actualizar el selector F&B se ejecutaron los tests de tipos/perfil: 8 pasaron.
- Ninguna prueba nueva de producto se ejecutó para crear este documento. No se inspeccionaron ni copiaron secretos de `.env`; no se ejecutaron migraciones remotas ni se tocó producción.
- La revisión de páginas de competidores fue limitada: algunos hosts no fueron accesibles o devolvieron error; solo se conserva el reclamo del sitio oficial de Poster alcanzado en la sesión como evidencia débil y promocional. No es benchmarking independiente.
