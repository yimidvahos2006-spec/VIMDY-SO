import { describe, expect, it } from "vitest";

import { confirmDialog, confirmStore } from "../../src/core/store/confirmStore";

describe("confirmDialog (reemplazo del window.confirm nativo)", () => {
  it("no muestra nada hasta que se pide una confirmación", () => {
    expect(confirmStore.getSnapshot()).toBeNull();
  });

  it("resuelve true al aceptar y false al cancelar, y cierra el cuadro", async () => {
    const accepted = confirmDialog({ title: "Eliminar", message: "¿Seguro?", danger: true });
    expect(confirmStore.getSnapshot()).toMatchObject({ title: "Eliminar", danger: true, confirmLabel: "Aceptar" });
    confirmStore.answer(true);
    await expect(accepted).resolves.toBe(true);
    expect(confirmStore.getSnapshot()).toBeNull();

    const cancelled = confirmDialog({ title: "Otro", message: "¿Seguro?" });
    confirmStore.answer(false);
    await expect(cancelled).resolves.toBe(false);
    expect(confirmStore.getSnapshot()).toBeNull();
  });

  it("muestra de una en una, en orden, si se piden varias a la vez", async () => {
    const first = confirmDialog({ title: "Primera", message: "a" });
    const second = confirmDialog({ title: "Segunda", message: "b" });

    expect(confirmStore.getSnapshot()?.title).toBe("Primera");
    confirmStore.answer(true);
    await expect(first).resolves.toBe(true);

    expect(confirmStore.getSnapshot()?.title).toBe("Segunda");
    confirmStore.answer(false);
    await expect(second).resolves.toBe(false);
    expect(confirmStore.getSnapshot()).toBeNull();
  });
});