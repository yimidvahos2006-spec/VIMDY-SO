import type { BusinessTypeId } from "./businessTypes";

/**
 * onboardingCategories.ts
 * ---------------------------------------------------------------------------
 * Catálogo de categorías automáticas de VIMDY (Fase 3 — Onboarding
 * inteligente, PASO 7). Única fuente de verdad: CategoriesStep.tsx lee de
 * aquí según el tipo de negocio elegido en el PASO 3, y las crea de
 * verdad en Supabase a través de CategoryEngine.
 *
 * Las sugerencias solo aplican a los tipos F&B seleccionables en el onboarding.
 * Los valores legacy permanecen para compatibilidad de datos históricos, no
 * para ofrecer sectores fuera del alcance en nuevos registros.
 */
export const DEFAULT_CATEGORIES_BY_BUSINESS_TYPE: Record<BusinessTypeId, string[]> = {
  restaurante: ["Entradas", "Platos Fuertes", "Bebidas", "Postres"],
  cafeteria: ["Cafés", "Bebidas Frías", "Panadería", "Postres"],
  pizzeria: ["Pizzas", "Entradas", "Bebidas", "Postres"],
  asadero: ["Carnes", "Acompañamientos", "Bebidas", "Postres"],
  bar: ["Cervezas", "Cócteles", "Licores", "Snacks"],
  panaderia: ["Panes", "Pasteles", "Bebidas", "Snacks"],
  pasteleria: ["Tortas", "Porciones", "Postres", "Bebidas"],
  reposteria: ["Tortas", "Postres", "Galletas", "Bebidas"],
  jugueria: ["Jugos", "Batidos", "Frutas", "Snacks"],
  catering: ["Menús", "Entradas", "Platos fuertes", "Postres"],
  comedor: ["Desayunos", "Almuerzos", "Bebidas", "Adicionales"],
  cadena: ["Alimentos", "Bebidas", "Complementos", "Postres"],
  tienda: ["Aseo", "Bebidas", "Snacks", "Lácteos"],
  heladeria: ["Helados", "Toppings", "Bebidas", "Postres"],
  hotel: ["Habitaciones", "Restaurante", "Bebidas", "Servicios"],
  food_truck: ["Platos Principales", "Bebidas", "Snacks", "Postres"],
  comida_rapida: ["Hamburguesas", "Pollo", "Bebidas", "Snacks"],
  minimercado: ["Aseo", "Bebidas", "Snacks", "Lácteos"],
  pequeno_supermercado: ["Aseo", "Bebidas", "Snacks", "Lácteos", "Frutas", "Verduras"],
  negocio_bebidas: ["Bebidas Frías", "Bebidas Calientes", "Snacks", "Licores"],
  negocio_productos: ["Productos", "Accesorios", "Snacks", "Bebidas"],
  negocio_servicios: ["Servicios", "Productos", "Snacks", "Bebidas"],
  otro: []
};

export function getDefaultCategoriesForBusinessType(businessType: BusinessTypeId): string[] {
  return DEFAULT_CATEGORIES_BY_BUSINESS_TYPE[businessType] ?? [];
}