// src/core/entities/Entities.ts
/* ===========================================
   VIMDY CORE ENTITIES
=========================================== */

/**
 * PASO 9 (rediseño formulario de producto — Opciones): una variante de
 * tamaño que el cliente puede elegir para este producto (ej. "Pequeño",
 * "Mediano", "Grande"). `priceDelta` es lo que SUMA (o resta, si es
 * negativo) al precio base del producto al elegir este tamaño -- 0 significa
 * que no cambia el precio. Solo una opción de tamaño se elige por venta.
 */
export interface ProductSizeOption {
  readonly id: string;
  readonly name: string;
  readonly priceDelta: number;
}

/**
 * PASO 9 (rediseño formulario de producto — Opciones): un extra/adicional
 * que el cliente puede agregar a este producto (ej. "Queso", "Tocineta").
 * A diferencia de un tamaño, se pueden elegir varios extras en la misma
 * venta. `priceDelta` es lo que se suma al precio por cada extra elegido.
 */
export interface ProductExtraOption {
  readonly id: string;
  readonly name: string;
  readonly priceDelta: number;
}

export interface Product {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly name: string;
  /**
   * PASO 2 (rediseño formulario de producto — Información General): texto
   * libre y opcional que describe el producto (ingredientes, tamaño, notas
   * para el cliente/mesero). No afecta ninguna lógica de negocio, es solo
   * informativo — se puede mostrar en el POS, en el menú digital, etc.
   */
  readonly description?: string;
  readonly categoryId: string;
  /** Precio de venta al público (el que ve el cliente y usa la Caja). */
  readonly price: number;
  readonly stock: number;
  readonly minStock: number;
  readonly barcode?: string;
  /** Código interno del negocio (Stock Keeping Unit). Único si se define. */
  readonly sku?: string;
  /** Precio al que el negocio compra el producto al proveedor. */
  readonly purchasePrice?: number;
  /** Fecha de la última compra registrada a un proveedor (Aumentar stock con proveedor). */
  readonly lastPurchaseDate?: Date;
  /** Tasa de IVA aplicable en porcentaje (ej. 19 = 19%). */
  readonly taxRate?: number;
  /** Referencia a Supplier.id. Proveedor principal. */
  readonly supplierId?: string;
  /** Proveedor alternativo, por si el principal falla o tarda (PASO 2.7 — Compras Inteligentes). */
  readonly alternateSupplierId?: string;
  readonly image?: string;
  /** Unidad de medida en la que se vende (kg, unidad, litro, servicio...). */
  readonly unit?: string;
  /**
   * PASO 2 (rediseño formulario de producto — Información General): estado
   * del producto. `true`/undefined = Disponible (se puede vender), `false`
   * = Agotado. Por defecto `true` para no afectar productos ya creados.
   */
  readonly active?: boolean;
  readonly lastUpdated: Date;
  readonly createdAt?: Date;
  /** Se destaca con una estrella en el POS. Antes vivía solo en productStore. */
  readonly favorite?: boolean;
  readonly aliases?: readonly string[];
  readonly businessId?: string;
  readonly branchId?: string;
  /**
   * Receta / BOM (Bill of Materials). Si tiene items, este producto es
   * "elaborado": al venderlo, InventoryEngine.consumeForSale() NO descuenta
   * el stock propio del producto (normalmente 0 o irrelevante) sino el de
   * cada ingrediente, en la cantidad indicada por unidad vendida.
   * Ej: "Hamburguesa Premium" -> [{ productId: pan, quantity: 1 }, { productId: carne, quantity: 0.15 }]
   */
  readonly recipe?: readonly RecipeItem[];
  /**
   * BLOQUEANTE (auditoría Fase 2 — rama Panadería): un producto con
   * `recipe` puede prepararse de dos formas muy distintas y hasta ahora
   * VIMDY solo sabía hacer una:
   *
   * - `'ON_DEMAND'` (default, undefined se trata igual): "a la orden" —
   *   como una Hamburguesa de restaurante. Nunca se prepara con
   *   anticipación, así que al venderse NO se toca el stock propio del
   *   producto (normalmente 0 o irrelevante): se descuenta cada
   *   ingrediente directo (ver InventoryEngine.consumeForSale).
   * - `'BATCH'` — como el Pan de una panadería: se hornea por tandas
   *   ANTES de vender (ver InventoryEngine.produceBatch), quedando un
   *   stock propio real de unidades ya listas. Al venderse, se descuenta
   *   el stock propio del producto (igual que un producto simple) — NO
   *   los ingredientes de nuevo, porque esos ya se descontaron una sola
   *   vez al momento de producir la tanda, no en cada venta individual.
   *
   * Por defecto `'ON_DEMAND'` para no cambiar el comportamiento de ningún
   * producto con receta ya creado antes de este campo.
   */
  readonly productionMode?: 'ON_DEMAND' | 'BATCH';
  /**
   * Si este producto necesita preparación en cocina antes de poder
   * entregarse (ej. una hamburguesa) o si se entrega tal cual se vende
   * (ej. una gaseosa embotellada, un paquete de papas, una playera).
   * Es la base de la que depende TODO el enrutamiento a cocina: cuando
   * se envía una venta/pedido a cocina (ver SalesEngine.sendToKitchen,
   * TableEngine.sendToKitchen, OrderEngine.sendToKitchen), solo los
   * items cuyo producto tiene requiresKitchen !== false entran en la
   * comanda — el resto se cobra y se entrega directo, sin pasar por
   * Cocina ni generar una comanda fantasma.
   * Por defecto es `true` (undefined se trata como true) para no romper
   * productos ya creados antes de este campo: hasta que el negocio no
   * lo desmarque explícitamente en el catálogo, todo sigue yendo a
   * cocina exactamente como iba antes.
   */
  readonly requiresKitchen?: boolean;

