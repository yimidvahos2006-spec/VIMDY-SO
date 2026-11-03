import { beforeEach, describe, expect, it } from "vitest";

import {
  remainderFor,
  sanitizeMixedAmount,
  summarizeMixed
} from "../../src/core/payments/mixedPayment";
import { paymentStore } from "../../src/core/store/paymentStore";
import { shiftOpenCache, SHIFT_OPEN_TTL_MS } from "../../src/core/caja/shiftOpenCache";

describe("pago mixto — reglas puras", () => {
  it("sanitiza montos inválidos a 0", () => {
    expect(sanitizeMixedAmount(-5)).toBe(0);
    expect(sanitizeMixedAmount(Number.NaN)).toBe(0);
    expect(sanitizeMixedAmount("abc")).toBe(0);
    expect(sanitizeMixedAmount(12500)).toBe(12500);
  });

  it("calcula lo que falta", () => {
    const s = summarizeMixed(50000, { cash: 20000, card: 0, transfer: 0 });
    expect(s.missing).toBe(30000);
    expect(s.covered).toBe(false);
    expect(s.valid).toBe(false);
  });

  it("efectivo + transferencia exactos es válido y sin vuelto", () => {
    const s = summarizeMixed(50000, { cash: 20000, card: 0, transfer: 30000 });
    expect(s.valid).toBe(true);
    expect(s.missing).toBe(0);
    expect(s.change).toBe(0);
  });

  it("el vuelto sale del efectivo", () => {
    const s = summarizeMixed(50000, { cash: 40000, card: 0, transfer: 20000 });
    expect(s.change).toBe(10000);
    expect(s.valid).toBe(true);
  });

  it("transferencia por encima del total NO es válida (no hay vuelto digital)", () => {
    const s = summarizeMixed(50000, { cash: 0, card: 0, transfer: 60000 });
    expect(s.externalExceeds).toBe(true);
    expect(s.valid).toBe(false);
  });

  it("remainderFor resta los otros dos campos y nunca da negativo", () => {
    expect(remainderFor(50000, { cash: 20000, card: 5000, transfer: 0 }, "transfer")).toBe(25000);
    expect(remainderFor(50000, { cash: 80000, card: 0, transfer: 0 }, "transfer")).toBe(0);
  });
});

describe("pago mixto — saldo automático en el store", () => {
  beforeEach(() => {
    paymentStore.reset();
    paymentStore.setTotal(50000);
    paymentStore.setMethod("mixed");
  });

  it("al escribir efectivo, la transferencia se llena sola con el saldo", () => {
    paymentStore.setMixedAmount("cash", 20000);
    const s = paymentStore.get();
    expect(s.mixedTransfer).toBe(30000);
    expect(s.mixedBalanceKind).toBe("transfer");
    expect(paymentStore.isPaid()).toBe(true);
  });

  it("si cambia el efectivo, la transferencia se reajusta en tiempo real", () => {
    paymentStore.setMixedAmount("cash", 20000);
    paymentStore.setMixedAmount("cash", 35000);
    expect(paymentStore.get().mixedTransfer).toBe(15000);
  });

  it("si se escribe primero la transferencia, el efectivo es el que se llena solo", () => {
    paymentStore.setMixedAmount("transfer", 12000);
    const s = paymentStore.get();
    expect(s.mixedCash).toBe(38000);
    expect(s.mixedBalanceKind).toBe("cash");
  });

  it("si el efectivo supera el total, la transferencia queda en 0 y hay vuelto", () => {
    paymentStore.setMixedAmount("cash", 70000);
    const s = paymentStore.get();
    expect(s.mixedTransfer).toBe(0);
    expect(s.change).toBe(20000);
  });

  it("si el cajero escribe a mano en el campo automático, se respeta y se apaga el automático", () => {
    paymentStore.setMixedAmount("cash", 20000); // transferencia = 30000 (auto)
    paymentStore.setMixedAmount("transfer", 10000); // manual
    let s = paymentStore.get();
    expect(s.mixedTransfer).toBe(10000);
    expect(s.mixedAutoEnabled).toBe(false);
    expect(paymentStore.isPaid()).toBe(false);

    paymentStore.setMixedAmount("cash", 25000); // ya no reajusta nada
    s = paymentStore.get();
    expect(s.mixedTransfer).toBe(10000);
  });

  it("'Completar con ...' llena lo que falta y reactiva el automático", () => {
    paymentStore.setMixedAmount("cash", 20000);
    paymentStore.setMixedAmount("transfer", 10000);
    paymentStore.fillMixedRemainder("transfer");
    const s = paymentStore.get();
    expect(s.mixedTransfer).toBe(30000);
    expect(s.mixedAutoEnabled).toBe(true);
  });

  it("si cambia el total del carrito, el campo automático se reajusta", () => {
    paymentStore.setMixedAmount("cash", 20000);
    paymentStore.setTotal(65000);
    expect(paymentStore.get().mixedTransfer).toBe(45000);
  });

  it("la tarjeta es manual y reajusta el campo automático", () => {
    paymentStore.setMixedAmount("cash", 20000); // transf = 30000
    paymentStore.setMixedAmount("card", 10000);
    const s = paymentStore.get();
    expect(s.mixedTransfer).toBe(20000);
    expect(paymentStore.isPaid()).toBe(true);
  });

  it("al volver a entrar a mixto no quedan montos viejos", () => {
    paymentStore.setMixedAmount("cash", 20000);
    paymentStore.setMethod("cash");
    paymentStore.setMethod("mixed");
    const s = paymentStore.get();
    expect(s.mixedCash).toBe(0);
    expect(s.mixedTransfer).toBe(0);
  });

  it("ignora montos negativos o inválidos", () => {
    paymentStore.setMixedAmount("cash", -100);
    expect(paymentStore.get().mixedCash).toBe(0);
  });
});

describe("memoria corta del turno abierto", () => {
  beforeEach(() => shiftOpenCache.invalidate());

  it("reutiliza el resultado solo mientras está fresco y para la misma caja", () => {
    shiftOpenCache.markOpen("b|s|c", 1000);
    expect(shiftOpenCache.isFresh("b|s|c", 1000 + SHIFT_OPEN_TTL_MS - 1)).toBe(true);
    expect(shiftOpenCache.isFresh("b|s|c", 1000 + SHIFT_OPEN_TTL_MS + 1)).toBe(false);
    expect(shiftOpenCache.isFresh("otra|s|c", 1500)).toBe(false);
  });

  it("invalidate borra la memoria", () => {
    shiftOpenCache.markOpen("b|s|c", 1000);
    shiftOpenCache.invalidate();
    expect(shiftOpenCache.isFresh("b|s|c", 1001)).toBe(false);
  });
});