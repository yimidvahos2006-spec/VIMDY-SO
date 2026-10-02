import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const config = {
  url: process.env.VIMDY_GATE1_SUPABASE_URL,
  anonKey: process.env.VIMDY_GATE1_SUPABASE_ANON_KEY,
  email: process.env.VIMDY_GATE1_EMAIL,
  password: process.env.VIMDY_GATE1_PASSWORD,
  businessId: process.env.VIMDY_GATE1_BUSINESS_ID,
  branchId: process.env.VIMDY_GATE1_BRANCH_ID,
  productId: process.env.VIMDY_GATE1_STOCK_ONE_PRODUCT_ID,
  shiftId: process.env.VIMDY_GATE1_OPEN_SHIFT_ID,
  cashRegisterId: process.env.VIMDY_GATE1_CASH_REGISTER_ID
};

const enabled = Object.values(config).every((value) => Boolean(value));

function requiredSetting(key: keyof typeof config): string {
  const value = config[key];
  if (!value) throw new Error(`Missing Gate 1 integration setting: ${key}`);
  return value;
}

function getRequiredConfig() {
  return {
    url: requiredSetting("url"),
    anonKey: requiredSetting("anonKey"),
    email: requiredSetting("email"),
    password: requiredSetting("password"),
    businessId: requiredSetting("businessId"),
    branchId: requiredSetting("branchId"),
    productId: requiredSetting("productId"),
    shiftId: requiredSetting("shiftId"),
    cashRegisterId: requiredSetting("cashRegisterId")
  };
}

