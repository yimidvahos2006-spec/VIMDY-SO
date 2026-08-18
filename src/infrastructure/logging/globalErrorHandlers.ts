/* =============================================================================
   globalErrorHandlers
   -----------------------------------------------------------------------------
   Complemento de ErrorBoundary.tsx — ese solo atrapa errores de RENDERIZADO
   de React. Todo lo demás (un onClick sin try/catch, un async sin .catch,
   un error dentro de un setTimeout, una promesa de pago o de impresión
   rechazada sin manejar) hoy se pierde en la consola del navegador de un
   solo cajero y nunca llega a `system_errors` — es exactamente el punto
   ciego que el checklist crítico #6 (ver ErrorBoundary.tsx) no cubre.

   Este archivo instala DOS listeners a nivel de `window`:
     1. 'error'              -> errores de JS no controlados (throw suelto,
                                 error de sintaxis en tiempo de ejecución, etc.)
     2. 'unhandledrejection' -> promesas rechazadas que nadie hizo .catch()

   FILTRO DE RUIDO: hay errores conocidos que no son bugs de VIMDY (ej.
   "ResizeObserver loop limit exceeded" que tiran algunos navegadores, o
   "Script error." de recursos cross-origin sin CORS, o ruido de extensiones
   del navegador del cliente). Esos se ignoran a propósito — reportarlos
   solo ensucia el conteo que usa ops-health-check para decidir si algo se
   está rompiendo de verdad.

   RATE LIMIT LOCAL: si el mismo error se repite muchas veces en poco
   tiempo (típico de un loop atascado), solo se loguea la primera vez cada
   10s — evita inundar `system_errors` (y por lo tanto las alertas de
   ops-health-check) con miles de filas idénticas de un solo turno.

   USO — se llama UNA vez, al arrancar la app (ver src/main.tsx):
     installGlobalErrorHandlers();
============================================================================= */

import { logError } from "./opsLogger";

const DEDUPE_WINDOW_MS = 10_000;
const recentlyLogged = new Map<string, number>();

function shouldLog(key: string): boolean {
  const now = Date.now();
  const last = recentlyLogged.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) {
    return false;
  }
  recentlyLogged.set(key, now);

  // Evita que el Map crezca sin límite en una sesión larga (turno de 12h
  // con la app siempre abierta en la caja). Limpieza perezosa y barata.
  if (recentlyLogged.size > 200) {
    const cutoff = now - DEDUPE_WINDOW_MS;
    for (const [existingKey, loggedAt] of recentlyLogged) {
      if (loggedAt < cutoff) {
        recentlyLogged.delete(existingKey);
      }
    }
  }

  return true;
}

function isIgnorableMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("resizeobserver loop") ||
    message === "Script error." ||
    lower.includes("chrome-extension://") ||
    lower.includes("moz-extension://") ||
    lower.includes("this model does not support image input") ||
    lower.includes("cannot read") && lower.includes("image.png") ||
    lower.includes("cannot read") && lower.includes("image")
  );
}

let installed = false;

export function installGlobalErrorHandlers(): void {
  if (typeof window === "undefined" || installed) {
    // Guard de `window` a propósito: este módulo se puede importar desde
    // contextos sin DOM (ej. si algún test terminara importándolo
    // indirectamente) sin tumbar nada, igual que opsLogger.ts.
    return;
  }
  installed = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    const message = event.message || "Error desconocido";
    if (isIgnorableMessage(message)) {
      event.preventDefault();
      return;
    }
    if (!shouldLog(`error:${message}:${event.filename ?? ""}:${event.lineno ?? ""}`)) return;

    logError(event.error ?? new Error(message), {
      category: "unknown",
      context: {
        source: "window.onerror",
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      }
    });
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    if (isIgnorableMessage(message)) {
      event.preventDefault();
      return;
    }
    if (!shouldLog(`rejection:${message}`)) return;

    logError(reason instanceof Error ? reason : new Error(message), {
      category: "unknown",
      context: { source: "unhandledrejection" }
    });
  });
}