// tests/unit/staffRoles.test.ts
/* ===========================================================================
   Los 4 roles tipados (ADMIN, CAJERO, MESERO, COCINA) y la regla
   "solo el administrador administra meseros".
   =========================================================================== */
import { describe, it, expect } from "vitest";

import {
  STAFF_ROLES,
  STAFF_ROLE_OPTIONS,
  WAITERS_MANAGE_PERMISSION,
  assertStaffRole,
  isStaffRole,
  parseStaffRole,
  staffRoleLabel
} from "../../src/core/config/staffRoles";
import {
  ROLE_PERMISSIONS,
  STAFF_ROLE_PERMISSIONS,
  permissionsForRole,
  roleCanManageWaiters
} from "../../src/core/config/permissions";
import * as infraPermissions from "../../src/infrastructure/supabase/rolePermissions";

describe("StaffRole", () => {
  it("son exactamente 4, en este orden", () => {
    expect([...STAFF_ROLES]).toEqual(["ADMIN", "CAJERO", "MESERO", "COCINA"]);
    expect(STAFF_ROLE_OPTIONS.map((r) => r.id)).toEqual([...STAFF_ROLES]);
  });

  it("isStaffRole / parseStaffRole normalizan mayúsculas y espacios", () => {
    expect(isStaffRole(" mesero ")).toBe(true);
    expect(parseStaffRole("cocina")).toBe("COCINA");
    expect(parseStaffRole("GERENTE")).toBeNull(); // rol antiguo: ya no se asigna
    expect(parseStaffRole("")).toBeNull();
    expect(parseStaffRole(undefined)).toBeNull();
    expect(parseStaffRole(42)).toBeNull();
  });

  it("assertStaffRole devuelve el rol normalizado o lanza ROLE_NOT_FOUND", () => {
    expect(assertStaffRole(" cajero ")).toBe("CAJERO");
    expect(() => assertStaffRole("SUPERUSER")).toThrow(/^ROLE_NOT_FOUND/);
    expect(() => assertStaffRole(null)).toThrow(/^ROLE_NOT_FOUND/);
  });

  it("staffRoleLabel muestra el nombre en español", () => {
    expect(staffRoleLabel("ADMIN")).toBe("Administrador");
    expect(staffRoleLabel("mesero")).toBe("Mesero");
    expect(staffRoleLabel("GERENTE")).toBe("GERENTE");
  });
});

describe("Permisos por rol", () => {
  it("cada uno de los 4 roles tiene su lista de permisos", () => {
    for (const role of STAFF_ROLES) {
      expect(STAFF_ROLE_PERMISSIONS[role].length, role).toBeGreaterThan(0);
      expect(permissionsForRole(role), role).toEqual([...STAFF_ROLE_PERMISSIONS[role]]);
    }
  });

  it("los roles antiguos siguen existiendo para cuentas viejas", () => {
    for (const role of ["GERENTE", "INVENTARIO", "CONTADOR", "SOPORTE"]) {
      expect(permissionsForRole(role).length, role).toBeGreaterThan(0);
    }
  });

  it("un rol desconocido (o el nombre de una propiedad de Object) no tiene permisos", () => {
    expect(permissionsForRole("NOPE")).toEqual([]);
    expect(permissionsForRole("constructor")).toEqual([]);
    expect(permissionsForRole("__proto__")).toEqual([]);
  });

  it("solo ADMIN administra meseros; ningún otro rol lleva waiters.manage", () => {
    expect(roleCanManageWaiters("ADMIN")).toBe(true);
    for (const role of Object.keys(ROLE_PERMISSIONS).filter((r) => r !== "ADMIN")) {
      expect(roleCanManageWaiters(role), role).toBe(false);
      expect(permissionsForRole(role), role).not.toContain(WAITERS_MANAGE_PERMISSION);
    }
    expect(roleCanManageWaiters(null)).toBe(false);
    expect(roleCanManageWaiters("")).toBe(false);
  });

  it("MESERO sigue viendo mesas pero no cobra ni toca caja (sin cambios)", () => {
    const perms = permissionsForRole("MESERO");
    expect(perms).toContain("tables.view");
    expect(perms).not.toContain("sales.create");
    expect(perms).not.toContain("cash.view");
  });

  it("CAJERO y GERENTE NO llevan staff.view (el cajero no entra a /meseros; así era en producción)", () => {
    expect(permissionsForRole("CAJERO")).not.toContain("staff.view");
    expect(permissionsForRole("GERENTE")).not.toContain("staff.view");
    expect(permissionsForRole("GERENTE")).toContain("tables.view");
  });

  it("la copia de infraestructura es la misma (ya no hay dos catálogos distintos)", () => {
    expect(infraPermissions.ROLE_PERMISSIONS).toBe(ROLE_PERMISSIONS);
    expect(infraPermissions.permissionsForRole).toBe(permissionsForRole);
  });
});