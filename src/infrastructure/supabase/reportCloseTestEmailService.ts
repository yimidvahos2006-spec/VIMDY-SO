/**
 * reportCloseTestEmailService.ts
 * ---------------------------------------------------------------------------
 * Botón "Enviar correo de prueba" de Configuración > Tickets y Reportes.
 *
 * Llama a la acción TEST_EMAIL de la Edge Function `process-daily-report`
 * (solo ADMIN). `supabase.functions.invoke` convierte cualquier respuesta no
 * 2xx en un error genérico en inglés ("Edge Function returned a non-2xx status
 * code"); aquí se lee el cuerpo de la respuesta para mostrar el mensaje claro
 * en español que envía el servidor.
 *
 * Siempre lanza un `Error` con un mensaje listo para mostrar al usuario.
 */

import { supabase } from "./supabaseClient";
import { REPORT_EMAIL_PATTERN } from "../../core/settings/ticketReportSettings";

export interface SendReportCloseTestEmailInput {
  readonly businessId: string;
  /** Sucursal cuya configuración se prueba (solo importa si no se escribe un correo). */
  readonly branchId?: string | null;
  /** Correo a probar. Vacío = probar a los destinatarios efectivos del cierre. */
  readonly recipient?: string | null;
}

export interface ReportCloseTestEmailResult {
  readonly recipient: string;
  readonly recipients: string[];
  readonly providerId: string | null;
  readonly origin: "manual" | "configured" | "fallback" | "none";
  readonly message: string;
}

const GENERIC_ERROR = "No se pudo enviar el correo de prueba. Inténtalo de nuevo.";
const NETWORK_ERROR = "No se pudo conectar con VIMDY. Revisa tu conexión a internet e inténtalo de nuevo.";
const RELAY_ERROR = "El servicio de envío no está disponible en este momento. Inténtalo de nuevo en unos minutos.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Saca el mensaje en español de un error de `functions.invoke`. */
async function messageFromInvokeError(error: unknown): Promise<string> {
  if (!isRecord(error)) return GENERIC_ERROR;

  const name = typeof error.name === "string" ? error.name : "";
  if (name === "FunctionsFetchError") return NETWORK_ERROR;
  if (name === "FunctionsRelayError") return RELAY_ERROR;

  // FunctionsHttpError: `context` es la Response del servidor.
  const context = error.context;
  if (context && typeof (context as { json?: unknown }).json === "function") {
    try {
      const payload: unknown = await (context as Response).json();
      if (isRecord(payload) && typeof payload.message === "string" && payload.message.trim()) {
        return payload.message;
      }
    } catch {
      /* cuerpo ilegible: se usa el mensaje genérico */
    }
  }
  return GENERIC_ERROR;
}

export async function sendReportCloseTestEmail(
  input: SendReportCloseTestEmailInput
): Promise<ReportCloseTestEmailResult> {
  const businessId = typeof input.businessId === "string" ? input.businessId.trim() : "";
  if (!businessId) throw new Error("Falta indicar el negocio para enviar la prueba.");

  const recipient = (input.recipient ?? "").trim().toLowerCase();
  if (recipient) {
    if (/[,;\s]/.test(recipient)) throw new Error("Escribe un solo correo para enviar la prueba.");
    if (!REPORT_EMAIL_PATTERN.test(recipient)) {
      throw new Error(`El correo "${recipient}" no es válido. Revisa que tenga el formato nombre@dominio.com.`);
    }
  }

  const branchId = (input.branchId ?? "").trim();
  const { data, error } = await supabase.functions.invoke("process-daily-report", {
    body: {
      businessId,
      action: "TEST_EMAIL",
      ...(branchId ? { branchId } : {}),
      ...(recipient ? { recipient } : {})
    }
  });

  if (error) throw new Error(await messageFromInvokeError(error));

  if (!isRecord(data) || data.ok !== true) {
    const message = isRecord(data) && typeof data.message === "string" && data.message.trim() ? data.message : GENERIC_ERROR;
    throw new Error(message);
  }

  const recipients = Array.isArray(data.recipients) ? data.recipients.filter((item): item is string => typeof item === "string") : [];
  return {
    recipient: typeof data.recipient === "string" ? data.recipient : (recipients[0] ?? recipient),
    recipients,
    providerId: typeof data.providerId === "string" ? data.providerId : null,
    origin: data.origin === "configured" || data.origin === "fallback" || data.origin === "none" ? data.origin : "manual",
    message: typeof data.message === "string" ? data.message : "Correo de prueba enviado."
  };
}