// src/core/config/inventoryCountAccess.ts
/* ===========================================================================
   Quién ve qué en el CONTEO DE INVENTARIO
   ---------------------------------------------------------------------------
   Esta lista debe ser IDÉNTICA a la que aplica la base de datos en la
   migración 20261023120000_inventory_count_blind_security.sql:

     · inventory_count_can_see_differences()  → COUNT_DIFFERENCE_ROLES
       Ven el stock del sistema y las diferencias, revisan y cierran el conteo.

     · inventory_count_can_count()            → COUNT_OPERATOR_ROLES
       Pueden abrir y llenar un conteo. NO reciben ninguna cifra del sistema:
       el servidor les entrega cada línea con solo nombre, unidad y lo contado.

   El servidor es siempre la autoridad. Esta lista solo sirve para que la
   pantalla no ofrezca algo que la base de datos va a rechazar. Cambiarla aquí
   NO cambia lo que el servidor entrega: hay que cambiar también el SQL.
=========================================================================== */

export const COUNT_DIFFERENCE_ROLES = ["ADMIN"] as const;
export const COUNT_OPERATOR_ROLES = ["ADMIN", "GERENTE", "INVENTARIO"] as const;

const normalize = (roleId: string | null | undefined): string => (roleId ?? "").trim().toUpperCase();

/** ¿Este rol ve el stock del sistema y las diferencias del conteo, y puede cerrarlo? */
export function canSeeCountDifferences(roleId: string | null | undefined): boolean {
  return (COUNT_DIFFERENCE_ROLES as readonly string[]).includes(normalize(roleId));
}

/** ¿Este rol puede abrir y llenar un conteo? */
export function canRunInventoryCount(roleId: string | null | undefined): boolean {
  return (COUNT_OPERATOR_ROLES as readonly string[]).includes(normalize(roleId));
}