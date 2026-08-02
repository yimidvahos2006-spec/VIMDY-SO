export type ReceiptTemplateId =
  | "clasico"
  | "moderno"
  | "restaurante"
  | "supermercado"
  | "cafeteria";

export type PaperWidth = "58mm" | "80mm" | "a4";

export type AccentColor = "cyan" | "green" | "red" | "slate";

export interface PrintSettings {
  template: ReceiptTemplateId;
  paperWidth: PaperWidth;
  accentColor: AccentColor;
  showLogo: boolean;
  showQr: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showEmail: boolean;
  showCashier: boolean;
  showCustomer: boolean;
  showTax: boolean;
  showDiscount: boolean;
  footerMessage: string;
}

export const RECEIPT_TEMPLATES: { id: ReceiptTemplateId; name: string; description: string }[] = [
  { id: "clasico", name: "Clásico", description: "Simple y directo. Ideal para tiendas pequeñas." },
  { id: "moderno", name: "Moderno", description: "El más elegante — logo, QR y totales destacados." },
  { id: "restaurante", name: "Restaurante", description: "Con mesa, mesero y notas por producto." },
  { id: "supermercado", name: "Supermercado", description: "Compacto, pensado para muchos ítems." },
  { id: "cafeteria", name: "Cafetería", description: "Muy corto — ideal para cafés y panaderías." }
];

export const ACCENT_COLORS: { id: AccentColor; name: string; hex: string }[] = [
  { id: "cyan", name: "Azul", hex: "#06b6d4" },
  { id: "green", name: "Verde", hex: "#22c55e" },
  { id: "red", name: "Rojo", hex: "#ef4444" },
  { id: "slate", name: "Negro", hex: "#0f172a" }
];

const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  template: "moderno",
  paperWidth: "80mm",
  accentColor: "cyan",
  showLogo: true,
  showQr: true,
  showAddress: true,
  showPhone: true,
  showEmail: false,
  showCashier: true,
  showCustomer: true,
  showTax: true,
  showDiscount: true,
  footerMessage: "Gracias por su compra\n¡Los esperamos nuevamente!"
};

const STORAGE_KEY = "vimdy.printSettings";

function loadPersisted(): Partial<PrintSettings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PrintSettings>;
  } catch {
    return {};
  }
}

function persist(settings: PrintSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage puede fallar en incógnito estricto o con el cupo lleno —
    // no es crítico, la app sigue funcionando solo en memoria.
  }
}

type Listener = () => void;

/**
 * printSettingsStore
 * ---------------------------------------------------------------------------
 * Preferencias de impresión del ticket de venta (Configuración > Impresión).
 * Sigue el mismo patrón que businessStore/companyConfigStore: un store en
 * memoria, hidratado desde localStorage al arrancar (por dispositivo/caja,
 * como el idioma), consumido por printReceiptDocument.ts para decidir qué
 * plantilla y qué secciones dibujar en cada ticket real.
 */
class PrintSettingsStore {
  private settings: PrintSettings = { ...DEFAULT_PRINT_SETTINGS, ...loadPersisted() };
  private listeners = new Set<Listener>();

  get(): PrintSettings {
    return { ...this.settings };
  }

  update(data: Partial<PrintSettings>) {
    this.settings = { ...this.settings, ...data };
    persist(this.settings);
    this.listeners.forEach((listener) => listener());
  }

  reset() {
    this.settings = { ...DEFAULT_PRINT_SETTINGS };
    persist(this.settings);
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const printSettingsStore = new PrintSettingsStore();