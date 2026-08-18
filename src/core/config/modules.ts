import type { BusinessTypeId } from "./businessTypes";

/**
 * modules.ts
 * ---------------------------------------------------------------------------
 * Catálogo de módulos de VIMDY (Fase 3 — Onboarding inteligente, PASO 4).
 * Única fuente de verdad: el wizard de onboarding y el Sidebar leen de aquí,
 * así que activar/ocultar un módulo para un tipo de negocio es cambiar UNA
 * línea en DEFAULT_MODULES_BY_BUSINESS_TYPE, sin tocar componentes.
 */

export type ModuleId =
  | "mesas"
  | "cocina"
  | "pedidos"
  | "caja"
  | "inventario"
  | "clientes"
  | "ia";

export interface ModuleDefinition {
  id: ModuleId;
  label: string;
  emoji: string;
  /**
   * Ruta real del Sidebar que controla este módulo (ver VimdySidebar.tsx).
   * `null` para módulos que no son una ruta propia del Sidebar:
   *   - "pedidos" es el flujo de tomar pedidos dentro de Mesas/Caja, no
   *     tiene pantalla separada todavía.
   *   - "ia" es el botón flotante "VIMDY IA" / copiloto, no un ítem de menú.
   */
  sidebarPath: string | null;
}

export const MODULE_CATALOG: ModuleDefinition[] = [
  { id: "mesas", label: "Mesas", emoji: "🪑", sidebarPath: "/meseros" },
  { id: "cocina", label: "Cocina", emoji: "👨‍🍳", sidebarPath: "/cocina" },
  { id: "pedidos", label: "Pedidos", emoji: "🧾", sidebarPath: null },
  { id: "caja", label: "Caja", emoji: "💵", sidebarPath: "/caja" },
  { id: "inventario", label: "Inventario", emoji: "📦", sidebarPath: "/inventario" },
  { id: "clientes", label: "Clientes", emoji: "👥", sidebarPath: "/clientes" },
  { id: "ia", label: "IA", emoji: "✦", sidebarPath: null }
];

/**
 * Módulos activos por defecto según el tipo de negocio.
 *
 * Los únicos dos casos que vinieron especificados en el documento de
 * producto son "restaurante" (todo activo) y "tienda" (sin Mesas, Cocina
 * ni Pedidos). El resto se completó con un criterio razonable según cómo
 * opera cada tipo de negocio:
 *   - Restaurante / Pizzería / Asadero / Cafetería / Bar / Hotel: atienden
 *     en mesas y cocinan, así que llevan el set completo.
 *   - Food Truck: cocina pero no tiene mesas (se atiende por ventanilla).
 *   - Panadería / Heladería / Tienda: venta de mostrador, sin mesas ni
 *     cocina ni flujo de pedidos.
 *
 * Esto es 100% ajustable: cambiar el negocio de lista aquí es lo único
 * que hace falta, el wizard y el Sidebar se actualizan solos.
 */
export const DEFAULT_MODULES_BY_BUSINESS_TYPE: Record<BusinessTypeId, ModuleId[]> = {
  restaurante: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  cafeteria: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  pizzeria: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  asadero: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  bar: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  hotel: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  food_truck: ["cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  panaderia: ["caja", "inventario", "clientes", "ia"],
  heladeria: ["caja", "inventario", "clientes", "ia"],
  tienda: ["caja", "inventario", "clientes", "ia"],
  comida_rapida: ["cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  minimercado: ["caja", "inventario", "clientes", "ia"],
  pequeno_supermercado: ["caja", "inventario", "clientes", "ia"],
  negocio_bebidas: ["caja", "inventario", "clientes", "ia"],
  negocio_productos: ["caja", "inventario", "clientes", "ia"],
  negocio_servicios: ["caja", "clientes", "ia"]
};

export function getDefaultModulesForBusinessType(businessType: BusinessTypeId): ModuleId[] {
  return DEFAULT_MODULES_BY_BUSINESS_TYPE[businessType] ?? MODULE_CATALOG.map((m) => m.id);
}