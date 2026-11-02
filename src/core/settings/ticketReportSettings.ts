/**
 * ticketReportSettings
 * ---------------------------------------------------------------------------
 * Tipos y reglas PURAS de Configuración > Tickets y Reportes (multi-sucursal).
 *
 * Dos configuraciones, cada una con alcance opcional por sucursal:
 *   - Impresión del ticket        -> tabla `ticket_print_settings`
 *   - Cierre inteligente (correo) -> tabla `report_close_settings`
 *
 * Alcance y herencia (fila COMPLETA, no columna por columna):
 *   override de la sucursal  ->  global del negocio  ->  defaults de la app
 *
 * Las validaciones de aquí repiten los CHECK de la base
 * (20261119000000_ticket_and_report_settings.sql): la base es la autoridad,
 * esto solo evita ir al servidor con datos que ya se sabe que rechazará.
 */

import {
  ACCENT_COLORS,
  DEFAULT_PRINT_SETTINGS,
  RECEIPT_TEMPLATES,
  type AccentColor,
  type PaperWidth,
  type PrintSettings,
  type ReceiptTemplateId
} from "../store/printSettingsStore";

/* ---------------------------------------------------------------------------
   Comunes
--------------------------------------------------------------------------- */

/** De dónde salió la configuración efectiva que se devolvió. */
export type SettingsSource = "branch" | "business" | "default";

/** Configuración efectiva de una sucursal (o del negocio) y de dónde viene. */
export interface ResolvedSettings<T> {
  readonly settings: T;
  readonly source: SettingsSource;
  /** Sucursal de la fila usada; null si es global del negocio o defaults. */
  readonly branchId: string | null;
  /** null cuando son los defaults de la app (no hay fila guardada). */
  readonly updatedAt: string | null;
}

/** Una fila guardada: global (`branchId` null) o override de una sucursal. */
export interface SettingsScope<T> {
  readonly businessId: string;
  readonly branchId: string | null;
  readonly settings: T;
  readonly updatedAt: string;
}

