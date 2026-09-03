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
  | "sales"
  | "print"
  | "unknown";

interface LogOptions {
  category?: OpsErrorCategory;
  businessId?: string | null;
  context?: Record<string, unknown>;
}

async function persist(
  severity: "error" | "warning",
  message: string,
  stack: string | undefined,
  options: LogOptions
) {
  try {
    const { supabase, getCurrentBusinessId } = await import("../supabase/supabaseClient");

    let businessId = options.businessId ?? null;
    if (!businessId) {
      try {
        businessId = getCurrentBusinessId() ?? null;
      } catch {
        businessId = null;
      }
    }

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      console.warn(`[opsLogger] Sin sesión activa, no se puede persistir en system_errors: ${message}`);
      return;
    }

    const { error: insertError } = await supabase.from("system_errors").insert({
      severity,
      category: options.category ?? "unknown",
      message: message.slice(0, 4000),
      stack: stack?.slice(0, 8000) ?? null,
      business_id: businessId,
      user_id: userData.user.id,
      context: options.context ?? {},
      source: "web"
    });

    if (insertError && !(insertError.message?.includes("does not exist") || insertError.code === "PGRST200")) {
      console.warn(`[opsLogger] system_errors insert failed: ${insertError.message}`);
    }
  } catch {
    // Silencioso a propósito — ver nota de "best effort" arriba. Ya quedó
    // impreso en consola por logError/logWarning antes de llegar acá.
  }
}

export async function logAudit(actorId: string, action: string, entity: string, details: string): Promise<void> {
  try {
    const { supabase, getCurrentBusinessId } = await import("../supabase/supabaseClient");

    const businessId = getCurrentBusinessId();

    await supabase.from("audit_log").insert({
      actor_id: actorId,
      action,
      entity,
      details: details.slice(0, 1000),
      business_id: businessId
    });
  } catch {
    // best effort
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