import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = join(__dirname, "../../supabase/functions");

describe("PRE-FLIGHT: payment security configuration", () => {
  it("Wompi POS uses the real SUPABASE_ANON_KEY and never a placeholder", () => {
    const source = readFileSync(join(FUNCTIONS, "wompi-create-pos-checkout/index.ts"), "utf8");
    expect(source).toContain('Deno.env.get("SUPABASE_ANON_KEY")');
    expect(source).toContain("createClient(SUPABASE_URL, SUPABASE_ANON_KEY");
    expect(source).not.toContain('createClient(SUPABASE_URL, "placeholder"');
  });

  it("provider webhooks retain server-side signature verification paths", () => {
    const wompi = readFileSync(join(FUNCTIONS, "wompi-webhook/index.ts"), "utf8");
    const wompiPos = readFileSync(join(FUNCTIONS, "wompi-pos-webhook/index.ts"), "utf8");
    const mercadopago = readFileSync(join(FUNCTIONS, "mercadopago-webhook/index.ts"), "utf8");
    const paypal = readFileSync(join(FUNCTIONS, "paypal-webhook/index.ts"), "utf8");
    expect(wompi).toContain("validateChecksum");
    expect(wompiPos).toContain("validateChecksum");
    expect(mercadopago).toContain("x-signature");
    expect(mercadopago).toContain("hmacSha256Hex");
    expect(paypal).toContain("verifyWebhookSignature");
  });
});
