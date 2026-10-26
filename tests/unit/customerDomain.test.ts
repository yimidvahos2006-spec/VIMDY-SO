import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { Sale } from "../../src/core/entities/Entities";
import {
  DEFAULT_LOYALTY_CONFIG,
  E164_PATTERN,
  FINAL_CONSUMER_DOCUMENT,
  assertValidLoyaltyConfig,
  calculateLifetimePoints,
  calculateLifetimeSpent,
  calculateLoyaltyProfile,
  computeNitCheckDigit,
  countsTowardLoyalty,
  getTierProgress,
  isLoyaltyEligibleCustomer,
  normalizeDocument,
  normalizePhone,
  resolveTier
} from "../../src/core/domain/customers";

/* ------------------------------------------------------------------ phone */

function e164(raw: string, country: Parameters<typeof normalizePhone>[1] = "CO"): string | null {
  const result = normalizePhone(raw, country);
  return result.ok ? result.e164 : null;
}

describe("normalizePhone", () => {
  it("todas las formas de escribir el mismo celular colombiano dan el mismo E.164", () => {
    const forms = [
      "3001234567",
      "300 123 4567",
      "300-123-4567",
      "(300) 123 4567",
      "+57 300 123 4567",
      "+573001234567",
      "57 300 123 4567",
      "573001234567",
      "0057 300 123 4567",
      " 300.123.4567 "
    ];
    for (const form of forms) expect(e164(form), form).toBe("+573001234567");
  });

  it("fijos colombianos de 10 dígitos con indicativo (601-608)", () => {
    expect(e164("601 234 5678")).toBe("+576012345678");
    expect(e164("(604) 444 1234")).toBe("+576044441234");
    expect(e164("609 234 5678")).toBeNull(); // 609 no existe
  });

  it("fijo colombiano de 7 dígitos se rechaza por falta de indicativo", () => {
    expect(normalizePhone("234 5678", "CO")).toEqual({ ok: false, reason: "MISSING_AREA_CODE" });
  });

  it("rechaza vacío, letras y '+' en medio", () => {
    expect(normalizePhone("", "CO")).toEqual({ ok: false, reason: "EMPTY" });
    expect(normalizePhone("   ", "CO")).toEqual({ ok: false, reason: "EMPTY" });
    expect(normalizePhone(null, "CO")).toEqual({ ok: false, reason: "EMPTY" });
    expect(normalizePhone("300 123 abcd", "CO")).toEqual({ ok: false, reason: "INVALID_CHARACTERS" });
    expect(normalizePhone("300+1234567", "CO")).toEqual({ ok: false, reason: "INVALID_CHARACTERS" });
    expect(normalizePhone("---", "CO")).toEqual({ ok: false, reason: "EMPTY" });
  });

  it("rechaza largos incorrectos", () => {
    expect(normalizePhone("300123456", "CO")).toEqual({ ok: false, reason: "TOO_SHORT" });
    expect(normalizePhone("30012345678", "CO")).toEqual({ ok: false, reason: "TOO_LONG" });
    expect(normalizePhone("+57 300 123 456", "CO")).toEqual({ ok: false, reason: "TOO_SHORT" });
  });

  it("rechaza un celular colombiano que no empieza por 3", () => {
    expect(normalizePhone("2001234567", "CO")).toEqual({ ok: false, reason: "INVALID_FORMAT" });
  });

  it("un número nacional que empieza igual que el código de país no se confunde (México)", () => {
    // 10 dígitos que empiezan por "52" siguen siendo un número nacional mexicano.
    expect(e164("5212345678", "MX")).toBe("+525212345678");
    expect(e164("+52 55 1234 5678", "MX")).toBe("+525512345678");
    expect(e164("52 55 1234 5678", "MX")).toBe("+525512345678");
  });

  it("México: el '1' antiguo de celulares se descarta", () => {
    expect(e164("+52 1 55 1234 5678", "MX")).toBe("+525512345678");
  });

  it("Estados Unidos / NANP", () => {
    expect(e164("(415) 555-2671", "US")).toBe("+14155552671");
    expect(e164("1 415 555 2671", "US")).toBe("+14155552671");
    expect(e164("+1 415 555 2671", "US")).toBe("+14155552671");
    expect(e164("115 555 2671", "US")).toBeNull();
  });

  it("España, Perú, Chile, Panamá y Ecuador", () => {
    expect(e164("612 345 678", "ES")).toBe("+34612345678");
    expect(e164("987 654 321", "PE")).toBe("+51987654321");
    expect(e164("9 8765 4321", "CL")).toBe("+56987654321");
    expect(e164("6123 4567", "PA")).toBe("+50761234567");
    expect(e164("099 123 4567", "EC")).toBe("+593991234567"); // 0 troncal fuera
    expect(e164("99 123 4567", "EC")).toBe("+593991234567");
  });

  it("Argentina solo se acepta en formato internacional (no se adivina el local)", () => {
    expect(normalizePhone("11 2345 6789", "AR")).toEqual({ ok: false, reason: "NATIONAL_FORMAT_UNSUPPORTED" });
    expect(e164("+54 11 2345 6789", "AR")).toBe("+541123456789");
    expect(e164("+54 9 11 2345 6789", "AR")).toBe("+5491123456789");
  });

  it("un cliente de otro país entra por formato internacional aunque el negocio sea de Colombia", () => {
    expect(e164("+49 1512 3456789", "CO")).toBe("+4915123456789"); // Alemania: fuera de la lista
    expect(e164("+34 612 345 678", "CO")).toBe("+34612345678");
    expect(e164("+1 415 555 2671", "CO")).toBe("+14155552671");
  });

  it("E.164: mínimo 8 y máximo 15 dígitos, sin 0 inicial", () => {
    expect(normalizePhone("+4912345", "CO")).toEqual({ ok: false, reason: "TOO_SHORT" });
    expect(normalizePhone("+49 1234 5678 9012 3456", "CO")).toEqual({ ok: false, reason: "TOO_LONG" });
    expect(normalizePhone("+0 123 456 789", "CO")).toEqual({ ok: false, reason: "INVALID_FORMAT" });
  });

  it("todo resultado válido cumple el mismo patrón que el CHECK de Postgres", () => {
    const samples = ["3001234567", "+4915123456789", "+14155552671", "601 234 5678", "+54 9 11 2345 6789"];
    for (const sample of samples) {
      const out = e164(sample);
      expect(out, sample).not.toBeNull();
      expect(E164_PATTERN.test(out as string), sample).toBe(true);
    }
  });

  it("es idempotente: normalizar un E.164 ya normalizado no lo cambia", () => {
    for (const sample of ["3001234567", "+14155552671", "+4915123456789", "601 234 5678"]) {
      const once = e164(sample) as string;
      expect(e164(once)).toBe(once);
    }
  });
});

