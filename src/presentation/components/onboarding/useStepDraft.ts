import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { useAuth } from "../../context/AuthContext";
import { onboardingStepDraft } from "./onboardingDraftStore";

/**
 * Como useState, pero lo que el usuario elige o escribe en un paso del
 * onboarding se guarda al instante y se recupera si sale de la página o
 * recarga. `sanitize` valida lo guardado: si no es válido devuelve null y se
 * usa `initial`. No guardar contraseñas aquí.
 */
export function useStepDraft<T>(
  step: string,
  initial: T,
  sanitize: (raw: unknown) => T | null
): [T, Dispatch<SetStateAction<T>>] {
  const { user, businessId } = useAuth();
  const userId = user?.id ?? "";
  const scopeId = businessId ?? "";

  const [value, setValue] = useState<T>(() => {
    const raw = onboardingStepDraft.read(userId, scopeId, step);
    if (raw === null || raw === undefined) return initial;

    try {
      return sanitize(raw) ?? initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    onboardingStepDraft.write(userId, scopeId, step, value);
  }, [userId, scopeId, step, value]);

  return [value, setValue];
}