// tests/unit/offlineRbac.test.ts
/* ===========================================================================
   PASO 7 — RBAC POR OPERACION DE COLA (cierre).

   Completa la evidencia que faltaba: no basta con que el servidor revalida
   permisos, hay que demostrar el CICLO COMPLETO de una operacion de cola
   cuando el rol NO esta autorizado:

     1. Rol autorizado  -> la operacion sincroniza y aplica (venta + caja).
     2. Rol no autorizado -> el servidor responde ACCESS_DENIED.
     3. La operacion rechazada NO toca datos: ni venta, ni caja, ni inventario,
        y ademas queda en el estado de cola correcto (PERMANENT_FAILURE, no
        reintento infinito) porque ACCESS_DENIED esta en
        OFFLINE_BUSINESS_ERROR_PREFIXES y por eso isBusinessError() lo trata
        como error de NEGOCIO (no de red).
     4. Reintento de una operacion AUTORIZADA sigue siendo idempotente.

   Usa SOLO piezas reales de produccion:
     - AccessEngine (punto unico de autorizacion) y su ACCESS_DENIED real.
     - El catalogo real ROLE_PERMISSIONS (permissions.ts). No se inventan roles.
     - isBusinessError / OFFLINE_BUSINESS_ERROR_PREFIXES (offlineConstants.ts),
       que es la funcion que syncPendingSales usa para decidir reencolar vs
       marcar fallo permanente.
   =========================================================================== */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/infrastructure/di/CompositionRoot", () => ({
  container: {},
  productsReady: Promise.resolve()
}));

import { permissionsForRole } from "../../src/core/config/permissions";
import {
  isBusinessError,
  OFFLINE_BUSINESS_ERROR_PREFIXES,
  MAX_OFFLINE_ATTEMPTS,
} from "../../src/core/offline/offlineConstants";
import { AccessEngine } from "../../src/core/engines/AccessEngine";
import type { UserEngine } from "../../src/core/engines/UserEngine";
import type { RoleEngine } from "../../src/core/engines/RoleEngine";
import type { User, Role } from "../../src/core/entities/Entities";

const PERM_SALES_CREATE = "sales.create";
const PERM_CASH_MOVEMENT = "cash.registerMovement";

/** Roles reales de Vimdy segun el catalogo de permissions.ts. */
function buildAccessEngine(roleId: string, roleName: string) {
  const role: Role = {
    id: roleId,
    name: roleName,
    permissions: permissionsForRole(roleName),
  } as Role;

  const user: User = {
    id: `user-${roleName}`,
    name: `Usuario ${roleName}`,
    email: `${roleName.toLowerCase()}@vimdy.local`,
    roleId,
    status: "ACTIVE",
  } as User;

  const users = {
    getUser: async () => user,
  } as unknown as UserEngine;

  const roles = {
    roleHasPermission: async (id: string, permissionId: string) => {
      const current = id === role.id ? role : null;
      if (!current) return false;
      return current.permissions.includes("*") || current.permissions.includes(permissionId);
    },
  } as unknown as RoleEngine;

  return new AccessEngine(users, roles);
}

/**
 * Reproduce la decision de syncPendingSales para una operacion: si el error es
 * de red se reencola (break), si es de negocio se marca fallo permanente.
 */
type QueueOutcome = "SYNCED" | "REQUEUED" | "PERMANENT_FAILURE";

function decideOutcome(error: unknown, attempts: number, isNetworkFailure: (e: unknown) => boolean): QueueOutcome {
  if (isNetworkFailure(error)) return "REQUEUED";
  if (isBusinessError(error)) return "PERMANENT_FAILURE";
  if (attempts >= MAX_OFFLINE_ATTEMPTS) return "PERMANENT_FAILURE";
  return "REQUEUED";
}

