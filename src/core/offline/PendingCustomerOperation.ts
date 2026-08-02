import { Customer } from "../entities/Entities";

/**
 * PendingCustomerOperation
 * ---------------------------------------------------------------------------
 * PASO 1.9 del plan offline: lo que se guarda en el navegador (ver
 * PendingCustomerOperationRepository.ts) cuando se crea un cliente nuevo sin
 * internet. Mismo patrón exacto que PendingSale.ts / PendingInventoryAdjustment.ts
 * / PendingTableOperation.ts, adaptado a CustomerEngine.save().
 *
 * A propósito solo cubre CREACIÓN de clientes (lo que pide el Paso 1.9), no
 * edición ni borrado — mismo alcance acotado que tuvieron 1.7 y 1.8 en su
 * primera versión.
 *
 * DECISIÓN DE DISEÑO (igual que en las otras colas): se guarda el Customer
 * completo tal cual se le habría pasado a CustomerEngine.save(), con su `id`
 * ya generado en el dispositivo (crypto.randomUUID(), ver useCustomers.ts).
 * Ese `id` es la clave de idempotencia: si el registro ya llegó a Supabase
 * en un intento anterior de sincronización, guardar de nuevo con el mismo id
 * no duplica el cliente (ver SupabaseRepository.save()).
 */

export type PendingCustomerOperationStatus =
  /** Recién guardada offline, esperando que vuelva la conexión. */
  | "PENDING_SYNC"
  /** El proceso de sincronización la está enviando ahora mismo. */
  | "SYNCING"
  /**
   * Se intentó sincronizar y falló por algo que NO es falta de red (ej. un
   * dato inválido). Se saca de la cola automática y espera revisión manual
   * — no se reintenta sola para no repetir el mismo error para siempre.
   */
  | "FAILED";

export interface PendingCustomerOperation {
  /** Mismo id que el Customer — clave de idempotencia real (ver arriba). */
  readonly id: string;
  readonly customer: Customer;
  readonly status: PendingCustomerOperationStatus;
  /** Cuándo se guardó localmente (el momento real de la creación offline). */
  readonly queuedAt: Date;
  readonly attempts: number;
  readonly lastAttemptAt?: Date;
  readonly lastError?: string;
}