  /**
   * Minutos estimados de preparación en cocina, solo tiene sentido cuando
   * `requiresKitchen` es true. Sirve para que cocina se organice (ver qué
   * comandas van a tardar más) y para mostrarle un tiempo estimado al
   * mesero/cliente. Opcional: si no se define, no se muestra ningún
   * tiempo — nunca se inventa un número por defecto.
   */
  readonly estimatedPrepMinutes?: number;

  /**
   * Estación de impresión/preparación de ESTE producto en particular (ej.
   * "Barra", "Postres"), cuando necesita una distinta a la de su
   * categoría. La mayoría de los productos no necesitan esto — heredan la
   * estación de `Category.printStation`. Solo se usa cuando el negocio
   * quiere una excepción puntual (ver diseño pedido: "las categorías
   * heredan, solo se cambia si algún producto necesita comportamiento
   * diferente").
   */
  readonly printStationOverride?: string;

  /**
   * PASO 9 (rediseño formulario de producto — Opciones): variantes de
   * tamaño configurables para este producto (ver ProductSizeOption). Si
   * está vacío/ausente, el producto no ofrece tamaños -- se vende tal cual
   * a `price`. NOTA: esto solo define QUÉ tamaños existen; el selector que
   * el cajero usa para ELEGIR uno al vender todavía no está construido en
   * Caja (ver PosProducts/CartEngine) -- por ahora solo se guarda en el
   * catálogo.
   */
  readonly sizes?: readonly ProductSizeOption[];

  /**
   * PASO 9 (rediseño formulario de producto — Opciones): extras/adicionales
   * configurables para este producto (ver ProductExtraOption). Mismo
   * comentario que `sizes`: por ahora es solo catálogo, la selección en
   * Caja es un paso aparte.
   */
  readonly extras?: readonly ProductExtraOption[];

  /**
   * BLOQUEANTE #2 (auditoría Fase 2) — fix: antes, "Servicio" e "Inventario"
   * se guardaban con exactamente los mismos flags (requiresKitchen=false,
   * sin receta), así que al reabrir el producto, inferProductType()
   * (ver InventoryDashboard.tsx) no tenía forma de distinguirlos y un
   * producto Servicio volvía a aparecer como Inventario.
   * `trackStock` hace explícito lo que antes era implícito: `false` =
   * este producto NO maneja stock (ej. domicilio, propina, cover) y por
   * lo tanto InventoryEngine no debe tocar ni exigir su cantidad en
   * bodega. `true`/undefined = comportamiento de siempre (maneja stock),
   * para no romper ningún producto ya creado.
   */
  readonly trackStock?: boolean;
  /** Marca explícita de productos no vendibles usados solo como insumos. */
  readonly isIngredient?: boolean;
}

