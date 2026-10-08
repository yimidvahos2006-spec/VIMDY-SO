import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://upoztxlcudrqhnjwjgho.supabase.co";
const ANON_KEY = "sb_publishable_zUHiDR00FbET1qisM11DCw_iWJ82nDT";

async function main() {
  const supabase = createClient(SUPABASE_URL, ANON_KEY);

  const email = "test.restaurante.run_20260816002021_4egukk@vimdy.dev";
  const password = "Test123456!";

  const { data } = await supabase.auth.signInWithPassword({ email, password });
  const jwt = data.session.access_token;

  console.log("1. Login OK");
  console.log("2. JWT:", jwt.slice(0, 20) + "...");

  const seedUrl = `${SUPABASE_URL}/functions/v1/test-seed-environment`;

  // Probar dryRun primero
  console.log("3. Probando dryRun...");
  const dryResponse = await fetch(seedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jwt}`
    },
    body: JSON.stringify({ dryRun: true })
  });

  const dryText = await dryResponse.text();
  console.log("   dryRun status:", dryResponse.status);
  console.log("   dryRun body:", dryText.slice(0, 500));

  if (!dryResponse.ok) {
    console.error("dryRun falló, no tiene sentido continuar");
    process.exit(1);
  }

  // Probar seed real
  console.log("4. Ejecutando seed real...");
  const seedResponse = await fetch(seedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jwt}`
    },
    body: JSON.stringify({ dryRun: false })
  });

  const seedText = await seedResponse.text();
  console.log("   seed status:", seedResponse.status);
  console.log("   seed body:", seedText.slice(0, 1000));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
