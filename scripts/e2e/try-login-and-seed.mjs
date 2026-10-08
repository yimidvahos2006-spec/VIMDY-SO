import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://upoztxlcudrqhnjwjgho.supabase.co";
const ANON_KEY = "sb_publishable_zUHiDR00FbET1qisM11DCw_iWJ82nDT";

async function main() {
  const supabase = createClient(SUPABASE_URL, ANON_KEY);

  const email = "test.restaurante.run_20260816002021_4egukk@vimdy.dev";
  const password = "Test123456!";

  console.log("Intentando login con:", email);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error || !data?.session?.access_token) {
    console.error("Login fallido:", error?.message || error);
    console.log("El usuario no existe todavía. Necesitamos crear usuarios primero.");
    process.exit(1);
  }

  const jwt = data.session.access_token;
  console.log("Login exitoso. JWT (primeros 20 chars):", jwt.slice(0, 20) + "...");

  // Llamar a test-seed-environment
  const seedUrl = `${SUPABASE_URL}/functions/v1/test-seed-environment`;
  console.log("Llamando a seed...");
  const response = await fetch(seedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jwt}`
    },
    body: JSON.stringify({ dryRun: false })
  });

  const text = await response.text();
  console.log("Seed status:", response.status);
  console.log("Seed respuesta:", text.slice(0, 1000));

  if (!response.ok) {
    console.error("Seed falló");
    process.exit(1);
  }

  console.log("Seed ejecutado correctamente");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