/** Un ingrediente de una receta: cuánto de `productId` se consume por CADA unidad vendida del producto elaborado. */
export interface RecipeItem {
  readonly productId: string;
  readonly quantity: number;
  /**
   * true si el ingrediente se puede quitar/omitir al vender (ej. "queso
   * opcional", "sin tomate"). No cambia el costo base de la receta —
   * VIMDY sigue asumiendo que se usa por defecto — es solo información
   * para que cocina y el mesero sepan que se puede personalizar.
   */
  readonly optional?: boolean;
}

/**
 * BusinessSnapshotRecord — PASO 9 (Aprendizaje). Una "foto" diaria y
 * liviana del negocio, guardada una vez por día (id = fecha "YYYY-MM-DD").
 * PatternLearningEngine acumula estas fotos con el tiempo y, cuando hay
 * suficiente historial, las usa para detectar tendencias reales (no
 * inventadas): si las ventas van al alza o a la baja, qué producto se
 * repite como más vendido, etc.
 */
export interface BusinessSnapshotRecord {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly date: Date;
  readonly totalSales: number;
  readonly salesCount: number;
  readonly averageTicket: number;
  readonly topProductName?: string;
  readonly lowStockCount: number;
  readonly createdAt: Date;
}

export interface SaleItem {
  readonly productId: string;
  readonly quantity: number;
  readonly price: number;
  /**
   * Nota libre del cajero/mesero para este item específico (ej. "sin cebolla",
   * "con hielo", "para llevar"). Se captura en el carrito de Caja y viaja
   * hasta la comanda de Cocina y el recibo.
   */
  readonly note?: string;
  /**
   * Copia de Product.requiresKitchen tomada en el momento en que el
   * producto se agregó al carrito/pedido (ver CartEngine.addItem y
   * OrderEngine.addItem). Existe para que TableEngine y OrderEngine
   * puedan decidir qué items van a cocina SIN consultar InventoryEngine
   * directamente (tienen prohibido tocarlo por diseño — ver sus
   * cabeceras). SalesEngine, que sí puede tocar InventoryEngine, no
   * depende de este campo: siempre resuelve el producto real antes de
   * armar la comanda. Si falta (item construido a mano, sin pasar por
   * el carrito), se trata como `true` — mismo default que Product.
   */
  readonly requiresKitchen?: boolean;
  /**
   * Tamaño elegido por el cliente (ej. "chico", "mediano", "grande").
   * Opcional: si no se usa variantes, se omite.
   */
  readonly selectedSizeId?: string;
  /**
   * Extras elegidos por el cliente (ej. queso, tocineta).
   * Opcional: si no se usa variantes, se omite.
   */
  readonly selectedExtraIds?: readonly string[];
  /**
   * Unidad física del item vendido (ej. "kg", "litro", "unidad").
   * Se persiste para trazabilidad en recibos/reportes.
   */
  readonly unit?: string;
  /**
   * Cantidad física vendida (ej. 0.75 para 0.75 kg).
   * Si se envía, el recibo muestra magnitud física + precio por unidad.
   */
  readonly quantityRaw?: number;
  /**
   * Descuento aplicado solo a esta línea. Opcional.
   */
  readonly discount?: { type: "PERCENT" | "FIXED"; value: number };
  /**
   * Tasa de impuesto específica de esta línea. Si se envía, se usa para
   * calcular el IVA del item; si falta, se usa la tasa global de la venta.
   */
  readonly taxRate?: number;
}

/** Una línea reembolsada dentro de un SaleRefundRecord: qué producto y cuánto. */
export interface SaleItemRefund {
  readonly productId: string;
  readonly quantity: number;
}

