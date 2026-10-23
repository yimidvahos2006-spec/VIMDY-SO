import type { LossCategory } from "../entities/Entities";
import type { IRepository } from "../../infrastructure/di/repositories/IRepository";
import type { InventoryEngine } from "../engines/InventoryEngine";
import { getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import {
  buildCountLines,
  computeDifferences,
  selectProductsForCount,
  type CountKind,
  type CountLine,
  type CountScope,
  type InventoryCountSession
} from "./inventoryCountLogic";

export interface ApplyFailure {
  name: string;
  error: string;
}

/**
 * Sesiones de conteo guiado: abrir, guardar lo contado y cerrar aplicando las
 * diferencias al inventario con movimientos de Kardex.
 */
export class InventoryCountEngine {
  constructor(
    private readonly repository: IRepository<InventoryCountSession>,
    private readonly inventory: InventoryEngine
  ) {}

  public async listSessions(): Promise<InventoryCountSession[]> {
    const all = await this.repository.findAll();
    return [...all].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }

  public async getSession(id: string): Promise<InventoryCountSession | null> {
    return this.repository.findById(id);
  }

  public async startSession(params: {
    kind: CountKind;
    scope: CountScope;
    scopeLabel: string;
    blind: boolean;
    createdBy: string;
  }): Promise<InventoryCountSession> {
    const products = await this.inventory.listAll();
    const selected = selectProductsForCount(products, params.kind, params.scope);
    if (selected.length === 0) throw new Error("COUNT_NO_PRODUCTS");

    const session: InventoryCountSession = {
      id: crypto.randomUUID(),
      status: "OPEN",
      blind: params.blind,
      scopeLabel: params.scopeLabel,
      kind: params.kind,
      createdAt: new Date(),
      createdBy: params.createdBy,
      lines: buildCountLines(selected)
    };
    await this.repository.save(session);
    return (await this.repository.findById(session.id)) ?? session;
  }

  /** Guarda lo contado. Una sesión cerrada no se edita. */
  public async saveCounts(session: InventoryCountSession, lines: CountLine[]): Promise<InventoryCountSession> {
    const current = await this.repository.findById(session.id);
    if (!current) throw new Error("COUNT_SESSION_NOT_FOUND");
    if (current.status === "CLOSED") throw new Error("COUNT_SESSION_CLOSED");
    if (current.prepared) throw new Error("COUNT_SESSION_CLOSING");

    // Por cada cantidad nueva o cambiada se guarda "la foto" de lo que decía el sistema en ese
    // instante (leída de la base, no de la pantalla). Las fotos nunca vienen de afuera: las
    // cantidades que no cambiaron conservan la suya y las que se borran la pierden.
    const storedById = new Map(current.lines.map((l) => [l.productId, l]));
    let stockById: Map<string, number> | null = null;
    const now = new Date().toISOString();
    const merged: CountLine[] = [];
    for (const incoming of lines) {
      const next: CountLine = { ...incoming };
      delete next.systemStockAtCount;
      delete next.countedAt;
      if (incoming.counted !== null) {
        const stored = storedById.get(incoming.productId);
        if (stored && stored.counted === incoming.counted && stored.systemStockAtCount !== undefined) {
          next.systemStockAtCount = stored.systemStockAtCount;
          if (stored.countedAt) next.countedAt = stored.countedAt;
        } else {
          if (!stockById) {
            const products = await this.inventory.listAll();
            stockById = new Map(products.map((p) => [p.id, p.stock]));
          }
          const stockNow = stockById.get(incoming.productId);
          if (stockNow !== undefined) {
            next.systemStockAtCount = stockNow;
            next.countedAt = now;
          }
        }
      }
      merged.push(next);
    }

    await this.repository.update({ ...current, lines: merged });
    return (await this.repository.findById(session.id)) ?? { ...current, lines: merged };
  }

  /**
   * Cierra el conteo: calcula las diferencias contra el stock actual, las
   * guarda en la sesión (con un id de movimiento por línea) y las aplica al
   * inventario. Si algo falla a medias, la sesión queda abierta y se puede
   * volver a intentar: los movimientos ya hechos no se duplican porque cada
   * uno lleva su id.
   */
  public async closeSession(
    sessionId: string,
    performedBy: string,
    reasons: Record<string, LossCategory> = {}
  ): Promise<{ session: InventoryCountSession; failures: ApplyFailure[] }> {
    let session = await this.repository.findById(sessionId);
    if (!session) throw new Error("COUNT_SESSION_NOT_FOUND");
    if (session.status === "CLOSED") throw new Error("COUNT_SESSION_CLOSED");

    // 1) Preparar (solo la primera vez): fija diferencias y ids de movimiento.
    if (!session.prepared) {
      const products = await this.inventory.listAll();
      const stockById = new Map(products.map((p) => [p.id, p.stock]));
      const diffs = computeDifferences(session.lines, stockById);
      const diffByProduct = new Map(diffs.map((d) => [d.line.productId, d]));

      const lines: CountLine[] = session.lines.map((line) => {
        const d = diffByProduct.get(line.productId);
        if (!d) return line;
        return {
          ...line,
          systemStockAtClose: d.stockNow,
          difference: d.difference,
          ...(d.difference < 0 ? { reason: reasons[line.productId] ?? "AJUSTE_ADMINISTRATIVO" } : {}),
          ...(d.difference !== 0 ? { movementId: line.movementId ?? crypto.randomUUID() } : {})
        };
      });
      await this.repository.update({ ...session, lines, prepared: true });
      session = (await this.repository.findById(sessionId)) ?? { ...session, lines, prepared: true };
    }

    // 2) Aplicar al inventario con Kardex.
    const failures: ApplyFailure[] = [];
    const branchId = getCurrentBranchId();
    const shortId = session.id.slice(0, 8);
    for (const line of session.lines) {
      const diff = line.difference ?? 0;
      if (diff === 0 || !line.movementId) continue;
      try {
        if (diff > 0) {
          await this.inventory.increaseStock(
            line.productId, diff, `Conteo ${shortId}: sobraba`, performedBy,
            undefined, undefined, line.movementId, branchId
          );
        } else {
          await this.inventory.decreaseStock(
            line.productId, Math.abs(diff), `Conteo ${shortId}: faltaba`, performedBy,
            line.reason ?? "AJUSTE_ADMINISTRATIVO", line.movementId, branchId
          );
        }
      } catch (error) {
        failures.push({ name: line.name, error: error instanceof Error ? error.message : String(error) });
      }
    }

    // 3) Solo se cierra si todo se aplicó; si no, queda abierta para reintentar.
    if (failures.length > 0) return { session, failures };

    await this.repository.update({ ...session, status: "CLOSED", closedAt: new Date(), closedBy: performedBy });
    const closed = (await this.repository.findById(sessionId)) ?? session;
    return { session: closed, failures };
  }
}