const STORAGE_KEY = "vimdy:intro:shown";

/**
 * appIntroStore
 * ---------------------------------------------------------------------------
 * FASE 6, PASO 1 — Intro cinematográfica.
 *
 * Guarda, por negocio y por navegador, si la intro ya se mostró. Cada
 * negocio nuevo la ve una vez al terminar su configuración inicial, aunque
 * el navegador ya la haya mostrado a otro negocio. Vive en localStorage y no
 * en Supabase: es solo una cortesía visual, no un dato del negocio.
 *
 * Falla en modo silencioso si localStorage no está disponible (navegación
 * privada estricta, etc.): en ese caso se comporta como si la intro nunca
 * se hubiera visto, así que en el peor de los casos se repite una vez de
 * más, nunca deja de aparecer del todo por un error.
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

  markShown(scope?: string | null): void {
    try {
      localStorage.setItem(this.key(scope), "1");
    } catch {
      /** No es crítico: en el peor caso, la intro se repite una vez más. */
    }
  }
}

export const appIntroStore = new AppIntroStore();