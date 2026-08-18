import { CreateSaleInput } from "../engines/SalesEngine";
import { PaymentMethod, MixedPayment } from "../engines/PaymentEngine";

/**
 * PendingSale
 * ---------------------------------------------------------------------------
 * Parte 2 del plan de ventas offline: lo que se guarda en el navegador
 * (ver PendingSaleRepository.ts) cuando una venta se cobra sin internet.
 *
 * DECISIÓN DE DISEÑO: se guarda la "receta" para rehacer la venta
 * (createSaleInput + payment), no una Sale ya armada. Offline no existe
 * una Sale real todavía: no hay inventario descontado en el servidor, no
 * hay código generado por Supabase, no hay comanda real en Cocina. Lo
 * único que existe de verdad en este momento es "esto es lo que el
 * cajero cobró" — y eso es exactamente lo que hace falta para, al
 * reconectar, llamar a SalesEngine.createSale() (y a registerPayment())
 * tal como se habría llamado si hubiera habido internet desde el
 * principio (ver Parte 4).
 *
 * IDEMPOTENCIA (checklist crítico #4): `id` acá es EXACTAMENTE el mismo
 * `saleId` que ya viaja dentro de `createSaleInput.id`. No se genera un
 * id nuevo para la cola — es a propósito el mismo, así que si el
 * navegador se cierra a mitad de una sincronización y hay que
 * reintentar, createSale() en el servidor ya sabe reconocer que esa
 * venta puntual ya existe y no la duplica.
 *
 * LÍMITE CONOCIDO (documentado, no resuelto aquí): esta cola vive en
 * IndexedDB del navegador SIN separarla por negocio, igual que
 * SessionRepository. Para el caso real de un POS (una caja = un negocio
 * casi siempre logueado) es suficiente; si algún día el mismo navegador
 * alterna sesiones de negocios distintos, estas ventas pendientes
 * quedarían mezcladas hasta sincronizarse.
 */

export type PendingSaleStatus =
  /** Recién guardada offline, esperando que vuelva la conexión. */
  | "PENDING_SYNC"
  /** El proceso de sincronización (Parte 4) la está enviando ahora mismo. */
  | "SYNCING"
   /**
    * Se intentó sincronizar y falló por algo que NO es falta de red (ej.
    * el producto ya no existe, quedó sin stock y así se decidió tratarlo
    * en la Parte 4, etc.). Se saca de la cola automática y espera revisión
    * manual — no se reintenta sola para no repetir el mismo error para
    * siempre.
    */
   | "FAILED"
   | "PERMANENT_FAILURE";

/**
 * Datos de cobro que el cajero ya completó offline (efectivo, tarjeta,
 * etc.), para reproducir el mismo `registerPayment()` una vez la venta
 * exista en el servidor. Ausente si la venta offline se quedó solo en
 * "enviada a cocina, sin cobrar todavía" (flujo de mesas).
 */
export interface QueuedSalePayment {
  readonly method: PaymentMethod;
  readonly received?: number;
  readonly reference?: string;
  readonly mixed?: MixedPayment;
}

export interface PendingSale {
  /** Igual a createSaleInput.id — ver nota de idempotencia arriba. */
  readonly id: string;
  /** Todo lo necesario para volver a llamar a SalesEngine.createSale(). */
  readonly createSaleInput: CreateSaleInput;
  /** Cobro ya realizado offline, si aplica (ver QueuedSalePayment). */
  readonly payment?: QueuedSalePayment;
  /** Metadata liviana, solo para reimprimir el recibo al sincronizar. */
  readonly cashierName?: string;
  readonly status: PendingSaleStatus;
  /** Cuándo se guardó localmente (el momento real del cobro offline). */
  readonly queuedAt: Date;
  /** Cuántas veces se ha intentado sincronizar esta venta (éxito o no). */
  readonly attempts: number;
  readonly lastAttemptAt?: Date;
  readonly lastError?: string;
  /** FASE 7 (Multi-tenant): contexto de negocio/sucursal al momento de encolar. */
  readonly businessId: string;
  readonly branchId: string;
}