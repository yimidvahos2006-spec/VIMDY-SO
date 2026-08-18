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
    // Import dinámico A PROPÓSITO, no al tope del archivo: opsLogger se
    // importa desde engines de src/core que los smoke tests (tests/smoke/)
    // corren en entorno "node" puro, sin DOM (ver vitest.config.ts). Si
    // supabaseClient.ts se cargara al tope de este archivo, su código de
    // inicialización (que toca `window` en modo DEV) tumbaría CUALQUIER
    // test que use un engine que loguee algo — aunque el test nunca llame
    // a logError/logWarning. Con import() perezoso, ese código solo se
    // ejecuta si de verdad se llega a persistir un error (en el navegador
    // real, nunca en los tests, que no llaman a esto).
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

    await supabase.from("system_errors").insert({
      severity,
      category: options.category ?? "unknown",
      message: message.slice(0, 4000),
      stack: stack?.slice(0, 8000) ?? null,
      business_id: businessId,
      user_id: userData.user.id,
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