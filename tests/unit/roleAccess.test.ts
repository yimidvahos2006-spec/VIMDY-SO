// tests/unit/roleAccess.test.ts
/* ===========================================================================
   Acceso por rol: pantalla de inicio, menú y redirecciones sin bucles.
   Usa los permisos REALES de ROLE_PERMISSIONS.
   =========================================================================== */
import { describe, it, expect } from "vitest";

import { permissionsForRole } from "../../src/infrastructure/supabase/rolePermissions";
import {
  ROUTE_PERMISSIONS,
  canAccessPath,
  hasAnyPermission,
  homePathForRole,
  resolveDeniedRedirect
} from "../../src/core/config/roleAccess";

const canFor = (role: string) => {
  const perms = permissionsForRole(role);
  return (permission: string) => perms.includes("*") || perms.includes(permission);
};

describe("Pantalla de inicio por rol", () => {
  it("MESERO entra a /meseros, nunca al Dashboard (sin importar mayúsculas)", () => {
    expect(homePathForRole("MESERO")).toBe("/meseros");
    expect(homePathForRole(" mesero ")).toBe("/meseros");
  });

  it("los demás roles (y sin rol) siguen entrando al Dashboard", () => {
    for (const role of ["ADMIN", "GERENTE", "CAJERO", "CONTADOR", "COCINA", "", undefined, null]) {
      expect(homePathForRole(role as string | undefined | null)).toBe("/dashboard");
    }
  });
});

describe("Menú: el MESERO solo ve lo que puede abrir", () => {
  const can = canFor("MESERO");
  const allowed = (path: string) => canAccessPath(path, can, "MESERO");

  it("no ve Dashboard, Inventario, Compras, Ganancias, Pérdidas, Reportes, IA, Caja ni Configuración", () => {
    for (const path of [
      "/dashboard", "/inventario", "/compras-inteligentes", "/ganancias", "/perdidas",
      "/reportes", "/pronostico", "/ia", "/caja", "/configuracion"
    ]) {
      expect(allowed(path), path).toBe(false);
    }
  });

  it("sí ve Meseros, Cocina, Clientes y Notificaciones", () => {
    for (const path of ["/meseros", "/cocina", "/clientes", "/notificaciones"]) {
      expect(allowed(path), path).toBe(true);
    }
  });

  it("/meseros ya NO exige staff.view (era lo que lo rebotaba al Dashboard)", () => {
    expect(hasAnyPermission(can, ROUTE_PERMISSIONS["/meseros"])).toBe(true);
  });
});

describe("No se rompe el acceso de otros roles", () => {
  it("ADMIN ve todo, incluido el Dashboard", () => {
    const can = canFor("ADMIN");
    for (const path of ["/dashboard", "/inventario", "/ganancias", "/configuracion", "/meseros"]) {
      expect(canAccessPath(path, can, "ADMIN"), path).toBe(true);
    }
  });

  it("CAJERO sigue sin Inventario ni /meseros (como antes) y conserva el Dashboard", () => {
    const can = canFor("CAJERO");
    expect(canAccessPath("/meseros", can, "CAJERO")).toBe(false);
    expect(canAccessPath("/inventario", can, "CAJERO")).toBe(false);
    expect(canAccessPath("/dashboard", can, "CAJERO")).toBe(true);
  });

  it("GERENTE (tiene tables.view) ahora SÍ entra a /meseros y sigue viendo el Dashboard", () => {
    const can = canFor("GERENTE");
    expect(canAccessPath("/meseros", can, "GERENTE")).toBe(true);
    expect(canAccessPath("/dashboard", can, "GERENTE")).toBe(true);
  });
});

describe("Redirección de rutas no autorizadas, sin bucles", () => {
  it("un MESERO que intenta /inventario va a /meseros", () => {
    expect(resolveDeniedRedirect("/inventario", "MESERO")).toBe("/meseros");
  });

  it("si la ruta bloqueada YA es su inicio no se redirige (null = mostrar aviso)", () => {
    expect(resolveDeniedRedirect("/meseros", "MESERO")).toBeNull();
    expect(resolveDeniedRedirect("/meseros/", "MESERO")).toBeNull();
    expect(resolveDeniedRedirect("/dashboard", "CAJERO")).toBeNull();
  });

  it("cadena completa: nunca se vuelve a visitar una ruta (ningún ciclo)", () => {
    // Simula ProtectedRoute/RequireModule hasta que se detiene.
    for (const role of ["MESERO", "CAJERO", "ADMIN"]) {
      let path = "/inventario";
      const visited = new Set<string>();
      for (let hops = 0; hops < 10; hops += 1) {
        expect(visited.has(path), `${role}: bucle en ${path}`).toBe(false);
        visited.add(path);
        const next = resolveDeniedRedirect(path, role);
        if (next === null) break;
        path = next;
      }
      expect(visited.size).toBeLessThanOrEqual(2);
    }
  });
});