import { ObservableStore } from "../store/ObservableStore";
import type {
  PendingSale,
  QueuedSalePayment
} from "./PendingSale";
import { PendingSaleRepository } from "../../infrastructure/di/repositories/PendingSaleRepository";
import type {
  CreateSaleInput
} from "../engines/SalesEngine";
import {
  getCurrentBranchId,
  requireCurrentBusinessId
} from "../../infrastructure/supabase/supabaseClient";

const repository =
  new PendingSaleRepository();

export interface PendingSalesSnapshot {
  readonly items: PendingSale[];
  readonly loaded: boolean;
}

const EMPTY_SNAPSHOT:
  PendingSalesSnapshot = {
    items: [],
    loaded: false
  };

/**
 * Cola reactiva de ventas offline.
 *
 * La persistencia real pertenece a PendingSaleRepository. Este store
 * solamente mantiene una copia reactiva para los consumidores de la UI
 * y para el servicio de sincronización.
 */
class PendingSalesStore extends ObservableStore<PendingSalesSnapshot> {
  constructor() {
    super(
      EMPTY_SNAPSHOT
    );

    /*
     * Durante SSR/tests IndexedDB puede no existir.
     * En navegador se hidrata automáticamente.
     */
    if (
      typeof indexedDB !==
      "undefined"
    ) {
      void this.refresh();
    }
  }

  /**
   * Recarga completamente el snapshot desde la persistencia local.
   */
  async refresh(): Promise<void> {
    const items =
      await repository.findAll();

    this.publish({
      items,
      loaded: true
    });
  }

  /**
   * Devuelve directamente las ventas disponibles para sincronización.
   *
   * Se consulta el repositorio en lugar del snapshot para evitar utilizar
   * datos potencialmente antiguos cuando el proceso de sincronización
   * empieza.
   */
  async findSyncable(): Promise<PendingSale[]> {
    return repository.findSyncable();
  }

  /**
   * Encola una operación offline.
   *
   * La clave del registro y createSaleInput.id son exactamente la misma.
   * Esto evita que un mismo intento de venta genere dos registros locales.
   */
  async enqueue(
    params: {
      createSaleInput: CreateSaleInput;
      payment?: QueuedSalePayment;
      cashierName?: string;
    }
  ): Promise<PendingSale> {
    const saleId =
      params.createSaleInput.id;

    if (
      !saleId ||
      !saleId.trim()
    ) {
      throw new Error(
        "PENDING_SALE_REQUIRES_ID: createSaleInput.id es obligatorio para encolar una venta offline (es la clave de idempotencia)."
      );
    }

    const existing =
      await repository.findById(
        saleId
      );

    const businessId =
      requireCurrentBusinessId();

    const branchId =
      getCurrentBranchId();

    if (!branchId) {
      throw new Error(
        "CONTEXT_MISMATCH: no existe una sucursal activa para guardar la venta offline."
      );
    }

    /*
     * Si el registro ya existe, conservamos:
     * - queuedAt
     * - attempts
     * - último intento
     * - errores anteriores
     *
     * Esto es importante para que repetir enqueue() no resetee el estado
     * de idempotencia de la operación.
     */
    const pendingSale:
      PendingSale = {
        id:
          saleId,

        createSaleInput:
          params.createSaleInput,

        payment:
          params.payment ??
          existing?.payment,

        cashierName:
          params.cashierName ??
          existing?.cashierName,

        status:
          "PENDING_SYNC",

        queuedAt:
          existing?.queuedAt ??
          new Date(),

        attempts:
          existing?.attempts ??
          0,

        lastAttemptAt:
          existing?.lastAttemptAt,

        lastError:
          existing?.lastError,

        businessId,

        branchId
      };

    await repository.save(
      pendingSale
    );

    await this.refresh();

    return pendingSale;
  }

