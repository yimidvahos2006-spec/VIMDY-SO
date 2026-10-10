import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const checkoutFunction = readFileSync(
  join(process.cwd(), "supabase", "functions", "wompi-create-checkout", "index.ts"),
  "utf-8"
);
const activationMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20261021120000_subscription_payment_concurrency_hardening.sql"),
  "utf-8"
);

describe("subscription payment concurrency hardening", () => {
  it("uses a deterministic checkout key for the same business, plan, and window", () => {
    expect(checkoutFunction).toContain("const checkoutWindow = Math.floor(Date.now() / (5 * 60 * 1000));");
    expect(checkoutFunction).toContain("const reference = `wompi_${businessId}_${plan}_${checkoutWindow}`;");
    expect(checkoutFunction).toContain("const idempotencyKey = `${businessId}:${plan}:${checkoutWindow}`;");
    expect(checkoutFunction).toContain("if (insertError) {");
    expect(checkoutFunction).toContain("existingPayment.wompi_reference");
  });

  it("serializes activation for each business with a transaction advisory lock", () => {
    expect(activationMigration).toContain("perform pg_advisory_xact_lock(v_lock_key);");
    expect(activationMigration).toContain("v_lock_key := hashtext('subscription-activation', p_business_id::text);");
    expect(activationMigration).toContain("if v_payment.status = 'approved' then");
    expect(activationMigration).toContain("update public.subscription_payments");
  });
});
