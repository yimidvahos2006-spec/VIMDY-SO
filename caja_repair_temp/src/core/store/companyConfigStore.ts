import { CountryCode, CurrencyCode, LanguageCode } from "../config/globalization";

export interface CompanyConfig {
  /** País operativo del negocio — dispara los valores por defecto de moneda/idioma/zona horaria. */
  country: CountryCode;

  currency: CurrencyCode;

  tax: number;

  serviceCharge: number;

  language: LanguageCode;

  timezone: string;

  allowNegativeStock: boolean;

  autoPrintReceipt: boolean;

  enableKitchen: boolean;

  enableTables: boolean;

  enableWhatsAppReports: boolean;

  enableAI: boolean;

  /**
   * Este negocio recibe pedidos a domicilio. Al activarlo, el WhatsApp de
   * pedidos (Business.whatsappOrders, ver businessStore.ts) pasa a ser
   * obligatorio en Configuración > Datos del negocio — es el número real
   * al que le van a escribir los clientes que escaneen el QR del ticket.
   */
  enableDelivery: boolean;

  /** Meta de ventas del día (PASO 4 — Alertas automáticas: "Meta alcanzada"). 0 = sin meta configurada. */
  dailySalesGoal: number;

  /**
   * Facturación electrónica (DIAN u otra autoridad fiscal futura). Vive en
   * CompanyConfig y no en una tabla aparte porque es, ante todo, una
   * preferencia del negocio (igual que enableKitchen o enableTables): la
   * mayoría de negocios la deja en `enabled: false` para siempre y el
   * resto de VIMDY nunca debe notar que este campo existe.
   *
   * Ver src/core/invoicing/ — InvoiceFactory decide, a partir de este
   * campo, si instancia un IInvoiceProvider real o ninguno.
   */
  electronicInvoicing: {
    enabled: boolean;
    /** Proveedor tecnológico elegido. "none" cuando enabled es false. */
    provider: "factus" | "none";
  };
}

const DEFAULT_CONFIG: CompanyConfig = {
  country: "CO",
  currency: "COP",
  tax: 19,
  serviceCharge: 0,
  language: "es",
  timezone: "America/Bogota",
  allowNegativeStock: false,
  autoPrintReceipt: true,
  enableKitchen: true,
  enableTables: true,
  enableWhatsAppReports: true,
  enableAI: true,
  enableDelivery: false,
  dailySalesGoal: 0,
  electronicInvoicing: { enabled: false, provider: "none" }
};

/**
 * Claves de localStorage para la preferencia de idioma/moneda/país del
 * DISPOSITIVO (no del negocio). Existen porque el selector de país
 * (RequireCountry / CountrySelectionPage) corre ANTES de que haya sesión o
 * negocio en Supabase — sin esto, la elección del visitante se perdería al
 * recargar la página o pasar de /pais a /login.
 *
 * Una vez el usuario inicia sesión, `update()` recibe el config real del
 * negocio (desde Supabase) y lo sobreescribe con la fuente de verdad
 * correcta — esta persistencia local solo cubre el hueco antes de eso.
 */
const LOCALE_STORAGE_KEY = "vimdy.locale";
const COUNTRY_SELECTED_KEY = "vimdy.countrySelected";

type PersistedLocale = Pick<CompanyConfig, "country" | "currency" | "language" | "timezone">;

function loadPersistedLocale(): Partial<PersistedLocale> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedLocale>;
  } catch {
    return {};
  }
}

function persistLocale(config: CompanyConfig) {
  if (typeof window === "undefined") return;
  try {
    const locale: PersistedLocale = {
      country: config.country,
      currency: config.currency,
      language: config.language,
      timezone: config.timezone
    };
    window.localStorage.setItem(LOCALE_STORAGE_KEY, JSON.stringify(locale));
  } catch {
    // localStorage puede fallar en modo incógnito estricto o con el cupo
    // lleno — no es crítico, la app sigue funcionando solo en memoria.
  }
}

type Listener = () => void;

class CompanyConfigStore {
  private config: CompanyConfig = { ...DEFAULT_CONFIG, ...loadPersistedLocale() };
  private listeners = new Set<Listener>();

  get() {
    return { ...this.config };
  }

  update(data: Partial<CompanyConfig>) {
    this.config = {
      ...this.config,
      ...data
    };
    persistLocale(this.config);
    this.listeners.forEach((listener) => listener());
  }

  reset() {
    this.config = { ...DEFAULT_CONFIG };
    this.listeners.forEach((listener) => listener());
  }

  /**
   * true si este dispositivo ya pasó por el selector de país (/pais) alguna
   * vez. RequireCountry usa esto para decidir si deja pasar a /login o
   * /registro, o si redirige primero al selector.
   */
  hasSelectedCountry(): boolean {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(COUNTRY_SELECTED_KEY) === "1";
    } catch {
      return true;
    }
  }

  /**
   * Aplica el país elegido en CountrySelectionPage: guarda país + moneda +
   * idioma + zona horaria sugeridos (getCountryDefaults) y marca el
   * dispositivo como "ya eligió país" para que RequireCountry no vuelva a
   * interceptar la navegación.
   */
  markCountrySelected(data: PersistedLocale) {
    this.update(data);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(COUNTRY_SELECTED_KEY, "1");
      } catch {
        // Ver comentario en persistLocale — no crítico.
      }
    }
  }

  /**
   * Usado por React (useTranslation, y cualquier componente que necesite
   * reaccionar en vivo a un cambio de idioma/moneda/país) vía
   * useSyncExternalStore, sin necesidad de recargar la página.
   */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export const companyConfigStore = new CompanyConfigStore();