/**
 * dictionaries.ts
 * ---------------------------------------------------------------------------
 * Diccionario de traducciones ES/EN/PT. Arranca con las claves de
 * Configuración y del selector de país (donde vive el cambio de idioma) —
 * se va ampliando pantalla por pantalla agregando más claves acá y usando
 * t("clave") en el componente, sin tocar el store ni el hook.
 */

// IMPORTANTE (rendimiento): solo el español vive en el paquete principal
// (es el idioma por defecto y el respaldo de todo). Inglés y portugués están
// en archivos aparte (dictionaries.en.ts / dictionaries.pt.ts) y se descargan
// únicamente cuando el negocio usa ese idioma.

const es = {
  "settings.title": "Configuración",
  "settings.subtitle": "Aquí configuras tu negocio. Elige una sección y toca Guardar al terminar.",

  "settings.business.title": "Datos del negocio",
  "settings.business.description": "Nombre, NIT y contacto. Salen en el ticket y en los reportes.",

  "settings.globalization.title": "País, idioma y hora",
  "settings.globalization.description": "Para que las fechas, la hora y el dinero se vean como en tu país.",

  "settings.taxCurrency.title": "Impuestos y moneda",
  "settings.taxCurrency.description": "IVA, propina o servicio y meta diaria. Se usan desde la próxima venta.",

  "settings.operation.title": "Operación",
  "settings.operation.description": "Enciende solo lo que usas: mesas, cocina, domicilios. Lo demás se oculta.",

  "settings.field.country": "País",
  "settings.field.currency": "Moneda",
  "settings.field.language": "Idioma",
  "settings.field.timezone": "Zona horaria",
  "settings.field.tax": "IVA (%)",
  "settings.field.serviceCharge": "Cargo por servicio (%)",
  "settings.field.dailyGoal": "Meta de ventas diaria",

  "settings.save.taxes": "Guardar impuestos",
  "settings.save.business": "Guardar datos del negocio",
  "settings.save.operation": "Guardar operación",
  "settings.save.globalization": "Guardar",
  "settings.saved": "Guardado",

  "country.title": "Elige tu país",
  "country.subtitle": "Así configuramos el idioma, la moneda y la hora de VIMDY para ti.",
  "country.searchPlaceholder": "Buscar país...",
  "country.noResults": "No encontramos ese país.",
  "country.detected": "Detectamos que estás en",
  "country.continue": "Continuar",
  "country.change": "Puedes cambiarlo después en Configuración.",

  "dashboard.section.indicators": "Indicadores principales",
  "dashboard.section.quickActions": "Acciones rápidas",
  "dashboard.section.activity": "Actividad reciente",

  "dashboard.indicator.sales": "Ventas",
  "dashboard.indicator.profit": "Ganancia",
  "dashboard.indicator.profitToday": "Ganancia real de hoy",
  "dashboard.indicator.cash": "Caja",
  "dashboard.indicator.cashMovedToday": "{amount} movidos hoy",
  "dashboard.indicator.orders": "Pedidos",
  "dashboard.indicator.health": "Salud del negocio",
  "dashboard.indicator.analyzing": "Analizando…",
  "dashboard.indicator.trend.noYesterdayData": "Sin datos de ayer",
  "dashboard.indicator.trend.newToday": "Nuevo hoy",
  "dashboard.indicator.trend.sameAsYesterday": "Igual que ayer",
  "dashboard.indicator.trend.vsYesterday": "{change} vs ayer",

  "dashboard.quickAction.newSale": "Nueva venta",
  "dashboard.quickAction.newCustomer": "Nuevo cliente",
  "dashboard.quickAction.newProduct": "Nuevo producto",
  "dashboard.quickAction.newOrder": "Nuevo pedido",

  "dashboard.activity.waiterOfDay": "Mesero del día",
  "dashboard.activity.live": "En vivo",
  "dashboard.activity.empty": "Todavía no hay actividad. En cuanto pase algo en el negocio, aparece aquí.",
  "dashboard.activity.justNow": "ahora mismo",
  "dashboard.activity.secondsAgo": "hace {seconds}s",
  "dashboard.activity.minutesAgo": "hace {minutes} min",
  "dashboard.activity.hoursAgo": "hace {hours} h",

  "dashboard.gerente.title": "Gerente Inteligente",
  "dashboard.gerente.subtitle": "Recomendaciones accionables para tu negocio",
  "dashboard.gerente.analyzing": "Analizando tu negocio…",
  "dashboard.gerente.notEnoughData1": "Aún no tengo suficiente información para generar recomendaciones.",
  "dashboard.gerente.notEnoughData2": "Sigue registrando ventas para comenzar a ayudarte.",
  "dashboard.gerente.allGood": "💰 Todo en orden. No hay nada urgente que atender ahora mismo.",

  "dashboard.welcome.todayPriority": "Prioridad de hoy",
  "dashboard.welcome.allGood": "Todo en orden. No hay nada urgente que atender ahora mismo.",
  "dashboard.welcome.forecastTomorrow": "Pronóstico de mañana ({weekday})",
  "dashboard.welcome.salesForecast": "{amount} en ventas",
  "dashboard.welcome.topDemand": " · mayor demanda esperada: ",

  "greeting.morning": "Buenos días",
  "greeting.afternoon": "Buenas tardes",
  "greeting.evening": "Buenas noches",
  "greeting.subtitle": "Ya revisé tu negocio. Esto es lo más importante para hoy.",

  "health.excellent": "Excelente",
  "health.good": "Bueno",
  "health.needsAttention": "Necesita atención",
  "health.critical": "Crítico",

  "healthPhrase.excellent": "Todo funciona correctamente.",
  "healthPhrase.normal": "Tu negocio está operando con normalidad.",
  "healthPhrase.attention": "Hay situaciones que requieren atención.",

  "priorityTitle.alert": "Alerta del negocio",
  "priorityTitle.production": "Producción limitada",
  "priorityTitle.purchase": "Reabastecimiento",
  "priorityTitle.profit": "Producto más rentable",
  "priorityTitle.loss": "Pérdidas del mes",
  "priorityTitle.employee": "Mejor desempeño",
  "priorityTitle.goodPerformance": "Buen desempeño",
  "priorityTitle.recommendation": "Recomendación",

  "route.goToKitchen": "Ir a Cocina",
  "route.goToInventory": "Ir al inventario",
  "route.viewReport": "Ver reporte",
  "route.viewMore": "Ver más",
  "route.viewRecipe": "Ver receta",
  "route.viewProduct": "Ver producto",
  "route.viewProfits": "Ver ganancias",
  "route.viewLossCenter": "Ver Centro de Pérdidas",
  "route.viewEmployees": "Ver empleados",

  "priority.production.criticalWithIngredient": "Compra {ingredient} ya: sin eso no puedes preparar más \"{product}\".",
  "priority.production.criticalNoIngredient": "Ya no puedes preparar más \"{product}\".",
  "priority.production.warningWithIngredient": "Compra {ingredient} pronto: solo te alcanza para {maxUnits} \"{product}\" más.",
  "priority.production.warningNoIngredient": "Solo puedes preparar {maxUnits} \"{product}\" más.",
  "priority.production.limitedWithIngredient": "Revisa {ingredient}: se está acabando y limita \"{product}\".",
  "priority.production.limitedNoIngredient": "Tu capacidad para preparar \"{product}\" está limitada.",

  "priority.purchase.urgent": "Te quedan {stock} \"{name}\": se agotan en ~{days} día(s). Consíguelos pronto.",
  "priority.purchase.simple": "Te quedan solo {stock} \"{name}\".",
  "priority.purchase.masked": "\"{name}\" está en {status}. Consíguelo pronto.",

  "priority.profit.message": "Tu producto más rentable es \"{name}\": te deja {amount} de ganancia. Hoy es un buen día para impulsarlo.",

  "priority.loss.message": "Este mes has perdido {amount} en inventario.{detail}",
  "priority.loss.detailProduct": " \"{name}\" es el que más pérdida genera.",
  "priority.loss.detailCategory": " La causa principal es {category}.",

  "priority.employee.message": "Excelente trabajo de {name}: fue tu mejor vendedor, con {amount} en {count} venta(s).",

  "priority.growth.message": "Excelente trabajo: ayer vendiste un {percent}% más que el día anterior. Sigue así.",

  "pos.status.cashier": "Cajero",
  "pos.status.administrator": "Administrador",
  "pos.status.owner": "Dueño",
  "pos.status.connected": "Conectado",
  "pos.status.synced": "Sincronizado",
  "pos.status.offline": "Sin conexión — vendiendo en modo local",
  "pos.status.pendingSales": "{count} venta(s) por sincronizar",
  "pos.status.syncing": "Sincronizando {count} venta(s)...",
  "pos.status.allSynced": "Todo sincronizado",
  "pos.status.retry": "Reintentar",

  "common.cancel": "Cancelar",
  "common.loading": "Cargando...",
  "common.saving": "Guardando...",
  "common.add": "Agregar",
  "common.other": "Otro",
  "common.change": "Cambio",
  "common.apply": "Aplicar",

  "pos.checkout.priorityTitle": "Prioridad de la comanda",
  "pos.checkout.priority.normal": "Normal",
  "pos.checkout.priority.high": "Alta",
  "pos.checkout.priority.urgent": "Urgente",
  "pos.checkout.needsInvoice": "Necesita factura",

  "pos.categories.title": "Categorías",
  "pos.categories.subtitle": "Selecciona una categoría",
  "pos.categories.all": "Todas",
  "pos.categories.favorites": "Favoritas",

  "pos.products.notFound": "No se encontraron productos.",
  "pos.products.added": "Agregado",
  "pos.products.available": "Disponible",
  "pos.products.outOfStock": "Agotado",
  "pos.products.addAria": "Agregar {name}, {price}",
  "pos.products.hideOutOfStock": "Solo disponibles",
  "pos.products.hiddenCount": "{count} agotado(s) oculto(s)",

  "pos.topbar.title": "Punto de Venta",
  "pos.topbar.register": "Caja 1",
  "pos.topbar.searchPlaceholder": "Buscar producto, código o cliente...",
  "pos.topbar.clearSearchAria": "Borrar búsqueda",
  "pos.topbar.barcodeNotFound": "Ningún producto tiene el código {code}.",
  "pos.topbar.barcodeOutOfStock": "{name} está agotado — no se pudo agregar.",
  "pos.topbar.chargeByTable": "Cobrar por mesa",

  "pos.tableCharge.title": "Cobrar por mesa",
  "pos.tableCharge.closeAria": "Cerrar",
  "pos.tableCharge.clearSearchAria": "Borrar búsqueda",
  "pos.tableCharge.subtitle": "Busca la mesa del cliente para cobrarla desde Caja.",
  "pos.tableCharge.searchPlaceholder": "Buscar mesa...",
  "pos.tableCharge.loading": "Cargando mesas...",
  "pos.tableCharge.emptyTitle": "No hay mesas con cuenta pendiente.",
  "pos.tableCharge.emptyDescription": "Cuando una mesa tenga un pedido abierto, aparecerá aquí para cobrarla.",

  "pos.sale.title": "Venta actual",
  "pos.sale.itemCount": "{count} producto(s)",
  "pos.sale.shiftClosedToast": "La caja está cerrada. Abre un turno en la pestaña \"Turno de caja\" antes de cobrar.",
  "pos.sale.addProductsBeforeSendToast": "Agrega productos antes de enviar la comanda.",
  "pos.sale.addProductsBeforeChargeToast": "Agrega productos antes de cobrar.",
  "pos.sale.noCashierToast": "No hay un cajero autenticado. Inicia sesión de nuevo.",
  "pos.sale.sentToKitchenToast": "Comanda enviada a cocina. Cobra cuando el cliente pida la cuenta.",
  "pos.sale.saleSuccessToast": "Venta realizada correctamente. El recibo se envió a imprimir.",
  "pos.sale.genericError": "No se pudo completar la venta. Intenta de nuevo.",
  "pos.sale.shiftClosedBanner": "La caja está cerrada. Abre un turno en \"Turno de caja\" para poder cobrar.",
  "pos.sale.totalWithTax": "Total (IVA incluido)",
  "pos.sale.sendToKitchen": "Enviar cocina",
  "pos.sale.charge": "Cobrar",
  "pos.sale.chargeAndInvoice": "Pagar y facturar",
  "pos.sale.processing": "Procesando",

  "pos.payment.title": "Método de pago",
  "pos.payment.method.cash": "Efectivo",
  "pos.payment.method.card": "Tarjeta",
  "pos.payment.method.transfer": "Transferencia",
  "pos.payment.method.mixed": "Mixto",
  "pos.payment.cashReceived": "Dinero recibido",
  "pos.payment.exact": "Exacto",
  "pos.payment.cardReference": "Referencia / últimos 4 dígitos del voucher",
  "pos.payment.transferReference": "Referencia de la transferencia",
  "pos.payment.cardRefPlaceholder": "Ej: 4521",
  "pos.payment.transferRefPlaceholder": "Ej: comprobante #00234",
  "pos.payment.referenceRequired": "Ingresa la referencia de pago para tarjeta o transferencia.",
  "pos.payment.amountToCharge": "Monto a cobrar:",
  "pos.payment.mixedRefPlaceholder": "Referencia tarjeta/transferencia (opcional)",
  "pos.payment.missingAmount": "Falta por cubrir",

  "pos.customer.levelGold": "Oro",
  "pos.customer.levelSilver": "Plata",
  "pos.customer.levelBronze": "Bronce",
  "pos.customer.customerOfLevel": "Cliente {level}",
  "pos.customer.none": "Sin cliente",
  "pos.customer.points": "Puntos: {points}",
  "pos.customer.addButton": "Cliente",
  "pos.customer.clearAria": "Quitar cliente de la venta",
  "pos.customer.closeAria": "Cerrar",
  "pos.customer.newCustomer": "Nuevo cliente",
  "pos.customer.selectCustomer": "Seleccionar cliente",
  "pos.customer.name": "Nombre",
  "pos.customer.namePlaceholder": "Nombre del cliente",
  "pos.customer.phoneOptional": "Teléfono (opcional)",
  "pos.customer.saveAndUse": "Guardar y usar",
  "pos.customer.searchPlaceholder": "Buscar por nombre o teléfono...",
  "pos.customer.registerNew": "Registrar cliente nuevo",
  "pos.customer.loadingCustomers": "Cargando clientes...",
  "pos.customer.noCustomers": "No hay clientes registrados.",
  "pos.customer.noPhone": "Sin teléfono",

  "pos.cart.clear": "Vaciar carrito",
  "pos.cart.decreaseAria": "Restar cantidad de {name}",
  "pos.cart.increaseAria": "Sumar cantidad de {name}",
  "pos.cart.removeItemAria": "Quitar {name} del carrito",
  "pos.cart.removeDiscountAria": "Quitar descuento",
  "pos.cart.removeTipAria": "Quitar propina",
  "pos.cart.emptyTitle": "🛒 Carrito vacío",
  "pos.cart.emptySubtitle": "Selecciona un producto para comenzar la venta.",
  "pos.cart.removeIngredients": "Quitar ingredientes",
  "pos.cart.withoutIngredient": "Sin {ingredient}",
  "pos.cart.addExtras": "Agregar extras",
  "pos.cart.extraPlaceholder": "Ej: queso, tocineta...",
  "pos.cart.extraPrefix": "Extra {value}",
  "pos.variants.subtitle": "Elige tamaño y extras",
  "pos.variants.sizeLabel": "Tamaño",
  "pos.variants.extrasLabel": "Extras",
  "pos.variants.total": "Total",
  "pos.variants.cancel": "Cancelar",
  "pos.variants.confirm": "Agregar",
  "pos.variants.closeAria": "Cerrar selector de tamaño y extras",
  "pos.cart.kitchenNotes": "Notas para cocina",
  "pos.cart.kitchenNotesPlaceholder": "Ej: bien cocido, sin sal, para llevar...",
  "pos.cart.observations": "Observaciones",
  "pos.cart.observationsPlaceholder": "Escribe una observación...",
  "pos.cart.subtotal": "Subtotal",
  "pos.cart.tax": "IVA",
  "pos.cart.discount": "Descuento",
  "pos.cart.applyDiscount": "Aplicar descuento",
  "pos.cart.tip": "Propina",
  "pos.cart.applyTip": "Agregar propina",
  "pos.cart.percent": "Porcentaje",
  "pos.cart.fixed": "$ Fijo",
  "pos.cart.percentPlaceholder": "Ej: 10",
  "pos.cart.fixedPlaceholder": "Ej: 5000",

  "pos.weight.title": "Pesar producto",
  "pos.weight.closeAria": "Cerrar",
  "pos.weight.pricePerUnit": "Precio por {unit}",
  "pos.weight.weightLabel": "Peso ({unit})",
  "pos.weight.weightPlaceholder": "Ej: 0.500",
  "pos.weight.scaleHint": "Escribe el peso que marca la báscula.",
  "pos.weight.subtotal": "Subtotal",
  "pos.weight.cancel": "Cancelar",
  "pos.weight.confirm": "Agregar al carrito",
  "pos.weight.invalidWeight": "Ingresa un peso válido mayor a 0.",

  "kitchen.tabs.active": "Comandas activas",
  "kitchen.tabs.history": "Historial de entregados",

  "kitchen.dashboard.stat.activeOrders": "Pedidos activos",
  "kitchen.dashboard.stat.pending": "Pendientes",
  "kitchen.dashboard.stat.preparing": "Preparando",
  "kitchen.dashboard.stat.ready": "Listos",
  "kitchen.dashboard.tvExit": "Salir de Modo TV",
  "kitchen.dashboard.tvMode": "Modo TV",
  "kitchen.dashboard.loading": "Cargando comandas...",
  "kitchen.dashboard.column.pending": "Pendientes",
  "kitchen.dashboard.column.preparing": "Preparando",
  "kitchen.dashboard.column.ready": "Listos",
  "kitchen.dashboard.empty": "Sin pedidos.",

  "kitchen.defaultOrigin": "Pedido",
  "kitchen.orderNumber": "Pedido #{number}",
  "kitchen.productCount_one": "{count} producto",
  "kitchen.productCount_other": "{count} productos",

  "kitchen.card.defaultOrigin": "Pedido",
  "kitchen.card.dragAria": "Arrastrar para cambiar de estado",
  "kitchen.card.viewDetail": "Ver detalle",
  "kitchen.card.print": "Imprimir",
  "kitchen.card.orderNumber": "Pedido #{number}",
  "kitchen.card.estimatedTime": "~{minutes} min",
  "kitchen.card.action.prepare": "Preparar",
  "kitchen.card.action.ready": "Listo",
  "kitchen.card.action.deliver": "Entregar",
  "kitchen.card.action.cancel": "Cancelar",
  "kitchen.card.printTitle": "Imprime un ticket por cada estación (Barra, Cocina, Pastelería...) sin separar nada a mano.",
  "kitchen.card.productCount_one": "{count} producto",
  "kitchen.card.productCount_other": "{count} productos",

  "kitchen.detail.defaultOrigin": "Pedido",
  "kitchen.detail.priority.urgent": "URGENTE",
  "kitchen.detail.priority.high": "ALTA",
  "kitchen.detail.priority.normal": "NORMAL",
  "kitchen.detail.orderNumber": "Pedido #{number}",
  "kitchen.detail.waiterLabel": "Mesero",
  "kitchen.detail.elapsedTime": "Tiempo transcurrido",
  "kitchen.detail.orderNotes": "Notas del pedido",
  "kitchen.detail.productCount_one": "{count} producto",
  "kitchen.detail.productCount_other": "{count} productos",
  "kitchen.detail.total": "Total",
  "kitchen.detail.closeButton": "Cerrar",

  "kitchen.timer.format": "{minutes}m {seconds}s",

  "kitchen.history.loading": "Cargando historial...",
  "kitchen.history.empty": "Todavía no hay comandas entregadas.",
  "kitchen.history.defaultOrigin": "Pedido",
  "kitchen.history.orderNumber": "Pedido #{number}",
  "kitchen.history.timeLabel": "Hora",
  "kitchen.history.durationLabel": "Tiempo",
  "kitchen.history.waiterLabel": "Mesero",
  "kitchen.history.noWaiter": "Sin asignar",
  "kitchen.history.productsLabel": "Productos",
  "kitchen.history.deliveredStatus": "Entregado",

  "kitchen.cancel.title": "Cancelar comanda",
  "kitchen.cancel.orderRef": "Pedido #{number}",
  "kitchen.cancel.reasonPrompt": "¿Cuál es el motivo?",
  "kitchen.cancel.reason.clientCanceled": "Cliente canceló",
  "kitchen.cancel.reason.error": "Error",
  "kitchen.cancel.reason.outOfStock": "Producto agotado",
  "kitchen.cancel.reason.other": "Otro",
  "kitchen.cancel.customReasonPlaceholder": "Describe el motivo...",
  "kitchen.cancel.errorFallback": "No se pudo cancelar la comanda.",
  "kitchen.cancel.backButton": "Volver",
  "kitchen.cancel.confirmButton": "Confirmar cancelación",
  "kitchen.closeAria": "Cerrar",

  "waiter.page.title": "Meseros",
  "waiter.page.tablesTitle": "Mesas",
  "waiter.page.subtitleWaiter": "{name} · Elige una mesa para comenzar",
  "waiter.page.subtitleAdmin": "Administración de meseros y mesas.",
  "waiter.page.switchWaiter": "Cambiar de mesero",
  "waiter.page.loading": "Cargando…",
  "waiter.offline.pendingSingular": "1 operación de mesa pendiente",
  "waiter.offline.pendingPlural": "{count} operaciones de mesa pendientes",

  "waiter.select.errorCreate": "No se pudo agregar el mesero.",
  "waiter.select.emptyTitle": "Todavía no has agregado meseros.",
  "waiter.select.emptyDescription": "Ve a Configuración → Meseros y agrega los nombres de tu equipo. Aparecerán aquí como tarjetas para que cada uno toque la suya.",
  "waiter.select.instruction": "Toca tu nombre para empezar.",
  "waiter.select.newWaiterTitle": "Nuevo mesero",
  "waiter.select.namePlaceholder": "Nombre del mesero",
  "waiter.select.creatingLabel": "Creando...",
  "waiter.select.createButton": "Crear",

  "waiter.table.status.free": "Libre",
  "waiter.table.status.reserved": "Reservada",
  "waiter.table.status.busy": "Ocupada",
  "waiter.table.status.waitingFood": "Esperando comida",
  "waiter.table.status.eating": "Comiendo",
  "waiter.table.status.billRequested": "Cuenta solicitada",
  "waiter.table.status.waitingBill": "Esperando cuenta",
  "waiter.table.status.paying": "Pagando",
  "waiter.table.status.merged": "Unida",
  "waiter.table.status.default": "Disponible",
  "waiter.table.emptyTitle": "Todavía no tienes mesas configuradas.",
  "waiter.table.emptyDescription": "Las mesas se configuran una vez en el asistente inicial de VIMDY (Onboarding).",
  "waiter.table.searchPlaceholder": "Buscar mesa...",
  "waiter.table.noMatches": "No se encontraron mesas con esos filtros.",
  "waiter.table.openTable": "Abrir mesa →",
  "waiter.table.defaultZone": "Sin zona",
  "waiter.table.capacityHint": "Capacidad de la mesa: {capacity} personas (se puede exceder).",

  "waiter.filters.all": "Todas",
  "waiter.filters.free": "Libres",
  "waiter.filters.busy": "Ocupadas",
  "waiter.filters.eating": "Comiendo",
  "waiter.filters.waiting": "Esperando",
  "waiter.filters.reserved": "Reservadas",

  "waiter.detail.allCategories": "Todos",
  "waiter.detail.noProductsFound": "No se encontraron productos con ese filtro.",
  "waiter.detail.tapToAdd": "Toca un producto para agregarlo a esta mesa.",
  "waiter.detail.currentOrder": "Pedido actual",
  "waiter.detail.peopleLabel": "Personas",
  "waiter.detail.addNote": "Agregar nota",
  "waiter.detail.notePlaceholder": "Ej: sin arroz, al punto...",
  "waiter.detail.productsTab": "Productos",
  "waiter.detail.orderTab": "Pedido",
  "waiter.detail.priorityLabel": "Prioridad:",
  "waiter.detail.priority.normal": "Normal",
  "waiter.detail.priority.high": "Alta",
  "waiter.detail.priority.urgent": "Urgente",
  "waiter.detail.voice.listening": "Escuchando...",
  "waiter.detail.voice.button": "Voz",
  "waiter.detail.voice.buttonMobile": "Pedir por voz",
  "waiter.detail.productSearchPlaceholder": "Buscar producto...",
  "waiter.detail.subtotal": "Subtotal",
  "waiter.detail.tax": "Impuesto",
  "waiter.detail.total": "Total",
  "waiter.detail.addPeopleTitle": "Agregar personas",
  "waiter.detail.saveButton": "Guardar",
  "waiter.detail.splitBillTitle": "Dividir cuenta",
  "waiter.detail.splitBillDescription": "La cuenta se divide en partes iguales entre la cantidad de personas.",
  "waiter.detail.splitButton": "Dividir",
  "waiter.detail.mergeTitle": "Unir mesa",
  "waiter.detail.mergeDescription": "Selecciona la mesa que quieres unir a esta.",
  "waiter.detail.noFreeTables": "No hay mesas libres disponibles.",
  "waiter.detail.mergeButton": "Unir",
  "waiter.detail.transferTitle": "Transferir mesa",
  "waiter.detail.transferDescription": "Selecciona la mesa destino (libre). Esta mesa quedará libre.",
  "waiter.detail.transferButton": "Transferir",
  "waiter.detail.errorFallback": "Ocurrió un error. Intenta de nuevo.",
  "waiter.detail.cancelReason": "Cancelado por mesero",

  "waiter.open.errorFallback": "No se pudo abrir la mesa.",
  "waiter.open.titleOpen": "Abrir {name}",
  "waiter.open.titleReserve": "Reservar {name}",
  "waiter.open.peopleLabel": "Personas",
  "waiter.open.exceedsCapacity": "Supera capacidad ({capacity})",
  "waiter.open.reserveNotice": "Se reservará <strong>{name}</strong> para el turno actual. Puedes abrirla desde la pantalla Mesas cuando llegue el cliente.",
  "waiter.open.openingLabel": "Abriendo...",
  "waiter.open.reservingLabel": "Reservando...",
  "waiter.open.openButton": "Abrir mesa",
  "waiter.open.reserveButton": "Reservar",

  "waiter.close.title": "Cobrar {name}",
  "waiter.close.totalLabel": "Total a pagar",
  "waiter.close.paymentMethodLabel": "Método de pago",
  "waiter.close.receivedLabel": "Dinero recibido",
  "waiter.close.changeLabel": "Cambio",
  "waiter.close.errorFallback": "No se pudo cobrar la mesa.",
  "waiter.close.processingLabel": "Cobrando...",
  "waiter.close.confirmButton": "Confirmar cobro",
  "waiter.payment.method.cash": "Efectivo",
  "waiter.payment.method.card": "Tarjeta",
  "waiter.payment.method.transfer": "Transferencia",
  "waiter.payment.method.qr": "QR",

  "waiter.confirm.releaseTitle": "¿Liberar esta mesa?",
  "waiter.confirm.releaseDescription": "Se eliminarán las personas registradas y la mesa volverá a estar disponible.",
  "waiter.confirm.releaseButton": "Sí, liberar mesa",
  "waiter.confirm.cancelOrderTitle": "¿Cancelar este pedido?",
  "waiter.confirm.cancelOrderDescription": "Esta acción cancelará los productos pendientes y liberará la mesa. Revisa cuidadosamente los efectos sobre cocina e inventario antes de confirmar.",
  "waiter.confirm.cancelOrderButton": "Cancelar pedido",

  "waiter.settings.namePlaceholder": "Nombre del mesero",
  "waiter.settings.photoReady": "Foto lista para guardar",
  "waiter.settings.showPhotosLabel": "Mostrar fotos en tarjetas",
  "waiter.settings.emptyMessage": "Todavía no agregas meseros. Aparecerán como tarjetas en la pantalla Meseros.",
  "waiter.settings.addButton": "Agregar",
  "waiter.settings.activeLabel": "Activo",
  "waiter.settings.inactiveLabel": "Inactivo",
  "waiter.settings.removePhotoTitle": "Quitar foto",
  "waiter.settings.deactivateLabel": "Desactivar",
  "waiter.settings.reactivateLabel": "Reactivar",
  "waiter.settings.deactivateAria": "Desactivar mesero",
  "waiter.settings.reactivateAria": "Reactivar mesero",
  "waiter.settings.deleteAria": "Eliminar mesero",
  "waiter.settings.errorRemovePhoto": "No se pudo quitar la foto.",
  "waiter.settings.errorUpdatePhoto": "No se pudo actualizar la foto.",
  "waiter.settings.errorUpdateWaiter": "No se pudo actualizar el mesero.",
  "waiter.settings.errorDeleteWaiter": "No se pudo eliminar el mesero.",
  "waiter.settings.confirmDelete": "¿Quitar a \"{name}\" de la lista de meseros?"
};

