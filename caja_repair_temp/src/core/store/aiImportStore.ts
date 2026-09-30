import { ObservableStore } from "./ObservableStore";

/**
 * VIMDY Smart Import — Paso 1.
 * ---------------------------------------------------------------------------
 * Guarda TEMPORALMENTE (solo en memoria, no en IndexedDB) la foto del menú
 * que el usuario acaba de capturar/seleccionar en "Importar menú con IA".
 * Todavía no hay ningún análisis: este store solo le pasa la imagen de un
 * paso al siguiente. El Paso 2 (leer el texto con IA) leerá `image` desde
 * aquí en vez de tener que volver a pedirla.
 *
 * Es intencional que NO persista entre recargas de página: es un borrador de
 * trabajo, no un dato del negocio. Si el usuario recarga a la mitad del
 * flujo, vuelve a empezar desde "Importar menú con IA".
 */
export interface AiImportState {
  image: string | null;
  savedAt: Date | null;
}

const INITIAL_STATE: AiImportState = {
  image: null,
  savedAt: null
};

class AiImportStore extends ObservableStore<AiImportState> {
  private state: AiImportState = { ...INITIAL_STATE };

  constructor() {
    super({ ...INITIAL_STATE });
  }

  private sync() {
    this.publish({ ...this.state });
  }

  get(): AiImportState {
    return this.snapshot;
  }

  /** Guarda la imagen capturada/seleccionada. Todavía no la analiza. */
  saveImage(image: string) {
    this.state.image = image;
    this.state.savedAt = new Date();
    this.sync();
  }

  clear() {
    this.state = { ...INITIAL_STATE };
    this.sync();
  }
}

export const aiImportStore = new AiImportStore();