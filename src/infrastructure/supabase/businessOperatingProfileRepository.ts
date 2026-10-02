/**
 * businessOperatingProfileRepository.ts
 * ---------------------------------------------------------------------------
 * Fuente REAL de la configuración operativa de un negocio.
 *
 * Regla: businessType describe el negocio; NO habilita capacidades por sí
 * solo. La configuración persistida en `businesses` es la autoridad para
 * decidir qué puede mostrar el Dashboard.
 */

import { supabase } from "./supabaseClient";
import { isStoredBusinessTypeId, type BusinessTypeId } from "../../core/config/businessTypes";
import { MODULE_CATALOG, type ModuleId } from "../../core/config/modules";
import {
  type InventoryType,
  type OperationConfig,
  type ProductionMode,
  type SalesChannel,
} from "../../core/config/operation";
import {
  buildBusinessOperatingProfile,
  type BusinessOperatingProfile,
} from "../../core/config/businessOperatingProfile";

export interface BusinessOperatingProfileRow {
  readonly business_type: string | null;
  readonly enabled_modules: unknown;
  readonly sales_channels: unknown;
  readonly inventory_type: string | null;
  readonly production_mode: string | null;
  readonly kds_enabled: boolean;
  readonly printer_enabled: boolean;
  readonly salida_cocina?: string | null;
  readonly service_mode?: string | null;
  readonly tables_enabled?: boolean | null;
  readonly waiter_mode_enabled?: boolean | null;
  readonly waiter_photos_enabled?: boolean | null;
  readonly kitchen_enabled?: boolean | null;
  readonly kitchen_output_mode?: string | null;
  readonly prep_stations?: unknown;
}

const SALES_CHANNELS = new Set<SalesChannel>([
  "presencial",
  "llevar",
  "domicilio",
  "web",
  "plataformas",
]);

const INVENTORY_TYPES = new Set<InventoryType>([
  "ingredientes",
  "productos",
  "ambos",
]);

const PRODUCTION_MODES = new Set<ProductionMode>([
  "on_demand",
  "batch",
  "ambos",
]);

const SERVICE_MODES = new Set<NonNullable<OperationConfig["serviceMode"]>>([
  "counter",
  "table_service",
  "both",
]);

const KITCHEN_OUTPUT_MODES = new Set<NonNullable<OperationConfig["kitchenOutputMode"]>>([
  "none",
  "kds",
  "printer",
  "both",
]);

type PrepStationType = NonNullable<OperationConfig["prepStations"]>[number]["type"];

const PREP_STATION_TYPES = new Set<PrepStationType>([
  "kitchen",
  "bar",
  "coffee",
  "dessert",
  "pickup",
  "other",
]);

const MODULE_IDS = new Set<ModuleId>(MODULE_CATALOG.map((module) => module.id));

function assertBusinessId(businessId: string): string {
  const normalized = businessId.trim();
  if (!normalized) {
    throw new Error("BUSINESS_CONTEXT_REQUIRED: se requiere un businessId válido.");
  }
  return normalized;
}

function parseBusinessType(value: string | null): BusinessTypeId | null {
  if (value === null || value.trim() === "") return null;
  if (!isStoredBusinessTypeId(value)) {
    throw new Error("BUSINESS_CONFIG_INVALID: business_type no reconocido.");
  }
  return value;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`BUSINESS_CONFIG_INVALID: ${field} debe ser un arreglo de texto.`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function parseModules(value: unknown): ModuleId[] {
  const raw = parseStringArray(value, "enabled_modules");
  const invalid = raw.find((module) => !MODULE_IDS.has(module as ModuleId));
  if (invalid) {
    throw new Error(`BUSINESS_CONFIG_INVALID: módulo no reconocido (${invalid}).`);
  }
  return raw as ModuleId[];
}

function parseSalesChannels(value: unknown): SalesChannel[] {
  const raw = parseStringArray(value, "sales_channels");
  const invalid = raw.find((channel) => !SALES_CHANNELS.has(channel as SalesChannel));
  if (invalid) {
    throw new Error(`BUSINESS_CONFIG_INVALID: canal de venta no reconocido (${invalid}).`);
  }
  return raw as SalesChannel[];
}

function parseNullableEnum<T extends string>(
  value: string | null,
  allowed: ReadonlySet<T>,
  field: string,
): T | null {
  if (value === null || value.trim() === "") return null;
  if (!allowed.has(value as T)) {
    throw new Error(`BUSINESS_CONFIG_INVALID: ${field} no reconocido.`);
  }
  return value as T;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`BUSINESS_CONFIG_INVALID: ${field} debe ser booleano.`);
  }
  return value;
}

function parsePrepStations(value: unknown): OperationConfig["prepStations"] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("BUSINESS_CONFIG_INVALID: prep_stations debe ser un arreglo.");
  }

  return value.map((station, index) => {
    if (!station || typeof station !== "object") {
      throw new Error(`BUSINESS_CONFIG_INVALID: prep_stations[${index}] inválida.`);
    }

    const candidate = station as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const type = candidate.type;
    const enabled = candidate.enabled;

    if (!id || !name || typeof type !== "string" || !PREP_STATION_TYPES.has(type as PrepStationType) || typeof enabled !== "boolean") {
      throw new Error(`BUSINESS_CONFIG_INVALID: prep_stations[${index}] inválida.`);
    }

    return {
      id,
      name,
      type: type as PrepStationType,
      enabled,
    };
  });
}

