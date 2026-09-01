import { describe, it, expect } from "vitest";
import { getDefaultModulesForBusinessType, type ModuleId } from "../../src/core/config/modules";
import { calculateModulesFromAnswers, type OnboardingAnswers } from "../../src/core/config/operation";

describe("ModuleId catalog — no 'meseros' como moduleId", () => {
  const VALID_MODULE_IDS: ModuleId[] = ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"];

  it("calculateModulesFromAnswers nunca incluye 'meseros' (inválido)", () => {
    const answers: OnboardingAnswers = {
      salesChannels: ["presencial"],
      hasTables: true,
      hasStaff: true,
      hasKitchen: true,
      hasInventory: true,
      useCustomers: true,
      inventoryType: "ambos",
      productionMode: "on_demand",
      kitchenOutput: "kds"
    };

    const modules = calculateModulesFromAnswers(answers);

    expect(modules).not.toContain("meseros");
    modules.forEach(m => expect(VALID_MODULE_IDS).toContain(m));
  });

  it("calculateModulesFromAnswers incluye 'mesas' cuando hasTables es true", () => {
    const answers: OnboardingAnswers = {
      salesChannels: ["presencial"],
      hasTables: true,
      hasStaff: true,
      hasKitchen: false,
      hasInventory: false,
      useCustomers: false,
      inventoryType: null,
      productionMode: null,
      kitchenOutput: null
    };

    const modules = calculateModulesFromAnswers(answers);

    expect(modules).toContain("mesas");
    expect(modules).toContain("caja");
    expect(modules).toContain("pedidos");
  });

  it("calculateModulesFromAnswers NO incluye 'mesas' cuando hasTables es false", () => {
    const answers: OnboardingAnswers = {
      salesChannels: ["presencial"],
      hasTables: false,
      hasStaff: false,
      hasKitchen: true,
      hasInventory: true,
      useCustomers: false,
      inventoryType: "ingredientes",
      productionMode: "batch",
      kitchenOutput: "printer"
    };

    const modules = calculateModulesFromAnswers(answers);

    expect(modules).not.toContain("mesas");
    expect(modules).toContain("cocina");
    expect(modules).toContain("inventario");
  });

  it("getDefaultModulesForBusinessType(restaurante) incluye todos los módulos del catálogo", () => {
    const modules = getDefaultModulesForBusinessType("restaurante");

    expect(modules).toEqual(["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"]);
  });

  it("getDefaultModulesForBusinessType(tienda) no incluye mesas/cocina/pedidos", () => {
    const modules = getDefaultModulesForBusinessType("tienda");

    expect(modules).toEqual(["caja", "inventario", "clientes", "ia"]);
    expect(modules).not.toContain("mesas");
    expect(modules).not.toContain("cocina");
  });
});

