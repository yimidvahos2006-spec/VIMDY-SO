// src/core/errors/translateBusinessError.ts
/* ===========================================================================
   translateBusinessError
   ---------------------------------------------------------------------------
   Punto único para convertir los errores de NEGOCIO que lanzan los engines
   (TableEngine, ShiftEngine, InventoryEngine, OrderEngine, etc. — ver
   BUSINESS_ERROR_PREFIXES en core/services/offlineSale.ts para el catálogo
   completo de prefijos que usa el sistema) en un mensaje que un cajero o
   administrador pueda leer y actuar, sin códigos tipo "TABLE_NOT_OPEN:" ni
   referencias a funciones internas como "openTable()".

   Por qué existe: antes cada pantalla hacía
     `err instanceof Error ? err.message : "..."`
   y mostraba el mensaje del engine tal cual, que está pensado para quien
   programa (prefijo en mayúsculas + a veces detalles técnicos), no para
   quien atiende el mostrador. Ahora toda pantalla debe pasar el error por
   esta función antes de mostrarlo.

   Uso:
     try {
       await something();
     } catch (err) {
       setErrorMsg(translateBusinessError(err));
       // o con un mensaje de respaldo distinto al genérico:
       setErrorMsg(translateBusinessError(err, "No se pudo cobrar la mesa."));
     }

   Si aparece un prefijo nuevo en el futuro que esta función no reconoce,
   NUNCA se muestra el código crudo — se usa el mensaje de respaldo
   (`fallback`) para no volver a exponer texto de desarrollador en pantalla.
=========================================================================== */

import { isOptimisticLockError } from "./OptimisticLockError";

