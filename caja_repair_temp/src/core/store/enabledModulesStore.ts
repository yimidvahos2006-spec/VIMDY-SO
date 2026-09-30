import { ObservableStore } from "./ObservableStore";
import type { ModuleId } from "../config/modules";

/**
 * Módulos activos del negocio actual (Fase 3 — Onboarding inteligente,
 * PASO 4). VimdySidebar se suscribe a este store para mostrar/ocultar
 * ítems del menú automáticamente.
 *
 * `null` = todavía no se sabe (sesión cargando, o negocio sin terminar el
 * onboarding). En ese estado el Sidebar NO oculta nada — mejor mostrar de
 * más mientras carga que ocultar por error un módulo que sí debería verse.
 *
 * Se hidrata real desde Supabase en AuthContext (hydrateBusinessConfig) y
 * se actualiza en vivo cuando el PASO 4 del onboarding guarda los módulos.
 */
class EnabledModulesStore extends ObservableStore<ModuleId[] | null> {
  constructor() {
    super(null);
  }

  get() {
    return this.snapshot;
  }

  set(modules: ModuleId[]) {
    this.publish(modules);
  }

  clear() {
    this.publish(null);
  }
}

export const enabledModulesStore = new EnabledModulesStore();