  /**
   * Marca una operación como actualmente sincronizándose.
   *
   * El incremento del contador ocurre antes de ejecutar la petición remota.
   * Si el navegador muere durante la petición, recoverStuckSyncing() podrá
   * devolverla al estado PENDING_SYNC.
   */
  async markSyncing(
    id: string
  ): Promise<boolean> {
    const current =
      await repository.findById(
        id
      );

    if (!current) {
      return false;
    }

    await repository.update({
      ...current,

      status:
        "SYNCING",

      attempts:
        current.attempts + 1,

      lastAttemptAt:
        new Date()
    });

    await this.refresh();

    return true;
  }

  /**
   * Marca un fallo genérico.
   *
   * Se mantiene el registro local para que no desaparezca información de
   * una operación cuyo estado remoto necesita investigación.
   */
  async markFailed(
    id: string,
    error: string
  ): Promise<void> {
    const current =
      await repository.findById(
        id
      );

    if (!current) {
      return;
    }

    await repository.update({
      ...current,

      status:
        "FAILED",

      lastError:
        error,

      lastAttemptAt:
        new Date()
    });

    await this.refresh();
  }

  /**
   * Marca un error de negocio que no debe reintentarse automáticamente.
   *
   * Ejemplos:
   * - producto eliminado;
   * - permisos insuficientes;
   * - contexto incorrecto;
   * - stock insuficiente;
   * - datos inválidos.
   */
  async markPermanentFailure(
    id: string,
    error: string
  ): Promise<void> {
    const current =
      await repository.findById(
        id
      );

    if (!current) {
      return;
    }

    await repository.update({
      ...current,

      status:
        "PERMANENT_FAILURE",

      lastError:
        error,

      lastAttemptAt:
        new Date()
    });

    await this.refresh();
  }

  /**
   * Devuelve una operación al ciclo automático.
   *
   * Se utiliza para errores temporales como pérdida de conexión.
   */
  async requeue(
    id: string
  ): Promise<void> {
    const current =
      await repository.findById(
        id
      );

    if (!current) {
      return;
    }

    await repository.update({
      ...current,

      status:
        "PENDING_SYNC"
    });

    await this.refresh();
  }

  /**
   * Elimina una venta únicamente después de haber completado correctamente
   * la sincronización remota.
   */
  async remove(
    id: string
  ): Promise<void> {
    await repository.delete(
      id
    );

    await this.refresh();
  }

  /**
   * Recupera operaciones que quedaron en SYNCING por:
   *
   * - cierre del navegador;
   * - pérdida de energía;
   * - refresh;
   * - crash de JavaScript.
   *
   * No se elimina ninguna operación.
   */
  async recoverStuckSyncing(): Promise<void> {
    const items =
      await repository.findAll();

    const stuck =
      items.filter(
        (sale) =>
          sale.status ===
          "SYNCING"
      );

    if (
      stuck.length === 0
    ) {
      return;
    }

    await Promise.all(
      stuck.map(
        (sale) =>
          repository.update({
            ...sale,

            status:
              "PENDING_SYNC"
          })
      )
    );

    await this.refresh();
  }

  /**
   * Devuelve únicamente operaciones que esperan sincronización.
   */
  syncable(): PendingSale[] {
    return this.snapshot.items.filter(
      (sale) =>
        sale.status ===
        "PENDING_SYNC"
    );
  }

  /**
   * Devuelve el snapshot actual en memoria.
   */
  list(): PendingSale[] {
    return this.snapshot.items;
  }

  /**
   * Cantidad total de registros almacenados.
   *
   * Incluye FAILED y PERMANENT_FAILURE para que la UI pueda mostrar que
   * existe trabajo que requiere revisión.
   */
  count(): number {
    return this.snapshot.items.length;
  }

  /**
   * Vacía completamente la cola.
   *
   * Debe utilizarse únicamente desde una operación administrativa
   * deliberada, nunca después de una sincronización individual.
   */
  async clear(): Promise<void> {
    await repository.clear();

    await this.refresh();
  }
}

export const pendingSalesStore =
  new PendingSalesStore();