function invalid(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

function readBoolean(value: unknown, field: string, code: string): boolean {
  if (typeof value !== "boolean") invalid(code, `${field} debe ser verdadero o falso.`);
  return value;
}

/* ---------------------------------------------------------------------------
   Impresión del ticket
--------------------------------------------------------------------------- */

export type TicketPrintSettings = PrintSettings;

export const TICKET_PAPER_WIDTHS: readonly PaperWidth[] = ["58mm", "80mm", "a4"];
export const MAX_TICKET_FOOTER_LENGTH = 240;

const TEMPLATE_IDS: readonly string[] = RECEIPT_TEMPLATES.map((template) => template.id);
const ACCENT_IDS: readonly string[] = ACCENT_COLORS.map((color) => color.id);

/** Valores por defecto de la app (los mismos que el store local de impresión). */
export function defaultTicketPrintSettings(): TicketPrintSettings {
  return { ...DEFAULT_PRINT_SETTINGS };
}

/** Fila de `ticket_print_settings` tal como la devuelve la base. */
export interface TicketPrintSettingsRow {
  readonly id: string;
  readonly business_id: string;
  readonly branch_id: string | null;
  readonly template: string;
  readonly paper_width: string;
  readonly accent_color: string;
  readonly show_logo: boolean;
  readonly show_qr: boolean;
  readonly show_address: boolean;
  readonly show_phone: boolean;
  readonly show_email: boolean;
  readonly show_cashier: boolean;
  readonly show_customer: boolean;
  readonly show_tax: boolean;
  readonly show_discount: boolean;
  /** Opcional: filas leídas antes de la migración 20261119000100 no la traen (se asume true). */
  readonly show_table?: boolean;
  /** Opcional: ídem (se asume true). */
  readonly show_footer?: boolean;
  readonly footer_message: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly updated_by: string | null;
}

/** Cuerpo que recibe `upsert_ticket_print_settings` (configuración completa). */
export interface TicketPrintSettingsPayload {
  readonly template: ReceiptTemplateId;
  readonly paper_width: PaperWidth;
  readonly accent_color: AccentColor;
  readonly show_logo: boolean;
  readonly show_qr: boolean;
  readonly show_address: boolean;
  readonly show_phone: boolean;
  readonly show_email: boolean;
  readonly show_cashier: boolean;
  readonly show_customer: boolean;
  readonly show_tax: boolean;
  readonly show_discount: boolean;
  readonly show_table: boolean;
  readonly show_footer: boolean;
  readonly footer_message: string;
}

const TICKET_CODE = "TICKET_SETTINGS_INVALID";

/**
 * Valida y normaliza lo que el administrador editó. Lanza con un mensaje claro;
 * nunca recorta ni corrige en silencio (salvo los saltos de línea de Windows).
 */
export function validateTicketPrintSettings(input: TicketPrintSettings): TicketPrintSettings {
  if (!TEMPLATE_IDS.includes(input.template)) invalid(TICKET_CODE, "la plantilla elegida no existe.");
  if (!TICKET_PAPER_WIDTHS.includes(input.paperWidth)) invalid(TICKET_CODE, "el ancho de papel no es válido.");
  if (!ACCENT_IDS.includes(input.accentColor)) invalid(TICKET_CODE, "el color elegido no es válido.");
  if (typeof input.footerMessage !== "string") invalid(TICKET_CODE, "el mensaje final debe ser texto.");

  const footerMessage = input.footerMessage.replace(/\r\n?/g, "\n");
  if (footerMessage.length > MAX_TICKET_FOOTER_LENGTH) {
    invalid(TICKET_CODE, `el mensaje final admite hasta ${MAX_TICKET_FOOTER_LENGTH} caracteres.`);
  }

  return {
    template: input.template,
    paperWidth: input.paperWidth,
    accentColor: input.accentColor,
    showLogo: readBoolean(input.showLogo, "showLogo", TICKET_CODE),
    showQr: readBoolean(input.showQr, "showQr", TICKET_CODE),
    showAddress: readBoolean(input.showAddress, "showAddress", TICKET_CODE),
    showPhone: readBoolean(input.showPhone, "showPhone", TICKET_CODE),
    showEmail: readBoolean(input.showEmail, "showEmail", TICKET_CODE),
    showCashier: readBoolean(input.showCashier, "showCashier", TICKET_CODE),
    showCustomer: readBoolean(input.showCustomer, "showCustomer", TICKET_CODE),
    showTax: readBoolean(input.showTax, "showTax", TICKET_CODE),
    showDiscount: readBoolean(input.showDiscount, "showDiscount", TICKET_CODE),
    showTable: readBoolean(input.showTable, "showTable", TICKET_CODE),
    showFooter: readBoolean(input.showFooter, "showFooter", TICKET_CODE),
    footerMessage
  };
}

export function ticketPrintSettingsToPayload(input: TicketPrintSettings): TicketPrintSettingsPayload {
  const s = validateTicketPrintSettings(input);
  return {
    template: s.template,
    paper_width: s.paperWidth,
    accent_color: s.accentColor,
    show_logo: s.showLogo,
    show_qr: s.showQr,
    show_address: s.showAddress,
    show_phone: s.showPhone,
    show_email: s.showEmail,
    show_cashier: s.showCashier,
    show_customer: s.showCustomer,
    show_tax: s.showTax,
    show_discount: s.showDiscount,
    show_table: s.showTable,
    show_footer: s.showFooter,
    footer_message: s.footerMessage
  };
}

/** Convierte una fila de la base en la configuración de la app. Falla si la fila es inválida. */
export function ticketPrintSettingsFromRow(row: TicketPrintSettingsRow): TicketPrintSettings {
  return validateTicketPrintSettings({
    template: row.template as ReceiptTemplateId,
    paperWidth: row.paper_width as PaperWidth,
    accentColor: row.accent_color as AccentColor,
    showLogo: row.show_logo,
    showQr: row.show_qr,
    showAddress: row.show_address,
    showPhone: row.show_phone,
    showEmail: row.show_email,
    showCashier: row.show_cashier,
    showCustomer: row.show_customer,
    showTax: row.show_tax,
    showDiscount: row.show_discount,
    showTable: row.show_table ?? true,
    showFooter: row.show_footer ?? true,
    footerMessage: row.footer_message
  });
}

/* ---------------------------------------------------------------------------
   Cierre inteligente por correo
--------------------------------------------------------------------------- */

export interface ReportCloseSettings {
  /** Interruptor general del cierre inteligente. */
  readonly enabled: boolean;
  /** Preparar y enviar el reporte al cerrar el turno. */
  readonly sendOnShiftClose: boolean;
  readonly emailEnabled: boolean;
  /** En minúsculas, sin repetidos. Máximo `MAX_REPORT_EMAIL_RECIPIENTS`. */
  readonly emailRecipients: readonly string[];
  /** Si no hay correo configurado, enviar a los administradores del negocio. */
  readonly emailFallbackEnabled: boolean;
}

export const MAX_REPORT_EMAIL_RECIPIENTS = 5;
export const MAX_REPORT_EMAIL_LENGTH = 254;
/** Mismo patrón que `is_valid_email_list` en la base (ya en minúsculas). */
export const REPORT_EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/** Valores por defecto: los mismos que `daily_report_settings` hoy. */
export const DEFAULT_REPORT_CLOSE_SETTINGS: ReportCloseSettings = Object.freeze({
  enabled: true,
  sendOnShiftClose: true,
  emailEnabled: true,
  emailRecipients: Object.freeze([] as string[]),
  emailFallbackEnabled: true
});

export function defaultReportCloseSettings(): ReportCloseSettings {
  return { ...DEFAULT_REPORT_CLOSE_SETTINGS, emailRecipients: [] };
}

/** Fila de `report_close_settings` tal como la devuelve la base. */
export interface ReportCloseSettingsRow {
  readonly id: string;
  readonly business_id: string;
  readonly branch_id: string | null;
  readonly enabled: boolean;
  readonly send_on_shift_close: boolean;
  readonly email_enabled: boolean;
  readonly email_recipients: string[];
  readonly email_fallback_enabled: boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly updated_by: string | null;
}

/** Cuerpo que recibe `upsert_report_close_settings` (configuración completa). */
export interface ReportCloseSettingsPayload {
  readonly enabled: boolean;
  readonly send_on_shift_close: boolean;
  readonly email_enabled: boolean;
  readonly email_recipients: string[];
  readonly email_fallback_enabled: boolean;
}

const REPORT_CODE = "REPORT_SETTINGS_INVALID";

/** Quita espacios, pasa a minúsculas y elimina repetidos. No descarta correos inválidos. */
export function normalizeReportEmails(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const email = String(value).trim().toLowerCase();
    if (email && !result.includes(email)) result.push(email);
  }
  return result;
}

