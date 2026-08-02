import React, { useEffect, useState } from "react";
import { HeartHandshake, Eye } from "lucide-react";

import { useSubscription } from "../../../core/store/useSubscription";
import { UpgradeModal } from "./UpgradeModal";

/**
 * TrialEndedOverlay
 * ---------------------------------------------------------------------------
 * VIMDY — FASE 7, PASO 5: "Cuando termine el Trial: no eliminar
 * información, no borrar datos, no cerrar la cuenta. Mostrar una pantalla
 * elegante. El usuario debe poder consultar su información, pero no
 * registrar nuevas ventas hasta activar un plan."
 *
 * Por eso esto NO es una redirección que bloquee toda la app (eso sí
 * impediría "consultar información"): aparece una sola vez por sesión al
 * detectar el vencimiento, y se puede cerrar con "Seguir consultando mi
 * información" para navegar con normalidad. El bloqueo real de nuevas
 * ventas ocurre en el punto de cobro (ver assertSubscriptionActive en
 * core/services/checkout.ts), no aquí.
 */
export function TrialEndedOverlay() {
  const { isSuspended, loading } = useSubscription();
  const [dismissed, setDismissed] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  // Si el estado cambia (ej. el usuario activa un plan en otra pestaña),
  // el overlay debe poder volver a mostrarse si vuelve a vencer más adelante.
  useEffect(() => {
    if (!isSuspended) setDismissed(false);
  }, [isSuspended]);

  if (loading || !isSuspended || dismissed) return null;

  return (
    <>
      <div className="fixed inset-0 z-[65] flex items-center justify-center bg-vimdy-background/90 backdrop-blur-md p-4">
        <div className="w-full max-w-md rounded-3xl border border-vimdy-border bg-vimdy-surface p-8 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-vimdy-accent/10 flex items-center justify-center mb-5">
            <HeartHandshake size={30} className="text-vimdy-accent" />
          </div>

          <h2 className="text-vimdy-text text-xl font-bold">Tu prueba gratuita ha finalizado.</h2>
          <p className="text-vimdy-text-secondary text-sm mt-2 leading-relaxed">
            Gracias por confiar en VIMDY. Para continuar administrando tu negocio, activa uno de
            nuestros planes.
          </p>

          <div className="mt-6 space-y-2.5">
            <button
              onClick={() => setUpgrading(true)}
              className="w-full h-12 rounded-xl bg-vimdy-accent hover:bg-vimdy-accent-hover transition text-white font-bold text-sm"
            >
              Actualizar ahora
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="w-full h-11 rounded-xl border border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text hover:border-vimdy-text-tertiary transition text-sm font-medium flex items-center justify-center gap-2"
            >
              <Eye size={15} />
              Seguir consultando mi información
            </button>
          </div>

          <p className="text-vimdy-text-tertiary text-xs mt-5">
            Tu información está segura: ventas, inventario y clientes siguen intactos.
          </p>
        </div>
      </div>

      {upgrading && <UpgradeModal onClose={() => setUpgrading(false)} />}
    </>
  );
}