/**
 * businessTypes.ts
 * ---------------------------------------------------------------------------
 * Catálogo de tipos de negocio de VIMDY (Fase 3 — Onboarding inteligente,
 * PASO 3). Única fuente de verdad: el wizard de onboarding, el motor que
 * decide qué módulos activar (PASO 4) y el Sidebar leen todos de aquí, en
 * vez de tener cada uno su propia lista de negocios sueltos.
 */

export type BusinessTypeId =
  | "restaurante"
  | "cafeteria"
  | "pizzeria"
  | "asadero"
  | "bar"
  | "panaderia"
  | "heladeria"
  | "food_truck"
  | "comida_rapida"
  | "negocio_bebidas"
  | "pasteleria"
  | "reposteria"
  | "jugueria"
  | "catering"
  | "comedor"
  | "cadena"
  // Legacy values may still exist on existing businesses; they are not
  // selectable for new onboarding.
  | "tienda"
  | "hotel"
  | "minimercado"
  | "pequeno_supermercado"
  | "negocio_productos"
  | "negocio_servicios"
  | "otro";

export type SupportedBusinessTypeId = Exclude<
  BusinessTypeId,
  | "tienda"
  | "hotel"
  | "minimercado"
  | "pequeno_supermercado"
  | "negocio_productos"
  | "negocio_servicios"
  | "otro"
>;

const LEGACY_BUSINESS_TYPE_IDS: readonly BusinessTypeId[] = [
  "tienda",
  "hotel",
  "minimercado",
  "pequeno_supermercado",
  "negocio_productos",
  "negocio_servicios",
  "otro"
];

export interface BusinessTypeDefinition {
  id: SupportedBusinessTypeId;
  label: string;
  emoji: string;
}

export const BUSINESS_TYPES: readonly BusinessTypeDefinition[] = [
  { id: "restaurante", label: "Restaurante", emoji: "🍔" },
  { id: "comida_rapida", label: "Restaurante rápido", emoji: "🍟" },
  { id: "cafeteria", label: "Cafetería", emoji: "☕" },
  { id: "pizzeria", label: "Pizzería", emoji: "🍕" },
  { id: "asadero", label: "Asadero", emoji: "🥩" },
  { id: "bar", label: "Bar", emoji: "🍺" },
  { id: "panaderia", label: "Panadería", emoji: "🍰" },
  { id: "pasteleria", label: "Pastelería", emoji: "🎂" },
  { id: "reposteria", label: "Repostería", emoji: "🧁" },
  { id: "heladeria", label: "Heladería", emoji: "🍦" },
  { id: "food_truck", label: "Food Truck", emoji: "🚚" },
  { id: "negocio_bebidas", label: "Negocio de bebidas", emoji: "🥤" },
  { id: "jugueria", label: "Juguería", emoji: "🧃" },
  { id: "catering", label: "Catering", emoji: "🍽️" },
  { id: "comedor", label: "Comedor empresarial", emoji: "🍴" },
  { id: "cadena", label: "Cadena gastronómica", emoji: "🏬" }
];

export function isBusinessTypeId(value: string): value is SupportedBusinessTypeId {
  return BUSINESS_TYPES.some((type) => type.id === value);
}

export function isStoredBusinessTypeId(value: string): value is BusinessTypeId {
  return isBusinessTypeId(value) || LEGACY_BUSINESS_TYPE_IDS.some((type) => type === value);
}

/**
 * La cocina NO se habilita por defecto solo por el tipo de negocio.
 * La decisión debe venir de la configuración operativa explícita del negocio
 * (mesas, cocina, producción, sales channels, etc.).
 */
export function requiresKitchenByDefaultForBusinessType(_businessType: BusinessTypeId): boolean {
  return false;
}
