import { describe, expect, it } from "vitest";
import {
  resolvePosShortcut,
  type PosShortcutContext,
} from "../../src/presentation/components/pos/posShortcuts";

const base: PosShortcutContext = {
  key: "",
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  targetKind: "none",
  modalOpen: false,
  processing: false,
  canCharge: true,
  searchHasText: false,
  cartHasItems: true,
};
const press = (over: Partial<PosShortcutContext>) => resolvePosShortcut({ ...base, ...over });

describe("atajos del POS", () => {
  it("F2 enfoca el buscador (salvo con modal abierto o con Ctrl/Alt)", () => {
    expect(press({ key: "F2" })).toBe("focus-search");
    expect(press({ key: "F2", targetKind: "editable" })).toBe("focus-search");
    expect(press({ key: "F2", modalOpen: true })).toBe("none");
    expect(press({ key: "F2", ctrlKey: true })).toBe("none");
  });

  it("Enter cobra solo desde el aire o desde campos de cobro", () => {
    expect(press({ key: "Enter" })).toBe("charge");
    expect(press({ key: "Enter", targetKind: "charge-ok" })).toBe("charge");
    // buscador (agrega por código de barras) y otros botones/campos: no cobra
    expect(press({ key: "Enter", targetKind: "editable" })).toBe("none");
    expect(press({ key: "Enter", targetKind: "control" })).toBe("none");
  });

  it("Enter nunca cobra si la venta no se puede cobrar, hay modal o ya se está cobrando", () => {
    expect(press({ key: "Enter", canCharge: false })).toBe("none");
    expect(press({ key: "Enter", modalOpen: true })).toBe("none");
    expect(press({ key: "Enter", processing: true })).toBe("none");
  });

  it("mantener Enter apretado no cobra dos veces", () => {
    expect(press({ key: "Enter", repeat: true })).toBe("none");
  });

  it("Esc: primero limpia la búsqueda, después la venta", () => {
    expect(press({ key: "Escape", searchHasText: true })).toBe("clear-search");
    expect(press({ key: "Escape" })).toBe("clear-sale");
    expect(press({ key: "Escape", targetKind: "charge-ok" })).toBe("clear-sale");
  });

  it("Esc no borra la venta por accidente", () => {
    expect(press({ key: "Escape", cartHasItems: false })).toBe("none");
    expect(press({ key: "Escape", modalOpen: true })).toBe("none");
    expect(press({ key: "Escape", processing: true })).toBe("none");
    expect(press({ key: "Escape", targetKind: "editable" })).toBe("none");
  });

  it("otras teclas no hacen nada", () => {
    expect(press({ key: "a" })).toBe("none");
  });
});