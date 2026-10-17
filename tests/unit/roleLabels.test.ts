import { describe, it, expect } from "vitest";
import {
  roleHelp,
  roleSummary,
  userStatusLabel,
  permissionLabel,
  PERMISSION_MODULE_LABELS,
  PERMISSION_MODULE_ORDER
} from "../../src/core/services/roleLabels";

describe("Usuarios y roles: textos simples", () => {
  it("cada rol del sistema tiene una explicación corta", () => {
    for (const id of ["ADMIN", "GERENTE", "CAJERO", "MESERO", "COCINA", "INVENTARIO", "CONTADOR", "SOPORTE"]) {
      expect(roleHelp(id).length).toBeGreaterThan(10);
    }
    expect(roleHelp("ADMIN")).toContain("dueño");
  });

  it("un rol creado por el dueño se explica con el número de cosas que puede hacer", () => {
    expect(roleHelp("X", ["sales.view"])).toBe("Rol creado por ti, con 1 cosa que puede hacer.");
    expect(roleHelp("X", ["a", "b"])).toBe("Rol creado por ti, con 2 cosas que puede hacer.");
    expect(roleHelp("X", ["*"])).toBe("Puede hacerlo todo.");
  });

  it("el resumen no usa la palabra permisos", () => {
    expect(roleSummary(["*"])).toBe("Puede hacerlo todo");
    expect(roleSummary(["a"])).toBe("Puede hacer 1 cosa");
    expect(roleSummary(["a", "b", "c"])).toBe("Puede hacer 3 cosas");
  });

  it("los estados salen en español", () => {
    expect(userStatusLabel("ACTIVE")).toBe("Activo");
    expect(userStatusLabel("SUSPENDED")).toBe("Sin acceso");
    expect(userStatusLabel("DELETED")).toBe("Eliminado");
  });

  it("los permisos técnicos se muestran en palabras simples y sin 'comanda' ni 'legado'", () => {
    expect(permissionLabel("cash.registerMovement")).toBe("Anotar dinero que entra o sale de la caja");
    expect(permissionLabel("kitchen.manage")).not.toMatch(/comanda/i);
    expect(permissionLabel("cash.close")).not.toMatch(/legado/i);
    expect(permissionLabel("algo.nuevo", "Texto original")).toBe("Texto original");
  });

  it("todos los grupos de permisos tienen nombre (nada sale como 'shift' o 'other')", () => {
    for (const m of PERMISSION_MODULE_ORDER) {
      expect(PERMISSION_MODULE_LABELS[m]).toBeTruthy();
    }
  });
});