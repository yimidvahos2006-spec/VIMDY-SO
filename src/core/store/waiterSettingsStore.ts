import { useCallback, useEffect, useRef, useState } from "react";

import { useOperationConfig } from "./useOperationConfig";
import { useVimdyEvent } from "../../hooks/useVimdyCore";
import { getCurrentBusinessId } from "../../infrastructure/supabase/supabaseClient";
import {
  WAITER_PHOTOS_DEFAULT,
  refreshWaiterPhotosEnabled,
  setWaiterPhotosEnabled
} from "../services/waiterPhotoSettingsService";
import { translateBusinessError } from "../errors/translateBusinessError";

/**
 * Interruptor global "Mostrar fotos en tarjetas".
 *
 * El valor ya NO es de este dispositivo: sale de la configuración del negocio
 * (`waiterPhotosEnabled`, guardada en Supabase), así el computador del dueño y
 * la tablet del salón siempre muestran lo mismo.
 *
 *  - `showPhotos`: valor vigente (true mientras la configuración carga).
 *  - `toggle()` / `setShowPhotos(v)`: lo cambian para todo el negocio. Solo
 *    el administrador puede; para otros roles el servidor lo rechaza y
 *    `error` trae el motivo.
 *  - `saving`: hay un cambio en camino.
 *
 * Cualquier cambio hecho desde otro dispositivo llega por el aviso de
 * "negocio actualizado" (realtime) y también al abrir la pantalla.
 */
export function useWaiterPhotoVisibility() {
  const config = useOperationConfig();
  const showPhotos = config?.waiterPhotosEnabled ?? WAITER_PHOTOS_DEFAULT;
  const loaded = config !== null;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const refresh = useCallback(() => {
    const businessId = getCurrentBusinessId();
    if (businessId) void refreshWaiterPhotosEnabled(businessId);
  }, []);

  // Al abrir la pantalla, ponerse al día con el servidor.
  useEffect(() => {
    if (loaded) refresh();
  }, [loaded, refresh]);

  // "subscription" = cambio en la fila del negocio hecho desde otro dispositivo.
  useVimdyEvent("subscription", refresh);

  const setShowPhotos = useCallback(async (next: boolean): Promise<boolean> => {
    if (savingRef.current) return false;

    const businessId = getCurrentBusinessId();
    if (!businessId) {
      setError("No hay un negocio activo. Vuelve a iniciar sesión.");
      return false;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await setWaiterPhotosEnabled(businessId, next);
      return true;
    } catch (err) {
      setError(translateBusinessError(err, "No se pudo guardar el ajuste de fotos."));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, []);

  const toggle = useCallback(() => setShowPhotos(!showPhotos), [setShowPhotos, showPhotos]);

  return { showPhotos, loaded, saving, error, toggle, setShowPhotos };
}