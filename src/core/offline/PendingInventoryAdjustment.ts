import { LossCategory } from "../entities/Entities";

/**
 * PendingInventoryAdjustment
 * ---------------------------------------------------------------------------
 * PASO 1.7 del plan offline: lo que se guarda en el navegador (ver
 * PendingInventoryAdjustmentRepository.ts) cuando un ajuste de inventario
 * (entrada o salida de stock desde el módulo Inventario) se hace sin
 * internet. Es el mismo patrón exacto que PendingSale.ts, adaptado a
 * InventoryEngine.increaseStock()/decreaseStock() en vez de
 * SalesEngine.createSale().
 *
 * DECISIÓN DE DISEÑO (igual que PendingSale): se guarda la "receta" para
 * rehacer el ajuste (productId + tipo + cantidad + motivo), no un
 * InventoryMovement ya armado. Offline no existe todavía un movimiento
 * real: el stock en el servidor no se ha tocado, así que lo único que
 * existe de verdad en este momento es "esto es lo que el usuario ajustó
 * en este dispositivo" — que es exactamente lo que hace falta para, al
 * reconectar, volver a llamar a InventoryEngine.increaseStock() /
 * decreaseStock() tal como se habría llamado si hubiera habido internet
 * desde el principio (ver syncPendingInventoryAdjustments.ts).
 *
 * IDEMPOTENCIA: a diferencia de una venta, un ajuste de stock no tiene un
 * "id de venta" natural que el servidor ya reconozca. Por eso `id` viaja
 * también como `movementId` hacia KardexEngine.record() (ver
 * InventoryEngine.ts) — si el navegador se cierra a mitad de una
 * sincronización y hay que reintentar, el servidor ya sabe que existe un
 * movimiento de Kardex con ese id exacto y NO vuelve a aplicar el delta de
 * stock una segunda vez.
 */

export type PendingInventoryAdjustmentStatus =
  /** Recién guardado offline, esperando que vuelva la conexión. */
  | "PENDING_SYNC"
  /** El proceso de sincronización lo está enviando ahora mismo. */
  | "SYNCING"
   /**
    * Se intentó sincronizar y falló por algo que NO es falta de red (ej.
    * el producto ya no existe, o ya no queda stock suficiente para una
    * salida). Se saca de la cola automática y espera revisión manual — no
    * se reintenta sola para no repetir el mismo error para siempre.
    */
   | "FAILED"
   | "PERMANENT_FAILURE";

export type PendingInventoryAdjustmentType = "INCREASE" | "DECREASE";

export interface PendingInventoryAdjustment {
  /** Clave de idempotencia — ver nota arriba. Es también el movementId del Kardex. */
  readonly id: string;
  readonly productId: string;
  /** Nombre del producto al momento de encolar, solo para mostrarlo en la UI (banner/lista). */
  readonly productName: string;
  readonly type: PendingInventoryAdjustmentType;
  readonly quantity: number;
  readonly reason: string;
  readonly performedBy?: string;
  /** Solo aplica a INCREASE (entrada por compra a proveedor). */
  readonly supplierId?: string;
  readonly purchasePrice?: number;
  /** Solo aplica a DECREASE manual (merma, vencimiento, consumo interno, robo, error). */
  readonly lossCategory?: LossCategory;
  readonly status: PendingInventoryAdjustmentStatus;
  /** Cuándo se guardó localmente (el momento real del ajuste offline). */
  readonly queuedAt: Date;
  readonly attempts: number;
  readonly lastAttemptAt?: Date;
  readonly lastError?: string;
  /** FASE 7 (Multi-tenant): contexto de negocio/sucursal al momento de encolar. */
  readonly businessId: string;
  readonly branchId: string;
}