type SaleFulfillmentResult = {
  readonly success: boolean;
  readonly idempotent?: boolean;
  readonly sale?: { readonly id?: string; readonly total?: number };
  readonly error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing Gate 1 test value: ${label}`);
  }
  return value;
}

function parseSaleFulfillmentResult(value: unknown): SaleFulfillmentResult | null {
  if (!isRecord(value) || typeof value.success !== "boolean") return null;
  const sale = isRecord(value.sale) ? value.sale : undefined;
  return {
    success: value.success,
    idempotent: typeof value.idempotent === "boolean" ? value.idempotent : undefined,
    sale: sale
      ? {
          id: typeof sale.id === "string" ? sale.id : undefined,
          total: typeof sale.total === "number" ? sale.total : Number(sale.total)
        }
      : undefined,
    error: typeof value.error === "string" ? value.error : undefined
  };
}

describe("Gate 1 — venta e idempotencia concurrentes en Supabase", () => {
  let client: SupabaseClient;

  beforeAll(async () => {
    if (!enabled) {
      throw new Error("BLOCKED_ENVIRONMENT: faltan credenciales o IDs de fixture reales para Gate 1.");
    }
    const settings = getRequiredConfig();
    client = createClient(settings.url, settings.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { error } = await client.auth.signInWithPassword({
      email: settings.email,
      password: settings.password
    });
    if (error) throw new Error(`Gate 1 test login failed: ${error.message}`);
  });

  afterAll(async () => {
    if (client) await client.auth.signOut();
  });

  it("serializa dos ventas sobre stock 1 y dos intentos concurrentes de pago", async () => {
    const settings = getRequiredConfig();
    const [{ data: business, error: businessError }, { data: branch, error: branchError }, { data: product, error: productError }] =
      await Promise.all([
        client.from("businesses").select("id,inventory_type,kitchen_enabled,kitchen_output_mode").eq("id", settings.businessId).single(),
        client.from("branches").select("id,business_id,active").eq("id", settings.branchId).single(),
        client.from("products").select("id,business_id,branch_id,data").eq("id", settings.productId).single()
      ]);
    if (businessError || branchError || productError) {
      throw new Error(`Gate 1 fixture read failed: ${businessError?.message ?? branchError?.message ?? productError?.message}`);
    }

    expect(branch.business_id).toBe(settings.businessId);
    expect(branch.active).toBe(true);
    expect(product.business_id).toBe(settings.businessId);
    expect([null, settings.branchId]).toContain(product.branch_id);
    expect(business.inventory_type).toMatch(/^(productos|ambos)$/);
    expect(product.data.active).not.toBe(false);
    expect(product.data.trackStock).toBe(true);
    expect(product.data.isIngredient).not.toBe(true);
    expect(product.data.recipe ?? []).toHaveLength(0);
    expect(Number(product.data.stock)).toBe(1);

    const firstSaleId = crypto.randomUUID();
    const secondSaleId = crypto.randomUUID();
    const createSale = (saleId: string) =>
      client.rpc("create_sale_fulfillment_atomic", {
        p_business_id: settings.businessId,
        p_branch_id: settings.branchId,
        p_idempotency_key: `gate1-concurrent-${saleId}`,
        p_sale: {
          id: saleId,
          type: "QUICK",
          items: [{ productId: settings.productId, quantity: 1 }]
        }
      });

    const saleAttempts = await Promise.all([createSale(firstSaleId), createSale(secondSaleId)]);
    for (const attempt of saleAttempts) {
      if (attempt.error) throw new Error(`Atomic sale RPC transport error: ${attempt.error.message}`);
    }
    const saleResults = saleAttempts.map((attempt) => parseSaleFulfillmentResult(attempt.data));
    expect(saleResults.every((result) => result !== null)).toBe(true);
    const successfulSales = saleResults.filter((result) => result?.success === true);
    const rejectedSales = saleResults.filter((result) => result?.success === false);
    expect(successfulSales).toHaveLength(1);
    expect(rejectedSales).toHaveLength(1);
    expect(rejectedSales[0]?.error).toContain("INSUFFICIENT_STOCK");

    const paidSale = successfulSales[0]?.sale;
    const saleId = requiredValue(paidSale?.id, "successful sale id");
    const total = Number(requiredValue(paidSale?.total, "successful sale total"));
    expect(total).toBeGreaterThan(0);

    const [retryOne, retryTwo] = await Promise.all([
      createSale(saleId),
      createSale(saleId)
    ]);
    for (const retry of [retryOne, retryTwo]) {
      if (retry.error) throw new Error(`Idempotent sale retry transport error: ${retry.error.message}`);
      const result = parseSaleFulfillmentResult(retry.data);
      expect(result?.success).toBe(true);
      expect(result?.idempotent).toBe(true);
    }

    const [{ data: updatedProduct, error: updatedProductError }, { data: saleRows, error: salesError }, { data: kitchenOrder, error: kitchenError }] =
      await Promise.all([
        client.from("products").select("data").eq("id", settings.productId).single(),
        client.from("sales").select("id,data").eq("business_id", settings.businessId).in("id", [firstSaleId, secondSaleId]),
        client.from("kitchen_orders").select("id,data").eq("id", saleId).maybeSingle()
      ]);
    if (updatedProductError || salesError || kitchenError) {
      throw new Error(`Gate 1 post-sale read failed: ${updatedProductError?.message ?? salesError?.message ?? kitchenError?.message}`);
    }

    expect(Number(updatedProduct.data.stock)).toBe(0);
    expect(saleRows).toHaveLength(1);
    const expectsKitchen =
      business.kitchen_enabled === true &&
      ["kds", "printer", "both"].includes(business.kitchen_output_mode) &&
      product.data.requiresKitchen !== false;
    expect(Boolean(kitchenOrder)).toBe(expectsKitchen);

    const paymentId = `gate1-concurrent-payment-${saleId}`;
    const registerPayment = () =>
      client.rpc("register_sale_payment_atomic", {
        p_sale_id: saleId,
        p_business_id: settings.businessId,
        p_branch_id: settings.branchId,
        p_payment_id: paymentId,
        p_change_id: null,
        p_payment_method: "CASH",
        p_total: total,
        p_cash_amount: total,
        p_received: total,
        p_change: 0,
        p_reference: null,
        p_cash_register_id: settings.cashRegisterId,
        p_verification_source: "CASH",
        p_shift_id: settings.shiftId
      });

    const paymentAttempts = await Promise.all([registerPayment(), registerPayment()]);
    for (const attempt of paymentAttempts) {
      if (attempt.error) throw new Error(`Atomic payment RPC failed: ${attempt.error.message}`);
    }
    expect(paymentAttempts.every((attempt) => Array.isArray(attempt.data) && attempt.data.length === 1)).toBe(true);

    const [{ data: paymentRows, error: paymentRowsError }, { data: persistedSale, error: persistedSaleError }] =
      await Promise.all([
        client.from("cash_movements").select("id").eq("business_id", settings.businessId).eq("branch_id", settings.branchId).eq("idempotency_key", paymentId),
        client.from("sales").select("data").eq("id", saleId).single()
      ]);
    if (paymentRowsError || persistedSaleError) {
      throw new Error(`Gate 1 payment verification read failed: ${paymentRowsError?.message ?? persistedSaleError?.message}`);
    }
    expect(paymentRows).toHaveLength(1);
    expect(persistedSale.data.status).toBe("PAID");

    const cashOperationKeys = [
      `gate1-cash-concurrent-a-${crypto.randomUUID()}`,
      `gate1-cash-concurrent-b-${crypto.randomUUID()}`
    ];
    const registerManualIncome = (idempotencyKey: string) =>
      client.rpc("register_cash_movement_enterprise", {
        p_idempotency_key: idempotencyKey,
        p_business_id: settings.businessId,
        p_branch_id: settings.branchId,
        p_cash_register_id: settings.cashRegisterId,
        p_shift_id: settings.shiftId,
        p_type: "IN",
        p_amount: 1,
        p_reason_code: "OTHER_IN",
        p_description: `Gate 1 concurrent cash ${idempotencyKey}`
      });

    const concurrentCashResults = await Promise.all(cashOperationKeys.map(registerManualIncome));
    for (const result of concurrentCashResults) {
      if (result.error) throw new Error(`Atomic cash movement RPC failed: ${result.error.message}`);
      expect(Array.isArray(result.data) && result.data.length === 1).toBe(true);
    }

    const conflictingKey = `gate1-cash-key-reuse-${crypto.randomUUID()}`;
    const initialCashMovement = await client.rpc("register_movement_atomic", {
      p_idempotency_key: conflictingKey,
      p_business_id: settings.businessId,
      p_branch_id: settings.branchId,
      p_type: "IN",
      p_amount: 1,
      p_description: "Gate 1 idempotency payload",
      p_payment_method: "CASH",
      p_cash_amount: 1,
      p_sale_id: null,
      p_created_at: new Date().toISOString(),
      p_cash_register_id: settings.cashRegisterId,
      p_verification_source: "CASH"
    });
    if (initialCashMovement.error) {
      throw new Error(`Initial idempotent cash movement failed: ${initialCashMovement.error.message}`);
    }
    const conflictingCashRetry = await client.rpc("register_movement_atomic", {
      p_idempotency_key: conflictingKey,
      p_business_id: settings.businessId,
      p_branch_id: settings.branchId,
      p_type: "IN",
      p_amount: 2,
      p_description: "Gate 1 idempotency payload changed",
      p_payment_method: "CASH",
      p_cash_amount: 2,
      p_sale_id: null,
      p_created_at: new Date().toISOString(),
      p_cash_register_id: settings.cashRegisterId,
      p_verification_source: "CASH"
    });
    expect(conflictingCashRetry.error?.message).toContain("CAJA_IDEMPOTENCY_KEY_REUSED");

    const [{ data: concurrentCashRows, error: concurrentCashError },
      { data: cashAuditRows, error: cashAuditError }] = await Promise.all([
      client.from("cash_movements").select("id,idempotency_key")
        .eq("business_id", settings.businessId).eq("branch_id", settings.branchId)
        .in("idempotency_key", [...cashOperationKeys, conflictingKey]),
      client.from("audit_logs").select("data")
        .eq("business_id", settings.businessId).eq("branch_id", settings.branchId)
        .in("data->>idempotencyKey", [...cashOperationKeys, conflictingKey])
    ]);
    if (concurrentCashError || cashAuditError) {
      throw new Error(`Cash persistence verification failed: ${concurrentCashError?.message ?? cashAuditError?.message}`);
    }
    expect(concurrentCashRows).toHaveLength(3);
    expect(cashAuditRows).toHaveLength(3);
  }, 60_000);
});
