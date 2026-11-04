// src/core/services/tableBill.ts
/* ===========================================================================
   Gestión y cierre de mesa — reglas puras (sin pantalla, sin base de datos)
   ---------------------------------------------------------------------------
   Este archivo decide DOS cosas y nada más:

     1. Qué acciones se ofrecen al reabrir una mesa activa (ver cuenta,
        pre-cuenta, agregar productos, cobrar y liberar, liberar vacía) y
        POR QUÉ una acción no está disponible.
     2. Cómo se arma la PRE-CUENTA: una foto de lo que lleva la mesa, para
        mostrarle al cliente ANTES de cobrar.

   Reglas de seguridad:
     - La pre-cuenta NO es una venta, NO es un recibo y NO mueve dinero ni
       inventario. Los totales salen tal cual de la mesa (los calcula el
       TableEngine); aquí no se recalcula ningún impuesto.
     - Aquí solo se decide qué MOSTRAR. La autoridad sigue siendo el
       TableEngine y la base de datos: si una acción pasa por aquí pero el
       servidor la rechaza (ej. otro dispositivo ya cobró la mesa), el
       servidor gana y la pantalla muestra su error.
   =========================================================================== */

import type { Table, TableStatus } from "../entities/Entities";

/** Mesas sin cuenta abierta: no se puede ver, pedir ni cobrar nada. */
const NOT_OPEN_STATUSES: readonly TableStatus[] = ["FREE", "RESERVED", "CLOSED"];

/** El cliente ya pidió la cuenta (las dos formas en que el sistema lo marca). */
const BILL_REQUESTED_STATUSES: readonly TableStatus[] = ["CUENTA_SOLICITADA", "WAITING_BILL"];

/** ¿La mesa tiene una cuenta abierta? */
export function isTableOpen(status: TableStatus): boolean {
  return !NOT_OPEN_STATUSES.includes(status);
}

/** ¿El cliente ya pidió la cuenta? (no incluye "Cobrando") */
export function isBillRequested(status: TableStatus): boolean {
  return BILL_REQUESTED_STATUSES.includes(status);
}

/**
 * ¿Hay que pasar la mesa a "Por cobrar" al generar la pre-cuenta?
 *
 * No si ya está pidiendo cuenta (no se repite la escritura) ni si está
 * "Cobrando": pisar ese estado en pleno pago digital desordenaría el cobro.
 */
export function shouldMarkBillRequested(status: TableStatus): boolean {
  return isTableOpen(status) && !isBillRequested(status) && status !== "PAYING";
}

/* ------------------------------ acciones ------------------------------ */

export interface ManageActionState {
  readonly enabled: boolean;
  /** Por qué NO está disponible (se muestra al mesero). Vacío si `enabled`. */
  readonly reason?: string;
}

export interface ManageActions {
  /** Ver el detalle completo de la cuenta. */
  readonly viewDetail: ManageActionState;
  /** Generar la pre-cuenta (imprimir o vista previa). */
  readonly preBill: ManageActionState;
  /** Agregar más productos a la cuenta abierta. */
  readonly addProducts: ManageActionState;
  /** Cobrar la cuenta; al pagar, la mesa queda libre. */
  readonly charge: ManageActionState;
  /** Liberar una mesa SIN consumo (con consumo se libera al cobrar o cancelando). */
  readonly release: ManageActionState;
}

const ENABLED: ManageActionState = { enabled: true };
const blocked = (reason: string): ManageActionState => ({ enabled: false, reason });

export const MANAGE_REASONS = {
  notOpen: "Esta mesa no tiene una cuenta abierta.",
  empty: "La mesa todavía no tiene productos.",
  paying: "Hay un cobro en curso. Termínalo o cancélalo antes de cambiar la cuenta.",
  cannotCharge: "Tu rol no puede cobrar mesas. Pide a un cajero o encargado que cobre esta cuenta.",
  hasItems: "Con consumo, la mesa se libera al cobrar la cuenta (o cancelando el pedido)."
} as const;

/**
 * Qué se puede hacer con una mesa activa y por qué no, cuando no se puede.
 * @param canCharge ¿el rol del usuario puede cobrar? (ver tableChargeRoles.ts)
 */
export function getManageActions(
  table: Pick<Table, "status" | "items">,
  options: { canCharge: boolean }
): ManageActions {
  if (!isTableOpen(table.status)) {
    const closed = blocked(MANAGE_REASONS.notOpen);
    return {
      viewDetail: closed,
      preBill: closed,
      addProducts: closed,
      charge: closed,
      release: closed
    };
  }

  const hasItems = table.items.length > 0;
  const paying = table.status === "PAYING";

  return {
    viewDetail: ENABLED,
    preBill: hasItems ? ENABLED : blocked(MANAGE_REASONS.empty),
    addProducts: paying ? blocked(MANAGE_REASONS.paying) : ENABLED,
    charge: !hasItems
      ? blocked(MANAGE_REASONS.empty)
      : !options.canCharge
        ? blocked(MANAGE_REASONS.cannotCharge)
        : ENABLED,
    release: hasItems ? blocked(MANAGE_REASONS.hasItems) : paying ? blocked(MANAGE_REASONS.paying) : ENABLED
  };
}

/* ------------------------------ pre-cuenta ----------------------------- */

export interface PreBillLine {
  readonly name: string;
  readonly note?: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly lineTotal: number;
}

export interface PreBill {
  readonly tableId: string;
  readonly tableName: string;
  readonly peopleCount: number;
  readonly waiterName?: string;
  readonly openedAt?: Date;
  readonly issuedAt: Date;
  readonly lines: readonly PreBillLine[];
  /** Unidades totales (suma de cantidades). */
  readonly units: number;
  readonly subtotal: number;
  readonly tax: number;
  readonly discount: number;
  readonly total: number;
}

/**
 * Arma la pre-cuenta a partir de la mesa tal como está AHORA.
 * `resolveName` traduce productId → nombre (si no lo encuentra, se usa un
 * texto genérico: la pre-cuenta nunca debe mostrar un id interno).
 */
export function buildPreBill(
  table: Table,
  resolveName: (productId: string) => string | undefined,
  options: { issuedAt?: Date; waiterName?: string } = {}
): PreBill {
  const lines: PreBillLine[] = table.items.map((item) => {
    const note = (item.note ?? "").trim();
    return {
      name: resolveName(item.productId)?.trim() || "Producto",
      ...(note ? { note } : {}),
      quantity: item.quantity,
      unitPrice: item.price,
      lineTotal: item.price * item.quantity
    };
  });

  return {
    tableId: table.id,
    tableName: table.name,
    peopleCount: table.peopleCount,
    waiterName: options.waiterName,
    openedAt: table.openedAt,
    issuedAt: options.issuedAt ?? new Date(),
    lines,
    units: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: table.subtotal,
    tax: table.tax,
    discount: table.discount,
    total: table.total
  };
}