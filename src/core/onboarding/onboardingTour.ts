import type { ModuleId } from "../config/modules";
import { ROUTE_PERMISSIONS, hasAnyPermission } from "../config/roleAccess";

/**
 * onboardingTour
 * ---------------------------------------------------------------------------
 * Lógica PURA del Bot Guía de 3 minutos (sin React, sin Supabase): qué pasos
 * existen, cuáles le tocan a cada persona y cómo avanza el progreso.
 * Vive aparte para poder probarla con vitest sin DOM.
 *
 * Regla de oro: el tour solo manda a una pantalla a la que la persona SÍ puede
 * entrar. Los permisos y módulos se evalúan con los mismos datos que usan las
 * rutas (ROUTE_PERMISSIONS + RequireModule), así el botón "Ir a Caja" nunca
 * termina en "Acceso denegado".
 */

export const ONBOARDING_TOUR_ID = "first_minutes_v1";

export type OnboardingStepId = "welcome" | "create_item" | "use_pos" | "done";
export type OnboardingStatus = "in_progress" | "completed" | "skipped";

export interface OnboardingProgress {
  status: OnboardingStatus;
  currentStep: OnboardingStepId;
  completedSteps: OnboardingStepId[];
  /** Epoch ms. Decide qué copia gana cuando local y Supabase difieren. */
  updatedAt: number;
}

export interface OnboardingStepDef {
  id: OnboardingStepId;
  /** "modal" = bloquea la pantalla (bienvenida/cierre); "card" = flotante, deja usar la app. */
  kind: "modal" | "card";
  /** Pantalla a la que lleva el paso (solo pasos de acción). */
  route?: string;
}

export const STEP_DEFS: Readonly<Record<OnboardingStepId, OnboardingStepDef>> = {
  welcome: { id: "welcome", kind: "modal" },
  create_item: { id: "create_item", kind: "card", route: "/inventario" },
  use_pos: { id: "use_pos", kind: "card", route: "/caja" },
  done: { id: "done", kind: "modal" }
};

const ALL_STEPS: readonly OnboardingStepId[] = ["welcome", "create_item", "use_pos", "done"];

export interface StepContext {
  can: (permissionId: string) => boolean;
  /** `null` = todavía no se sabe (mismo criterio que enabledModulesStore). */
  enabledModules: readonly ModuleId[] | null;
}

function moduleOn(ctx: StepContext, module: ModuleId): boolean {
  // Mientras carga no se oculta nada (igual que el Sidebar).
  return ctx.enabledModules === null || ctx.enabledModules.includes(module);
}

/**
 * Pasos que le corresponden a esta persona, en orden. Si no hay NINGÚN paso de
 * acción (ej. un mesero o cocina) devuelve [] y el tour no se muestra: una
 * bienvenida sin nada que hacer es solo ruido.
 */
export function buildTourSteps(ctx: StepContext): OnboardingStepId[] {
  const action: OnboardingStepId[] = [];

  if (
    moduleOn(ctx, "inventario") &&
    hasAnyPermission(ctx.can, ROUTE_PERMISSIONS["/inventario"]) &&
    ctx.can("inventory.create")
  ) {
    action.push("create_item");
  }

  if (moduleOn(ctx, "caja") && hasAnyPermission(ctx.can, ROUTE_PERMISSIONS["/caja"])) {
    action.push("use_pos");
  }

  return action.length === 0 ? [] : ["welcome", ...action, "done"];
}

export function isTerminal(status: OnboardingStatus): boolean {
  return status === "completed" || status === "skipped";
}

export function initialProgress(now: number = Date.now()): OnboardingProgress {
  return { status: "in_progress", currentStep: "welcome", completedSteps: [], updatedAt: now };
}

/** Si el paso guardado ya no le aplica (cambió de rol/módulos), cae en un paso válido. */
export function resolveCurrentStep(progress: OnboardingProgress, steps: readonly OnboardingStepId[]): OnboardingStepId {
  if (steps.includes(progress.currentStep)) return progress.currentStep;
  const firstPending = steps.find((id) => !progress.completedSteps.includes(id));
  return firstPending ?? "done";
}

/**
 * Pasa al siguiente paso. Por defecto marca el actual como hecho; con
 * `markCompleted: false` ("Saltar este paso") avanza sin contarlo como logrado.
 * En el último paso no avanza más.
 */
export function advance(
  progress: OnboardingProgress,
  steps: readonly OnboardingStepId[],
  options: { now?: number; markCompleted?: boolean } = {}
): OnboardingProgress {
  const { now = Date.now(), markCompleted = true } = options;
  const current = resolveCurrentStep(progress, steps);
  const index = steps.indexOf(current);
  if (index === -1 || index >= steps.length - 1) return progress;

  const completed =
    !markCompleted || progress.completedSteps.includes(current)
      ? progress.completedSteps
      : [...progress.completedSteps, current];

  return { ...progress, status: "in_progress", currentStep: steps[index + 1], completedSteps: completed, updatedAt: now };
}

