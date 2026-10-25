import { supabase } from "./supabaseClient";
import type { Business } from "../../core/store/businessStore";
import type { CompanyConfig } from "../../core/store/companyConfigStore";

/**
 * Ajustes del negocio que se guardan en `businesses.settings` (jsonb).
 * Nombre, país, moneda, idioma, zona horaria e IVA van en columnas propias.
 */
export interface BusinessSettingsBlob {
  nit?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  whatsappOrders?: string;
  autoPrintReceipt?: boolean;
  enableAI?: boolean;
  dailySalesGoal?: number;
  electronicInvoicing?: { enabled: boolean; provider: string };
}

export interface BusinessSettingsRow {
  name: string;
  country: string;
  currency: string;
  language: string;
  timezone: string;
  tax_rate: number;
  settings: BusinessSettingsBlob;
}

const text = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" ? v.trim().slice(0, max) : undefined;

const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

function clampNumber(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

/** Convierte lo que el dueño editó en lo que se escribe en la base. Valida y limpia. */
export function buildBusinessSettingsUpdate(
  business: Business,
  config: CompanyConfig
): BusinessSettingsRow {
  const name = (business.name ?? "").trim();
  if (!name) throw new Error("El nombre del negocio no puede quedar vacío.");

  const tax = clampNumber(config.tax, 0, 100);
  if (tax === undefined) throw new Error("El IVA debe ser un número entre 0 y 100.");

  return {
    name: name.slice(0, 120),
    country: config.country,
    currency: config.currency,
    language: config.language,
    timezone: config.timezone,
    tax_rate: tax,
    settings: {
      nit: text(business.nit, 40) ?? "",
      phone: text(business.phone, 40) ?? "",
      email: text(business.email, 120) ?? "",
      address: text(business.address, 200) ?? "",
      city: text(business.city, 80) ?? "",
      whatsappOrders: text(business.whatsappOrders, 40) ?? "",
      autoPrintReceipt: !!config.autoPrintReceipt,
      enableAI: !!config.enableAI,
      dailySalesGoal: clampNumber(config.dailySalesGoal, 0, 100_000_000_000) ?? 0,
      electronicInvoicing: {
        enabled: !!config.electronicInvoicing?.enabled,
        provider: config.electronicInvoicing?.enabled
          ? String(config.electronicInvoicing.provider)
          : "none"
      }
    }
  };
}

/**
 * Lo contrario: de la fila de la base a lo que se aplica en las stores.
 * Un campo que no está guardado se omite (no pisa el valor actual).
 */
export function readBusinessSettings(blob: unknown): {
  business: Partial<Business>;
  config: Partial<CompanyConfig>;
} {
  const s = (blob && typeof blob === "object" ? blob : {}) as Record<string, unknown>;
  const business: Partial<Business> = {};
  const config: Partial<CompanyConfig> = {};

  const nit = text(s.nit, 40);
  if (nit !== undefined) business.nit = nit;
  const phone = text(s.phone, 40);
  if (phone !== undefined) business.phone = phone;
  const email = text(s.email, 120);
  if (email !== undefined) business.email = email;
  const address = text(s.address, 200);
  if (address !== undefined) business.address = address;
  const city = text(s.city, 80);
  if (city !== undefined) business.city = city;
  const wa = text(s.whatsappOrders, 40);
  if (wa !== undefined) business.whatsappOrders = wa;

  const auto = bool(s.autoPrintReceipt);
  if (auto !== undefined) config.autoPrintReceipt = auto;
  const ai = bool(s.enableAI);
  if (ai !== undefined) config.enableAI = ai;
  const goal = clampNumber(s.dailySalesGoal, 0, 100_000_000_000);
  if (goal !== undefined) config.dailySalesGoal = goal;

  const inv = s.electronicInvoicing as { enabled?: unknown; provider?: unknown } | undefined;
  if (inv && typeof inv === "object" && typeof inv.enabled === "boolean") {
    config.electronicInvoicing = {
      enabled: inv.enabled,
      provider: (inv.enabled && typeof inv.provider === "string"
        ? inv.provider
        : "none") as CompanyConfig["electronicInvoicing"]["provider"]
    };
  }
  return { business, config };
}

/** Guarda en la base. Lanza un mensaje claro si no se pudo (nunca falla en silencio). */
export async function saveBusinessSettings(
  businessId: string,
  business: Business,
  config: CompanyConfig
): Promise<void> {
  const row = buildBusinessSettingsUpdate(business, config);
  const { data, error } = await supabase
    .from("businesses")
    .update(row)
    .eq("id", businessId)
    .select("id");

  if (error) {
    if (/settings/i.test(error.message ?? "") && /column|schema/i.test(error.message ?? "")) {
      throw new Error(
        "Falta actualizar la base de datos (columna de ajustes). Avísale a soporte."
      );
    }
    throw new Error(error.message || "No se pudieron guardar los ajustes.");
  }
  // RLS: si el usuario no es administrador o el plan venció, Supabase responde
  // sin error pero con 0 filas. Eso NO es "guardado".
  if (!data || data.length === 0) {
    throw new Error(
      "No se guardó. Solo el administrador puede cambiar los ajustes y el plan debe estar activo."
    );
  }
}

/** Carga los ajustes extra. Devuelve null si no se pueden leer (no rompe el inicio de sesión). */
export async function fetchBusinessSettings(
  businessId: string
): Promise<ReturnType<typeof readBusinessSettings> | null> {
  try {
    const { data, error } = await supabase
      .from("businesses")
      .select("settings")
      .eq("id", businessId)
      .maybeSingle();
    if (error || !data) return null;
    return readBusinessSettings((data as { settings?: unknown }).settings);
  } catch {
    return null;
  }
}