/** Saca el primer texto entre comillas dobles de un detalle (ej. el nombre de una mesa o producto). */
function extractQuoted(text: string): string | null {
  const match = text.match(/"([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Mensajes para los prefijos "CODIGO: detalle" que lanzan los engines.
 * Cada función recibe el `detalle` (texto después de los dos puntos, ya
 * sin espacios sobrantes) y puede usarlo si aporta información útil
 * (nombre de mesa, producto, correo) o ignorarlo si el texto original
 * tiene jerga de desarrollador.
 */
const CODE_MESSAGES: Record<string, (detail: string) => string> = {
  // Mesas
  TABLE_NOT_OPEN: () =>
    "Esta mesa no tiene un pedido abierto todavía. Ábrela primero.",
  TABLE_NOT_AVAILABLE: (detail) => {
    const name = extractQuoted(detail);
    return name
      ? `La mesa "${name}" no está disponible en este momento.`
      : "Esa mesa no está disponible en este momento.";
  },
  EMPTY_TABLE: () => "Esta mesa no tiene productos para cobrar todavía.",

  // Pedidos
  EMPTY_ORDER: () => "Este pedido no tiene productos todavía.",
  NOTHING_REQUIRES_KITCHEN: () =>
    "Ningún producto de este pedido necesita preparación en cocina — cóbralo directamente.",
  ORDER_LOCKED: () =>
    "Este pedido ya fue cobrado o cancelado, así que no se puede modificar.",
  ORDER_MISSING_TABLE: () => "Este pedido no tiene una mesa asignada.",
  INVALID_SPLIT: () => "El número de personas para dividir la cuenta no es válido.",

  // Inventario / stock
  INSUFFICIENT_STOCK: (detail) => {
    if (!detail) return "No hay stock suficiente para completar la venta.";
    if (detail.includes("cambió justo antes")) return detail; // ya es un mensaje claro
    return `No hay stock suficiente: ${detail.replace(/ \| /g, ", ")}`;
  },
  PRODUCT_NOT_FOUND: () =>
    "Este producto ya no existe (puede que otro usuario lo haya eliminado).",
  SUPABASE_ADJUST_STOCK_FAILED: () => "No se pudo actualizar el stock. Intenta de nuevo.",

  // Turno de caja
  SHIFT_ALREADY_OPEN: () => "Ya hay un turno de caja abierto. Ciérralo antes de abrir uno nuevo.",
  SHIFT_ALREADY_CLOSED: () => "Este turno ya fue cerrado y no se puede modificar.",
  INVALID_AMOUNT: (detail) => detail || "El monto ingresado no es válido.",
  CANCEL_REASON_REQUIRED: () => "Escribe un motivo para poder cancelar.",

  // Ventas
  SALE_NOT_PAID: (detail) => detail || "Esta venta todavía no está pagada.",
  SALE_NOT_FOUND: () => "No se encontró esa venta (puede que ya no exista).",
  SALE_CANNOT_BE_CANCELLED: (detail) => detail || "Esta venta no se puede cancelar en su estado actual.",
  VALIDATION_ERROR: (detail) => detail || "Revisa los datos ingresados: algo no es válido.",
  PENDING_SALE_REQUIRES_ID: () =>
    "No se pudo guardar la venta para sincronizarla después. Intenta de nuevo con conexión a internet.",

  // Usuarios, roles y permisos
  ACCESS_DENIED: () => "No tienes permiso para hacer esto. Pide ayuda a un administrador.",
  EMAIL_ALREADY_IN_USE: (detail) => detail || "Ya existe un usuario con ese correo.",
  ROLE_ALREADY_EXISTS: (detail) => detail || "Ya existe un rol con ese identificador.",
  ROLE_IS_SYSTEM: (detail) => detail || "Este rol es del sistema y no se puede eliminar.",
  PERMISSION_NOT_FOUND: () => "Uno de los permisos seleccionados no existe.",

  // Compras
  PURCHASE_ORDER_NOT_OPEN: () =>
    "Esta orden de compra ya fue cerrada o recibida y no se puede modificar.",
  INVALID_ITEM: () => "Revisa los productos y cantidades de la orden: hay uno inválido.",

  // IA / integraciones
  MENU_VISION_UNAVAILABLE: () => "El escaneo de menú con IA no está disponible en este momento."
};

/**
 * Códigos "legacy" que ya se lanzaban en español pero sin prefijo con dos
 * puntos (formulario de Nuevo producto — ver antes useProducts.ts). Se
 * mantienen aquí para que exista un solo lugar central.
 */
const LEGACY_PRODUCT_CODE_MESSAGES: Record<string, string> = {
  NOMBRE_REQUERIDO: "El nombre del producto es obligatorio.",
  CATEGORIA_REQUERIDA: "Selecciona una categoría.",
  PRECIO_INVALIDO: "El precio de venta no es válido.",
  STOCK_INVALIDO: "El stock inicial no es válido.",
  STOCK_MINIMO_INVALIDO: "El stock mínimo no es válido.",
  PRECIO_COMPRA_INVALIDO: "El precio de compra no es válido.",
  IVA_INVALIDO: "El IVA debe estar entre 0 y 100%.",
  SKU_DUPLICADO: "Ya existe un producto con ese SKU.",
  BARCODE_DUPLICADO: "Ya existe un producto con ese código de barras."
};

/** "CODIGO: detalle" o "CODIGO: detalle en varias\nlíneas" */
const CODE_WITH_DETAIL_PATTERN = /^([A-Z][A-Z0-9_]{2,}):\s*([\s\S]*)$/;

/** Código suelto en mayúsculas, sin detalle (ej. "INVALID_AMOUNT", "PRODUCT_NOT_FOUND"). */
const BARE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,}$/;

/**
 * Traduce cualquier error capturado en un catch a un mensaje humano en
 * español, listo para mostrarse tal cual en pantalla.
 *
 * @param err el valor capturado en `catch (err) { ... }`
 * @param fallback mensaje a usar si `err` no es un error reconocido o su
 *   código no está catalogado — nunca se muestra un código crudo.
 */
export function translateBusinessError(
  err: unknown,
  fallback = "Ocurrió un error. Intenta de nuevo."
): string {
  // Los errores de bloqueo optimista ya traen un mensaje pensado para el usuario final.
  if (isOptimisticLockError(err)) return err.message;

  if (!(err instanceof Error) || !err.message) return fallback;

  const raw = err.message.trim();

  const withDetail = raw.match(CODE_WITH_DETAIL_PATTERN);
  if (withDetail) {
    const [, code, detail] = withDetail;
    const build = CODE_MESSAGES[code] ?? undefined;
    if (build) return build(detail.trim());
    // Prefijo con forma de código de negocio pero no catalogado: nunca
    // mostrar el texto crudo (puede tener stack traces o nombres de función).
    return fallback;
  }

  if (BARE_CODE_PATTERN.test(raw)) {
    if (CODE_MESSAGES[raw]) return CODE_MESSAGES[raw]("");
    if (LEGACY_PRODUCT_CODE_MESSAGES[raw]) return LEGACY_PRODUCT_CODE_MESSAGES[raw];
    return fallback;
  }

  // No tiene forma de código (no está todo en MAYÚSCULAS_CON_GUIONES_BAJOS):
  // probablemente ya sea un mensaje humano armado a mano en otra parte del
  // código (ej. "No se pudo conectar. Revisa tu internet e intenta de nuevo.").
  return raw;
}