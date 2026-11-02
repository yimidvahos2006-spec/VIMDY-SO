/**
 * ticketDesigner
 * ---------------------------------------------------------------------------
 * Lógica PURA del editor visual de tickets (Configuración > Tickets y
 * Reportes > Impresión): catálogo de controles, reducer del borrador,
 * validación y navegación por teclado de los grupos de opciones.
 *
 * Sin React ni DOM: se prueba en node (tests/unit/ticketDesigner.test.ts).
 * La UI (src/presentation/components/settings/ticket-designer) solo pinta.
 */

import {
  ACCENT_COLORS,
  RECEIPT_TEMPLATES,
  type AccentColor,
  type PaperWidth,
  type PrintSettings,
  type ReceiptTemplateId
} from "../store/printSettingsStore";
import { MAX_TICKET_FOOTER_LENGTH, validateTicketPrintSettings } from "./ticketReportSettings";

/* ---------------------------------------------------------------------------
   Catálogo de controles
--------------------------------------------------------------------------- */

/** Claves booleanas de PrintSettings que el administrador puede activar/desactivar. */
export type VisibilityKey = {
  [K in keyof PrintSettings]: PrintSettings[K] extends boolean ? K : never;
}[keyof PrintSettings];

export interface VisibilityToggleDef {
  readonly key: VisibilityKey;
  readonly label: string;
  /** Una línea que explica qué cambia en el ticket (se lee con lector de pantalla). */
  readonly hint: string;
}

export interface VisibilityGroupDef {
  readonly id: string;
  readonly title: string;
  readonly toggles: readonly VisibilityToggleDef[];
}

export const VISIBILITY_GROUPS: readonly VisibilityGroupDef[] = [
  {
    id: "encabezado",
    title: "Encabezado",
    toggles: [
      { key: "showLogo", label: "Logo", hint: "Muestra el logo arriba del ticket. Sin logo, se crea un membrete con el nombre del negocio." },
      { key: "showAddress", label: "Dirección", hint: "Imprime la dirección del negocio." },
      { key: "showPhone", label: "Teléfono", hint: "Imprime el teléfono del negocio." },
      { key: "showEmail", label: "Correo", hint: "Imprime el correo del negocio." }
    ]
  },
  {
    id: "venta",
    title: "Datos de la venta",
    toggles: [
      { key: "showTable", label: "Mesa", hint: "Indica la mesa cuando la venta viene de una mesa." },
      { key: "showCashier", label: "Cajero", hint: "Muestra quién cobró la venta." },
      { key: "showCustomer", label: "Cliente", hint: "Muestra el nombre del cliente." }
    ]
  },
  {
    id: "totales",
    title: "Totales",
    toggles: [
      { key: "showTax", label: "IVA", hint: "Desglosa el IVA en los totales." },
      { key: "showDiscount", label: "Descuentos", hint: "Muestra el descuento aplicado, si lo hubo." }
    ]
  },
  {
    id: "cierre",
    title: "Cierre del ticket",
    toggles: [
      { key: "showQr", label: "Código QR", hint: "QR para pedir por WhatsApp (necesita teléfono del negocio)." },
      { key: "showFooter", label: "Pie de página", hint: "Imprime el mensaje final del ticket." }
    ]
  }
];

export const ALL_VISIBILITY_KEYS: readonly VisibilityKey[] = VISIBILITY_GROUPS.flatMap((group) =>
  group.toggles.map((toggle) => toggle.key)
);

export interface PaperOption {
  readonly id: PaperWidth;
  readonly label: string;
  readonly hint: string;
}

export const PAPER_OPTIONS: readonly PaperOption[] = [
  { id: "80mm", label: "80 mm", hint: "Térmica estándar" },
  { id: "58mm", label: "58 mm", hint: "Térmica angosta" },
  { id: "a4", label: "A4", hint: "Carta / láser" }
];

