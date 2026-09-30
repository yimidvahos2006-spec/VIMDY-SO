/**
 * Fuente única de verdad del onboarding de VIMDY.
 *
 * Los pasos reales que ve el usuario son:
 * 1. Bienvenida
 * 2. Tipo de negocio
 * 3. Módulos
 * 4. Empleados
 * 5. Categorías
 * 6. Primer producto
 * 7. Apertura de caja
 *
 * "Mesas" NO es una pantalla independiente: se configura dentro de
 * ModulesStep. "loading" y "final" son pantallas de transición/cierre y no
 * participan en el contador 1..7.
 */
export type OnboardingStepId =
  | "welcome"
  | "business_type"
  | "modules"
  | "employees"
  | "categories"
  | "first_product"
  | "cash_opening"
  | "loading"
  | "final";

export const ONBOARDING_STEP_ORDER: OnboardingStepId[] = [
  "welcome",
  "business_type",
  "modules",
  "employees",
  "categories",
  "first_product",
  "cash_opening",
  "loading",
  "final"
];

export const ONBOARDING_STEPS_BUILT: OnboardingStepId[] = [...ONBOARDING_STEP_ORDER];

export const ONBOARDING_PROGRESS_STEPS: OnboardingStepId[] = [
  "welcome",
  "business_type",
  "modules",
  "employees",
  "categories",
  "first_product",
  "cash_opening"
];

export function nextOnboardingStep(current: OnboardingStepId): OnboardingStepId {
  const index = ONBOARDING_STEP_ORDER.indexOf(current);
  return ONBOARDING_STEP_ORDER[index + 1] ?? current;
}

export function resolveAfterModules(): OnboardingStepId {
  return "employees";
}
