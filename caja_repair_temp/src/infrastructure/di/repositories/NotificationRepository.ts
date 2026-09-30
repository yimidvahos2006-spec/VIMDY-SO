import type { Notification } from "../../../core/store/notificationStore";
import { SupabaseRepository } from "./SupabaseRepository";

/**
 * NotificationRepository
 * ---------------------------------------------------------------------------
 * PASO 5 — Centro de notificaciones (persistencia real).
 *
 * Antes: notificationStore vivía SOLO en memoria (RAM del navegador) — al
 * recargar la página o entrar desde otro dispositivo, todo se perdía.
 *
 * Ahora: cada notificación se guarda en la tabla `notifications` de
 * Supabase (ver supabase/notifications_migration.sql), aislada por negocio
 * mediante Row Level Security — mismo patrón que ShiftRepository,
 * AlertRepository, etc. Un negocio JAMÁS ve las notificaciones de otro.
 */
export class NotificationRepository extends SupabaseRepository<Notification> {
  protected tableName = "notifications" as const;
}