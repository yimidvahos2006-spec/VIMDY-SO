import { supabase, getCurrentBusinessId } from "../supabase/supabaseClient";

/* =============================================================================
   opsLogger
   -----------------------------------------------------------------------------
   FASE 3.5 #2: "que tú te enteres antes que el cliente".

   Reemplaza los `console.warn`/`console.error` sueltos por un solo punto de
   entrada que:
     1. Sigue imprimiendo en la consola del navegador (no quita eso, sigue
        sirviendo para debug local).
     2. Además inserta la fila en `system_errors` (ver
        supabase/error_logging_migration.sql) para que quede centralizado y
        una función de backend (ops-health-check) pueda revisarla y avisarte
        por webhook sin que tengas que estar mirando la consola de nadie.

   IMPORTANTE — esto es "best effort", nunca bloqueante:
     - Si el insert a Supabase falla (sin conexión, RLS mal configurado,
       etc.) NO se relanza el error ni se interrumpe el flujo del negocio.
       Un logger que puede tumbar la app que intenta loguear un error sería
       peor que el problema que resuelve.
     - No espera (no usa `await` en el call site) — usar opsLogger no debe
       agregar latencia perceptible a ninguna acción del usuario.

   USO — reemplaza:
     console.warn("algo raro pasó", detalle)
   por:
     logWarning("algo raro pasó", { category: "sync", context: { detalle } })

   y reemplaza:
     console.error(error)
   por:
     logError(error, { category: "payment", context: { saleId } })
============================================================================= */

export type OpsErrorCategory =
  | "payment"
  | "sync"
  | "kitchen"
  | "auth"
  | "inventory"
  | "offline"
  | "ai"
  | "unknown";

interface LogOptions {
  category?: OpsErrorCategory;
  businessId?: string | null;
  context?: Record<string, unknown>;
}

function currentBusinessIdFallback(): string | null {
  // Si el call site no pasa businessId explícito, intenta tomarlo del
  // mismo contexto en memoria que ya usa toda la app (setCurrentBusinessId
  // se llama al iniciar sesión, ver authBusinessContext.ts). getCurrentBusinessId()
  // lanza si todavía no hay negocio activo (ej. pantalla de login) — por
  // eso va en try/catch, es mejor esfuerzo, no crítico si falla.
  try {
    return getCurrentBusinessId();
  } catch {
    return null;
  }
}

async function persist(
  severity: "error" | "warning",
  message: string,
  stack: string | undefined,
  options: LogOptions
) {
  try {
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("system_errors").insert({
      severity,
      category: options.category ?? "unknown",
      message: message.slice(0, 4000), // evita filas gigantes por errores con payloads enormes
      stack: stack?.slice(0, 8000) ?? null,
      business_id: options.businessId ?? currentBusinessIdFallback(),
      user_id: userData?.user?.id ?? null,
      context: options.context ?? {},
      source: "web"
    });
  } catch {
    // Silencioso a propósito — ver nota de "best effort" arriba. Ya quedó
    // impreso en consola por logError/logWarning antes de llegar acá.
  }
}

export function logError(error: unknown, options: LogOptions = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // eslint-disable-next-line no-console
  console.error(`[${options.category ?? "unknown"}]`, error, options.context ?? "");

  void persist("error", message, stack, options);
}

export function logWarning(message: string, options: LogOptions = {}): void {
  // eslint-disable-next-line no-console
  console.warn(`[${options.category ?? "unknown"}]`, message, options.context ?? "");

  void persist("warning", message, undefined, options);
}