import type { PurchaseOrderItem } from "../entities/Entities";

/**
 * PendingPurchase
 * ---------------------------------------------------------------------------
 * Cola offline DEDICADA de Compras. Lo que se guarda en el navegador (ver
 * PendingPurchaseRepository.ts) cuando una compra se registra:
 *
 *   - sin internet, o
 *   - con internet pero la respuesta del servidor nunca llegó (corte de red,
 *     cierre de la pestaña, reinicio del navegador a mitad de la operación).
 *
 * Es el mismo patrón de PendingSale / PendingInventoryAdjustment, pero
 * AISLADO: una compra mueve stock, Kardex, costo promedio, estado del
 * documento y auditoría en el servidor (receive_purchase_order_atomic), así
 * que no se mezcla con los ajustes sueltos de inventario.
 *
 * DOS TIPOS (los dos flujos del servidor, mismo motor):
 *   - DIRECT : compra directa (factura / nota de entrega, sin orden previa)
 *              -> record_direct_purchase_atomic.
 *   - RECEIPT: recepción (total o parcial) de una orden previa
 *              -> receive_purchase_order_atomic.
 *
 * IDEMPOTENCIA PERSISTENTE: `id` ES la clave de idempotencia
 * (p_operation_id) que viaja al servidor. Se genera UNA sola vez, antes de
 * llamar al servidor, y queda guardada en IndexedDB. Antes vivía en un Map
 * en memoria del engine: al reiniciar el navegador se perdía y un reintento
 * generaba otro id (y por tanto otra entrada de stock). Ahora cada reintento
 * — en esta sesión o después de reiniciar — usa exactamente el mismo id, y el
 * servidor responde "idempotent" en vez de sumar el stock otra vez.
 *
 * DECISIÓN DE DISEÑO: se guarda la "receta" completa de la compra (líneas,
 * precios, proveedor, factura), ya resuelta. En una recepción SIEMPRE se
 * guardan las líneas explícitas: si se guardara "recibir lo que falte" y el
 * primer intento sí llegó al servidor, el reintento calcularía 0 pendiente y
 * fallaría en vez de confirmar que ya se aplicó.
 */

export type PendingPurchaseStatus =
  /** Recién guardada, esperando que vuelva la conexión (o el próximo ciclo). */
  | "PENDING_SYNC"
  /** Se está enviando ahora mismo. */
  | "SYNCING"
  /**
   * Falló por algo que no es de negocio y no se pudo confirmar (ej. error
   * inesperado). Se saca del ciclo automático y espera revisión/reintento.
   */
  | "FAILED"
  /**
   * El servidor la rechazó por una regla de negocio (factura repetida, sin
   * permiso, producto ajeno…) o se agotaron los intentos. No se reintenta sola.
   */
  | "PERMANENT_FAILURE";

export type PendingPurchaseKind = "DIRECT" | "RECEIPT";

export interface PendingPurchase {
  /** Clave de idempotencia — ver nota arriba. Es el p_operation_id del servidor. */
  readonly id: string;
  readonly kind: PendingPurchaseKind;
  /**
   * Huella del contenido (tipo + proveedor + factura + orden + líneas). Evita
   * guardar dos veces la misma compra si la persona pulsa dos veces o la
   * vuelve a registrar mientras la primera sigue en cola.
   */
  readonly fingerprint: string;
  /** Líneas ya resueltas (producto, cantidad y precio unitario real). */
  readonly items: readonly PurchaseOrderItem[];
  /** Solo DIRECT. */
  readonly supplierId?: string;
  readonly invoiceNumber?: string;
  /** Solo RECEIPT. */
  readonly purchaseOrderId?: string;
  readonly note?: string;
  readonly performedBy?: string;
  /** Texto corto para mostrar en la UI (ej. "Compra directa · 3 productos"). */
  readonly summary: string;
  /** Suma cantidad × precio, solo informativo para la UI. */
  readonly totalCost: number;
  readonly status: PendingPurchaseStatus;
  /** Cuándo se registró localmente (el momento real de la compra). */
  readonly queuedAt: Date;
  readonly attempts: number;
  readonly lastAttemptAt?: Date;
  readonly lastError?: string;
  /** Multi-tenant: contexto de negocio/sucursal al momento de encolar. */
  readonly businessId: string;
  readonly branchId: string;
}

export interface PurchaseFingerprintInput {
  readonly kind: PendingPurchaseKind;
  readonly supplierId?: string;
  readonly invoiceNumber?: string;
  readonly purchaseOrderId?: string;
  readonly items: readonly PurchaseOrderItem[];
}

/**
 * Huella estable del contenido de una compra. Mismo criterio que usaba el
 * engine en memoria (proveedor + factura + líneas ordenadas), ahora también
 * para recepciones, y compartida por la cola persistente.
 */
export function buildPurchaseFingerprint(input: PurchaseFingerprintInput): string {
  // El vencimiento solo entra a la huella cuando existe: así las compras ya
  // guardadas en la cola (sin fecha) conservan su huella y un doble clic tras
  // actualizar no las duplica. Con otra fecha es otra compra distinta.
  const lines = input.items
    .map((item) =>
      item.expiresAt === undefined
        ? [item.productId, item.quantity, item.unitPrice ?? null]
        : [item.productId, item.quantity, item.unitPrice ?? null, item.expiresAt]
    )
    .map((line) => JSON.stringify(line))
    .sort();

  return [
    input.kind,
    input.purchaseOrderId ?? "",
    input.supplierId ?? "",
    (input.invoiceNumber ?? "").trim().toLowerCase(),
    `[${lines.join(",")}]`
  ].join("|");
}

export function totalCostOf(items: readonly PurchaseOrderItem[]): number {
  const total = items.reduce((sum, item) => sum + item.quantity * (item.unitPrice ?? 0), 0);
  return Math.round(total * 10000) / 10000;
}