/**
 * Registro de un reembolso PARCIAL aplicado sobre una venta (bloqueante
 * #3 de la auditoría). Una venta puede acumular varios de estos a lo
 * largo del tiempo (ej. el cliente devuelve un producto hoy y otro la
 * semana que viene) — por eso `Sale.refunds` es un arreglo y no un solo
 * valor. SalesEngine.getRefundedQuantities() suma todos los
 * registros para saber cuánto de cada producto ya se devolvió, y así
 * evitar que se reembolse dos veces la misma unidad.
 */
export interface SaleRefundRecord {
  readonly id: string;
  readonly items: SaleItemRefund[];
  /** Monto reembolsado en este registro puntual (no el total de la venta). */
  readonly amount: number;
  readonly reason: string;
  readonly actorId?: string;
  readonly createdAt: Date;
}

/** Tipo de venta según el canal por el que se originó. */
export type SaleType = "QUICK" | "TABLE" | "DELIVERY";

/** Estado del ciclo de vida de una venta. */
export type SaleStatus =
  | "PENDING_PAYMENT"
  | "PAID"
  | "CLOSED"
  | "CANCELLED"
  | "REFUNDED"
  | "OPEN";

export interface Sale {
  readonly id: string;
  readonly businessId?: string;
  readonly branchId?: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  /** Código legible de la venta (ej. "RAP-123456-0001"). */
  readonly code?: string;
  readonly customerId: string;
  readonly items: SaleItem[];
  readonly subtotal?: number;
  readonly tax?: number;
  readonly discount?: number;
  readonly deliveryFee?: number;
  /**
   * BLOQUEANTE (auditoría Fase 2 — rama Bar): propina voluntaria del
   * cliente. A diferencia de discount/deliveryFee (que restan/suman al
   * total ANTES de calcular el total final junto con el IVA), la propina
   * se suma DESPUÉS de aplicar IVA y descuento — no es un valor sobre el
   * que se cobra impuesto (ver SalesEngine.calculateTip/calculateTotal).
   * Ausente o 0 = venta sin propina (comportamiento de siempre, no rompe
   * ninguna venta ya creada antes de este campo).
   */
  readonly tip?: number;
  readonly total: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly type?: SaleType;
  readonly status?: SaleStatus;
  readonly tableId?: string;
  readonly cashierId?: string;
  /** id del mesero (Waiter.id, el ligero sin login) que atendió la venta, si aplica. */
  readonly waiterId?: string;
  readonly deliveryAddress?: string;
  readonly notes?: string;
  /** Método de pago utilizado al cobrar la venta. */
  readonly paymentMethod?: string;
  /**
   * Historial de reembolsos PARCIALES aplicados a esta venta (bloqueante
   * #3). Ausente o vacío = nunca se le hizo un reembolso parcial. El
   * reembolso TOTAL (SalesEngine.refundSale) no agrega registros acá:
   * simplemente pone `status: "REFUNDED"`, igual que siempre.
   */
  readonly refunds?: SaleRefundRecord[];
  /**
   * Id de la factura electrónica emitida para esta venta (Factus/DIAN u
   * otro proveedor — ver src/core/invoicing/), si aplica. Ausente = la
   * venta no tiene factura electrónica emitida (el caso normal hoy, porque
   * SalesEngine todavía no invoca InvoiceFactory al cobrar — eso es
   * trabajo de Fase 4). Existe para que refundSale()/partialRefundSale()
   * puedan bloquear la devolución de una venta ya facturada, tal como se
   * decidió con Yimid: hace falta nota crédito manual mientras tanto.
   */
  readonly invoiceId?: string;
  /**
   * Prioridad manual elegida al crear el pedido (Caja, Pedidos rápidos,
   * Para llevar, Domicilios). Ausente = tratar como "NORMAL". Viaja tal
   * cual hasta el KitchenOrder que genera SalesEngine.sendToKitchen().
   */
  readonly priority?: OrderPriority;
}

export interface Customer {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly name: string;
  readonly email: string;
  readonly phone?: string;
  readonly points?: number;
  readonly createdAt?: Date;
  readonly businessId?: string;
  readonly branchId?: string;
}

