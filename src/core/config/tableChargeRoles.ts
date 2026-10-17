// src/core/config/tableChargeRoles.ts
/* ===========================================================================
   Quién puede COBRAR una mesa
   ---------------------------------------------------------------------------
   Esta lista debe ser IDÉNTICA a la que exige la base de datos en TODA la
   cadena de cobro de una mesa:

     1) Crear la venta de la mesa ............ ADMIN, GERENTE, CAJERO
        (RPC create_sale_fulfillment_atomic)
     2) Abrir la sesión de pago con Wompi .... ADMIN, GERENTE, CAJERO
        (RPC create_wompi_sale_payment_session_atomic)
     3) Registrar el cobro en caja ........... ADMIN, GERENTE, CAJERO
        (RPC register_sale_payment_atomic)

   Antes, el paso 3 solo aceptaba ADMIN y CAJERO: un GERENTE podía crear la
   venta pero el cobro terminaba en "CAJA_FORBIDDEN". El MESERO nunca puede
   cobrar (maneja la cuenta, no el dinero): la pantalla lo informa antes de
   intentar nada, en vez de fallar al final con un error del servidor.

   El servidor es siempre la autoridad. Esta lista solo sirve para que la
   pantalla no ofrezca una acción que la base de datos va a rechazar.
   El test tests/smoke/mesa-roles-cobro.test.ts compara esta lista contra
   las migraciones SQL para que nunca vuelvan a desalinearse.
=========================================================================== */

export const TABLE_CHARGE_ROLES = ["ADMIN", "GERENTE", "CAJERO"] as const;

export type TableChargeRole = (typeof TABLE_CHARGE_ROLES)[number];

/** Mensaje para quien no puede cobrar (ej. un mesero). */
export const TABLE_CHARGE_FORBIDDEN_MESSAGE =
  "Tu rol no puede cobrar mesas. Pide a un cajero o encargado que cobre esta cuenta.";

/**
 * ¿Este rol puede cobrar una mesa?
 * @param roleId rol del usuario en el negocio (business_members.role).
 */
export function canChargeTables(roleId: string | null | undefined): boolean {
  if (!roleId) return false;
  const normalized = roleId.trim().toUpperCase();
  return (TABLE_CHARGE_ROLES as readonly string[]).includes(normalized);
}