/* --------------------------------------------------------------- document */

describe("computeNitCheckDigit", () => {
  it("coincide con NIT reales conocidos", () => {
    expect(computeNitCheckDigit("890903938")).toBe(8); // Bancolombia
    expect(computeNitCheckDigit("800197268")).toBe(4); // DIAN
    expect(computeNitCheckDigit("899999068")).toBe(1); // Ecopetrol
    expect(computeNitCheckDigit("890900608")).toBe(9); // Almacenes Éxito
  });

  it("devuelve siempre un solo dígito 0-9", () => {
    for (let i = 0; i < 2000; i += 1) {
      const base = String(100000 + Math.floor(Math.random() * 899999999));
      const dv = computeNitCheckDigit(base);
      expect(Number.isInteger(dv) && dv >= 0 && dv <= 9, base).toBe(true);
    }
  });

  it("rechaza bases que no son dígitos", () => {
    expect(() => computeNitCheckDigit("12A")).toThrow("NIT_BASE_INVALID");
    expect(() => computeNitCheckDigit("")).toThrow("NIT_BASE_INVALID");
  });
});

describe("normalizeDocument", () => {
  it("NIT: puntos, espacios y guion son solo formato; la llave es la base sin DV", () => {
    for (const form of ["890903938-8", "890.903.938-8", " 890 903 938 - 8 ".replace(/ - /, "-")]) {
      expect(normalizeDocument("NIT", form), form).toEqual({
        ok: true,
        type: "NIT",
        number: "890903938-8",
        key: "890903938",
        checkDigit: 8
      });
    }
  });

  it("NIT sin DV: se acepta y se calcula; con el mismo resultado de unicidad", () => {
    const withDv = normalizeDocument("NIT", "890903938-8");
    const without = normalizeDocument("NIT", "890903938");
    expect(without.ok && without.key).toBe("890903938");
    expect(without.ok && withDv.ok && without.key === withDv.key).toBe(true);
    expect(without.ok && without.number).toBe("890903938-8");
  });

  it("NIT con DV incorrecto se rechaza", () => {
    expect(normalizeDocument("NIT", "890903938-7")).toEqual({ ok: false, reason: "CHECK_DIGIT_MISMATCH" });
  });

  it("NIT: largo y caracteres", () => {
    expect(normalizeDocument("NIT", "12345")).toEqual({ ok: false, reason: "TOO_SHORT" });
    expect(normalizeDocument("NIT", "12345678901-1")).toEqual({ ok: false, reason: "TOO_LONG" });
    expect(normalizeDocument("NIT", "ABC123456-1")).toEqual({ ok: false, reason: "INVALID_CHARACTERS" });
    expect(normalizeDocument("NIT", "890903938-88")).toEqual({ ok: false, reason: "INVALID_CHARACTERS" });
    expect(normalizeDocument("NIT", "")).toEqual({ ok: false, reason: "EMPTY" });
    expect(normalizeDocument("NIT", undefined)).toEqual({ ok: false, reason: "EMPTY" });
  });

  it("NIT de persona natural de 10 dígitos sin guion se toma como base completa", () => {
    const result = normalizeDocument("NIT", "1020304050");
    expect(result.ok && result.key).toBe("1020304050");
  });

  it("el placeholder DIAN de consumidor final nunca identifica a un cliente", () => {
    for (const type of ["CC", "CE", "NIT", "PASSPORT", "OTHER"] as const) {
      expect(normalizeDocument(type, FINAL_CONSUMER_DOCUMENT), type).toEqual({
        ok: false,
        reason: "FINAL_CONSUMER_PLACEHOLDER"
      });
    }
    expect(normalizeDocument("NIT", "222.222.222.222")).toEqual({ ok: false, reason: "FINAL_CONSUMER_PLACEHOLDER" });
  });

  it("CC y CE: solo dígitos, con largos razonables", () => {
    expect(normalizeDocument("CC", "1.020.304.050")).toEqual({ ok: true, type: "CC", number: "1020304050", key: "1020304050" });
    expect(normalizeDocument("CC", "12345")).toEqual({ ok: false, reason: "TOO_SHORT" });
    expect(normalizeDocument("CC", "12345678901")).toEqual({ ok: false, reason: "TOO_LONG" });
    expect(normalizeDocument("CC", "10203A4050")).toEqual({ ok: false, reason: "INVALID_CHARACTERS" });
    expect(normalizeDocument("CE", "123456")).toEqual({ ok: true, type: "CE", number: "123456", key: "123456" });
  });

  it("pasaporte y otros: alfanumérico en mayúsculas sin espacios ni guiones", () => {
    expect(normalizeDocument("PASSPORT", "ab-123 456")).toEqual({
      ok: true,
      type: "PASSPORT",
      number: "AB123456",
      key: "AB123456"
    });
    expect(normalizeDocument("OTHER", "abc")).toEqual({ ok: false, reason: "TOO_SHORT" });
    expect(normalizeDocument("OTHER", "a".repeat(21))).toEqual({ ok: false, reason: "TOO_LONG" });
    expect(normalizeDocument("PASSPORT", "AB#12345")).toEqual({ ok: false, reason: "INVALID_CHARACTERS" });
  });
});

