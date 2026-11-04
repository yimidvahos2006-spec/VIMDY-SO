import React, { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, Package, Rocket, ShoppingCart, X } from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { useEnabledModules } from "../../../core/store/useEnabledModules";
import { useSidebar } from "../../../core/store/useSidebar";
import { useCashierShiftStatus } from "../../../hooks/useCashierShiftStatus";
import { useOnboardingProgress } from "../../../hooks/useOnboardingProgress";
import {
  STEP_DEFS,
  buildTourSteps,
  type OnboardingStepId
} from "../../../core/onboarding/onboardingTour";
import { logError } from "../../../infrastructure/logging/opsLogger";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyModal } from "../ui/VimdyModal";

/**
 * OnboardingTour — Bot Guía de 3 minutos.
 *
 * Flujo: Bienvenida (modal) -> Crear plato/insumo (tarjeta) -> Probar Caja
 * (tarjeta) -> Final (modal). Solo se muestran los pasos que la persona puede
 * hacer con su rol y los módulos de su negocio (ver buildTourSteps).
 *
 * Los pasos de acción son una tarjeta FLOTANTE y no un modal: la persona tiene
 * que poder usar Inventario y Caja mientras la guía sigue ahí.
 *
 * Salidas, siempre a la vista:
 *   - "Omitir tour": definitivo (queda guardado, no vuelve a aparecer).
 *   - X / Esc / clic afuera: solo lo oculta esta sesión; lo retoma después.
 */

