// tests/unit/mercadopagoRefundIdempotency.test.ts
// ===========================================================================
// Paso 6.9 CP2-A′.1 — Guarda de idempotency en mercadopago-refund.
//
// ALCANCE Y LIMITACION (leer antes de interpretar):
//   El handler es una Edge Function de Deno (`Deno.serve`, imports `npm:`).
//   Este repo corre vitest con `environment: "node"` y solo
//   `include: ["tests/**/*.test.ts"]`, y Deno no esta instalado. Por eso NO
//   se puede ejecutar el handler real aqui: hacerlo exigiria instalar Deno.
//
//   Lo que SI se verifica es la Guarantee ESTRUCTURAL sobre el fuente real:
//   que la guarda existe, que rechaza el rango 1..200, y que ocurre ANTES de
//   cualquier efecto (la RPC que reserva saldo y la llamada al proveedor).
//   Eso no sustituye una prueba de runtime: clasificado como PASS_STRUCTURAL.
// ===========================================================================

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(
  __dirname,
  "../../supabase/functions/mercadopago-refund/index.ts"
);

let source = "";
const indexOf = (needle: string) => source.indexOf(needle);

beforeAll(() => {
  source = readFileSync(SOURCE_PATH, "utf8");
});

describe("mercadopago-refund: guarda de idempotencyKey", () => {
  it("rechaza la ausencia de idempotencyKey antes de reservar saldo o llamar al proveedor", () => {
    const guardIdx = indexOf("IDEMPOTENCY_KEY_REQUIRED");
    const requestIdx = indexOf("request_subscription_refund_atomic");
    const providerIdx = indexOf("/refunds`");

    expect(guardIdx).toBeGreaterThan(-1);
    expect(requestIdx).toBeGreaterThan(-1);
    expect(providerIdx).toBeGreaterThan(-1);

    // El orden es la garantia: si la guarda no esta primero, una request sin
    // key reservaria saldo antes de ser rechazada.
    expect(guardIdx).toBeLessThan(requestIdx);
    expect(requestIdx).toBeLessThan(providerIdx);
  });

  it("devuelve 400 en el rechazo", () => {
    const guardIdx = indexOf("IDEMPOTENCY_KEY_REQUIRED");
    const after = source.slice(guardIdx - 260, guardIdx + 200);
    expect(after).toMatch(/\{\s*error:\s*"IDEMPOTENCY_KEY_REQUIRED/);
    expect(after).toMatch(/400/);
  });

  it("valida el rango 1..200, cubriendo undefined, vacio, espacios y 201 chars", () => {
    // La guarda real: typeof string -> trim, luego longitud.
    expect(source).toMatch(/typeof payload\.idempotencyKey === "string"/);
    expect(source).toMatch(/payload\.idempotencyKey\.trim\(\)/);
    expect(source).toMatch(/idempotencyKey\.length < 1 \|\| idempotencyKey\.length > 200/);

    // Comportamiento equivalente de la guarda para las 4 variantes,\    // evaluando la misma expresion sobre valores representativos.
    const guard = (v: unknown) => {
      const k = typeof v === "string" ? v.trim() : "";
      return k.length < 1 || k.length > 200;
    };
    expect(guard(undefined)).toBe(true);   // undefined
    expect(guard("")).toBe(true);          // ""
    expect(guard("   ")).toBe(true);       // solo espacios
    expect(guard("x".repeat(201))).toBe(true); // 201 chars
    expect(guard("x".repeat(200))).toBe(false); // 200 chars: valido
  });

  it("NO deriva la key de payment+amount (colision entre refunds legitimos)", () => {
    // El bug corregido en CP2-A′: dos refunds de 50 000 sobre un pago de
    // 100 000 generaban la misma key y el segundo devolvia en silencio el
    // refund anterior.
    expect(source).not.toContain("mp-refund-${");
    expect(source).not.toMatch(/idempotencyKey\s*=\s*`[^`]*\$\{paymentRow\.id\}/);
  });
});