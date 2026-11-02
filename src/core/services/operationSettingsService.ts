/**
 * operationSettingsService.ts
 * ---------------------------------------------------------------------------
 * Caso de uso de Configuración > Operación: "Guardar configuración".
 *
 * Orquesta el guardado completo en este orden y NUNCA deja a medias:
 *
 *   1. Valida el borrador y los datos del negocio ANTES de tocar la base.
 *   2. Escribe TODO en una sola sentencia (módulos + columnas de operación +
 *      reglas de venta en `settings`) vía `persistOperationSettings`.
 *   3. Solo si la base confirmó: refleja las reglas de venta en la sesión y en
 *      el caché local.
 *   4. Relee el perfil operativo para que Caja, Meseros y Cocina vean lo
 *      guardado (`confirmed` indica si esa relectura se pudo verificar).
 *
 * Nunca lanza: devuelve un resultado tipado para que la pantalla muestre el
 * Toast correcto. Los mensajes son siempre legibles (sin códigos técnicos).
 *
 * Nota de diseño — por qué es UPDATE y no `upsert`:
 * `businesses` ya existe (la crea el onboarding). Un `upsert` ejecuta primero
 * el camino INSERT, y ahí la política `businesses_insert_own` exige
 * "trial no usado", `name` es NOT NULL y los permisos de escritura son por
 * columna. Un UPDATE por `id` es igual de atómico (una sola sentencia) y es
 * el único que respeta la RLS de administrador. Ver operationSettingsRepository.
 */

import { businessStore, type Business } from "../store/businessStore";
import { companyConfigStore, type CompanyConfig } from "../store/companyConfigStore";
import { businessOperatingProfileStore } from "../store/businessOperatingProfileStore";
import { hydrateBusinessOperatingProfile } from "../bootstrap/businessOperatingProfileBootstrap";
import { translateBusinessError } from "../errors/translateBusinessError";
import type { ModuleId } from "../config/modules";
import type { OperationConfig } from "../config/operation";
import {
  draftToModules,
  draftToOperationConfig,
  hasBlockingIssues,
  normalizeDraft,
  validateDraft,
  type OperationDraft,
} from "../config/operationDraft";
import {
  buildBusinessSettingsUpdate,
  writeCachedBusinessSettings,
  type BusinessSettingsBlob,
} from "../../infrastructure/supabase/businessSettings";
import {
  persistOperationSettings,
  type PersistOperationSettingsInput,
} from "../../infrastructure/supabase/operationSettingsRepository";

const FALLBACK_SAVE_ERROR = "No se pudo guardar la configuración.";
const NO_BUSINESS_ERROR = "No hay un negocio activo. Vuelve a iniciar sesión.";

export interface SaveOperationInput {
  readonly businessId: string;
  readonly draft: OperationDraft;
  /** Configuración y módulos vigentes: se conservan los campos que esta pantalla no edita. */
  readonly previousConfig: OperationConfig | null;
  readonly previousModules: readonly ModuleId[] | null;
}

export type SaveOperationResult =
  | {
      readonly ok: true;
      /**
       * true  → se guardó y se volvió a leer de la base correctamente.
       * false → se guardó, pero no se pudo verificar la relectura.
       */
      readonly confirmed: boolean;
    }
  | { readonly ok: false; readonly message: string };

/** Dependencias inyectables: permiten probar el flujo sin Supabase ni stores reales. */
export interface SaveOperationDeps {
  readonly persist: (input: PersistOperationSettingsInput) => Promise<void>;
  /** Relee el perfil operativo; true si quedó listo para ese negocio. */
  readonly confirmProfile: (businessId: string) => Promise<boolean>;
  readonly getBusiness: () => Business;
  readonly getCompanyConfig: () => CompanyConfig;
  readonly applyCompanyConfig: (patch: Partial<CompanyConfig>) => void;
  readonly cacheSettings: (businessId: string, blob: BusinessSettingsBlob) => void;
}

const defaultDeps: SaveOperationDeps = {
  persist: persistOperationSettings,
  confirmProfile: async (businessId) => {
    await hydrateBusinessOperatingProfile(businessId);
    const snapshot = businessOperatingProfileStore.get();
    return snapshot.status === "ready" && snapshot.businessId === businessId;
  },
  getBusiness: () => businessStore.get(),
  getCompanyConfig: () => companyConfigStore.get(),
  applyCompanyConfig: (patch) => companyConfigStore.update(patch),
  cacheSettings: writeCachedBusinessSettings,
};

export async function saveOperationDraft(
  input: SaveOperationInput,
  deps: SaveOperationDeps = defaultDeps,
): Promise<SaveOperationResult> {
  const businessId = input.businessId.trim();
  if (!businessId) return { ok: false, message: NO_BUSINESS_ERROR };

  // 1) Validación previa. Se valida el borrador TAL CUAL llegó (no el
  //    normalizado): `normalizeDraft` descartaría en silencio un canal inválido.
  const issues = validateDraft(input.draft);
  if (hasBlockingIssues(issues)) {
    const blocking = issues.find((issue) => issue.severity === "error");
    return { ok: false, message: blocking?.message ?? FALLBACK_SAVE_ERROR };
  }

  try {
    const draft = normalizeDraft(input.draft);
    const salesRules = {
      autoPrintReceipt: draft.salesRules.autoPrintReceipt,
      enableAI: draft.salesRules.enableAI,
    };

    // `buildBusinessSettingsUpdate` valida nombre, IVA, idioma, moneda y zona
    // horaria; si algo está mal lanza ANTES de escribir.
    const { settings } = buildBusinessSettingsUpdate(deps.getBusiness(), {
      ...deps.getCompanyConfig(),
      ...salesRules,
    });

    // 2) Una sola escritura atómica.
    await deps.persist({
      businessId,
      modules: draftToModules(draft, input.previousModules),
      config: draftToOperationConfig(draft, input.previousConfig),
      settings,
    });

    // 3) La base confirmó: ahora sí se refleja en la sesión y en el caché.
    deps.applyCompanyConfig(salesRules);
    deps.cacheSettings(businessId, settings);
  } catch (error: unknown) {
    return { ok: false, message: translateBusinessError(error, FALLBACK_SAVE_ERROR) };
  }

  // 4) Relectura. Un fallo aquí NO deshace el guardado: se informa con `confirmed`.
  let confirmed = false;
  try {
    confirmed = await deps.confirmProfile(businessId);
  } catch {
    confirmed = false;
  }
  return { ok: true, confirmed };
}