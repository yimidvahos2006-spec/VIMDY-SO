/**
 * useOperationSettings.ts
 * ---------------------------------------------------------------------------
 * Hook de Configuración > Operación: expone el borrador tipado, si hay cambios
 * sin guardar, los avisos de validación y las acciones guardar / descartar.
 *
 * El borrador sigue a los datos reales mientras NO tenga cambios propios, así
 * un refresco en segundo plano (otro dispositivo) nunca pisa lo que el dueño
 * está editando.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { companyConfigStore } from "./companyConfigStore";
import { useOperationConfig } from "./useOperationConfig";
import { useEnabledModules } from "./useEnabledModules";
import {
  draftFromSources,
  hasBlockingIssues,
  isDraftEqual,
  operationDraftReducer,
  validateDraft,
  type DraftIssue,
  type OperationDraft,
  type OperationDraftAction,
} from "../config/operationDraft";
import { saveOperationDraft, type SaveOperationResult } from "../services/operationSettingsService";

export interface UseOperationSettingsResult {
  readonly draft: OperationDraft;
  readonly dispatch: (action: OperationDraftAction) => void;
  /** false mientras todavía no llega la configuración real del negocio. */
  readonly ready: boolean;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly issues: readonly DraftIssue[];
  readonly canSave: boolean;
  readonly save: () => Promise<SaveOperationResult>;
  readonly discard: () => void;
}

const subscribeCompanyConfig = companyConfigStore.subscribe;
const readAutoPrint = (): boolean => companyConfigStore.get().autoPrintReceipt;
const readEnableAI = (): boolean => companyConfigStore.get().enableAI;

export function useOperationSettings(businessId: string | null): UseOperationSettingsResult {
  const operationConfig = useOperationConfig();
  const enabledModules = useEnabledModules();
  const autoPrintReceipt = useSyncExternalStore(subscribeCompanyConfig, readAutoPrint, readAutoPrint);
  const enableAI = useSyncExternalStore(subscribeCompanyConfig, readEnableAI, readEnableAI);

  const baseline = useMemo(
    () => draftFromSources(operationConfig, enabledModules, { autoPrintReceipt, enableAI }),
    [operationConfig, enabledModules, autoPrintReceipt, enableAI],
  );

  const [draft, dispatch] = useReducer(operationDraftReducer, baseline);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const previousBaselineRef = useRef(baseline);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Si el dato real cambió y el borrador no tenía cambios propios, lo seguimos.
  useEffect(() => {
    const previous = previousBaselineRef.current;
    previousBaselineRef.current = baseline;
    if (isDraftEqual(previous, baseline)) return;
    if (isDraftEqual(draft, previous)) {
      dispatch({ type: "replace", draft: baseline });
    }
  }, [baseline, draft]);

  const dirty = !isDraftEqual(draft, baseline);
  const issues = useMemo(() => validateDraft(draft), [draft]);
  const ready = operationConfig !== null;
  const canSave = ready && dirty && !saving && Boolean(businessId) && !hasBlockingIssues(issues);

  const save = useCallback(async (): Promise<SaveOperationResult> => {
    if (!businessId) return { ok: false, message: "No hay un negocio activo. Vuelve a iniciar sesión." };
    if (savingRef.current) return { ok: false, message: "Ya se está guardando la configuración." };

    savingRef.current = true;
    setSaving(true);
    try {
      return await saveOperationDraft({
        businessId,
        draft,
        previousConfig: operationConfig,
        previousModules: enabledModules,
      });
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, [businessId, draft, operationConfig, enabledModules]);

  const discard = useCallback(() => dispatch({ type: "replace", draft: baseline }), [baseline]);

  return { draft, dispatch, ready, dirty, saving, issues, canSave, save, discard };
}