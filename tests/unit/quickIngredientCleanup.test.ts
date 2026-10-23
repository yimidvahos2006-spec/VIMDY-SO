import { describe, it, expect, vi } from "vitest";
import { discardQuickIngredients } from "../../src/presentation/components/inventory/quickIngredientCleanup";

describe("discardQuickIngredients", () => {
  it("al cancelar borra todos los insumos creados en la sesión", async () => {
    const del = vi.fn(async () => "deleted");
    const n = await discardQuickIngredients(["a", "b"], new Set(), del);
    expect(n).toBe(2);
    expect(del).toHaveBeenCalledWith("a");
    expect(del).toHaveBeenCalledWith("b");
  });

  it("al guardar conserva los que quedaron en la receta y borra el resto", async () => {
    const del = vi.fn(async () => "deleted");
    const n = await discardQuickIngredients(["a", "b", "c"], new Set(["a", "c"]), del);
    expect(n).toBe(1);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith("b");
  });

  it("un fallo no detiene a los demás y no lanza", async () => {
    const del = vi.fn(async (id: string) => {
      if (id === "a") throw new Error("PRODUCT_IN_USE");
      return "deleted";
    });
    await expect(discardQuickIngredients(["a", "b"], new Set(), del)).resolves.toBe(1);
    expect(del).toHaveBeenCalledTimes(2);
  });

  it("no intenta borrar dos veces el mismo id ni hace nada con lista vacía", async () => {
    const del = vi.fn(async () => "deleted");
    await discardQuickIngredients(["a", "a"], new Set(), del);
    expect(del).toHaveBeenCalledTimes(1);
    expect(await discardQuickIngredients([], new Set(), del)).toBe(0);
  });
});
