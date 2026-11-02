/**
 * branchAccess.ts
 * ---------------------------------------------------------------------------
 * Reglas PURAS de Sucursales: qué permite el plan contratado (1 sede o
 * Multi-Sucursal) y cómo se validan los datos de una sucursal.
 *
 * Importante: esto decide qué muestra y permite la PANTALLA. No reemplaza una
 * restricción en la base de datos (ver la nota en la migración
 * 20261114000000_operation_settings_branch_plan.sql).
 */

import type { BusinessTier } from "../entities/SubscriptionTypes";

/** El plan de 1 sede incluye exactamente una sucursal activa. */
export const SINGLE_TIER_ACTIVE_BRANCH_LIMIT = 1;

export interface BranchSummary {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly is_main: boolean;
  readonly active: boolean;
}

export type BranchAccessReason = "ok" | "plan_limit" | "subscription_blocked";

export interface BranchAccess {
  readonly tier: BusinessTier;
  readonly activeCount: number;
  /** null = sin límite (Multi-Sucursal). */
  readonly limit: number | null;
  readonly canCreate: boolean;
  /** Reactivar una sucursal inactiva suma una activa: mismo límite que crear. */
  readonly canActivate: boolean;
  /** Ya hay más sucursales activas de las que incluye el plan (ej. se bajó de plan). */
  readonly overLimit: boolean;
  readonly reason: BranchAccessReason;
  readonly upgradeRequired: boolean;
  readonly message: string | null;
}

export interface BranchAccessInput {
  readonly tier: BusinessTier;
  readonly branches: readonly BranchSummary[];
  /** Suscripción vencida o suspendida: no se pueden crear ni activar sedes. */
  readonly subscriptionBlocked: boolean;
}

export function evaluateBranchAccess(input: BranchAccessInput): BranchAccess {
  const activeCount = input.branches.filter((branch) => branch.active).length;
  const limit = input.tier === "multi" ? null : SINGLE_TIER_ACTIVE_BRANCH_LIMIT;
  const overLimit = limit !== null && activeCount > limit;

  if (input.subscriptionBlocked) {
    return {
      tier: input.tier,
      activeCount,
      limit,
      canCreate: false,
      canActivate: false,
      overLimit,
      reason: "subscription_blocked",
      upgradeRequired: false,
      message: "Tu suscripción no está activa. Renuévala para crear o reactivar sucursales.",
    };
  }

  const atLimit = limit !== null && activeCount >= limit;
  if (atLimit) {
    return {
      tier: input.tier,
      activeCount,
      limit,
      canCreate: false,
      canActivate: false,
      overLimit,
      reason: "plan_limit",
      upgradeRequired: true,
      message: overLimit
        ? `Tu plan incluye ${limit} sucursal activa y tienes ${activeCount}. Pasa a Multi-Sucursal para mantenerlas todas.`
        : "Tu plan incluye 1 sucursal. Pasa a Multi-Sucursal para agregar más sedes.",
    };
  }

  return {
    tier: input.tier,
    activeCount,
    limit,
    canCreate: true,
    canActivate: true,
    overLimit,
    reason: "ok",
    upgradeRequired: false,
    message: null,
  };
}

export interface BranchInput {
  readonly name: string;
  readonly address: string;
  readonly phone: string;
}

export type BranchField = keyof BranchInput;

export type BranchValidation =
  | { readonly ok: true; readonly value: BranchInput }
  | { readonly ok: false; readonly errors: Partial<Record<BranchField, string>> };

const NAME_MIN = 2;
const NAME_MAX = 80;
const ADDRESS_MAX = 200;
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;
const PHONE_ALLOWED = /^[+\d\s().-]+$/;

function nameKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

export function validateBranchInput(
  input: BranchInput,
  existing: readonly BranchSummary[],
  editingId: string | null,
): BranchValidation {
  const name = input.name.trim().replace(/\s+/g, " ");
  const address = input.address.trim();
  const phone = input.phone.trim();
  const errors: Partial<Record<BranchField, string>> = {};

  if (name.length < NAME_MIN) {
    errors.name = "Escribe el nombre de la sucursal (mínimo 2 letras).";
  } else if (name.length > NAME_MAX) {
    errors.name = `El nombre no puede pasar de ${NAME_MAX} caracteres.`;
  } else if (existing.some((branch) => branch.id !== editingId && nameKey(branch.name) === nameKey(name))) {
    errors.name = "Ya existe una sucursal con ese nombre.";
  }

  if (address.length > ADDRESS_MAX) {
    errors.address = `La dirección no puede pasar de ${ADDRESS_MAX} caracteres.`;
  }

  if (phone.length > 0) {
    const digits = phone.replace(/\D/g, "").length;
    if (!PHONE_ALLOWED.test(phone) || digits < PHONE_MIN_DIGITS || digits > PHONE_MAX_DIGITS) {
      errors.phone = "Escribe un teléfono válido (entre 7 y 15 números).";
    }
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { name, address, phone } };
}

export interface GuardResult {
  readonly allowed: boolean;
  readonly message: string | null;
}

const ALLOWED: GuardResult = { allowed: true, message: null };

export function canDeactivateBranch(branch: BranchSummary, branches: readonly BranchSummary[]): GuardResult {
  if (!branch.active) return ALLOWED;
  if (branch.is_main) {
    return { allowed: false, message: "No puedes desactivar la sucursal principal. Marca otra como principal primero." };
  }
  const otherActive = branches.filter((other) => other.id !== branch.id && other.active).length;
  if (otherActive === 0) {
    return { allowed: false, message: "Debe quedar al menos una sucursal activa." };
  }
  return ALLOWED;
}

export function canDeleteBranch(branch: BranchSummary): GuardResult {
  if (branch.is_main) {
    return { allowed: false, message: "No se puede eliminar la sucursal principal." };
  }
  return ALLOWED;
}

export function canSetMainBranch(branch: BranchSummary): GuardResult {
  if (branch.is_main) return { allowed: false, message: "Esta sucursal ya es la principal." };
  if (!branch.active) {
    return { allowed: false, message: "Reactiva la sucursal antes de marcarla como principal." };
  }
  return ALLOWED;
}