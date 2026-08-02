import React, { useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

import { useSubscription } from "../../../core/store/useSubscription";
import { UpgradeModal } from "./UpgradeModal";

const DISMISS_KEY_PREFIX = "vimdy.subscription.warning.dismissed";

/**
 * SubscriptionWarningBanner
 * ---------------------------------------------------------------------------
 * VIMDY — FASE 7, PASO 4: "Cuando falten 7 / 3 / 1 días, mostrar un aviso
 * elegante. Nunca mostrar mensajes agresivos."
 *
 * Vive en VimdyAppLayout (toda la app), así que aparece en Dashboard,
 * Configuración, Perfil del negocio — donde sea que el usuario esté.
 *
 * Se puede cerrar con la X (no es invasivo), pero vuelve a aparecer si al
 * día siguiente cruza a un umbral más cercano (7 -> 3 -> 1) — cerrarlo una
 * vez no significa "nunca más avisar", solo "ya lo vi por hoy".
 */
export function SubscriptionWarningBanner() {
  const { isTrial, warningThreshold, daysRemaining } = useSubscription();
  const [dismissedThreshold, setDismissedThreshold] = useState<number | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  const dismissKey = useMemo(
    () => `${DISMISS_KEY_PREFIX}:${new Date().toDateString()}:${warningThreshold ?? ""}`,
    [warningThreshold]
  );

  if (!isTrial || warningThreshold === null) return null;
  if (dismissedThreshold === warningThreshold) return null;

  function handleDismiss() {
    setDismissedThreshold(warningThreshold);
    try {
      window.localStorage.setItem(dismissKey, "1");
    } catch {
      // localStorage no disponible: solo se pierde el "recordar" entre recargas.
    }
  }

  return (
    <>
      <div className="fixed bottom-6 right-6 z-[60] w-[360px] max-w-[calc(100vw-2rem)]">
        <div className="rounded-2xl border border-vimdy-warning/30 bg-vimdy-surface/95 backdrop-blur-xl shadow-2xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-vimdy-warning-bg flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={18} className="text-vimdy-warning" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-vimdy-text text-sm font-semibold">
                {daysRemaining === 1
                  ? "Tu prueba termina mañana."
                  : `Tu prueba termina en ${daysRemaining} días.`}
              </p>
              <p className="text-vimdy-text-secondary text-xs mt-1 leading-relaxed">
                Actualiza tu plan para seguir utilizando VIMDY sin interrupciones.
              </p>
              <button
                onClick={() => setUpgrading(true)}
                className="mt-3 bg-vimdy-accent hover:bg-vimdy-accent-hover transition text-white text-xs font-bold px-3.5 py-2 rounded-lg"
              >
                Ver planes
              </button>
            </div>
            <button onClick={handleDismiss} className="text-vimdy-text-tertiary hover:text-vimdy-text flex-shrink-0">
              <X size={16} />
            </button>
          </div>
        </div>
      </div>

      {upgrading && <UpgradeModal onClose={() => setUpgrading(false)} />}
    </>
  );
}