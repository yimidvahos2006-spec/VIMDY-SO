import { Waiter } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { vimdyCore } from "../VimdyCore";

/* ===========================================================================
   WaiterEngine
   ---------------------------------------------------------------------------
   CRUD real de meseros "ligeros" — solo nombre, sin correo ni contraseña.
   Se gestionan desde Configuración > Meseros y se seleccionan desde la
   pantalla Meseros (grid de tarjetas, sin login). Es un motor a propósito
   simple: no toca permisos ni sesiones, eso sigue siendo responsabilidad
   de UserEngine/RoleEngine para quien de verdad necesite una cuenta.
=========================================================================== */
export class WaiterEngine {
  constructor(private readonly repository: IRepository<Waiter>) {}

  /** Solo los activos, ordenados alfabéticamente — lo que ve el mesero al tocar la pantalla. */
  public async listActive(): Promise<Waiter[]> {
    const waiters = await this.repository.findAll();
    return waiters
      .filter((w) => w.active)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Todos (activos e inactivos) — lo que ve el dueño en Configuración. */
  public async listAll(): Promise<Waiter[]> {
    const waiters = await this.repository.findAll();
    return waiters.sort((a, b) => a.name.localeCompare(b.name));
  }

  public async getById(id: string): Promise<Waiter | null> {
    return await this.repository.findById(id);
  }

  public async create(input: { name: string }): Promise<Waiter> {
    const name = input.name.trim();

    if (!name) {
      throw new Error("WAITER_NAME_REQUIRED");
    }

    const waiter: Waiter = {
      id: crypto.randomUUID(),
      name,
      active: true,
      createdAt: new Date()
    };

    await this.repository.save(waiter);
    vimdyCore.emit("waiter", { action: "CREATED", waiter });
    return waiter;
  }

  public async rename(id: string, name: string): Promise<Waiter> {
    const current = await this.repository.findById(id);

    if (!current) {
      throw new Error("WAITER_NOT_FOUND");
    }

    const trimmed = name.trim();

    if (!trimmed) {
      throw new Error("WAITER_NAME_REQUIRED");
    }

    const updated: Waiter = { ...current, name: trimmed };
    await this.repository.update(updated);
    vimdyCore.emit("waiter", { action: "UPDATED", waiter: updated });
    return updated;
  }

  public async setActive(id: string, active: boolean): Promise<Waiter> {
    const current = await this.repository.findById(id);

    if (!current) {
      throw new Error("WAITER_NOT_FOUND");
    }

    const updated: Waiter = { ...current, active };
    await this.repository.update(updated);
    vimdyCore.emit("waiter", { action: "UPDATED", waiter: updated });
    return updated;
  }

  /**
   * Borrado real (no solo desactivar). Se usa desde Configuración cuando
   * el dueño quiere quitar a alguien de la lista por completo. No revisa
   * ventas históricas: esas ya guardaron el nombre indirectamente vía
   * waiterId y siguen siendo consultables aunque el mesero ya no exista.
   */
  public async delete(id: string): Promise<void> {
    const waiter = await this.repository.findById(id);

    if (!waiter) {
      throw new Error("WAITER_NOT_FOUND");
    }

    await this.repository.delete(id);
    vimdyCore.emit("waiter", { action: "DELETED", waiter });
  }
}