export function parseBusinessOperatingProfileRow(
  businessId: string,
  row: BusinessOperatingProfileRow,
): BusinessOperatingProfile {
  const normalizedBusinessId = assertBusinessId(businessId);
  const businessType = parseBusinessType(row.business_type);
  const enabledModules = parseModules(row.enabled_modules);
  const kdsEnabled = parseBoolean(row.kds_enabled, "kds_enabled");
  const printerEnabled = parseBoolean(row.printer_enabled, "printer_enabled");

  const tablesExplicit = typeof row.tables_enabled === "boolean" ? row.tables_enabled : enabledModules.includes("mesas");
  const kitchenExplicit = typeof row.kitchen_enabled === "boolean" ? row.kitchen_enabled : enabledModules.includes("cocina");
  const waiterExplicit = typeof row.waiter_mode_enabled === "boolean"
    ? row.waiter_mode_enabled
    : false;

  const serviceMode = row.service_mode === undefined || row.service_mode === null || row.service_mode.trim() === ""
    ? (tablesExplicit ? "both" : "counter")
    : parseNullableEnum(row.service_mode, SERVICE_MODES, "service_mode") ?? (tablesExplicit ? "both" : "counter");

  const fallbackOutputMode = row.salida_cocina === "impresora" ? "printer"
    : row.salida_cocina === "ambos" ? "both"
    : (kdsEnabled && printerEnabled) ? "both"
    : printerEnabled ? "printer"
    : kdsEnabled ? "kds"
    : kitchenExplicit ? "kds" : "none";

  const kitchenOutputMode = row.kitchen_output_mode === undefined || row.kitchen_output_mode === null || row.kitchen_output_mode.trim() === ""
    ? fallbackOutputMode
    : parseNullableEnum(row.kitchen_output_mode, KITCHEN_OUTPUT_MODES, "kitchen_output_mode") ?? fallbackOutputMode;

  const operationConfig: OperationConfig = {
    serviceMode,
    tablesEnabled: tablesExplicit,
    waiterModeEnabled: waiterExplicit,
    waiterPhotosEnabled: typeof row.waiter_photos_enabled === "boolean" ? row.waiter_photos_enabled : true,
    kitchenEnabled: kitchenExplicit,
    kitchenOutputMode,
    prepStations: parsePrepStations(row.prep_stations),
    salesChannels: parseSalesChannels(row.sales_channels),
    inventoryType: parseNullableEnum(row.inventory_type, INVENTORY_TYPES, "inventory_type"),
    productionMode: parseNullableEnum(row.production_mode, PRODUCTION_MODES, "production_mode"),
    kdsEnabled,
    printerEnabled,
  };

  return buildBusinessOperatingProfile({
    businessId: normalizedBusinessId,
    businessType,
    enabledModules,
    operationConfig,
  });
}

/**
 * Lee la configuración operativa persistida de Supabase.
 *
 * Consulta las columnas operativas de Supabase con fallback resiliente para
 * garantizar funcionamiento continuo tanto antes como después de migraciones.
 */
export async function loadBusinessOperatingProfile(
  businessId: string,
): Promise<BusinessOperatingProfile> {
  const normalizedBusinessId = assertBusinessId(businessId);

  // Intento 1: consulta con columnas avanzadas
  const fullCols =
    "business_type, enabled_modules, sales_channels, inventory_type, production_mode, kds_enabled, printer_enabled, salida_cocina, service_mode, tables_enabled, waiter_mode_enabled, waiter_photos_enabled, kitchen_enabled, kitchen_output_mode, prep_stations";

  const primary = await supabase
    .from("businesses")
    .select(fullCols)
    .eq("id", normalizedBusinessId)
    .maybeSingle();

  let data: BusinessOperatingProfileRow | null = primary.data
    ? (primary.data as unknown as BusinessOperatingProfileRow)
    : null;

  // Intento 2: fallback a columnas base si las columnas nuevas aún no están migradas en DB remota.
  // Los campos nuevos son opcionales en BusinessOperatingProfileRow, por lo que aquí
  // se completa explícitamente su ausencia en vez de forzar un objeto parcial a
  // través de una asignación incompatible.
  if (primary.error) {
    const baseCols =
      "business_type, enabled_modules, sales_channels, inventory_type, production_mode, kds_enabled, printer_enabled, salida_cocina";

    const fallback = await supabase
      .from("businesses")
      .select(baseCols)
      .eq("id", normalizedBusinessId)
      .maybeSingle();

    if (fallback.error) {
      throw new Error(`BUSINESS_CONFIG_LOAD_FAILED: ${fallback.error.message}`);
    }

    data = fallback.data
      ? ({
          ...(fallback.data as unknown as BusinessOperatingProfileRow),
          service_mode: undefined,
          tables_enabled: undefined,
          waiter_mode_enabled: undefined,
          waiter_photos_enabled: undefined,
          kitchen_enabled: undefined,
          kitchen_output_mode: undefined,
          prep_stations: undefined,
        } satisfies BusinessOperatingProfileRow)
      : null;
  }

  if (!data) {
    throw new Error("BUSINESS_CONFIG_NOT_FOUND: no existe configuración para el negocio activo.");
  }

  return parseBusinessOperatingProfileRow(
    normalizedBusinessId,
    data as unknown as BusinessOperatingProfileRow,
  );
}
