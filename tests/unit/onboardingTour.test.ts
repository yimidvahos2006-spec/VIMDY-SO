import { describe, expect, it } from "vitest";

import {
  advance,
  buildTourSteps,
  finish,
  goBack,
  initialProgress,
  onboardingLocalStore,
  parseProgress,
  resolveCurrentStep,
  resolveProgress,
  skip,
  type OnboardingProgress
} from "../../src/core/onboarding/onboardingTour";
import { permissionsForRole } from "../../src/infrastructure/supabase/rolePermissions";

function canFor(role: string) {
  const permissions = permissionsForRole(role);
  return (id: string) => permissions.includes("*") || permissions.includes(id);
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data
  };
}

describe("buildTourSteps — qué ve cada rol", () => {
  it("ADMIN con todos los módulos: bienvenida, inventario, caja y final", () => {
    expect(buildTourSteps({ can: canFor("ADMIN"), enabledModules: null })).toEqual([
      "welcome",
      "create_item",
      "use_pos",
      "done"
    ]);
  });

  it("CAJERO no puede crear productos: solo ve el paso de Caja", () => {
    expect(buildTourSteps({ can: canFor("CAJERO"), enabledModules: ["caja", "inventario"] })).toEqual([
      "welcome",
      "use_pos",
      "done"
    ]);
  });

  it("MESERO y COCINA no tienen nada que hacer aquí: no hay tour", () => {
    expect(buildTourSteps({ can: canFor("MESERO"), enabledModules: null })).toEqual([]);
    expect(buildTourSteps({ can: canFor("COCINA"), enabledModules: null })).toEqual([]);
  });

  it("respeta los módulos del negocio: sin módulo caja no se manda a /caja", () => {
    expect(buildTourSteps({ can: canFor("ADMIN"), enabledModules: ["inventario", "mesas"] })).toEqual([
      "welcome",
      "create_item",
      "done"
    ]);
  });

  it("sin ningún módulo útil no hay tour", () => {
    expect(buildTourSteps({ can: canFor("ADMIN"), enabledModules: ["mesas"] })).toEqual([]);
  });
});

describe("avance del progreso", () => {
  const steps = ["welcome", "create_item", "use_pos", "done"] as const;

  it("avanza y marca los pasos hechos", () => {
    let p = initialProgress(1);
    p = advance(p, steps, { now: 2 });
    expect(p.currentStep).toBe("create_item");
    expect(p.completedSteps).toEqual(["welcome"]);
    p = advance(p, steps, { now: 3 });
    expect(p.currentStep).toBe("use_pos");
    expect(p.completedSteps).toEqual(["welcome", "create_item"]);
  });

  it("'saltar paso' avanza sin contarlo como hecho", () => {
    let p = advance(initialProgress(1), steps, { now: 2 });
    p = advance(p, steps, { now: 3, markCompleted: false });
    expect(p.currentStep).toBe("use_pos");
    expect(p.completedSteps).toEqual(["welcome"]);
  });

  it("no avanza más allá del último paso", () => {
    const atDone: OnboardingProgress = { ...initialProgress(1), currentStep: "done" };
    expect(advance(atDone, steps)).toBe(atDone);
  });

  it("puede volver atrás pero no antes de la bienvenida", () => {
    const p = advance(initialProgress(1), steps, { now: 2 });
    expect(goBack(p, steps, 3).currentStep).toBe("welcome");
    expect(goBack(initialProgress(1), steps).currentStep).toBe("welcome");
  });

  it("omitir y terminar son estados definitivos distintos", () => {
    expect(skip(initialProgress(1), 5).status).toBe("skipped");
    const done = finish(initialProgress(1), 5);
    expect(done.status).toBe("completed");
    expect(done.completedSteps).toContain("done");
  });

  it("si el paso guardado ya no le aplica (cambió de rol), cae en uno válido", () => {
    const stale: OnboardingProgress = { ...initialProgress(1), currentStep: "create_item", completedSteps: ["welcome"] };
    expect(resolveCurrentStep(stale, ["welcome", "use_pos", "done"])).toBe("use_pos");
  });
});

describe("resolveProgress — local vs Supabase", () => {
  const inProgress = (updatedAt: number): OnboardingProgress => ({ ...initialProgress(updatedAt), updatedAt });

  it("un estado terminal siempre gana, aunque sea más viejo", () => {
    const skipped = skip(inProgress(1), 1);
    const newerInProgress = inProgress(999);
    expect(resolveProgress(skipped, newerInProgress)).toBe(skipped);
    expect(resolveProgress(newerInProgress, skipped)).toBe(skipped);
  });

  it("entre dos en curso gana el más reciente", () => {
    const a = inProgress(1);
    const b = inProgress(2);
    expect(resolveProgress(a, b)).toBe(b);
    expect(resolveProgress(b, a)).toBe(b);
  });

  it("si solo hay uno, ese es", () => {
    const a = inProgress(1);
    expect(resolveProgress(a, null)).toBe(a);
    expect(resolveProgress(null, a)).toBe(a);
    expect(resolveProgress(null, null)).toBeNull();
  });
});

describe("parseProgress — datos de afuera no son de fiar", () => {
  it("rechaza basura", () => {
    expect(parseProgress(null)).toBeNull();
    expect(parseProgress("x")).toBeNull();
    expect(parseProgress({ status: "hackeado" })).toBeNull();
  });

  it("sanea pasos desconocidos y duplicados", () => {
    const p = parseProgress({
      status: "in_progress",
      currentStep: "nope",
      completedSteps: ["welcome", "welcome", "inventado", 3],
      updatedAt: "no-es-numero"
    });
    expect(p).toEqual({ status: "in_progress", currentStep: "welcome", completedSteps: ["welcome"], updatedAt: 0 });
  });
});

describe("onboardingLocalStore", () => {
  it("guarda y lee por usuario y negocio (no se mezclan)", () => {
    const storage = memoryStorage();
    const progress = finish(initialProgress(1), 2);
    onboardingLocalStore.write("u1", "b1", { progress, pendingSync: true }, storage);

    expect(onboardingLocalStore.read("u1", "b1", storage)).toEqual({ progress, pendingSync: true });
    expect(onboardingLocalStore.read("u2", "b1", storage)).toBeNull();
    expect(onboardingLocalStore.read("u1", "b2", storage)).toBeNull();
  });

  it("JSON corrupto no lanza: se trata como 'sin registro'", () => {
    const storage = memoryStorage();
    storage.setItem("vimdy:onboarding-tour:v1:first_minutes_v1:u1:b1", "{no es json");
    expect(onboardingLocalStore.read("u1", "b1", storage)).toBeNull();
  });

  it("sin storage disponible nada lanza", () => {
    expect(onboardingLocalStore.read("u1", "b1", null)).toBeNull();
    expect(() =>
      onboardingLocalStore.write("u1", "b1", { progress: initialProgress(1), pendingSync: false }, null)
    ).not.toThrow();
    expect(onboardingLocalStore.isSnoozed("u1", "b1", null)).toBe(false);
  });

  it("posponer es por sesión y se puede limpiar", () => {
    const session = memoryStorage();
    expect(onboardingLocalStore.isSnoozed("u1", "b1", session)).toBe(false);
    onboardingLocalStore.snooze("u1", "b1", session);
    expect(onboardingLocalStore.isSnoozed("u1", "b1", session)).toBe(true);
    onboardingLocalStore.clearSnooze("u1", "b1", session);
    expect(onboardingLocalStore.isSnoozed("u1", "b1", session)).toBe(false);
  });
});