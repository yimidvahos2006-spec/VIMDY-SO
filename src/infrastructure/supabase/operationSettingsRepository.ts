/**
 * operationSettingsRepository.ts
 * ---------------------------------------------------------------------------
 * Escritura de Configuración > Operación en Supabase.
 *
 * Todo se guarda con UN SOLO `UPDATE` sobre la fila del negocio: los módulos
 * activos, las columnas de operación y las reglas de venta (`settings`)
 * cambian juntos o no cambian. Así Caja, Meseros o Cocina nunca ven una
 * mezcla de configuración vieja y nueva.
 */

import { supabase } from "./supabaseClient";
import type { ModuleId } from "../../core/config/modules";
import type { KitchenOutputModeConfig, OperationConfig } from "../../core/config/operation";
import type { BusinessSettingsBlob } from "./businessSettings";

/** Columnas de `businesses` que escribe esta pantalla (no incluye `settings`). */
export interface OperatingProfileColumns {
  readonly enabled_modules: ModuleId[];
  readonly sales_channels: OperationConfig["salesChannels"];
  readonly inventory_type: OperationConfig["inventoryType"];
  readonly production_mode: OperationConfig["productionMode"];
  readonly kds_enabled: boolean;
  readonly printer_enabled: boolean;
  readonly service_mode: NonNullable<OperationConfig["serviceMode"]>;
  readonly tables_enabled: boolean;
  readonly waiter_mode_enabled: boolean;
  readonly waiter_photos_enabled: boolean;
  readonly kitchen_enabled: boolean;
  readonly kitchen_output_mode: KitchenOutputModeConfig;
  readonly prep_stations: NonNullable<OperationConfig["prepStations"]>;
  /** Columna heredada: no admite "none", se conserva un valor válido para clientes antiguos. */
  readonly salida_cocina: "impresora" | "ambos" | "pantalla";
}

export function buildOperatingProfileColumns(
  modules: readonly ModuleId[],
  config: OperationConfig,
): OperatingProfileColumns {
  const tablesEnabled = config.tablesEnabled ?? false;
  const outputMode = config.kitchenOutputMode ?? "none";
  return {
    enabled_modules: [...modules],
    sales_channels: [...config.salesChannels],
    inventory_type: config.inventoryType,
    production_mode: config.productionMode,
    kds_enabled: config.kdsEnabled,
    printer_enabled: config.printerEnabled,
    service_mode: config.serviceMode ?? (tablesEnabled ? "both" : "counter"),
    tables_enabled: tablesEnabled,
    waiter_mode_enabled: config.waiterModeEnabled ?? false,
    waiter_photos_enabled: config.waiterPhotosEnabled ?? true,
    kitchen_enabled: config.kitchenEnabled ?? false,
    kitchen_output_mode: outputMode,
    prep_stations: [...(config.prepStations ?? [])],
    salida_cocina: outputMode === "printer" ? "impresora" : outputMode === "both" ? "ambos" : "pantalla",
  };
}

export interface PersistOperationSettingsInput {
  readonly businessId: string;
  readonly modules: readonly ModuleId[];
  readonly config: OperationConfig;
  readonly settings: BusinessSettingsBlob;
}

export async function persistOperationSettings(input: PersistOperationSettingsInput): Promise<void> {
  const businessId = input.businessId.trim();
  if (!businessId) {
    throw new Error("No hay un negocio activo. Vuelve a iniciar sesión.");
  }

  const row = {
    ...buildOperatingProfileColumns(input.modules, input.config),
    settings: input.settings,
  };

  const { data, error } = await supabase.from("businesses").update(row).eq("id", businessId).select("id");

  if (error) {
    const message = error.message ?? "";
    if (/column|schema/i.test(message)) {
      throw new Error("Falta actualizar la base de datos (columnas de operación). Avísale a soporte.");
    }
    throw new Error(message || "No se pudo guardar la configuración del negocio.");
  }

  // RLS: si el usuario no es administrador o el plan venció, Supabase responde
  // sin error pero con 0 filas. Eso NO es "guardado".
  if (!data || data.length === 0) {
    throw new Error(
      "No se guardó. Solo el administrador puede cambiar la operación y el plan debe estar activo.",
    );
  }
}

/**
 * Interruptor global "Mostrar fotos en tarjetas": cambia SOLO la columna
 * `businesses.waiter_photos_enabled` (ya tiene GRANT UPDATE por columna y la
 * misma RLS de administrador que el resto de la operación). Es un UPDATE
 * puntual para no pisar otros ajustes que el dueño esté editando en
 * Configuración > Operación.
 */
export async function persistWaiterPhotosEnabled(businessId: string, enabled: boolean): Promise<void> {
  const id = businessId.trim();
  if (!id) {
    throw new Error("No hay un negocio activo. Vuelve a iniciar sesión.");
  }

  const { data, error } = await supabase
    .from("businesses")
    .update({ waiter_photos_enabled: enabled })
    .eq("id", id)
    .select("id");

  if (error) {
    throw new Error(`WAITER_PHOTOS_SAVE_FAILED: ${error.message ?? ""}`.trim());
  }

  // RLS: un usuario que no es administrador recibe 0 filas, sin error.
  if (!data || data.length === 0) {
    throw new Error("WAITERS_FORBIDDEN: solo el administrador puede cambiar este ajuste.");
  }
}

/** Lee el valor vigente del interruptor (para que otros dispositivos se pongan al día). `null` si no se pudo leer. */
export async function fetchWaiterPhotosEnabled(businessId: string): Promise<boolean | null> {
  const id = businessId.trim();
  if (!id) return null;

  const { data, error } = await supabase
    .from("businesses")
    .select("waiter_photos_enabled")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  const value = (data as { waiter_photos_enabled?: unknown }).waiter_photos_enabled;
  return typeof value === "boolean" ? value : null;
}