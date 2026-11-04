import { useEffect, useSyncExternalStore } from "react";

import { getKitchenAudio, type KitchenAudioStatus } from "../core/services/kitchenAudio";
import { enableKitchenAudio } from "../core/services/kitchenAlertService";

/**
 * Estado del audio de Cocina + acción para habilitarlo.
 * `enable` debe llamarse directamente desde un onClick (gesto del usuario).
 */
export function useKitchenAudio(): { status: KitchenAudioStatus; enable: () => Promise<void> } {
  const audio = getKitchenAudio();

  useEffect(() => {
    audio.start();
    return () => audio.stop();
  }, [audio]);

  const status = useSyncExternalStore(audio.subscribe, audio.getStatus, audio.getStatus);

  return { status, enable: enableKitchenAudio };
}