export function goBack(
  progress: OnboardingProgress,
  steps: readonly OnboardingStepId[],
  now: number = Date.now()
): OnboardingProgress {
  const index = steps.indexOf(resolveCurrentStep(progress, steps));
  if (index <= 0) return progress;
  return { ...progress, currentStep: steps[index - 1], updatedAt: now };
}

export function finish(progress: OnboardingProgress, now: number = Date.now()): OnboardingProgress {
  const completed = progress.completedSteps.includes("done")
    ? progress.completedSteps
    : [...progress.completedSteps, "done" as const];
  return { ...progress, status: "completed", currentStep: "done", completedSteps: completed, updatedAt: now };
}

export function skip(progress: OnboardingProgress, now: number = Date.now()): OnboardingProgress {
  return { ...progress, status: "skipped", updatedAt: now };
}

/**
 * Al reconciliar local con Supabase: un estado terminal (completado u omitido)
 * siempre gana a uno en curso — si omitió en otro dispositivo, no se lo
 * volvemos a mostrar —; si ambos son del mismo tipo, gana el más reciente.
 */
export function resolveProgress(
  local: OnboardingProgress | null,
  remote: OnboardingProgress | null
): OnboardingProgress | null {
  if (!local) return remote;
  if (!remote) return local;
  const localDone = isTerminal(local.status);
  const remoteDone = isTerminal(remote.status);
  if (localDone !== remoteDone) return localDone ? local : remote;
  return local.updatedAt >= remote.updatedAt ? local : remote;
}

function isStepId(value: unknown): value is OnboardingStepId {
  return typeof value === "string" && (ALL_STEPS as readonly string[]).includes(value);
}

/** Valida datos que vienen de afuera (localStorage / Supabase). Nunca lanza. */
export function parseProgress(value: unknown): OnboardingProgress | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  if (raw.status !== "in_progress" && raw.status !== "completed" && raw.status !== "skipped") return null;
  const currentStep = isStepId(raw.currentStep) ? raw.currentStep : "welcome";
  const completedSteps = Array.isArray(raw.completedSteps)
    ? Array.from(new Set(raw.completedSteps.filter(isStepId)))
    : [];
  const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;

  return { status: raw.status, currentStep, completedSteps, updatedAt };
}

/* ---------------------------------------------------------------------------
   Copia local (localStorage) + "posponer" de la sesión (sessionStorage)
--------------------------------------------------------------------------- */

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface LocalRecord {
  progress: OnboardingProgress;
  /** true = hay un cambio que Supabase todavía no recibió (estaba sin conexión). */
  pendingSync: boolean;
}

function safeStorage(kind: "local" | "session"): StorageLike | null {
  try {
    return kind === "local" ? globalThis.localStorage ?? null : globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

const keyFor = (userId: string, businessId: string) =>
  `vimdy:onboarding-tour:v1:${ONBOARDING_TOUR_ID}:${userId}:${businessId}`;
const snoozeKeyFor = (userId: string, businessId: string) =>
  `vimdy:onboarding-tour:snooze:${ONBOARDING_TOUR_ID}:${userId}:${businessId}`;

export const onboardingLocalStore = {
  read(userId: string, businessId: string, storage: StorageLike | null = safeStorage("local")): LocalRecord | null {
    if (!storage) return null;
    try {
      const text = storage.getItem(keyFor(userId, businessId));
      if (!text) return null;
      const data = JSON.parse(text) as { progress?: unknown; pendingSync?: unknown };
      const progress = parseProgress(data.progress);
      return progress ? { progress, pendingSync: data.pendingSync === true } : null;
    } catch {
      return null;
    }
  },

  write(
    userId: string,
    businessId: string,
    record: LocalRecord,
    storage: StorageLike | null = safeStorage("local")
  ): void {
    if (!storage) return;
    try {
      storage.setItem(keyFor(userId, businessId), JSON.stringify(record));
    } catch {
      /* Sin localStorage (modo privado / cuota): el tour sigue funcionando con Supabase. */
    }
  },

  isSnoozed(userId: string, businessId: string, storage: StorageLike | null = safeStorage("session")): boolean {
    if (!storage) return false;
    try {
      return storage.getItem(snoozeKeyFor(userId, businessId)) === "1";
    } catch {
      return false;
    }
  },

  snooze(userId: string, businessId: string, storage: StorageLike | null = safeStorage("session")): void {
    try {
      storage?.setItem(snoozeKeyFor(userId, businessId), "1");
    } catch {
      /* Si no se puede recordar, el peor caso es que reaparezca al recargar. */
    }
  },

  clearSnooze(userId: string, businessId: string, storage: StorageLike | null = safeStorage("session")): void {
    try {
      storage?.removeItem(snoozeKeyFor(userId, businessId));
    } catch {
      /* ver snooze() */
    }
  }
};

/** Evento para que Ayuda/Configuración pidan "Repetir el tour" sin acoplarse al componente. */
export const RESTART_TOUR_EVENT = "vimdy:onboarding-tour:restart";

export function requestOnboardingTourRestart(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RESTART_TOUR_EVENT));
}