/**
 * Mesero "ligero": solo nombre, sin correo ni contraseña. Pensado para el
 * tablet compartido de un restaurante — el mesero solo toca su nombre en
 * la pantalla de Meseros, no inicia sesión. Es DISTINTO de User/rol MESERO
 * (que sí tiene login y permisos): ese sigue existiendo para quien de
 * verdad necesite cuenta con permisos (ej. también hace de cajero).
 */
export interface Waiter {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly name: string;
  readonly active: boolean;
  readonly createdAt: Date;
}

/** Estado de una cuenta de usuario. */
export type UserStatus = "ACTIVE" | "SUSPENDED" | "DELETED";

/**
 * Perfil de un miembro del personal (dueño/admin, cajero, mesero, cocina).
 * NUNCA guarda credenciales — el login real vive en Supabase Auth
 * (`business_members.role` define el rol; ver create-staff-user y
 * authBusinessContext.ts). `id` es el mismo id que `auth.users.id`.
 */
export interface User {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly name: string;
  readonly email: string;
  /** Referencia a Role.id. El rol define qué puede hacer el usuario. */
  readonly roleId: string;
  readonly status: UserStatus;
  readonly avatar?: string;
  /** Preferencias personales del usuario (tema, idioma, atajos, etc). */
  readonly settings?: Record<string, unknown>;

  readonly lastLoginAt?: Date;

  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Permiso individual e independiente (ej. "sales.create", "inventory.edit").
 * Es la unidad mínima de autorización en VIMDY: los roles agrupan permisos,
 * nunca al revés.
 */
export interface Permission {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  /** Módulo al que pertenece (ej. "sales", "inventory", "users"). */
  readonly module: string;
  readonly description: string;
}

/**
 * Un rol es un conjunto de permisos con nombre. "*" en `permissions`
 * significa acceso total (super-admin), sin necesidad de listar cada uno.
 */
export interface Role {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly name: string;
  readonly description?: string;
  readonly permissions: string[];
  /** Roles del sistema (ADMIN, CAJERO, etc) no se pueden eliminar. */
  readonly isSystem: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Sesión activa de un usuario autenticado (un login = una sesión). */
export interface Session {
  readonly id: string;
  readonly userId: string;
  readonly token: string;
  readonly ip?: string;
  readonly device?: string;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  readonly active: boolean;
  readonly closedAt?: Date;
  readonly closeReason?: "LOGOUT" | "INACTIVITY" | "REVOKED";
}

/** Registro de auditoría: quién hizo qué, cuándo y sobre qué entidad. */
export interface AuditLog {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly actorId: string;
  readonly action: string;
  readonly module: string;
  readonly entityId?: string;
  readonly description: string;
  readonly date: Date;
}

export interface CashMovement {
  readonly id: string;
  readonly businessId?: string;
  readonly branchId?: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  /** Monto total del movimiento (puede incluir medios no físicos, ej. tarjeta). */
  readonly amount: number;
  readonly type: "IN" | "OUT";
  readonly description?: string;
  readonly date: Date;

  /**
   * Medio de pago del movimiento (solo aplica a ingresos por venta).
   * Los egresos (retiros, gastos) son siempre en efectivo físico.
   * Si no se especifica, se asume "CASH" (movimientos manuales de caja).
   */
  readonly paymentMethod?: "CASH" | "CARD" | "TRANSFER" | "QR" | "MIXED";

