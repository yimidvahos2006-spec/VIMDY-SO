import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "../../src/core/config/permissions";
import { ROLE_PERMISSIONS as CLIENT_ROLE_PERMISSIONS } from "../../src/infrastructure/supabase/rolePermissions";

// Misma regla que AuthContext.can(): "*" o el permiso exacto.
const can = (perms: string[], id: string) => perms.includes("*") || perms.includes(id);

describe.each([
  ["core/config/permissions", ROLE_PERMISSIONS],
  ["infrastructure/supabase/rolePermissions", CLIENT_ROLE_PERMISSIONS]
])("inventory.viewCosts (%s)", (_name, roles) => {
  it("solo ADMIN puede ver costos y valor del inventario", () => {
    expect(can(roles.ADMIN, "inventory.viewCosts")).toBe(true);
    for (const role of Object.keys(roles).filter((r) => r !== "ADMIN")) {
      expect(can(roles[role], "inventory.viewCosts"), role).toBe(false);
    }
  });

  it("un rol desconocido no lo tiene", () => {
    expect(can([], "inventory.viewCosts")).toBe(false);
  });
});