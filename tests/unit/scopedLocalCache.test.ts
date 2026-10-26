import { describe, it, expect } from "vitest";
import { buildCacheRows, pickCachedItems } from "../../src/infrastructure/cache/scopedLocalCache";

interface Role {
  id: string;
  name: string;
}

describe("scopedLocalCache (aislamiento por negocio)", () => {
  it("dos negocios con el mismo id de rol no se pisan", () => {
    const rowsA = buildCacheRows<Role>("negocio-A", [{ id: "ADMIN", name: "Administrador A" }], 1);
    const rowsB = buildCacheRows<Role>("negocio-B", [{ id: "ADMIN", name: "Administrador B" }], 2);
    const all = [...rowsA, ...rowsB];

    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(pickCachedItems<Role>("negocio-A", all)).toEqual([{ id: "ADMIN", name: "Administrador A" }]);
    expect(pickCachedItems<Role>("negocio-B", all)).toEqual([{ id: "ADMIN", name: "Administrador B" }]);
  });

  it("un negocio que nunca guardó su lista devuelve null (no una lista vacía)", () => {
    const rows = buildCacheRows<Role>("negocio-A", [{ id: "ADMIN", name: "Admin" }], 1);
    expect(pickCachedItems<Role>("negocio-C", rows)).toBeNull();
  });

  it("una lista vacía guardada se distingue de 'nunca guardada'", () => {
    const rows = buildCacheRows<Role>("negocio-A", [], 1);
    expect(pickCachedItems<Role>("negocio-A", rows)).toEqual([]);
  });

  it("ignora filas viejas de otro formato (ej. usuarios de versiones anteriores)", () => {
    const legacy = [
      { id: "ADMIN", name: "Administrador", passwordHash: "x" },
      { id: "u1", email: "viejo@correo.com" }
    ];
    const rows = [...legacy, ...buildCacheRows<Role>("negocio-A", [{ id: "CAJERO", name: "Cajero" }], 1)];

    expect(pickCachedItems<Role>("negocio-A", rows)).toEqual([{ id: "CAJERO", name: "Cajero" }]);
    expect(pickCachedItems<Role>("negocio-B", rows)).toBeNull();
  });
});