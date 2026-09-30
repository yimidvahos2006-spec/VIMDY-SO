import { Session } from "../../../core/entities/Entities";
import { IndexedDbRepository } from "./IndexedDbRepository";

/**
 * SessionRepository
 * ---------------------------------------------------------------------------
 * A propósito NO se migra a Supabase. Esto es la sesión de PIN del
 * empleado (mesero/cajero/cocina) dentro de un turno en ESTE dispositivo
 * — no es lo mismo que el login del negocio (eso ya lo maneja Supabase
 * Auth de forma segura y sincronizada, ver authBusinessContext.ts). Cada
 * caja/tablet debe manejar sus propias sesiones de PIN localmente; no
 * aporta nada (y sí añade riesgo) sincronizarlas entre dispositivos.
 */
export class SessionRepository extends IndexedDbRepository<Session> {
  protected storeName = "sessions" as const;

  public async findActiveByUser(userId: string): Promise<Session[]> {
    const sessions = await this.findAll();
    return sessions.filter(session => session.userId === userId && session.active);
  }
}