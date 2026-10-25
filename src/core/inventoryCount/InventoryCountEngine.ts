import type { LossCategory } from "../entities/Entities";
import type { ApplyFailure, IInventoryCountGateway } from "./IInventoryCountGateway";
import type {
  CountKind,
  CountLine,
  CountReviewEntry,
  CountScope,
  InventoryCountSession
} from "./inventoryCountLogic";

export type { ApplyFailure } from "./IInventoryCountGateway";

/**
 * Sesiones de conteo guiado: abrir, guardar lo contado y cerrar aplicando las
 * diferencias al inventario con movimientos de Kardex.
 *
 * REGLA P0 (conteo a ciegas): este motor YA NO lee ni calcula stock. Toda cifra
 * del sistema (foto al abrir, foto al contar, diferencias) la toma y la protege
 * el SERVIDOR (ver supabase/migrations/20261023120000_inventory_count_blind_security.sql):
 *   · Quien cuenta recibe solo producto + lo que contó; nunca stock ni diferencias.
 *   · Revisar y cerrar es exclusivo de los roles autorizados en el servidor;
 *     para el resto estas operaciones lanzan COUNT_FORBIDDEN.
 *   · Si el servidor no responde, la operación falla (COUNT_SERVER_ERROR) y la
 *     sesión queda como estaba: jamás se improvisa con datos locales.
 */
export class InventoryCountEngine {
  constructor(private readonly gateway: IInventoryCountGateway) {}

  public async listSessions(): Promise<InventoryCountSession[]> {
    const all = await this.gateway.list();
    return [...all].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }

  public async getSession(id: string): Promise<InventoryCountSession | null> {
    return this.gateway.get(id);
  }

  public async startSession(params: {
    kind: CountKind;
    scope: CountScope;
    scopeLabel: string;
    blind: boolean;
    createdBy: string;
  }): Promise<InventoryCountSession> {
    return this.gateway.start(params);
  }

  /**
   * Guarda lo contado. Una sesión cerrada no se edita (el servidor lo rechaza).
   * Solo se envían `productId` y `counted`: la "foto" de lo que decía el sistema
   * la pone el servidor, leyendo la base en ese instante.
   * `recountedIds`: productos en cuyo campo la persona volvió a escribir (aunque
   * sea el mismo número); solo esos refrescan su foto.
   */
  public async saveCounts(
    session: InventoryCountSession,
    lines: CountLine[],
    options: { recountedIds?: readonly string[] } = {}
  ): Promise<InventoryCountSession> {
    return this.gateway.save(
      session.id,
      lines.map((l) => ({ productId: l.productId, counted: l.counted })),
      options.recountedIds ?? []
    );
  }

  /** Diferencias para revisar antes de cerrar. Solo roles autorizados (si no: COUNT_FORBIDDEN). */
  public async reviewSession(sessionId: string): Promise<CountReviewEntry[]> {
    return this.gateway.review(sessionId);
  }

  /**
   * Cierra el conteo: el servidor calcula las diferencias contra el stock actual,
   * las guarda en la sesión (con un id de movimiento por línea) y las aplica con
   * Kardex. Si algo falla a medias, la sesión queda abierta y se puede reintentar:
   * los movimientos ya hechos no se duplican porque cada uno lleva su id.
   * Solo roles autorizados (si no: COUNT_FORBIDDEN).
   */
  public async closeSession(
    sessionId: string,
    performedBy: string,
    reasons: Record<string, LossCategory> = {}
  ): Promise<{ session: InventoryCountSession; failures: ApplyFailure[] }> {
    return this.gateway.close({
      sessionId,
      performedBy,
      reasons,
      // Opción B: el conteo físico es la cura del stock negativo, nunca lo crea.
      allowNegative: false
    });
  }
}