  /**
   * Parte de `amount` que es efectivo físico real (el que debe estar en
   * el cajón). Para CASH es igual a `amount`; para CARD/TRANSFER/QR es 0;
   * para MIXED es la porción en efectivo del pago dividido; para egresos
   * es siempre igual a `amount`. Esta es la cifra que usa el arqueo de
   * turno para calcular lo "esperado en caja" — nunca `amount`.
   */
  readonly cashAmount?: number;
}

/**
 * Categoría de pérdida — PASO 2 (Motor de Producción), Centro de Pérdidas.
 * Solo aplica a movimientos DECREASE que representan una salida sin venta
 * (no se usa para descuentos por venta normal, que no son una "pérdida").
 */
export type LossCategory =
  | "MERMA"
  | "VENCIDO"
  | "CONSUMO_INTERNO"
  | "ROBO"
  | "ERROR"
  | "DAÑO"
  | "AJUSTE_ADMINISTRATIVO"
  | "OTRO";

export interface InventoryMovement {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly productId: string;
  /**
   * Nombre del producto tal como se llamaba EN EL MOMENTO del movimiento.
   * Antes no se guardaba nada acá: la pantalla de "Últimos movimientos"
   * resolvía el nombre buscando `productId` en la lista de productos
   * actuales, así que si el producto se eliminaba (o se renombraba)
   * después, el historial perdía el nombre real y mostraba el `productId`
   * (un UUID) en su lugar — dato real igual, pero ilegible. Guardarlo acá
   * es una foto fija del nombre real de ese momento, igual que ya se hace
   * con `supplierName`.
   */
  readonly productName?: string;
  readonly quantity: number;
  readonly date: Date;
  readonly type:
    | "INCREASE"
    | "DECREASE"
    | "ADJUST";
  readonly reason: string;
  /** Nombre del usuario que hizo el movimiento (auditoría). "Sistema" para movimientos automáticos (ventas, stock inicial). */
  readonly performedBy?: string;
  /** Si la entrada vino de una compra a un proveedor. */
  readonly supplierId?: string;
  readonly supplierName?: string;
  /**
   * Categoría de pérdida, solo para salidas manuales registradas desde
   * Inventario (merma, vencimiento, consumo interno, robo, error). Las
   * ventas normales (consumeForSale) nunca la traen: no son una pérdida,
   * son inventario que sí generó ingreso.
   */
  readonly lossCategory?: LossCategory;
  readonly branchId?: string;
}

/**
 * Prioridad MANUAL de una comanda, elegida por el mesero/cajero al enviar
 * el pedido (o NORMAL por defecto si no la marca). Es solo el "piso":
 * la prioridad que de verdad se muestra en Cocina (ver kitchenPriority.ts)
 * también sube sola con el tiempo de espera, sin bajar nunca por debajo
 * de lo que el mesero marcó.
 */
export type OrderPriority = "NORMAL" | "HIGH" | "URGENT";

export interface KitchenOrder {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly items: SaleItem[];
  readonly status:
    | "PENDIENTE"
    | "EN_PREPARACION"
    | "LISTO"
    | "ENTREGADO"
    | "CANCELADO";
  readonly createdAt: Date;
  /**
   * Prioridad manual (piso). Opcional solo por compatibilidad con comandas
   * guardadas antes de este campo; toda comanda nueva siempre lo trae.
   * Ausente = tratar como "NORMAL".
   */
  readonly priority?: OrderPriority;

  /** Texto descriptivo del origen del pedido (ej. "Mostrador", "Mesa 4"). */
  readonly origin?: string;
  /** id del mesero (User.id) que envió el pedido, si aplica. */
  readonly waiterId?: string;
  /** Observaciones del pedido (ej. "sin cebolla", "para llevar"). Viene de Sale.notes. */
  readonly notes?: string;
  /** Momento en que se marcó ENTREGADO. Se fija una sola vez (ver KitchenEngine.updateStatus). */
  readonly deliveredAt?: Date;
  /** Motivo de cancelación, cuando status es CANCELADO. */
  readonly cancelReason?: string;
  /**
   * Número correlativo legible del pedido (ej. 154), heredado del Order
   * que originó esta comanda. Es lo único que debe mostrarse en Cocina
   * y Meseros para identificar el pedido — nunca `id` (UUID interno).
   * Opcional solo por compatibilidad con comandas guardadas antes de
   * este campo; toda comanda nueva siempre lo trae.
   */
  readonly orderNumber?: number;
  /** id de la mesa asociada, si aplica. */
  readonly tableId?: string;
  /** id del pedido (Order) asociado, si aplica. */
  readonly orderId?: string;
  readonly businessId?: string;
  readonly branchId?: string;
}

export interface Alert {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly priority:
    | "CRITICAL"
    | "HIGH"
    | "MEDIUM"
    | "LOW";
  readonly title: string;
}

export interface Category {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly name: string;
  readonly description?: string;
  readonly active?: boolean;
  readonly createdAt?: Date;
  /**
   * Paso 3.1 (Cocina): valor de `Product.requiresKitchen` que deberían
   * traer por defecto los productos NUEVOS de esta categoría (ej. todo lo
   * de "Bebidas embotelladas" normalmente no necesita cocina, todo lo de
   * "Platos fuertes" sí). Es solo un default a nivel de categoría — el
   * Paso 3.2 lo usa para precargar `requiresKitchen` al crear/importar un
   * producto, pero el campo por producto ya existente sigue siendo la
   * fuente de verdad y se puede desmarcar/marcar individualmente sin que
   * esto lo pise.
   * Por defecto es `true` (undefined se trata como true), igual que
   * `Product.requiresKitchen`, para no romper categorías ya creadas antes
   * de este campo.
   */
  readonly requiresKitchenByDefault?: boolean;

