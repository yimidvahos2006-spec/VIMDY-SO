import { BusinessSnapshotRecord } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";

/**
 * BusinessSnapshotRepository
 * ---------------------------------------------------------------------------
 * Persiste las "fotos" diarias del negocio que usa PatternLearningEngine
 * (PASO 9 — Aprendizaje) en la tabla `business_snapshots` de Supabase.
 * Mismo patrón que ProductRepository, SaleRepository, etc: solo define
 * `tableName`, toda la lógica de business_id/RLS vive en SupabaseRepository.
 */
export class BusinessSnapshotRepository extends SupabaseRepository<BusinessSnapshotRecord> {
  protected tableName = "business_snapshots" as const;
}