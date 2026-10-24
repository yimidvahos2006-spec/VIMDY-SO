import type { LossCategory } from "../entities/Entities";
import type {
  CountKind,
  CountReviewEntry,
  CountScope,
  InventoryCountSession
} from "./inventoryCountLogic";

export interface ApplyFailure {
  name: string;
  error: string;
}

/**
 * Puerta de entrada al conteo en el SERVIDOR. Toda cifra del sistema (stock al
 * abrir, "fotos" al contar, diferencias) la calcula y la protege el backend; el
 * cliente nunca las envía y, según su rol, tampoco las recibe.
 */
export interface IInventoryCountGateway {
  list(): Promise<InventoryCountSession[]>;
  get(id: string): Promise<InventoryCountSession | null>;
  start(params: {
    kind: CountKind;
    scope: CountScope;
    scopeLabel: string;
    blind: boolean;
    createdBy: string;
  }): Promise<InventoryCountSession>;
  /** Solo viaja lo que la persona contó: nunca cifras del sistema. */
  save(
    sessionId: string,
    counts: ReadonlyArray<{ productId: string; counted: number | null }>,
    recountedIds: readonly string[]
  ): Promise<InventoryCountSession>;
  /** Solo roles con permiso de ver diferencias; el resto recibe COUNT_FORBIDDEN. */
  review(sessionId: string): Promise<CountReviewEntry[]>;
  /** Solo roles con permiso de ver diferencias; el resto recibe COUNT_FORBIDDEN. */
  close(params: {
    sessionId: string;
    performedBy: string;
    reasons: Record<string, LossCategory>;
    allowNegative: boolean;
  }): Promise<{ session: InventoryCountSession; failures: ApplyFailure[] }>;
}