// src/core/errors/DuplicateNameError.ts
/* ===========================================================================
   DuplicateNameError
   ---------------------------------------------------------------------------
   Se lanza cuando Supabase rechaza un guardado por violar el índice único
   de nombre (ej. `categories_business_name_unique_idx`, ver
   supabase/categories_dedupe_migration.sql).

   Por qué hace falta esto además de la validación que ya hace CategoryEngine
   .create() (que revisa `repository.findAll()` ANTES de guardar): esa
   revisión solo ve el caché local en ese instante — en VIMDY (offline-first,
   multi-dispositivo) hay una ventana real donde dos pestañas/dispositivos
   pueden pasar esa revisión casi al mismo tiempo, ambos creyendo que el
   nombre está libre, y terminar creando dos categorías iguales (ej. dos
   "Entradas"). El índice único en la base de datos es el blindaje real
   contra esa carrera; este error es cómo la app se entera de que chocó,
   en vez de mostrar un error genérico de guardado.

   Quién la atrapa: CategoryEngine.create()/update() la traducen de vuelta al
   mensaje "CATEGORY_NAME_DUPLICATE" que la UI ya sabe mostrar, así que para
   el usuario final se ve exactamente igual que si lo hubiera atajado la
   revisión de siempre.
=========================================================================== */

export class DuplicateNameError extends Error {
  /** Nombre de la tabla/entidad en conflicto (ej. "categories"). */
  public readonly entity: string;
  /** El nombre que ya estaba en uso. */
  public readonly name_: string;

  constructor(entity: string, name: string) {
    super(`Ya existe un registro de "${entity}" con el nombre "${name}".`);
    this.name = "DuplicateNameError";
    this.entity = entity;
    this.name_ = name;
  }
}

/** Type guard cómodo para los `catch (err)` de la capa de negocio. */
export function isDuplicateNameError(err: unknown): err is DuplicateNameError {
  return err instanceof DuplicateNameError;
}