  /**
   * Estación de impresión/preparación por defecto para los productos de
   * esta categoría (ej. "Barra", "Cocina", "Pastelería"). Texto libre que
   * define el propio negocio — VIMDY no inventa una lista fija de
   * estaciones porque cada negocio arma su cocina distinto.
   * Un producto individual puede pisar este valor con
   * `Product.printStationOverride` si necesita un comportamiento distinto
   * al resto de su categoría; si no lo pisa, hereda esta estación.
   * undefined = sin estación configurada (no se separa el ticket).
   */
  readonly printStation?: string;
}

export interface Supplier {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly name: string;
  /** Persona de contacto en el proveedor (ej. "Carlos Pérez"). */
  readonly contactName?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly address?: string;
  /** Tiempo promedio de entrega, en días, desde que se hace el pedido. */
  readonly avgDeliveryDays?: number;
  readonly active?: boolean;
  readonly createdAt?: Date;
}

/**
 * PASO 2.7 (Compras Inteligentes) — estados del ciclo de vida de una orden
 * de compra. COMPRADO y CANCELADO son finales: una vez ahí, la orden ya no
 * se puede modificar (se preserva como historial).
 */
export type PurchaseOrderStatus = "PENDIENTE" | "COMPRADO" | "POSPUESTO" | "CANCELADO";

/** Una línea de una orden de compra: cuánto se pide de un producto/ingrediente y a qué precio. */
export interface PurchaseOrderItem {
  readonly productId: string;
  readonly quantity: number;
  /** Precio unitario esperado/pactado al crear la orden. Puede ajustarse al recibir si llegó distinto. */
  readonly unitPrice: number;
}

/**
 * Orden de compra real: convierte una recomendación ("deberías comprar
 * pan") en una acción con estado, historial y trazabilidad. Al marcarse
 * como COMPRADO, PurchaseOrderEngine.markAsPurchased() reutiliza
 * InventoryEngine.increaseStock() por cada item — nunca duplica la lógica
 * de actualizar inventario.
 */
export interface PurchaseOrder {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly items: readonly PurchaseOrderItem[];
  readonly supplierId: string;
  readonly status: PurchaseOrderStatus;
  readonly createdBy?: string;
  readonly createdAt: Date;
  readonly expectedDeliveryDate?: Date;
  /** Solo se llena al marcar COMPRADO: cuándo entró de verdad al inventario. */
  readonly receivedAt?: Date;
  /** Motivo al posponer o cancelar (auditoría, igual que reason en InventoryMovement). */
  readonly statusNote?: string;
}

/** Estado del ciclo de vida de una mesa. */
export type TableStatus =
  | "FREE"
  | "RESERVED"
  | "BUSY"
  | "WAITING_FOOD"
  | "EATING"
  | "CUENTA_SOLICITADA"
  | "WAITING_BILL"
  | "PAYING"
  | "CLOSED";

export interface Table {
  readonly id: string;
  readonly businessId?: string;
  readonly branchId?: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly name: string;
  readonly capacity: number;
  readonly peopleCount: number;
  readonly status: TableStatus;
  readonly waiterId?: string;
  readonly customerId?: string;
  readonly items: SaleItem[];
  readonly subtotal: number;
  readonly tax: number;
  readonly discount: number;
  readonly total: number;
  readonly notes?: string;
  readonly zone?: string;
  /** id de la mesa con la que fue unida, si aplica. */
  readonly mergedInto?: string;
  readonly openedAt?: Date;
  readonly openOperationId?: string;
  /** id del pedido (Order) asociado a esta mesa, si existe. */
  readonly orderId?: string;
  readonly updatedAt: Date;
}

/** Origen del pedido. */
export type OrderSource = "TABLE" | "QUICK" | "DELIVERY" | "TAKEOUT";

/** Ciclo de vida operativo de un pedido (independiente del cobro). */
export type OrderStatus =
  | "DRAFT"
  | "CONFIRMED"
  | "SENT_TO_KITCHEN"
  | "IN_PREPARATION"
  | "READY"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED";

export interface Order {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly code: string;
  /**
   * Número correlativo legible del pedido (1, 2, 3...), el que de verdad
   * ve y dice en voz alta el mesero/cocina (ej. "Ya salió el 154").
   * Se calcula en OrderEngine.createOrder a partir de los pedidos ya
   * guardados, así que sobrevive a un refresh (no es un contador en RAM).
   */
  readonly orderNumber: number;
  readonly source: OrderSource;
  readonly tableId?: string;
  readonly waiterId?: string;
  readonly customerId?: string;
  readonly items: SaleItem[];
  readonly notes?: string;
  readonly status: OrderStatus;
  /** id de la comanda en KitchenEngine, una vez enviada. */
  readonly kitchenOrderId?: string;
  /** id de la venta en SalesEngine, una vez cobrada. */
  readonly saleId?: string;
  readonly cancelReason?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly businessId?: string;
  readonly branchId?: string;
}

export interface Company {
  readonly id: string;
  readonly name: string;
  readonly nit?: string;
  readonly address?: string;
  readonly phone?: string;
}

export interface DashboardData {
  readonly sales: number;
  readonly customers: number;
  readonly orders: number;
  readonly inventory: number;
}

export interface Notification {
  readonly id: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly title: string;
  readonly message: string;
  readonly createdAt: Date;
  readonly read: boolean;
}

/** Estado del ciclo de vida de un turno de caja. */
export type ShiftStatus = "OPEN" | "CLOSED";

/**
 * Representa un turno de caja: desde que un cajero abre caja con un fondo
 * inicial, hasta que la cierra y se compara lo esperado (según sistema)
 * contra lo contado físicamente.
 */
export interface Shift {
  readonly id: string;
  readonly businessId?: string;
  readonly branchId?: string;
  /**
   * Bloqueo optimista (CRÍTICO #6 del checklist): número de versión
   * de este registro en la base de datos. Lo asigna/incrementa
   * SupabaseRepository — nunca se setea a mano. Si al guardar la
   * versión ya no coincide con la de la base de datos, significa que
   * alguien más guardó primero y se lanza OptimisticLockError en vez
   * de pisar ese cambio. Opcional porque entidades creadas en memoria
   * (antes del primer save) todavía no tienen versión.
   */
  readonly version?: number;
  readonly cashierId: string;
  readonly status: ShiftStatus;

  /** Monto con el que se abrió la caja (fondo inicial). */
  readonly openingAmount: number;
  readonly openedAt: Date;
  readonly openingNotes?: string;

  /** Suma de TODOS los ingresos del turno, sin importar el medio de pago (informativo). */
  readonly totalIncome?: number;
  /** Suma de egresos registrados durante el turno (siempre efectivo). */
  readonly totalExpense?: number;
  /** Parte de totalIncome que es efectivo físico real. Es la que se usa para expectedAmount. */
  readonly totalCashIncome?: number;
  /** Ventas por medio de pago no físico durante el turno, ej. { CARD: 300000, TRANSFER: 50000 } (informativo). */
  readonly incomeByMethod?: Record<string, number>;
  /** openingAmount + totalCashIncome - totalExpense (solo al cerrar). Lo que debe haber físicamente en el cajón. */
  readonly expectedAmount?: number;
  /** Monto contado físicamente por el cajero al cerrar. */
  readonly countedAmount?: number;
  /** countedAmount - expectedAmount. Positivo = sobrante, negativo = faltante. */
  readonly difference?: number;

  readonly closedAt?: Date;
  readonly closingNotes?: string;
}