/* ---------------------------------------------------------------- loyalty */

function sale(overrides: Partial<Sale> & { total: number }): Sale {
  return {
    id: "s",
    customerId: "c1",
    items: [],
    createdAt: new Date("2026-03-01T10:00:00Z"),
    updatedAt: new Date("2026-03-01T10:00:00Z"),
    status: "PAID",
    ...overrides
  } as Sale;
}

describe("loyalty — puntos y niveles", () => {
  it("bordes exactos de nivel: 149 / 150 / 499 / 500 puntos", () => {
    expect(resolveTier(0)).toBe("bronce");
    expect(resolveTier(149)).toBe("bronce");
    expect(resolveTier(150)).toBe("plata");
    expect(resolveTier(499)).toBe("plata");
    expect(resolveTier(500)).toBe("oro");
    expect(resolveTier(1_000_000)).toBe("oro");
  });

  it("valores inválidos caen a bronce, nunca lanzan", () => {
    expect(resolveTier(-5)).toBe("bronce");
    expect(resolveTier(Number.NaN)).toBe("bronce");
    expect(resolveTier(Number.POSITIVE_INFINITY)).toBe("bronce");
  });

  it("1 punto por cada $1.000, sin errores de punto flotante en los bordes", () => {
    expect(calculateLifetimePoints(0)).toBe(0);
    expect(calculateLifetimePoints(999.99)).toBe(0);
    expect(calculateLifetimePoints(1000)).toBe(1);
    expect(calculateLifetimePoints(149_999.99)).toBe(149);
    expect(calculateLifetimePoints(150_000)).toBe(150);
    expect(calculateLifetimePoints(499_999.99)).toBe(499);
    expect(calculateLifetimePoints(500_000)).toBe(500);
    expect(calculateLifetimePoints(-10)).toBe(0);
    expect(calculateLifetimePoints(Number.NaN)).toBe(0);
  });

  it("coincide con la regla vigente de la app: floor(total * 0.001)", () => {
    for (const total of [0, 999, 1000, 12_345, 150_000, 499_999, 500_000, 2_345_678]) {
      expect(calculateLifetimePoints(total)).toBe(Math.floor(total * 0.001));
    }
  });

  it("progreso hacia el siguiente nivel", () => {
    expect(getTierProgress(0)).toEqual({ tier: "bronce", nextTier: "plata", pointsToNextTier: 150, progress: 0 });
    expect(getTierProgress(75)).toEqual({ tier: "bronce", nextTier: "plata", pointsToNextTier: 75, progress: 0.5 });
    expect(getTierProgress(150)).toEqual({ tier: "plata", nextTier: "oro", pointsToNextTier: 350, progress: 0 });
    expect(getTierProgress(500)).toEqual({ tier: "oro", nextTier: null, pointsToNextTier: null, progress: 1 });
  });

  it("valida la configuración", () => {
    expect(() => assertValidLoyaltyConfig(DEFAULT_LOYALTY_CONFIG)).not.toThrow();
    expect(() => assertValidLoyaltyConfig({ currencyUnitsPerPoint: 0, tiers: DEFAULT_LOYALTY_CONFIG.tiers })).toThrow(
      "INVALID_LOYALTY_CONFIG:currencyUnitsPerPoint"
    );
    expect(() => assertValidLoyaltyConfig({ currencyUnitsPerPoint: 1000, tiers: [] })).toThrow(
      "INVALID_LOYALTY_CONFIG:firstTierMustStartAtZero"
    );
    expect(() =>
      assertValidLoyaltyConfig({ currencyUnitsPerPoint: 1000, tiers: [{ tier: "bronce", minPoints: 10 }] })
    ).toThrow("INVALID_LOYALTY_CONFIG:firstTierMustStartAtZero");
    expect(() =>
      assertValidLoyaltyConfig({
        currencyUnitsPerPoint: 1000,
        tiers: [
          { tier: "bronce", minPoints: 0 },
          { tier: "plata", minPoints: 100 },
          { tier: "oro", minPoints: 100 }
        ]
      })
    ).toThrow("INVALID_LOYALTY_CONFIG:tiersMustBeStrictlyAscending");
  });

  it("una configuración propia (otra moneda) cambia puntos y niveles", () => {
    const usd = {
      currencyUnitsPerPoint: 1,
      tiers: [
        { tier: "bronce", minPoints: 0 },
        { tier: "plata", minPoints: 100 },
        { tier: "oro", minPoints: 300 }
      ]
    } as const;
    expect(calculateLifetimePoints(99.99, usd)).toBe(99);
    expect(resolveTier(calculateLifetimePoints(300, usd), usd)).toBe("oro");
  });
});

