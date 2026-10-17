// tests/smoke/mesa-roles-cobro.test.ts
/* ===========================================================================
   Cobro de mesas — quién puede cobrar (punto 2)
   ---------------------------------------------------------------------------
   Garantiza que la pantalla y TODA la cadena de cobro del servidor acepten
   exactamente los mismos roles, y que cada rechazo de permiso se muestre con
   un mensaje claro (nunca un código crudo ni "sin internet").
=========================================================================== */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  TABLE_CHARGE_ROLES,
  TABLE_CHARGE_FORBIDDEN_MESSAGE,
  canChargeTables
} from "../../src/core/config/tableChargeRoles";
import { translateBusinessError } from "../../src/core/errors/translateBusinessError";
import { isBusinessError } from "../../src/core/offline/offlineConstants";
import { isNetworkFailure } from "../../src/core/services/offlineSale";

const MIGRATIONS_DIR = join(__dirname, "../../supabase/migrations");

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8").replace(/\r\n/g, "\n");
}

/** Última migración (por nombre) que define la función indicada. */
function latestDefinition(functionName: string): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const needle = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\s*\\(`, "i");
  const matching = files.filter((f) => needle.test(readMigration(f)));
  expect(matching.length, `no hay migración que defina ${functionName}`).toBeGreaterThan(0);
  return readMigration(matching[matching.length - 1]);
}

function rolesIn(sql: string, pattern: RegExp): string[] {
  const match = sql.match(pattern);
  expect(match, `no se encontró la validación de roles ${pattern}`).not.toBeNull();
  return [...(match as RegExpMatchArray)[1].matchAll(/'([A-Z]+)'/g)].map((m) => m[1]).sort();
}

describe("Cobro de mesas — roles permitidos", () => {
  const expected = [...TABLE_CHARGE_ROLES].sort();

  it("ADMIN, GERENTE y CAJERO pueden cobrar; el resto no", () => {
    expect(canChargeTables("ADMIN")).toBe(true);
    expect(canChargeTables("GERENTE")).toBe(true);
    expect(canChargeTables("CAJERO")).toBe(true);
    expect(canChargeTables(" cajero ")).toBe(true);

    for (const role of ["MESERO", "COCINA", "INVENTARIO", "CONTADOR", "SOPORTE", "", null, undefined]) {
      expect(canChargeTables(role as string | null | undefined)).toBe(false);
    }
  });

  it("el cobro en caja (register_sale_payment_atomic) acepta los mismos roles que la pantalla", () => {
    const sql = latestDefinition("register_sale_payment_atomic");
    const roles = rolesIn(
      sql,
      /IF NOT v_is_provider AND NOT public\.has_business_role\(p_business_id, ARRAY\[([^\]]+)\]\) THEN RAISE EXCEPTION 'CAJA_FORBIDDEN'/
    );
    expect(roles).toEqual(expected);
  });

  it("crear la venta de la mesa acepta los mismos roles que la pantalla", () => {
    const sql = latestDefinition("create_sale_fulfillment_atomic");
    const roles = rolesIn(
      sql,
      /IF NOT public\.has_business_role\(p_business_id, ARRAY\[([^\]]+)\]\) THEN\s+RAISE EXCEPTION 'SALE_FORBIDDEN'/
    );
    expect(roles).toEqual(expected);
  });

  it("la sesión de pago de Wompi acepta los mismos roles que la pantalla", () => {
    const sql = latestDefinition("create_wompi_sale_payment_session_atomic");
    const roles = rolesIn(
      sql,
      /has_business_role\(v_sale\.business_id, ARRAY\[([^\]]+)\]\)\s*\)? THEN\s+RAISE EXCEPTION 'PAYMENT_SESSION_FORBIDDEN'/
    );
    expect(roles).toEqual(expected);
  });

  it("propiedad del turno: solo ADMIN y GERENTE cobran sobre el turno de otro cajero", () => {
    const sql = latestDefinition("register_sale_payment_atomic");
    const ownerChecks = [
      ...sql.matchAll(
        /AND NOT public\.has_business_role\(p_business_id, ARRAY\[([^\]]+)\]\)\s+AND NULLIF\(v_shift\.data->>'cashierId'/g
      )
    ];
    // Un chequeo con turno indicado y otro al resolver el turno abierto.
    expect(ownerChecks.length).toBe(2);
    for (const check of ownerChecks) {
      const roles = [...check[1].matchAll(/'([A-Z]+)'/g)].map((m) => m[1]).sort();
      expect(roles).toEqual(["ADMIN", "GERENTE"]);
    }
  });

  it("el camino de proveedor (webhook de Wompi) y el alcance de sucursal siguen intactos", () => {
    const sql = latestDefinition("register_sale_payment_atomic");
    expect(sql).toContain("v_is_provider boolean := (auth.role() = 'service_role' AND p_verification_source = 'PROVIDER')");
    expect(sql).toContain("RAISE EXCEPTION 'CAJA_BRANCH_FORBIDDEN'");
    expect(sql).toContain("RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED'");
  });
});

describe("Cobro de mesas — mensajes de permiso claros", () => {
  const codes = [
    "CAJA_FORBIDDEN",
    "CAJA_NOT_A_MEMBER",
    "CAJA_BRANCH_FORBIDDEN",
    "CAJA_SHIFT_OWNER_REQUIRED",
    "SALE_FORBIDDEN",
    "SALE_NOT_A_MEMBER",
    "SALE_SUBSCRIPTION_INACTIVE",
    "PAYMENT_SESSION_FORBIDDEN"
  ];

  it.each(codes)("%s se traduce a un mensaje en español sin código crudo", (code) => {
    const message = translateBusinessError(new Error(code), "RESPALDO");
    expect(message).not.toBe("RESPALDO");
    expect(message).not.toContain(code);
    expect(message.length).toBeGreaterThan(20);
  });

  it("los rechazos de permiso nunca se confunden con falta de internet ni se reintentan offline", () => {
    for (const code of [
      "CAJA_FORBIDDEN",
      "CAJA_BRANCH_FORBIDDEN",
      "CAJA_SHIFT_OWNER_REQUIRED",
      "SALE_FORBIDDEN",
      "SALE_NOT_A_MEMBER"
    ]) {
      expect(isNetworkFailure(new Error(code)), code).toBe(false);
      expect(isBusinessError(new Error(code)), code).toBe(true);
    }
  });

  it("el mensaje para un mesero es claro y sin jerga", () => {
    expect(TABLE_CHARGE_FORBIDDEN_MESSAGE).toMatch(/cajero|encargado/i);
  });
});