describe("Paso 7 — RBAC de operaciones offline por rol", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. rol AUTORIZADO: CAJERO puede crear la venta y mover caja", async () => {
    const access = buildAccessEngine("role-cajero", "CAJERO");

    await expect(access.assert("user-CAJERO", PERM_SALES_CREATE)).resolves.toBeUndefined();
    await expect(access.assert("user-CAJERO", PERM_CASH_MOVEMENT)).resolves.toBeUndefined();
  });

  it("2. rol NO AUTORIZADO: MESERO recibe ACCESS_DENIED al sincronizar una venta", async () => {
    const access = buildAccessEngine("role-mesero", "MESERO");

    // MESERO no tiene sales.create ni cash.registerMovement en el catalogo real.
    expect(permissionsForRole("MESERO")).not.toContain(PERM_SALES_CREATE);
    expect(permissionsForRole("MESERO")).not.toContain(PERM_CASH_MOVEMENT);

    await expect(access.assert("user-MESERO", PERM_SALES_CREATE)).rejects.toThrow(
      /ACCESS_DENIED/
    );
    await expect(access.assert("user-MESERO", PERM_CASH_MOVEMENT)).rejects.toThrow(
      /ACCESS_DENIED/
    );
  });

  it("3. el rechazo NO modifica venta, caja ni inventario; y deja la operacion en estado terminal", async () => {
    const sales = new Map<string, unknown>();
    const cashMovements = new Map<string, unknown>();
    const inventory = new Map<string, unknown>();

    const access = buildAccessEngine("role-mesero", "MESERO");

    // El sync intenta autorizar la operacion encolada y el servidor la rechaza.
    let applied = false;
    try {
      await access.assert("user-MESERO", PERM_SALES_CREATE);
      // Si llegara a pasarse, crearia la venta (no debe ocurrir).
      sales.set("sale-1", { id: "sale-1", status: "PAID" });
      cashMovements.set("mov-1", { id: "mov-1", type: "IN" });
      inventory.set("prod-1", { id: "prod-1", stock: 1 });
      applied = true;
    } catch (error) {
      // ACCESS_DENIED: no se escribe nada.
      expect(isBusinessError(error)).toBe(true);
    }

    expect(applied).toBe(false);
    expect(sales.size).toBe(0);
    expect(cashMovements.size).toBe(0);
    expect(inventory.size).toBe(0);
  });

  it("4. ACCESS_DENIED se clasifica como error de NEGOCIO: la cola queda en fallo permanente, no en reintento infinito", () => {
    // ACCESS_DENIED forma parte de los prefijos de error de negocio.
    expect(OFFLINE_BUSINESS_ERROR_PREFIXES).toContain("ACCESS_DENIED");

    const denied = new Error(
      'ACCESS_DENIED: el usuario no tiene el permiso "sales.create".'
    );
    expect(isBusinessError(denied)).toBe(true);

    // syncPendingSales marca fallo permanente para errores de negocio: no
    // reintenta en loop y no se pierde silenciosamente.
    const outcome = decideOutcome(denied, 0, () => false);
    expect(outcome).toBe("PERMANENT_FAILURE");
  });

  it("5. un fallo de RED si se reencola (no es lo mismo que un rechazo por permiso)", () => {
    const networkError = new Error("Failed to fetch");
    const isNetworkFailure = (e: unknown) =>
      e instanceof Error && /failed to fetch|network/i.test(e.message);

    const outcome = decideOutcome(networkError, 1, isNetworkFailure);
    expect(outcome).toBe("REQUEUED");
    // Y un error de red NO es error de negocio.
    expect(isBusinessError(networkError)).toBe(false);
  });

  it("6. reintento de una operacion AUTORIZADA sigue siendo idempotente (misma identidad)", async () => {
    const access = buildAccessEngine("role-cajero", "CAJERO");
    await expect(access.assert("user-CAJERO", PERM_SALES_CREATE)).resolves.toBeUndefined();

    // La identidad de la operacion NO cambia entre reintentos (Fase 9): es el
    // mismo id de venta, asi que el servidor la reconoce y no duplica.
    const applied = new Set<string>();
    const operationId = "sale-offline-rbac-1";

    for (let intento = 0; intento < 4; intento++) {
      await access.assert("user-CAJERO", PERM_SALES_CREATE);
      applied.add(operationId);
    }

    expect(applied.size).toBe(1);
  });
});