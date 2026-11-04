import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../presentation/context/AuthContext";
import {
  RESTART_TOUR_EVENT,
  advance,
  finish,
  goBack,
  initialProgress,
  isTerminal,
  onboardingLocalStore,
  resolveCurrentStep,
  resolveProgress,
  skip,
  type OnboardingProgress,
  type OnboardingStepId
} from "../core/onboarding/onboardingTour";
import {
  fetchOnboardingProgress,
  saveOnboardingProgress
} from "../infrastructure/supabase/onboardingProgressRepository";
import { logWarning } from "../infrastructure/logging/opsLogger";

/** Si Supabase no responde en este tiempo, seguimos con lo que haya en local. */
const REMOTE_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ONBOARDING_PROGRESS_TIMEOUT")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Estado del tour guiado, persistido en dos capas:
 *
 *  - localStorage: respuesta inmediata y funciona sin internet (un POS se cae
 *    de red; el tour no debe depender de ella).
 *  - Supabase (`user_onboarding_progress`): recuerda el tour entre
 *    dispositivos y navegadores. Es "best effort": un fallo se registra y se
 *    reintenta en la próxima carga, nunca interrumpe la operación.
 *
 * Si no hay copia local y Supabase no responde, NO se muestra el tour esa
 * sesión: preferimos no repetírselo a alguien que ya lo vio.
 */
export function useOnboardingProgress(steps: readonly OnboardingStepId[]) {
  const { user, businessId } = useAuth();
  const userId = user?.id ?? null;

  const [fresh] = useState(() => initialProgress());
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [ready, setReady] = useState(false);
  const [statusUnknown, setStatusUnknown] = useState(false);
  const [snoozed, setSnoozed] = useState(false);

  // Los callbacks leen siempre el valor más reciente, sin quedar con uno viejo.
  const progressRef = useRef<OnboardingProgress | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  /* ---- Carga inicial (local -> Supabase) ---- */
  useEffect(() => {
    progressRef.current = null;
    setProgress(null);
    setReady(false);
    setStatusUnknown(false);
    setSnoozed(false);
    if (!userId || !businessId) return;

    let cancelled = false;
    const local = onboardingLocalStore.read(userId, businessId);
    setSnoozed(onboardingLocalStore.isSnoozed(userId, businessId));

    const applyLoaded = (value: OnboardingProgress | null) => {
      progressRef.current = value;
      setProgress(value);
      setReady(true);
    };

    const flush = (value: OnboardingProgress) => {
      saveOnboardingProgress(userId, businessId, value)
        .then(() => {
          if (progressRef.current === value) {
            onboardingLocalStore.write(userId, businessId, { progress: value, pendingSync: false });
          }
        })
        .catch((error: unknown) => {
          logWarning("No se pudo sincronizar el progreso del tour", {
            category: "sync",
            context: { error: error instanceof Error ? error.message : String(error) }
          });
        });
    };

    // Ya terminó o lo omitió en este navegador: no hace falta preguntarle a la red.
    if (local && isTerminal(local.progress.status)) {
      applyLoaded(local.progress);
      if (local.pendingSync) flush(local.progress);
      return () => {
        cancelled = true;
      };
    }

    withTimeout(fetchOnboardingProgress(userId, businessId), REMOTE_TIMEOUT_MS)
      .then((remote) => {
        if (cancelled) return;
        const merged = resolveProgress(local?.progress ?? null, remote);
        if (merged) {
          const fromLocal = merged === local?.progress;
          onboardingLocalStore.write(userId, businessId, {
            progress: merged,
            pendingSync: fromLocal && local?.pendingSync === true
          });
          if (fromLocal && local?.pendingSync) flush(merged);
        }
        applyLoaded(merged);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logWarning("No se pudo leer el progreso del tour", {
          category: "sync",
          context: { error: error instanceof Error ? error.message : String(error) }
        });
        if (local) {
          applyLoaded(local.progress);
        } else {
          setStatusUnknown(true);
          applyLoaded(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userId, businessId]);

  /* ---- Escritura: local al instante, Supabase en segundo plano ---- */
  const persist = useCallback(
    (next: OnboardingProgress) => {
      if (!userId || !businessId) return;
      progressRef.current = next;
      setProgress(next);
      onboardingLocalStore.write(userId, businessId, { progress: next, pendingSync: true });

      saveOnboardingProgress(userId, businessId, next)
        .then(() => {
          // Si mientras tanto hubo un cambio más nuevo, ese es el que decide el flag.
          if (progressRef.current === next) {
            onboardingLocalStore.write(userId, businessId, { progress: next, pendingSync: false });
          }
        })
        .catch((error: unknown) => {
          logWarning("No se pudo guardar el progreso del tour", {
            category: "sync",
            context: { error: error instanceof Error ? error.message : String(error) }
          });
        });
    },
    [userId, businessId]
  );

  const base = useCallback(() => progressRef.current ?? initialProgress(), []);

  const next = useCallback(() => persist(advance(base(), stepsRef.current)), [persist, base]);
  const skipStep = useCallback(
    () => persist(advance(base(), stepsRef.current, { markCompleted: false })),
    [persist, base]
  );
  const back = useCallback(() => persist(goBack(base(), stepsRef.current)), [persist, base]);
  const skipTour = useCallback(() => persist(skip(base())), [persist, base]);
  const complete = useCallback(() => persist(finish(base())), [persist, base]);

  /** Cerrar sin omitir: se oculta en esta sesión y se retoma donde iba la próxima vez. */
  const snooze = useCallback(() => {
    if (!userId || !businessId) return;
    onboardingLocalStore.snooze(userId, businessId);
    setSnoozed(true);
  }, [userId, businessId]);

  const restart = useCallback(() => {
    if (!userId || !businessId) return;
    onboardingLocalStore.clearSnooze(userId, businessId);
    setSnoozed(false);
    setStatusUnknown(false);
    setReady(true);
    persist(initialProgress());
  }, [userId, businessId, persist]);

  // "Repetir el tour" desde Ayuda / Configuración.
  useEffect(() => {
    window.addEventListener(RESTART_TOUR_EVENT, restart);
    return () => window.removeEventListener(RESTART_TOUR_EVENT, restart);
  }, [restart]);

  const effective = progress ?? fresh;

  return {
    /** Ya sabemos si esta persona vio el tour (o se agotó el tiempo de espera). */
    ready,
    /** false si no se pudo confirmar el estado y no hay copia local: no molestar. */
    statusKnown: ready && !statusUnknown,
    status: effective.status,
    snoozed,
    currentStep: resolveCurrentStep(effective, steps),
    completedSteps: effective.completedSteps,
    next,
    skipStep,
    back,
    skipTour,
    complete,
    snooze,
    restart
  };
}