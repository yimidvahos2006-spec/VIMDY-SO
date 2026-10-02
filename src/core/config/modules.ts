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
 * Módulos por defecto neutrales.
 *
 * El tipo de negocio es una clasificación descriptiva, no la autoridad que
 * habilita módulos. La configuración operativa explícita del negocio (wizard,
 * operationConfig, enabledModules) debe decidir qué módulos están activos.
 *
 * Para evitar que un negocio "restaurante" o "panadería" active módulos por
 * defecto sin que el usuario los confirme, se usa una base mínima y segura.
 */
export const DEFAULT_BASE_MODULES: ModuleId[] = ["caja", "pedidos"];

export function getDefaultModulesForBusinessType(_businessType: BusinessTypeId): ModuleId[] {
  return [...DEFAULT_BASE_MODULES];
}