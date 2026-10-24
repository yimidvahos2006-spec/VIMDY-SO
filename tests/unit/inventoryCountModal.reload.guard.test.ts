import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guarda estática: al abrir un conteo, InventoryCountModal debe recargar el catálogo
 * desde el servidor (reemplaza el caché local) y repintar, y hacerlo DESPUÉS de que el
 * servidor confirmó el inicio del conteo (desde ahí es cuando el stock llega enmascarado).
 */
const file = join(process.cwd(), "src", "presentation", "components", "inventory", "InventoryCountModal.tsx");
const code = readFileSync(file, "utf-8");

describe("InventoryCountModal: recarga el catálogo al iniciar el conteo", () => {
  const fn = code.slice(code.indexOf("async function createSession"), code.indexOf("async function goReview"));

  it("createSession recarga el catálogo del servidor y refresca la pantalla, en ese orden", () => {
    const start = fn.indexOf(".startSession(");
    const reload = fn.indexOf("reloadFromServer()");
    const refresh = fn.indexOf("inventory.refresh()");
    const open = fn.indexOf("openSession(created)");
    expect(start).toBeGreaterThan(-1);
    expect(reload).toBeGreaterThan(start);
    expect(refresh).toBeGreaterThan(reload);
    expect(open).toBeGreaterThan(refresh);
  });
});