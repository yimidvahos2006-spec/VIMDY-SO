const STORAGE_KEY = "vimdy:intro:shown";

/**
 * appIntroStore
 * ---------------------------------------------------------------------------
 * FASE 6, PASO 1 — Intro cinematográfica.
 *
 * Guarda, por dispositivo/navegador (no por cuenta ni por negocio), si la
 * intro ya se mostró alguna vez. Es intencional que viva en localStorage y
 * no en Supabase: el requisito es "una sola vez por instalación", no "una
 * vez por usuario" — si dos personas distintas usan el mismo dispositivo,
 * la segunda no debe volver a verla; si la misma persona reinstala la app
 * en OTRO dispositivo, sí debe verla de nuevo ahí.
 *
 * Falla en modo silencioso si localStorage no está disponible (navegación
 * privada estricta, etc.): en ese caso se comporta como si la intro nunca
 * se hubiera visto, así que en el peor de los casos se repite una vez de
 * más, nunca deja de aparecer del todo por un error.
 */
class AppIntroStore {
  hasBeenShown(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  markShown(): void {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /** No es crítico: en el peor caso, la intro se repite una vez más. */
    }
  }
}

export const appIntroStore = new AppIntroStore();