/**
 * Ancho (px) del documento que genera `renderReceiptDocument` para cada papel
 * (ver `paperWidthCss`). El marco de la vista previa usa EXACTAMENTE este ancho
 * para que lo que se ve sea lo que se imprime.
 */
export const PREVIEW_PAPER_WIDTH_PX: Readonly<Record<PaperWidth, number>> = {
  "58mm": 220,
  "80mm": 300,
  a4: 560
};

export const TEMPLATE_IDS: readonly ReceiptTemplateId[] = RECEIPT_TEMPLATES.map((t) => t.id);
export const ACCENT_IDS: readonly AccentColor[] = ACCENT_COLORS.map((c) => c.id);

/* ---------------------------------------------------------------------------
   Reducer del borrador
--------------------------------------------------------------------------- */

export type DesignerAction =
  | { readonly type: "template"; readonly value: ReceiptTemplateId }
  | { readonly type: "paper"; readonly value: PaperWidth }
  | { readonly type: "accent"; readonly value: AccentColor }
  | { readonly type: "toggle"; readonly key: VisibilityKey }
  | { readonly type: "footer"; readonly value: string }
  | { readonly type: "reset"; readonly to: PrintSettings };

/** Devuelve SIEMPRE un objeto nuevo solo si algo cambió (si no, la misma referencia). */
export function designerReducer(state: PrintSettings, action: DesignerAction): PrintSettings {
  switch (action.type) {
    case "template":
      return state.template === action.value ? state : { ...state, template: action.value };
    case "paper":
      return state.paperWidth === action.value ? state : { ...state, paperWidth: action.value };
    case "accent":
      return state.accentColor === action.value ? state : { ...state, accentColor: action.value };
    case "toggle":
      return { ...state, [action.key]: !state[action.key] };
    case "footer":
      return state.footerMessage === action.value ? state : { ...state, footerMessage: action.value };
    case "reset":
      return { ...action.to };
  }
}

const COMPARABLE_KEYS: readonly (keyof PrintSettings)[] = [
  "template",
  "paperWidth",
  "accentColor",
  ...ALL_VISIBILITY_KEYS,
  "footerMessage"
];

/** ¿El borrador difiere de lo guardado? (compara campo a campo; ignora \r\n vs \n). */
export function isDraftDirty(draft: PrintSettings, saved: PrintSettings): boolean {
  return COMPARABLE_KEYS.some((key) => {
    const a = draft[key];
    const b = saved[key];
    if (key === "footerMessage") {
      return String(a).replace(/\r\n?/g, "\n") !== String(b).replace(/\r\n?/g, "\n");
    }
    return a !== b;
  });
}

export type DraftValidation = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Valida con las MISMAS reglas que el guardado (que a su vez repiten los CHECK de la base). */
export function validateDraft(draft: PrintSettings): DraftValidation {
  try {
    validateTicketPrintSettings(draft);
    return { ok: true };
  } catch (error) {
    const raw = error instanceof Error ? error.message : "La configuración no es válida.";
    // "TICKET_SETTINGS_INVALID: el mensaje" -> "El mensaje"
    const text = raw.replace(/^[A-Z_]+:\s*/, "");
    return { ok: false, message: text.charAt(0).toUpperCase() + text.slice(1) };
  }
}

/** Caracteres del pie de página usados / permitidos (contando como la base: \r\n = 1). */
export function footerUsage(value: string): { used: number; max: number; over: boolean } {
  const used = value.replace(/\r\n?/g, "\n").length;
  return { used, max: MAX_TICKET_FOOTER_LENGTH, over: used > MAX_TICKET_FOOTER_LENGTH };
}

/* ---------------------------------------------------------------------------
   Teclado: grupos de opciones (role="radiogroup")
--------------------------------------------------------------------------- */

/**
 * Índice que debe quedar seleccionado/enfocado tras una tecla en un
 * radiogroup (patrón WAI-ARIA: flechas con vuelta al inicio, Home, End).
 * `null` = la tecla no navega y no hay que hacer nada.
 */
export function nextRadioIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}