describe("loyalty — perfil derivado de ventas", () => {
  it("solo PAID/CLOSED cuentan (sin importar mayúsculas ni espacios); el resto no", () => {
    expect(countsTowardLoyalty({ status: "PAID" })).toBe(true);
    expect(countsTowardLoyalty({ status: "CLOSED" })).toBe(true);
    expect(countsTowardLoyalty({ status: " paid " as Sale["status"] })).toBe(true);
    for (const status of ["OPEN", "PENDING_PAYMENT", "CANCELLED", "REFUNDED", undefined] as const) {
      expect(countsTowardLoyalty({ status }), String(status)).toBe(false);
    }
  });

  it("calcula gasto, compras, primera/última compra, puntos y nivel", () => {
    const profile = calculateLoyaltyProfile([
      sale({ id: "a", total: 100_000, createdAt: new Date("2026-03-05T10:00:00Z") }),
      sale({ id: "b", total: 50_000.5, status: "CLOSED", createdAt: new Date("2026-03-01T10:00:00Z") }),
      sale({ id: "c", total: 999_999, status: "OPEN" }),
      sale({ id: "d", total: 999_999, status: "CANCELLED" })
    ]);
    expect(profile.lifetimeSpent).toBe(150_000.5);
    expect(profile.lifetimePurchaseCount).toBe(2);
    expect(profile.firstPurchaseAt?.toISOString()).toBe("2026-03-01T10:00:00.000Z");
    expect(profile.lastPurchaseAt?.toISOString()).toBe("2026-03-05T10:00:00.000Z");
    expect(profile.lifetimePoints).toBe(150);
    expect(profile.tier).toBe("plata");
    expect(profile.progress.nextTier).toBe("oro");
  });

  it("los reembolsos restan; una venta devuelta por completo no cuenta como compra", () => {
    const refund = (amount: number) => ({ id: "r", items: [], amount, reason: "x", createdAt: new Date() });
    const profile = calculateLoyaltyProfile([
      sale({ id: "a", total: 100_000, refunds: [refund(30_000), refund(20_000)] }),
      sale({ id: "b", total: 80_000, refunds: [refund(80_000)] }),
      sale({ id: "c", total: 10_000, refunds: [refund(999_999)] })
    ]);
    expect(profile.lifetimeSpent).toBe(50_000);
    expect(profile.lifetimePurchaseCount).toBe(1);
    expect(profile.lifetimePoints).toBe(50);
  });

  it("un reembolso grande puede bajar el nivel (el nivel sigue al gasto neto)", () => {
    const refund = { id: "r", items: [], amount: 450_000, reason: "x", createdAt: new Date() };
    expect(calculateLoyaltyProfile([sale({ total: 600_000 })]).tier).toBe("oro");
    expect(calculateLoyaltyProfile([sale({ total: 600_000, refunds: [refund] })]).tier).toBe("plata");
  });

  it("sin ventas: todo en cero, bronce y sin fechas", () => {
    const profile = calculateLoyaltyProfile([]);
    expect(profile).toMatchObject({
      lifetimeSpent: 0,
      lifetimePurchaseCount: 0,
      firstPurchaseAt: null,
      lastPurchaseAt: null,
      lifetimePoints: 0,
      tier: "bronce"
    });
  });

  it("calculateLifetimeSpent suma sin deriva de punto flotante", () => {
    const sales = Array.from({ length: 10 }, (_, i) => sale({ id: String(i), total: 0.1 }));
    expect(calculateLifetimeSpent(sales)).toBe(1);
  });

  it("el cliente de mostrador no acumula; un cliente real sí", () => {
    expect(isLoyaltyEligibleCustomer("CLIENTE_GENERAL")).toBe(false);
    expect(isLoyaltyEligibleCustomer("")).toBe(false);
    expect(isLoyaltyEligibleCustomer("   ")).toBe(false);
    expect(isLoyaltyEligibleCustomer(null)).toBe(false);
    expect(isLoyaltyEligibleCustomer(undefined)).toBe(false);
    expect(isLoyaltyEligibleCustomer("c2000000-0000-4000-8000-000000000101")).toBe(true);
  });
});

