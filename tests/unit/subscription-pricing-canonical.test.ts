import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getPlanPrice, getPlanCurrency } from "../../src/core/entities/SubscriptionTypes";

describe("subscription price canonical source", () => {
  it("usa el precio de lanzamiento VIMDY en COP sin descuento implícito", () => {
    expect(getPlanPrice("monthly", "CO")).toBe(59900);
    expect(getPlanPrice("yearly", "CO")).toBe(718800);
    expect(getPlanCurrency("monthly", "CO")).toBe("COP");
  });

  it("calcula la firma Wompi antes de reutilizar el checkout pendiente", () => {
    const file = readFileSync(
      join(process.cwd(), "supabase", "functions", "wompi-create-checkout", "index.ts"),
      "utf-8"
    );

    const signatureIndex = file.indexOf("const signature = await buildIntegritySignature");
    const existingPaymentIndex = file.indexOf("if (existingPayment)");
    const conflictRecoveryIndex = file.indexOf("if (insertError)");

    expect(signatureIndex).toBeGreaterThan(-1);
    expect(existingPaymentIndex).toBeGreaterThan(-1);
    expect(conflictRecoveryIndex).toBeGreaterThan(-1);
    expect(signatureIndex).toBeLessThan(existingPaymentIndex);
    expect(existingPaymentIndex).toBeLessThan(conflictRecoveryIndex);
  });
});
