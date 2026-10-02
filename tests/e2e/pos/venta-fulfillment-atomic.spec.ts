import { expect, test } from "@playwright/test";

const config = {
  email: process.env.VIMDY_GATE1_E2E_EMAIL,
  password: process.env.VIMDY_GATE1_E2E_PASSWORD,
  productId: process.env.VIMDY_GATE1_E2E_PRODUCT_ID,
  productName: process.env.VIMDY_GATE1_E2E_PRODUCT_NAME,
  businessId: process.env.VIMDY_GATE1_E2E_BUSINESS_ID,
  branchId: process.env.VIMDY_GATE1_E2E_BRANCH_ID,
  openShiftId: process.env.VIMDY_GATE1_E2E_OPEN_SHIFT_ID
};

function requiredSetting(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing Gate 1 E2E setting: ${name}`);
  return value;
}

test.describe("Gate 1 — POS fulfillment atómico", () => {
  test("producto → venta atómica → pago → inventario/KDS persistidos", async ({ page }) => {
    const e2eConfig = {
      email: requiredSetting(config.email, "VIMDY_GATE1_E2E_EMAIL"),
      password: requiredSetting(config.password, "VIMDY_GATE1_E2E_PASSWORD"),
      productId: requiredSetting(config.productId, "VIMDY_GATE1_E2E_PRODUCT_ID"),
      productName: requiredSetting(config.productName, "VIMDY_GATE1_E2E_PRODUCT_NAME"),
      businessId: requiredSetting(config.businessId, "VIMDY_GATE1_E2E_BUSINESS_ID"),
      branchId: requiredSetting(config.branchId, "VIMDY_GATE1_E2E_BRANCH_ID"),
      openShiftId: requiredSetting(config.openShiftId, "VIMDY_GATE1_E2E_OPEN_SHIFT_ID")
    };

    await page.goto("/login");
    await expect(page).toHaveURL(/\/pais$/);
    await page.getByRole("button", { name: /Colombia/ }).click();
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.locator("#email").fill(e2eConfig.email);
    await page.locator("#password").fill(e2eConfig.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await page.waitForURL("**/dashboard", { timeout: 60_000 });

    const initialState = await page.evaluate(async ({ businessId, branchId, productId, openShiftId }) => {
      const { supabase, getCurrentBusinessId, getCurrentBranchId } =
        await import("/src/infrastructure/supabase/supabaseClient.ts");
      if (getCurrentBusinessId() !== businessId || getCurrentBranchId() !== branchId) {
        throw new Error("Gate 1 E2E user is not scoped to the configured business/branch.");
      }
      const [{ data: business, error: businessError }, { data: product, error: productError },
        { data: shift, error: shiftError }] =
        await Promise.all([
          supabase.from("businesses")
            .select("id,inventory_type,kitchen_enabled,kitchen_output_mode")
            .eq("id", businessId).single(),
          supabase.from("products")
            .select("id,business_id,branch_id,data")
            .eq("id", productId).single(),
          supabase.from("shifts")
            .select("id,business_id,branch_id,data")
            .eq("id", openShiftId).single()
        ]);
      if (businessError || productError || shiftError) {
        throw new Error(businessError?.message ?? productError?.message ?? shiftError?.message);
      }
      if (product.business_id !== businessId || ![null, branchId].includes(product.branch_id)) {
        throw new Error("Gate 1 E2E product belongs to another tenant or branch.");
      }
      if (product.data.active === false || product.data.isIngredient === true) {
        throw new Error("Gate 1 E2E product must be an active sellable product.");
      }
      if (product.data.trackStock !== true || !["productos", "ambos"].includes(business.inventory_type)) {
        throw new Error("Gate 1 E2E product must use finished-product stock tracking.");
      }
      if ((product.data.recipe ?? []).length > 0) {
        throw new Error("Gate 1 E2E stock fixture must be a tracked finished product without a recipe.");
      }
      if (shift.business_id !== businessId || shift.branch_id !== branchId ||
          shift.data.status !== "OPEN" || !shift.data.cashRegisterId) {
        throw new Error("Gate 1 E2E requires an open shift and cash register in the configured branch.");
      }
      return {
        stock: Number(product.data.stock),
        requiresKitchen: product.data.requiresKitchen !== false,
        kitchenEnabled: business.kitchen_enabled,
        kitchenOutputMode: business.kitchen_output_mode
      };
    }, {
      businessId: e2eConfig.businessId,
      branchId: e2eConfig.branchId,
      productId: e2eConfig.productId,
      openShiftId: e2eConfig.openShiftId
    });
    expect(initialState.stock).toBeGreaterThan(0);

    await page.goto("/caja");
    await page.waitForURL("**/caja");
    const quickSale = page.getByRole("button", { name: /Venta rápida/i });
    if (await quickSale.isVisible()) await quickSale.click();

    await page.getByRole("button", {
      name: new RegExp(e2eConfig.productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    }).click();
    await page.getByRole("button", { name: /^Efectivo$/i }).click();
    await page.locator("#pos-cash-received").fill("100000000");

    const atomicSaleResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/rest/v1/rpc/create_sale_fulfillment_atomic")
    );
    const paymentResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/rest/v1/rpc/register_sale_payment_atomic")
    );
    await page.getByRole("button", { name: /COBRAR/i }).last().click();
    const [atomicSaleResponse, paymentResponse] = await Promise.all([
      atomicSaleResponsePromise,
      paymentResponsePromise
    ]);
    expect(atomicSaleResponse.ok()).toBe(true);
    expect(paymentResponse.ok()).toBe(true);
    const saleResult = await atomicSaleResponse.json();
    const paymentResult = await paymentResponse.json();
    expect(saleResult.success).toBe(true);
    expect(saleResult?.sale?.id).toBeTruthy();
    expect(Number(saleResult?.sale?.total)).toBeGreaterThan(0);
    expect(paymentResult).toHaveLength(1);
    expect(paymentResult[0]?.sale_data?.status).toBe("PAID");

    const persistedState = await page.evaluate(async ({ businessId, branchId, productId, saleId }) => {
      const { supabase } = await import("/src/infrastructure/supabase/supabaseClient.ts");
      const [{ data: sale, error: saleError }, { data: product, error: productError },
        { data: movements, error: movementsError }, { data: kitchenOrder, error: kitchenError },
        { data: cashMovements, error: cashError }] = await Promise.all([
        supabase.from("sales").select("id,business_id,branch_id,data")
          .eq("id", saleId).eq("business_id", businessId).eq("branch_id", branchId).single(),
        supabase.from("products").select("data").eq("id", productId).single(),
        supabase.from("inventory_movements").select("id,data")
          .eq("business_id", businessId).eq("branch_id", branchId).eq("data->>saleId", saleId),
        supabase.from("kitchen_orders").select("id,data").eq("id", saleId).maybeSingle(),
        supabase.from("cash_movements").select("id,idempotency_key")
          .eq("business_id", businessId).eq("branch_id", branchId)
          .eq("idempotency_key", `sale-payment-${saleId}`)
      ]);
      if (saleError || productError || movementsError || kitchenError || cashError) {
        throw new Error(saleError?.message ?? productError?.message ?? movementsError?.message ??
          kitchenError?.message ?? cashError?.message);
      }
      return {
        sale: sale.data,
        stock: Number(product.data.stock),
        movementCount: movements.length,
        kitchenOrder,
        cashMovementCount: cashMovements.length
      };
    }, {
      businessId: e2eConfig.businessId,
      branchId: e2eConfig.branchId,
      productId: e2eConfig.productId,
      saleId: saleResult.sale.id
    });

    expect(persistedState.sale.status).toBe("PAID");
    expect(persistedState.stock).toBe(initialState.stock - 1);
    expect(persistedState.movementCount).toBe(1);
    expect(persistedState.cashMovementCount).toBe(1);
    const expectsKitchen = initialState.kitchenEnabled &&
      ["kds", "printer", "both"].includes(initialState.kitchenOutputMode) &&
      initialState.requiresKitchen;
    expect(Boolean(persistedState.kitchenOrder)).toBe(Boolean(expectsKitchen));
  });
});
