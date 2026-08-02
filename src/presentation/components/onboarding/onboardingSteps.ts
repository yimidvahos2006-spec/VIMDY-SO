/**
 * FASE 3 — Onboarding inteligente.
 *
 * Roadmap real del asistente (PASO 2 al PASO 11 del documento de producto).
 * Este archivo solo define el tipo y el orden de los pasos — es la única
 * fuente de verdad de "qué sigue" para que OnboardingPage.tsx no tenga que
 * cambiar cada vez que se agrega un paso nuevo.
 *
 * IMPORTANTE: que un paso esté listado aquí NO significa que ya esté
 * construido. Cada paso se implementa uno por uno, con datos reales en
 * Supabase, en entregas separadas. Ver ONBOARDING_STEPS_BUILT más abajo
 * para saber cuáles ya están conectados de verdad.
 */
export type OnboardingStepId =
  | "welcome" // PASO 2 — Bienvenida
  | "business_type" // PASO 3 — Tipo de negocio
  | "modules" // PASO 4 — Módulos según tipo de negocio
  | "tables" // PASO 5 — Número de mesas
  | "employees" // PASO 6 — Empleados (opcional)
  | "categories" // PASO 7 — Categorías del negocio
  | "first_product" // PASO 8 — Primer producto
  | "cash_opening" // PASO 9 — Apertura de caja
  | "loading" // PASO 10 — Animación de configuración
  | "final"; // PASO 11 — Pantalla final

export const ONBOARDING_STEP_ORDER: OnboardingStepId[] = [
  "welcome",
  "business_type",
  "modules",
  "tables",
  "employees",
  "categories",
  "first_product",
  "cash_opening",
  "loading",
  "final"
];

/**
 * Pasos que YA están construidos y conectados a Supabase de verdad.
 * Se actualiza en cada entrega. Cualquier paso que no esté aquí se
 * muestra en OnboardingPage como "en construcción" — nunca con datos
 * simulados.
 *
 * Con esta entrega (PASO 5 al PASO 11) el asistente queda completo.
 */
export const ONBOARDING_STEPS_BUILT: OnboardingStepId[] = [
  "welcome",
  "business_type",
  "modules",
  "tables",
  "employees",
  "categories",
  "first_product",
  "cash_opening",
  "loading",
  "final"
];

/**
 * Avanza al siguiente paso de la lista, sin ningún criterio de negocio.
 * Se usa tal cual para todos los pasos salvo "modules" -> "tables", que
 * pasa por resolveAfterModules() para decidir si el PASO 5 aplica.
 */
export function nextOnboardingStep(current: OnboardingStepId): OnboardingStepId {
  const index = ONBOARDING_STEP_ORDER.indexOf(current);
  const next = ONBOARDING_STEP_ORDER[index + 1];
  return next ?? current;
}

/**
 * PASO 5 (mesas) es el único paso condicional del asistente: el documento
 * de producto dice "Si el negocio usa mesas: preguntar...". Un negocio
 * como Tienda o Panadería no tiene el módulo "mesas" activo (ver PASO 4 /
 * modules.ts), así que no tiene sentido preguntarle cuántas mesas tiene.
 * OnboardingPage llama a esta función justo después de "modules" en vez
 * de nextOnboardingStep() a secas.
 */
export function resolveAfterModules(enabledModules: readonly string[]): OnboardingStepId {
  return enabledModules.includes("mesas") ? "tables" : "employees";
}