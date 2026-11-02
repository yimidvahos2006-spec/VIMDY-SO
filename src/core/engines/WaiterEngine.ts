import { Waiter } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { vimdyCore } from "../VimdyCore";
import {
  WAITER_NAME_MAX_LENGTH,
  normalizeWaiterName,
  waiterNameKey,
  waiterPhotoProblem
} from "../utils/waiterProfile";

/* ===========================================================================
   WaiterEngine
   ---------------------------------------------------------------------------
   CRUD real de meseros "ligeros" — solo nombre y foto, sin correo ni
   contraseña. Se gestionan desde Configuración > Meseros y se seleccionan
   desde la pantalla Meseros (grid de tarjetas, sin login). Es un motor a
   propósito simple: no toca permisos ni sesiones, eso sigue siendo
   responsabilidad de UserEngine/RoleEngine para quien de verdad necesite una
   cuenta.

   Quién puede escribir: SOLO el administrador (Paso 1: políticas RLS de la
   tabla `waiters`). La pantalla además oculta los controles a quien no tenga
   el permiso `waiters.manage`; este motor garantiza las reglas de datos:
   nombre obligatorio, máximo 40 letras, sin repetir (ignorando tildes y
   mayúsculas) y foto con formato válido.
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

  public async create(input: { name: string; photoUrl?: string }): Promise<Waiter> {
    const name = this.validName(input.name);
    await this.assertNameAvailable(name);

    const photoUrl = input.photoUrl ? this.validPhoto(input.photoUrl) : undefined;

    const waiter: Waiter = {
      id: crypto.randomUUID(),
      name,
      active: true,
      createdAt: new Date(),
      ...(photoUrl ? { photoUrl } : {})
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

    const trimmed = this.validName(name);

    // Sin cambios (ni siquiera de mayúsculas): no hay nada que guardar.
    if (trimmed === current.name) return current;

    await this.assertNameAvailable(trimmed, id);

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

  /** `photoUrl` undefined = quitar la foto (la tarjeta vuelve al ícono). */
  public async updatePhoto(id: string, photoUrl: string | undefined): Promise<Waiter> {
    const current = await this.repository.findById(id);

    if (!current) {
      throw new Error("WAITER_NOT_FOUND");
    }

    const { photoUrl: _previous, ...withoutPhoto } = current;
    const updated: Waiter = photoUrl
      ? { ...withoutPhoto, photoUrl: this.validPhoto(photoUrl) }
      : withoutPhoto;

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

  /* ------------------------------ reglas ------------------------------ */

  private validName(raw: string): string {
    const name = normalizeWaiterName(raw);

    if (!name) {
      throw new Error("WAITER_NAME_REQUIRED");
    }
    if (name.length > WAITER_NAME_MAX_LENGTH) {
      throw new Error("WAITER_NAME_TOO_LONG");
    }
    return name;
  }

  private validPhoto(photoUrl: string): string {
    const problem = waiterPhotoProblem(photoUrl);
    if (problem) {
      throw new Error(`WAITER_PHOTO_INVALID: ${problem}`);
    }
    return photoUrl.trim();
  }

  /** Dos tarjetas con el mismo nombre confunden al mesero: se compara sin tildes ni mayúsculas. */
  private async assertNameAvailable(name: string, exceptId?: string): Promise<void> {
    const key = waiterNameKey(name);
    const all = await this.repository.findAll();
    const clash = all.some((w) => w.id !== exceptId && waiterNameKey(w.name) === key);

    if (clash) {
      throw new Error(`WAITER_NAME_DUPLICATE: ya existe un mesero llamado "${name}".`);
    }
  }
}