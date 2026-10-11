/**
 * Guardia de seguridad para scripts de pruebas E2E.
 *
 * Los scripts de esta carpeta crean usuarios de prueba y siembran datos.
 * NUNCA deben correr contra producción por accidente, así que:
 *  - No hay URL ni llaves por defecto: todo viene de variables de entorno.
 *  - Solo corren contra localhost/127.0.0.1, o contra un proyecto de PRUEBAS
 *    si se confirma a propósito con E2E_TARGET_IS_NOT_PRODUCTION=yes.
 *  - Si la URL coincide con PRODUCTION_SUPABASE_URL, se niegan siempre.
 */
export function resolveE2eTarget() {
  const url = (process.env.E2E_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const anonKey = (process.env.E2E_SUPABASE_ANON_KEY || "").trim();

  if (!url || !anonKey) {
    fail("Faltan E2E_SUPABASE_URL y/o E2E_SUPABASE_ANON_KEY. No hay valores por defecto a propósito.");
  }

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    fail(`E2E_SUPABASE_URL no es una URL válida: ${url}`);
  }

  const prod = (process.env.PRODUCTION_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (prod && url === prod) {
    fail("E2E_SUPABASE_URL es igual a PRODUCTION_SUPABASE_URL. Estos scripts no corren contra producción.");
  }

  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (!isLocal && process.env.E2E_TARGET_IS_NOT_PRODUCTION !== "yes") {
    fail(
      `El destino ${host} no es local. Si es un proyecto de PRUEBAS (no producción), ` +
        "confirma con E2E_TARGET_IS_NOT_PRODUCTION=yes."
    );
  }

  return { url, anonKey };
}

function fail(message) {
  console.error(`E2E BLOQUEADO: ${message}`);
  process.exit(1);
}
