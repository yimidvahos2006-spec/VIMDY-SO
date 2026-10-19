import { AuditLog } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";
import { supabase, getCurrentBusinessId, getCurrentBranchId } from "../../supabase/supabaseClient";

/**
 * AuditLogRepository
 * ---------------------------------------------------------------------------
 * Lectura: igual que cualquier SupabaseRepository (RLS limita quién ve qué).
 *
 * Escritura: audit_logs es de solo lectura para el navegador (la migración
 * 20261005000000 le quitó INSERT/UPDATE/DELETE a `authenticated` para que
 * nadie pueda falsificar la auditoría). Por eso save() NO hace upsert
 * directo: llama a la RPC record_audit_event, que fija el actor con
 * auth.uid() y valida que el usuario pertenezca al negocio.
 */
export class AuditLogRepository extends SupabaseRepository<AuditLog> {
  protected tableName = "audit_logs" as const;

  public override async save(item: AuditLog): Promise<void> {
    const businessId = getCurrentBusinessId();
    if (!businessId) {
      throw new Error("NO_BUSINESS_CONTEXT: no hay un negocio activo. No se puede registrar la auditoría.");
    }

    const { error } = await supabase.rpc("record_audit_event", {
      p_business_id: businessId,
      p_action: item.action,
      p_module: item.module,
      p_description: item.description ?? "",
      p_entity_id: item.entityId ?? null,
      p_branch_id: getCurrentBranchId() ?? null
    });

    if (error) {
      throw new Error(`AUDIT_LOG_FAILED: ${error.message}`);
    }
  }
}