/* ------------------------------------------------- paridad con Postgres */

describe("paridad dominio TypeScript <-> migración SQL de customers_v2", () => {
  const migration = readFileSync(
    resolve(__dirname, "../../supabase/migrations/20261113000000_customers_v2_loyalty_server_columns.sql"),
    "utf8"
  ).replace(/\r\n/g, "\n");

  it("los umbrales de nivel de la columna generada son los de DEFAULT_LOYALTY_CONFIG", () => {
    const [, plata, oro] = DEFAULT_LOYALTY_CONFIG.tiers;
    expect(migration).toContain(`WHEN lifetime_points >= ${oro.minPoints} THEN '${oro.tier}'`);
    expect(migration).toContain(`WHEN lifetime_points >= ${plata.minPoints} THEN '${plata.tier}'`);
    expect(migration).toContain(`ELSE '${DEFAULT_LOYALTY_CONFIG.tiers[0].tier}'`);
  });

  it("la fórmula de puntos de SQL usa las mismas unidades por punto", () => {
    expect(migration).toContain(`floor(p_spent / ${DEFAULT_LOYALTY_CONFIG.currencyUnitsPerPoint})`);
  });

  it("el CHECK de teléfono de SQL exige el mismo patrón E.164 que el dominio", () => {
    expect(migration).toContain("phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'");
    expect(E164_PATTERN.source).toBe("^\\+[1-9][0-9]{7,14}$");
  });

  it("los tipos de documento de SQL son los del dominio", () => {
    expect(migration).toContain("document_type IN ('CC', 'CE', 'NIT', 'PASSPORT', 'OTHER')");
  });
});