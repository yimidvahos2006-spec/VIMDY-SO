const STORAGE_KEY = "vimdy:intro:shown";
const PENDING_KEY = "vimdy:intro:pending";

/**
 * appIntroStore
 * ---------------------------------------------------------------------------
 * FASE 6, PASO 1 — Intro cinematográfica.
 *
 * La intro es solo para quien CREÓ el negocio: se marca como "pendiente"
 * cuando el ADMIN termina el onboarding (FinalStep) y se muestra una única
 * vez (OnboardingGate, que además exige rol ADMIN). Un cajero, mesero o
 * cocina que entra después, o un ADMIN que inicia sesión en otro navegador,
 * nunca la ve porque ahí no hay marca pendiente.
 *
 * Vive en localStorage y no en Supabase: es solo una cortesía visual, no un
 * dato del negocio. Si localStorage no está disponible no se muestra intro.
 */
class AppIntroStore {
  private key(scope?: string | null): string {
    return scope ? `${STORAGE_KEY}:${scope}` : STORAGE_KEY;
  }

  hasBeenShown(scope?: string | null): boolean {
    try {
      return localStorage.getItem(this.key(scope)) === "1";
    } catch {
      return false;
    }
  }

  /**
   * Marca que esta persona acaba de crear el negocio y terminar su
   * configuración, así que la intro le corresponde. Solo FinalStep llama a
   * esto, y solo para el ADMIN: nadie más pasa por el onboarding.
   */
  markPending(scope: string): void {
    try {
      localStorage.setItem(`${PENDING_KEY}:${scope}`, "1");
    } catch {
      /** Sin localStorage no hay intro: preferible a mostrársela a quien no toca. */
    }
  }

  /** ¿Esta persona terminó el onboarding y aún no ha visto la intro? */
  isPending(scope?: string | null): boolean {
    if (!scope) return false;
    try {
      return localStorage.getItem(`${PENDING_KEY}:${scope}`) === "1";
    } catch {
      return false;
    }
  }

  markShown(scope?: string | null): void {
    try {
      localStorage.setItem(this.key(scope), "1");
      if (scope) localStorage.removeItem(`${PENDING_KEY}:${scope}`);
    } catch {
      /** No es crítico: en el peor caso, la intro se repite una vez más. */
    }
  }
}

export const appIntroStore = new AppIntroStore();