import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { onboardingDraftStore } from "../../src/presentation/components/onboarding/onboardingDraftStore";
import { assertBusinessTypeId, type BusinessTypeId } from "../../src/core/config/businessTypes";
import { translateBusinessError } from "../../src/core/errors/translateBusinessError";

const ONBOARDING_COMPONENTS = join(process.cwd(), "src", "presentation", "components", "onboarding");

function createDraft(businessType: BusinessTypeId | string) {
  return {
    step: "business_type" as const,
    businessType,
    enabledModules: [],
    categories: [],
    savedAt: new Date().toISOString()
  };
}

describe("onboarding business type persistence", () => {
  let storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    onboardingDraftStore.clear("user-1", "business-1");
    onboardingDraftStore.clear("user-1", "business-2");
    onboardingDraftStore.clear("user-a", "shared-business");
    onboardingDraftStore.clear("user-b", "shared-business");
  });

  it("restores a valid business type without accepting an invalid draft", () => {
    onboardingDraftStore.save("user-1", "business-1", createDraft("restaurante"));

    expect(onboardingDraftStore.get("user-1", "business-1")?.businessType).toBe("restaurante");

    onboardingDraftStore.save("user-1", "business-1", createDraft("not-a-real-business-type"));
    expect(onboardingDraftStore.get("user-1", "business-1")?.businessType).toBeNull();
  });

  it("keeps drafts isolated by business and clears the previous business", () => {
    onboardingDraftStore.save("user-1", "business-1", createDraft("restaurante"));
    onboardingDraftStore.save("user-1", "business-2", createDraft("cafeteria"));

    expect(onboardingDraftStore.get("user-1", "business-1")?.businessType).toBe("restaurante");
    expect(onboardingDraftStore.get("user-1", "business-2")?.businessType).toBe("cafeteria");

    onboardingDraftStore.clear("user-1", "business-1");
    expect(onboardingDraftStore.get("user-1", "business-1")).toBeNull();
    expect(onboardingDraftStore.get("user-1", "business-2")?.businessType).toBe("cafeteria");
  });

  it("isolates same-business drafts across users", () => {
    onboardingDraftStore.save("user-a", "shared-business", createDraft("restaurante"));
    onboardingDraftStore.save("user-b", "shared-business", createDraft("cafeteria"));

    expect(onboardingDraftStore.get("user-a", "shared-business")?.businessType).toBe("restaurante");
    expect(onboardingDraftStore.get("user-b", "shared-business")?.businessType).toBe("cafeteria");
  });

  it("rejects invalid business types before persistence", () => {
    expect(() => assertBusinessTypeId("restaurante")).not.toThrow();
    expect(() => assertBusinessTypeId("not-a-real-business-type")).toThrow(
      "El tipo de negocio seleccionado no es válido."
    );
  });

  it("keeps visible onboarding counters aligned with the seven-step progress", () => {
    const firstProduct = readFileSync(join(ONBOARDING_COMPONENTS, "FirstProductStep.tsx"), "utf-8");
    const cashOpening = readFileSync(join(ONBOARDING_COMPONENTS, "CashOpeningStep.tsx"), "utf-8");

    expect(firstProduct).toContain("Paso 6 de 7");
    expect(cashOpening).toContain("Paso 7 de 7");
  });

  it("blocks completion without an active product and translates the server rejection", () => {
    const firstProduct = readFileSync(join(ONBOARDING_COMPONENTS, "FirstProductStep.tsx"), "utf-8");
    const finalStep = readFileSync(join(ONBOARDING_COMPONENTS, "FinalStep.tsx"), "utf-8");

    expect(firstProduct).toContain("Crea al menos un producto activo antes de continuar.");
    expect(firstProduct).toContain("!hasActiveProduct");
    expect(finalStep).toContain("!hasActiveProduct");
    expect(translateBusinessError(new Error("ONBOARDING_PRODUCT_REQUIRED"))).toBe(
      "Crea al menos un producto activo antes de terminar la configuración."
    );
  });

  it("requires an authenticated employee creator and synchronously guards category saving", () => {
    const employees = readFileSync(join(ONBOARDING_COMPONENTS, "EmployeesStep.tsx"), "utf-8");
    const categories = readFileSync(join(ONBOARDING_COMPONENTS, "CategoriesStep.tsx"), "utf-8");

    expect(employees).toContain('setError("AUTH_USER_REQUIRED")');
    expect(translateBusinessError(new Error("AUTH_USER_REQUIRED"))).toBe(
      "Inicia sesión de nuevo para agregar empleados."
    );
    expect(employees).not.toContain('user?.id ?? "ADMIN"');
    expect(categories).toContain("useRef(false)");
    expect(categories).toContain("if (actionInFlight.current) return");
  });
});
