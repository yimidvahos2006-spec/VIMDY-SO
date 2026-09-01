import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const WOMPI_WEBHOOK = readFileSync(
  join(process.cwd(), "supabase", "functions", "wompi-webhook", "index.ts"),
  "utf-8"
);
const MERCADOPAGO_WEBHOOK = readFileSync(
  join(process.cwd(), "supabase", "functions", "mercadopago-webhook", "index.ts"),
  "utf-8"
);
const PAYPAL_WEBHOOK = readFileSync(
  join(process.cwd(), "supabase", "functions", "paypal-webhook", "index.ts"),
  "utf-8"
);

describe("P0 — Pagos declinados NO cancelan la suscripción", () => {
  it("wompi-webhook usa expire (no cancel) en declinación", () => {
    expect(WOMPI_WEBHOOK).toMatch(/expire_subscription_server_side/);
    expect(WOMPI_WEBHOOK).not.toMatch(/cancel_subscription_server_side/);
  });

  it("mercadopago-webhook usa expire (no cancel) en declinación", () => {
    expect(MERCADOPAGO_WEBHOOK).toMatch(/expire_subscription_server_side/);
    expect(MERCADOPAGO_WEBHOOK).not.toMatch(/cancel_subscription_server_side/);
  });

  it("paypal-webhook usa expire (no cancel) en declinación", () => {
    expect(PAYPAL_WEBHOOK).toMatch(/expire_subscription_server_side/);
    expect(PAYPAL_WEBHOOK).not.toMatch(/cancel_subscription_server_side/);
  });

  it("expire_subscription_server_side deja past_due/suspended, NUNCA cancelled", () => {
    const schema = readFileSync(join(process.cwd(), "supabase", "schema.sql"), "utf-8");
    const expireFn = schema.indexOf("create or replace function public.expire_subscription_server_side");
    expect(expireFn).toBeGreaterThan(-1);

    const fnBody = schema.substring(expireFn, expireFn + 1000);
    expect(fnBody).toMatch(/past_due/);
    expect(fnBody).toMatch(/suspended/);
    expect(fnBody).not.toMatch(/cancelled/);
  });
});
