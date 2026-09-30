import { ObservableStore } from "./ObservableStore";

/**
 * weightEntryStore.ts
 * ---------------------------------------------------------------------------
 * BLOQUEANTE (auditoría Fase 2 — rama Supermercado): "No hay UI de
 * báscula". Este store guarda el producto pendiente de pesar mientras el
 * cajero escribe el peso en PosWeightEntryModal — tanto PosTopBar (escaneo
 * de código de barras) como PosProducts (clic en la tarjeta) lo abren de
 * la misma forma, así que el modal vive una sola vez, montado en PosPage.
 *
 * NOTA de hardware (para cuando VIMDY conecte una báscula física real):
 * el navegador no tiene acceso directo a un puerto serial/USB de báscula
 * desde una PWA salvo WebHID/WebSerial (soporte limitado y requiere
 * permiso explícito del usuario por dispositivo). Este store ya deja el
 * punto de enganche listo: en vez de que PosWeightEntryModal dependa de
 * que el cajero escriba el peso a mano, una futura integración solo
 * necesita llamar a `weightEntryStore.open(product, pesoLeido)` con el
 * peso que reporte la báscula por WebSerial, y el modal ya lo muestra
 * precargado (editable, por si hay que corregirlo) sin tocar nada más de
 * este archivo.
 */

export interface WeightEntryProduct {
  readonly id: string;
  readonly name: string;
  /** Precio POR unidad de medida (ej. precio por kg), no precio total. */
  readonly price: number;
  readonly unit: string;
  readonly requiresKitchen?: boolean;
}

export interface WeightEntryState {
  readonly product: WeightEntryProduct | null;
  /** Peso inicial a precargar en el input (ej. lectura de báscula real). */
  readonly presetWeight: number | null;
}

const INITIAL_STATE: WeightEntryState = {
  product: null,
  presetWeight: null
};

class WeightEntryStore extends ObservableStore<WeightEntryState> {
  constructor() {
    super({ ...INITIAL_STATE });
  }

  open(product: WeightEntryProduct, presetWeight: number | null = null) {
    this.publish({ product, presetWeight });
  }

  close() {
    this.publish({ ...INITIAL_STATE });
  }
}

export const weightEntryStore = new WeightEntryStore();