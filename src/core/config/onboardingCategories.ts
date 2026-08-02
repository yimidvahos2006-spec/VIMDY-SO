import type { BusinessTypeId } from "./businessTypes";

/**
 * onboardingCategories.ts
 * ---------------------------------------------------------------------------
 * Catálogo de categorías automáticas de VIMDY (Fase 3 — Onboarding
 * inteligente, PASO 7). Única fuente de verdad: CategoriesStep.tsx lee de
 * aquí según el tipo de negocio elegido en el PASO 3, y las crea de
 * verdad en Supabase a través de CategoryEngine.
 *
 * Los dos casos que vinieron especificados en el documento de producto son
 * "restaurante" (Entradas, Platos Fuertes, Bebidas, Postres) y "tienda"
 * (Aseo, Bebidas, Snacks, Lácteos). El resto se completó con un criterio
 * razonable según cómo vende cada tipo de negocio — igual que ya se hizo
 * en modules.ts con DEFAULT_MODULES_BY_BUSINESS_TYPE. Es 100% ajustable:
 * cambiar el negocio de lista aquí es lo único que hace falta.
 */
export const DEFAULT_CATEGORIES_BY_BUSINESS_TYPE: Record<BusinessTypeId, string[]> = {
  restaurante: ["Entradas", "Platos Fuertes", "Bebidas", "Postres"],
  cafeteria: ["Cafés", "Bebidas Frías", "Panadería", "Postres"],
  pizzeria: ["Pizzas", "Entradas", "Bebidas", "Postres"],
  asadero: ["Carnes", "Acompañamientos", "Bebidas", "Postres"],
  bar: ["Cervezas", "Cócteles", "Licores", "Snacks"],
  panaderia: ["Panes", "Pasteles", "Bebidas", "Snacks"],
  tienda: ["Aseo", "Bebidas", "Snacks", "Lácteos"],
  heladeria: ["Helados", "Toppings", "Bebidas", "Postres"],
  hotel: ["Habitaciones", "Restaurante", "Bebidas", "Servicios"],
  food_truck: ["Platos Principales", "Bebidas", "Snacks", "Postres"]
};

export function getDefaultCategoriesForBusinessType(businessType: BusinessTypeId): string[] {
  return DEFAULT_CATEGORIES_BY_BUSINESS_TYPE[businessType] ?? [];
}