/**
 * waiterPhotoSettingsService.ts
 * ---------------------------------------------------------------------------
 * Interruptor GLOBAL "Mostrar fotos en tarjetas" de la pantalla Meseros.
 *
 * Antes vivía en localStorage de cada dispositivo: lo que el dueño apagaba en
 * su computador no cambiaba en la tablet del salón. Ahora el valor vive en
 * `businesses.waiter_photos_enabled` (fuente de verdad en Supabase) y se
 * refleja en `operationConfigStore`, así todos los dispositivos del negocio
 * ven lo mismo.
 *
 * Reglas:
 *  - Cambio optimista: la pantalla responde al instante.
 *  - Si el servidor lo rechaza (no eres administrador, sin red...), se vuelve
 *    al valor anterior y se lanza el error ya con código traducible.
 *  - Solo se sube si el usuario puede administrar meseros; los demás roles
 *    únicamente leen el valor.
 */

import { operationConfigStore } from "../store/operationConfigStore";
import {
  fetchWaiterPhotosEnabled,
  persistWaiterPhotosEnabled
} from "../../infrastructure/supabase/operationSettingsRepository";

/** Valor por defecto mientras la configuración no ha cargado (igual que el resto del sistema). */
export const WAITER_PHOTOS_DEFAULT = true;

export function readWaiterPhotosEnabled(): boolean {
  return operationConfigStore.get()?.waiterPhotosEnabled ?? WAITER_PHOTOS_DEFAULT;
}

export interface WaiterPhotoSettingsDeps {
  readonly persist: (businessId: string, enabled: boolean) => Promise<void>;
  readonly fetchRemote: (businessId: string) => Promise<boolean | null>;
}

const defaultDeps: WaiterPhotoSettingsDeps = {
  persist: persistWaiterPhotosEnabled,
  fetchRemote: fetchWaiterPhotosEnabled
};

/**
 * Guarda el interruptor para todo el negocio. Lanza si el servidor no lo
 * confirma (después de revertir el cambio local).
 */
export async function setWaiterPhotosEnabled(
  businessId: string,
  enabled: boolean,
  deps: WaiterPhotoSettingsDeps = defaultDeps
): Promise<void> {
  const previous = readWaiterPhotosEnabled();
  if (previous === enabled && operationConfigStore.get() !== null) return;

  operationConfigStore.patch({ waiterPhotosEnabled: enabled });

  try {
    await deps.persist(businessId, enabled);
  } catch (error) {
    operationConfigStore.patch({ waiterPhotosEnabled: previous });
    throw error;
  }
}

/**
 * Pone este dispositivo al día con el valor del servidor (otro dispositivo pudo
 * cambiarlo). Nunca lanza: si no se puede leer, deja el valor actual.
 */
export async function refreshWaiterPhotosEnabled(
  businessId: string,
  deps: Pick<WaiterPhotoSettingsDeps, "fetchRemote"> = defaultDeps
): Promise<void> {
  try {
    const remote = await deps.fetchRemote(businessId);
    if (remote === null) return;
    if (operationConfigStore.get() === null) return; // la configuración aún no cargó: la hidratación manda
    if (remote !== readWaiterPhotosEnabled()) {
      operationConfigStore.patch({ waiterPhotosEnabled: remote });
    }
  } catch {
    /* sin red: se conserva el último valor conocido */
  }
}