interface StepCopy {
  label: string;
  title: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

const STEP_COPY: Record<Exclude<OnboardingStepId, "welcome" | "done">, StepCopy> = {
  create_item: { label: "Crea tu primer plato o insumo", title: "Crea tu primer plato o insumo", Icon: Package },
  use_pos: { label: "Abre tu turno y prueba la Caja", title: "Prueba la Caja", Icon: ShoppingCart }
};

/** Barra segmentada: un tramo por paso, lleno hasta el paso actual. */
function StepBar({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex gap-1" aria-hidden="true">
      {Array.from({ length: total }, (_, index) => (
        <div
          key={index}
          className={`h-1 flex-1 rounded-full transition-colors duration-vimdy-normal ${
            index <= current ? "bg-vimdy-accent" : "bg-vimdy-border"
          }`}
        />
      ))}
    </div>
  );
}

/** Solo se monta en el paso de Caja: consulta el turno únicamente cuando hace falta. */
function ShiftOpenHint() {
  const isOpen = useCashierShiftStatus();
  if (!isOpen) return null;
  return (
    <p className="mt-vimdy-sm flex items-center gap-1.5 text-vimdy-small text-vimdy-success" role="status">
      <Check size={16} /> Turno abierto: ya puedes vender.
    </p>
  );
}

/**
 * El tour es opcional: si algo en él truena, se apaga en silencio. El
 * ErrorBoundary global mostraría una pantalla de error a pantalla completa,
 * y un cajero no puede perder la caja por una guía de bienvenida.
 */
class TourErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    logError(error, { category: "unknown", context: { where: "OnboardingTour" } });
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function OnboardingTourContent() {
  const { user, can, onboardingCompleted } = useAuth();
  const enabledModules = useEnabledModules();
  const { expanded } = useSidebar();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const steps = useMemo(() => buildTourSteps({ can, enabledModules }), [can, enabledModules]);
  const tour = useOnboardingProgress(steps);

  const visible =
    onboardingCompleted && steps.length > 0 && tour.statusKnown && tour.status === "in_progress" && !tour.snoozed;
  if (!visible) return null;

  const current = tour.currentStep;
  const currentIndex = steps.indexOf(current);
  const actionSteps = steps.filter((id) => STEP_DEFS[id].kind === "card") as Array<keyof typeof STEP_COPY>;
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? "";

  /* ---------------- Bienvenida ---------------- */
  if (current === "welcome") {
    return (
      <VimdyModal
        open
        onClose={tour.snooze}
        size="sm"
        title={firstName ? `¡Bienvenido a VIMDY, ${firstName}!` : "¡Bienvenido a VIMDY!"}
      >
        <div className="space-y-vimdy-md">
          <StepBar total={steps.length} current={currentIndex} />
          <p className="text-vimdy-small text-vimdy-text-secondary">
            En unos 3 minutos te llevamos de la mano por lo esencial para que hagas tu primera venta:
          </p>

          <ol className="space-y-vimdy-sm">
            {actionSteps.map((id, index) => {
              const { label, Icon } = STEP_COPY[id];
              return (
                <li
                  key={id}
                  className="flex items-center gap-3 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface p-vimdy-sm"
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-vimdy-sm bg-vimdy-surface-active text-vimdy-accent-hover">
                    <Icon size={18} />
                  </span>
                  <span className="text-vimdy-small text-vimdy-text">
                    <span className="text-vimdy-text-tertiary">{index + 1}. </span>
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="flex items-center justify-between gap-vimdy-sm pt-vimdy-xs">
            <VimdyButton variant="ghost" size="sm" onClick={tour.skipTour}>
              Omitir tour
            </VimdyButton>
            <VimdyButton onClick={tour.next}>Empezar</VimdyButton>
          </div>
          <p className="text-center text-vimdy-micro text-vimdy-text-tertiary">
            Si cierras esta ventana, la retomas la próxima vez que entres.
          </p>
        </div>
      </VimdyModal>
    );
  }

  /* ---------------- Final ---------------- */
  if (current === "done") {
    return (
      <VimdyModal open onClose={tour.complete} size="sm" title="¡Todo listo!">
        <div className="space-y-vimdy-md">
          <StepBar total={steps.length} current={currentIndex} />
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-vimdy-md bg-vimdy-success-bg text-vimdy-success">
              <Rocket size={20} />
            </span>
            <p className="text-vimdy-small text-vimdy-text-secondary">
              Ya conoces lo esencial de VIMDY. Esto fue lo que recorrimos:
            </p>
          </div>

          <ul className="space-y-vimdy-sm">
            {actionSteps.map((id) => {
              const done = tour.completedSteps.includes(id);
              return (
                <li key={id} className="flex items-center gap-2 text-vimdy-small">
                  <span
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
                      done ? "bg-vimdy-success-bg text-vimdy-success" : "bg-vimdy-surface-active text-vimdy-text-tertiary"
                    }`}
                    aria-hidden="true"
                  >
                    {done ? <Check size={12} /> : null}
                  </span>
                  <span className={done ? "text-vimdy-text" : "text-vimdy-text-tertiary"}>
                    {STEP_COPY[id].label}
                    {done ? "" : " (pendiente)"}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between gap-vimdy-sm pt-vimdy-xs">
            <VimdyButton variant="ghost" size="sm" onClick={tour.back}>
              Atrás
            </VimdyButton>
            <VimdyButton onClick={tour.complete}>Terminar</VimdyButton>
          </div>
        </div>
      </VimdyModal>
    );
  }

  /* ---------------- Pasos de acción (tarjeta flotante) ---------------- */
  const def = STEP_DEFS[current];
  const copy = STEP_COPY[current as keyof typeof STEP_COPY];
  const route = def.route ?? "/";
  const onRoute = pathname === route || pathname.startsWith(`${route}/`);
  const position = actionSteps.indexOf(current as keyof typeof STEP_COPY) + 1;

  const primaryLabel =
    current === "create_item"
      ? onRoute ? "Ya lo creé" : "Ir a Inventario"
      : onRoute ? "Ya lo probé" : "Ir a Caja";

  function handlePrimary() {
    if (onRoute) {
      tour.next();
      return;
    }
    // Caja abre en "Venta rápida"; el turno se abre en la pestaña "Turno".
    navigate(route, current === "use_pos" ? { state: { tab: "turno" } } : undefined);
  }

  return (
    <section
      role="region"
      aria-label="Guía de inicio"
      className={`
        fixed z-40
        bottom-20 left-4 right-4
        md:bottom-6 md:right-auto md:w-[360px]
        ${expanded ? "md:left-[284px]" : "md:left-[108px]"}
        transition-[left] duration-300
        animate-vimdy-slide-up
        rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface shadow-vimdy-lg
        p-vimdy-md
      `}
    >
      <div className="flex items-center gap-vimdy-sm">
        <div className="flex-1">
          <StepBar total={steps.length} current={currentIndex} />
        </div>
        <button
          type="button"
          onClick={tour.snooze}
          aria-label="Cerrar guía (la retomas la próxima vez)"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-vimdy-text-secondary transition-colors duration-vimdy-fast hover:bg-vimdy-surface-hover hover:text-vimdy-text"
        >
          <X size={18} />
        </button>
      </div>

      <p className="mt-vimdy-md text-vimdy-micro uppercase text-vimdy-text-tertiary">
        Paso {position} de {actionSteps.length}
      </p>
      <h2 className="mt-1 text-vimdy-h3 text-vimdy-text">{copy.title}</h2>

      {current === "create_item" ? (
        <div className="mt-vimdy-sm space-y-vimdy-sm text-vimdy-small text-vimdy-text-secondary">
          <p>
            Un <span className="font-semibold text-vimdy-warning">insumo</span> es lo que compras y guardas (arroz,
            pollo). Un <span className="font-semibold text-vimdy-accent-hover">producto</span> es lo que vendes en
            Caja.
          </p>
          {onRoute ? (
            <p className="text-vimdy-text">
              Toca «Nuevo producto» (pestaña Productos) o «Nuevo insumo» (pestaña Insumos) y guárdalo.
            </p>
          ) : (
            <p>Empieza con uno; después agregas el resto.</p>
          )}
        </div>
      ) : (
        <div className="mt-vimdy-sm space-y-vimdy-sm text-vimdy-small text-vimdy-text-secondary">
          <p>Abre tu turno con el efectivo inicial y arma una cuenta con el producto que creaste.</p>
          {onRoute ? (
            <p className="text-vimdy-text">
              En la pestaña «Turno» toca «Abrir turno»; luego, en «Venta rápida», agrega tu producto.
            </p>
          ) : null}
          <ShiftOpenHint />
        </div>
      )}

      <div className="mt-vimdy-md">
        <VimdyButton fullWidth onClick={handlePrimary}>
          {primaryLabel}
        </VimdyButton>
      </div>

      <div className="mt-vimdy-sm flex items-center justify-between gap-vimdy-xs">
        <div className="flex items-center gap-vimdy-xs">
          <VimdyButton variant="ghost" size="sm" onClick={tour.back}>
            Atrás
          </VimdyButton>
          <VimdyButton variant="ghost" size="sm" onClick={tour.skipStep}>
            Saltar paso
          </VimdyButton>
        </div>
        <VimdyButton variant="ghost" size="sm" onClick={tour.skipTour}>
          Omitir tour
        </VimdyButton>
      </div>
    </section>
  );
}

export function OnboardingTour() {
  return (
    <TourErrorBoundary>
      <OnboardingTourContent />
    </TourErrorBoundary>
  );
}

export default OnboardingTour;