/** Valida y normaliza. Un correo inválido lanza error con el correo señalado (no se descarta en silencio). */
export function validateReportCloseSettings(input: ReportCloseSettings): ReportCloseSettings {
  if (!Array.isArray(input.emailRecipients)) invalid(REPORT_CODE, "los correos deben ser una lista.");
  const emails = normalizeReportEmails(input.emailRecipients);

  if (emails.length > MAX_REPORT_EMAIL_RECIPIENTS) {
    invalid(REPORT_CODE, `se permiten hasta ${MAX_REPORT_EMAIL_RECIPIENTS} correos.`);
  }
  for (const email of emails) {
    if (email.length > MAX_REPORT_EMAIL_LENGTH || !REPORT_EMAIL_PATTERN.test(email)) {
      invalid(REPORT_CODE, `el correo "${email}" no es válido.`);
    }
  }

  return {
    enabled: readBoolean(input.enabled, "enabled", REPORT_CODE),
    sendOnShiftClose: readBoolean(input.sendOnShiftClose, "sendOnShiftClose", REPORT_CODE),
    emailEnabled: readBoolean(input.emailEnabled, "emailEnabled", REPORT_CODE),
    emailRecipients: emails,
    emailFallbackEnabled: readBoolean(input.emailFallbackEnabled, "emailFallbackEnabled", REPORT_CODE)
  };
}

export function reportCloseSettingsToPayload(input: ReportCloseSettings): ReportCloseSettingsPayload {
  const s = validateReportCloseSettings(input);
  return {
    enabled: s.enabled,
    send_on_shift_close: s.sendOnShiftClose,
    email_enabled: s.emailEnabled,
    email_recipients: [...s.emailRecipients],
    email_fallback_enabled: s.emailFallbackEnabled
  };
}

export function reportCloseSettingsFromRow(row: ReportCloseSettingsRow): ReportCloseSettings {
  return validateReportCloseSettings({
    enabled: row.enabled,
    sendOnShiftClose: row.send_on_shift_close,
    emailEnabled: row.email_enabled,
    emailRecipients: row.email_recipients,
    emailFallbackEnabled: row.email_fallback_enabled
  });
}