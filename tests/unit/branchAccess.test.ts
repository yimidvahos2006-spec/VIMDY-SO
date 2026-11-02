import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

import {
  canDeactivateBranch,
  canDeleteBranch,
  canSetMainBranch,
  evaluateBranchAccess,
  validateBranchInput,
  type BranchSummary,
} from "../../src/core/config/branchAccess";

function branch(overrides: Partial<BranchSummary> & { id: string }): BranchSummary {
  return { name: `Sede ${overrides.id}`, address: null, phone: null, is_main: false, active: true, ...overrides };
}

const MAIN = branch({ id: "a", name: "Principal", is_main: true });

describe("evaluateBranchAccess — plan de 1 sede", () => {
  it("sin sucursales todavía puede crear la primera", () => {
    const access = evaluateBranchAccess({ tier: "single", branches: [], subscriptionBlocked: false });
    expect(access).toMatchObject({ canCreate: true, upgradeRequired: false, reason: "ok", limit: 1, message: null });
  });

  it("con 1 sucursal activa no puede crear otra y se le ofrece Multi-Sucursal", () => {
    const access = evaluateBranchAccess({ tier: "single", branches: [MAIN], subscriptionBlocked: false });
    expect(access).toMatchObject({ canCreate: false, canActivate: false, upgradeRequired: true, reason: "plan_limit", overLimit: false });
    expect(access.message).toMatch(/Multi-Sucursal/);
  });

  it("las sucursales inactivas no cuentan contra el límite", () => {
    const access = evaluateBranchAccess({
      tier: "single",
      branches: [MAIN, branch({ id: "b", active: false })],
      subscriptionBlocked: false,
    });
    expect(access.activeCount).toBe(1);
    expect(access.canCreate).toBe(false);
  });

  it("si ya tiene más activas que el plan (bajó de plan) lo indica sin borrar nada", () => {
    const access = evaluateBranchAccess({
      tier: "single",
      branches: [MAIN, branch({ id: "b" }), branch({ id: "c" })],
      subscriptionBlocked: false,
    });
    expect(access).toMatchObject({ overLimit: true, canCreate: false, activeCount: 3 });
    expect(access.message).toMatch(/tienes 3/);
  });
});

describe("evaluateBranchAccess — Multi-Sucursal y suscripción", () => {
  it("Multi-Sucursal no tiene límite", () => {
    const many = Array.from({ length: 12 }, (_, i) => branch({ id: String(i), is_main: i === 0 }));
    const access = evaluateBranchAccess({ tier: "multi", branches: many, subscriptionBlocked: false });
    expect(access).toMatchObject({ canCreate: true, limit: null, upgradeRequired: false, overLimit: false });
  });

  it("suscripción vencida o suspendida bloquea crear y reactivar aunque el plan sea Multi", () => {
    const access = evaluateBranchAccess({ tier: "multi", branches: [MAIN], subscriptionBlocked: true });
    expect(access).toMatchObject({ canCreate: false, canActivate: false, reason: "subscription_blocked", upgradeRequired: false });
    expect(access.message).toMatch(/suscripción/i);
  });
});

describe("validateBranchInput", () => {
  const existing = [MAIN, branch({ id: "b", name: "Sede Norte" })];

  it("acepta datos válidos y los normaliza", () => {
    const result = validateBranchInput({ name: "  Sede   Sur ", address: " Cra 5 ", phone: "300 123 4567" }, existing, null);
    expect(result).toEqual({ ok: true, value: { name: "Sede Sur", address: "Cra 5", phone: "300 123 4567" } });
  });

  it("el teléfono y la dirección son opcionales", () => {
    expect(validateBranchInput({ name: "Sede Sur", address: "", phone: "" }, existing, null).ok).toBe(true);
  });

  it("rechaza nombre vacío, muy corto o muy largo", () => {
    for (const name of ["", " ", "A", "x".repeat(81)]) {
      const result = validateBranchInput({ name, address: "", phone: "" }, existing, null);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.name).toBeTruthy();
    }
  });

  it("rechaza nombres repetidos sin importar mayúsculas ni espacios, pero permite conservar el propio al editar", () => {
    const dup = validateBranchInput({ name: "  sede   NORTE", address: "", phone: "" }, existing, null);
    expect(dup).toMatchObject({ ok: false, errors: { name: "Ya existe una sucursal con ese nombre." } });
    expect(validateBranchInput({ name: "Sede Norte", address: "", phone: "" }, existing, "b").ok).toBe(true);
  });

  it("valida el teléfono: caracteres permitidos y entre 7 y 15 dígitos", () => {
    const bad = ["12345", "abcdefghij", "300-123-4567 ext 9x", "1".repeat(16)];
    for (const phone of bad) {
      const result = validateBranchInput({ name: "Sede Sur", address: "", phone }, existing, null);
      expect(result.ok, phone).toBe(false);
    }
    for (const phone of ["+57 300 123 4567", "(604) 123-4567", "3001234567"]) {
      expect(validateBranchInput({ name: "Sede Sur", address: "", phone }, existing, null).ok, phone).toBe(true);
    }
  });

  it("limita la dirección a 200 caracteres", () => {
    const result = validateBranchInput({ name: "Sede Sur", address: "x".repeat(201), phone: "" }, existing, null);
    expect(result).toMatchObject({ ok: false, errors: { address: expect.any(String) } });
  });
});

describe("guardas de sucursal", () => {
  const other = branch({ id: "b" });

  it("no se desactiva la principal ni la última activa", () => {
    expect(canDeactivateBranch(MAIN, [MAIN, other]).allowed).toBe(false);
    expect(canDeactivateBranch(other, [MAIN, other]).allowed).toBe(true);
    const lonely = branch({ id: "z" });
    expect(canDeactivateBranch(lonely, [lonely, branch({ id: "y", active: false })]).allowed).toBe(false);
  });

  it("reactivar siempre está permitido por esta guarda (el límite lo decide el plan)", () => {
    expect(canDeactivateBranch(branch({ id: "i", active: false }), [MAIN]).allowed).toBe(true);
  });

  it("no se elimina la principal", () => {
    expect(canDeleteBranch(MAIN).allowed).toBe(false);
    expect(canDeleteBranch(other).allowed).toBe(true);
  });

  it("solo una sucursal activa y no principal puede pasar a ser la principal", () => {
    expect(canSetMainBranch(MAIN).allowed).toBe(false);
    expect(canSetMainBranch(branch({ id: "i", active: false })).allowed).toBe(false);
    expect(canSetMainBranch(other).allowed).toBe(true);
  });
});