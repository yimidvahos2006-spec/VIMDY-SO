import type { LossCategory } from "../../../core/entities/Entities";
import type {
  ApplyFailure,
  IInventoryCountGateway
} from "../../../core/inventoryCount/IInventoryCountGateway";
import type {
  CountKind,
  CountReviewEntry,
  CountScope,
  InventoryCountSession
} from "../../../core/inventoryCount/inventoryCountLogic";
import { getCurrentBranchId, getCurrentBusinessId, supabase } from "../../supabase/supabaseClient";
import { reviveDates } from "./SupabaseRepository";

/** Códigos de error que lanza la base de datos (ver la migración inventory_count_blind_security). */
const KNOWN_COUNT_ERRORS = [
  "COUNT_FORBIDDEN",
  "COUNT_SESSION_NOT_FOUND",
  "COUNT_SESSION_CLOSED",
  "COUNT_SESSION_CLOSING",
  "COUNT_NO_PRODUCTS",
  "COUNT_INVALID_INPUT",
  "COUNT_INVALID_VALUE"
] as const;

function toCountError(error: { message?: string }): Error {
  const message = error.message ?? "";
  const known = KNOWN_COUNT_ERRORS.find((code) => message.includes(code));
  if (known) return new Error(known);
  const failure = new Error(`COUNT_SERVER_ERROR: ${message}`);
  (failure as Error & { cause?: unknown }).cause = error;
  return failure;
}

/**
 * Conteos de inventario (tabla `inventory_count_sessions`).
 *
 * A PROPÓSITO ya no extiende SupabaseRepository: la tabla está cerrada a
 * lectura/escritura directa desde el navegador (RLS + sin permisos). TODO pasa
 * por funciones del servidor que deciden, según el rol en `business_members`,
 * qué datos entregar. Un empleado que cuenta nunca recibe el stock del sistema.
 */
export class InventoryCountRepository implements IInventoryCountGateway {
  private scope(): { p_business_id: string; p_branch_id: string | null } {
    const businessId = getCurrentBusinessId();
    if (!businessId) {
      throw new Error("NO_BUSINESS_CONTEXT: no hay un negocio activo.");
    }
    return { p_business_id: businessId, p_branch_id: getCurrentBranchId() ?? null };
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.rpc(fn, { ...this.scope(), ...args });
    if (error) throw toCountError(error);
    return data as T;
  }

  public async list(): Promise<InventoryCountSession[]> {
    const data = await this.rpc<unknown[] | null>("inventory_count_list", {});
    return (data ?? []).map((row) => reviveDates(row as InventoryCountSession));
  }

  public async get(id: string): Promise<InventoryCountSession | null> {
    if (!id) return null;
    const data = await this.rpc<unknown | null>("inventory_count_get", { p_session_id: id });
    return data ? reviveDates(data as InventoryCountSession) : null;
  }

  public async start(params: {
    kind: CountKind;
    scope: CountScope;
    scopeLabel: string;
    blind: boolean;
    createdBy: string;
  }): Promise<InventoryCountSession> {
    const data = await this.rpc<unknown>("inventory_count_start", {
      p_kind: params.kind,
      p_scope: params.scope,
      p_scope_label: params.scopeLabel,
      p_blind: params.blind,
      p_created_by: params.createdBy
    });
    return reviveDates(data as InventoryCountSession);
  }

  public async save(
    sessionId: string,
    counts: ReadonlyArray<{ productId: string; counted: number | null }>,
    recountedIds: readonly string[]
  ): Promise<InventoryCountSession> {
    const data = await this.rpc<unknown>("inventory_count_save", {
      p_session_id: sessionId,
      // Solo id y cantidad: el servidor ignora cualquier otro campo.
      p_counts: counts.map((c) => ({ productId: c.productId, counted: c.counted })),
      p_recounted_ids: [...recountedIds]
    });
    return reviveDates(data as InventoryCountSession);
  }

  public async review(sessionId: string): Promise<CountReviewEntry[]> {
    const data = await this.rpc<CountReviewEntry[] | null>("inventory_count_review", {
      p_session_id: sessionId
    });
    return data ?? [];
  }

  public async close(params: {
    sessionId: string;
    performedBy: string;
    reasons: Record<string, LossCategory>;
    allowNegative: boolean;
  }): Promise<{ session: InventoryCountSession; failures: ApplyFailure[] }> {
    const data = await this.rpc<{ session: unknown; failures?: ApplyFailure[] }>("inventory_count_close", {
      p_session_id: params.sessionId,
      p_performed_by: params.performedBy,
      p_reasons: params.reasons,
      p_allow_negative: params.allowNegative
    });
    return {
      session: reviveDates(data.session as InventoryCountSession),
      failures: data.failures ?? []
    };
  }
}