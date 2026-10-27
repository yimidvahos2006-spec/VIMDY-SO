/**
 * Fuente única de verdad del onboarding de VIMDY.
 *
 * Los pasos reales que ve el usuario son:
 * 1. Bienvenida
 * 2. Tu negocio (nombre, NIT/cédula, moneda, ciudad)
 * 3. Tipo de negocio
 * 4. Módulos
 * 5. Empleados
 * 6. Categorías
 * 7. Primer producto
 * 8. Apertura de caja
 *
 * "Mesas" NO es una pantalla independiente: se configura dentro de
 * ModulesStep. "final" es la pantalla de cierre y no participa en el
 * contador 1..8. No hay pantalla de "carga" falsa: todo lo que se muestra
 * ya fue guardado de verdad en cada paso.
 */
export type OnboardingStepId =
  | "welcome"
  | "business_identity"
  | "business_type"
  | "modules"
  | "employees"
  | "categories"
  | "first_product"
  | "cash_opening"
  | "final";

export const ONBOARDING_STEP_ORDER: OnboardingStepId[] = [
  "welcome",
  "business_identity",
  "business_type",
  "modules",
  "employees",
  "categories",
  "first_product",
  "cash_opening",
  "final"
];

export const ONBOARDING_STEPS_BUILT: OnboardingStepId[] = [...ONBOARDING_STEP_ORDER];

export const ONBOARDING_PROGRESS_STEPS: OnboardingStepId[] = [
  "welcome",
  "business_identity",
  "business_type",
  "modules",
  "employees",
  "categories",
  "first_product",
  "cash_opening"
];

export const ONBOARDING_BACK_ENABLED_STEPS: OnboardingStepId[] = [
  "business_identity",
  "business_type",
  "modules",
  "employees",
  "categories",
  "first_product",
  "cash_opening"
];

/**
 * Texto "Paso N de M" de un paso. Sale de ONBOARDING_PROGRESS_STEPS, la misma
 * lista que usa la barra de progreso, para que los contadores NUNCA se
 * desalineen si algún día se agrega o quita un paso. Devuelve "" para
 * pantallas que no cuentan (como "final").
 */
export function onboardingStepLabel(step: OnboardingStepId): string {
  const index = ONBOARDING_PROGRESS_STEPS.indexOf(step);
  if (index < 0) return "";
  return `Paso ${index + 1} de ${ONBOARDING_PROGRESS_STEPS.length}`;
}

export function nextOnboardingStep(current: OnboardingStepId): OnboardingStepId {
  const index = ONBOARDING_STEP_ORDER.indexOf(current);
  return ONBOARDING_STEP_ORDER[index + 1] ?? current;
}

/**
 * Paso anterior al actual. Welcome no tiene anterior; final es la pantalla
 * de cierre (ya se guardó todo), por eso no se puede volver desde ahí.
 */
export function prevOnboardingStep(current: OnboardingStepId): OnboardingStepId {
  if (!canGoBackFromStep(current)) return current;
  const index = ONBOARDING_STEP_ORDER.indexOf(current);
  return ONBOARDING_STEP_ORDER[index - 1] ?? current;
}

export function canGoBackFromStep(current: OnboardingStepId): boolean {
  return ONBOARDING_BACK_ENABLED_STEPS.includes(current);
}

export function resolveAfterModules(): OnboardingStepId {
  return "employees";
}