export type TranslationKey = keyof typeof es;

type Dictionary = Record<TranslationKey, string>;
type Language = "es" | "en" | "pt";

const loaded: Partial<Record<Language, Dictionary>> = { es };
const pending: Partial<Record<Language, Promise<void>>> = {};
const listeners = new Set<() => void>();
let version = 0;

/** Para que useTranslation se vuelva a pintar cuando llega un idioma nuevo. */
export const dictionaryStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getVersion(): number {
    return version;
  }
};

/** Español siempre disponible: es el respaldo de cualquier clave faltante. */
export const spanishDictionary: Dictionary = es;

export function getDictionary(language: Language): Dictionary | undefined {
  return loaded[language];
}

/** Descarga el diccionario del idioma pedido (una sola vez) y avisa a la UI. */
export function ensureDictionary(language: Language): Promise<void> {
  if (loaded[language]) return Promise.resolve();
  const existing = pending[language];
  if (existing) return existing;

  const loader: Promise<{ default: Dictionary }> | null =
    language === "en"
      ? import("./dictionaries.en")
      : language === "pt"
        ? import("./dictionaries.pt")
        : null;
  if (!loader) return Promise.resolve();

  const promise = loader
    .then((module) => {
      loaded[language] = module.default;
      version += 1;
      listeners.forEach((listener) => listener());
    })
    .catch(() => {
      // Sin red: se queda en español y se reintenta en el próximo cambio.
      delete pending[language];
    });
  pending[language] = promise;
  return promise;
}