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
  | "tienda"
  | "heladeria"
  | "hotel"
  | "food_truck"
  | "comida_rapida"
  | "minimercado"
  | "pequeno_supermercado"
  | "negocio_bebidas"
  | "negocio_productos"
  | "negocio_servicios";

export interface BusinessTypeDefinition {
  id: BusinessTypeId;
  label: string;
  emoji: string;
}

export const BUSINESS_TYPES: BusinessTypeDefinition[] = [
  { id: "restaurante", label: "Restaurante", emoji: "🍔" },
  { id: "cafeteria", label: "Cafetería", emoji: "☕" },
  { id: "pizzeria", label: "Pizzería", emoji: "🍕" },
  { id: "asadero", label: "Asadero", emoji: "🥩" },
  { id: "bar", label: "Bar", emoji: "🍺" },
  { id: "panaderia", label: "Panadería", emoji: "🍰" },
  { id: "tienda", label: "Tienda", emoji: "🛒" },
  { id: "heladeria", label: "Heladería", emoji: "🍦" },
  { id: "hotel", label: "Hotel", emoji: "🏨" },
  { id: "food_truck", label: "Food Truck", emoji: "🚚" },
  { id: "comida_rapida", label: "Comida rápida", emoji: "🍟" },
  { id: "minimercado", label: "Minimercado", emoji: "🏪" },
  { id: "pequeno_supermercado", label: "Pequeño supermercado", emoji: "🏬" },
  { id: "negocio_bebidas", label: "Negocio de bebidas", emoji: "🥤" },
  { id: "negocio_productos", label: "Negocio de productos", emoji: "📦" },
  { id: "negocio_servicios", label: "Negocio de servicios", emoji: "🔧" }
];

export function isBusinessTypeId(value: string): value is BusinessTypeId {
  return BUSINESS_TYPES.some((type) => type.id === value);
}

const BUSINESS_TYPES_WITH_KITCHEN = new Set<BusinessTypeId>([
  "restaurante",
  "cafeteria",
  "pizzeria",
  "asadero",
  "food_truck",
  "comida_rapida",
  "heladeria",
  "panaderia"
]);

export function requiresKitchenByDefaultForBusinessType(businessType: BusinessTypeId): boolean {
  return BUSINESS_TYPES_WITH_KITCHEN.has(businessType);
}
