import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  totals: {} as Record<string, number>,
  calls: [] as Array<{ table: string; from: number; to: number; businessId: string }>,
  failures: [] as Array<{ table: string; times: number; code?: string; message?: string }>,
  selects: [] as Array<{ table: string; columns: string }>
}));

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  requireCurrentBusinessId: () => "biz-1",
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        state.selects.push({ table, columns });
        const q: any = {
          _biz: "",
          eq: (_col: string, value: string) => {
            q._biz = value;
            return q;
          },
          order: () => q,
          range: (from: number, to: number) => {
            state.calls.push({ table, from, to, businessId: q._biz });
            const failure = state.failures.find((f) => f.table === table && f.times > 0);
            if (failure) {
              failure.times -= 1;
              return Promise.resolve({
                data: null,
                error: { message: failure.message ?? "boom", code: failure.code }
              });
            }
            const total = state.totals[table] ?? 0;
            const rows = [];
            for (let i = from; i <= to && i < total; i += 1) {
              rows.push(
                table === "customers_v2"
                  ? { id: `c2-${i}`, business_id: "biz-1", name: `Cliente ${i}`, lifetime_points: 10 * i, loyalty_tier: "bronce" }
                  : { data: { id: `${table}-${i}` } }
              );
            }
            return Promise.resolve({ data: rows, error: null });
          }
        };
        return q;
      }
    })
  }
}));

import {
  BACKUP_ALL_TABLES,
  BACKUP_TABLES,
  CUSTOMERS_V2_COLUMNS,
  backupFileName,
  buildBackupSnapshot,
  serializeBackup
} from "../../src/infrastructure/supabase/backupService";

describe("backupService", () => {
  beforeEach(() => {
    state.totals = {};
    state.calls = [];
    state.failures = [];
    state.selects = [];
  });

  it("incluye productos, ventas, clientes, turnos y usuarios", () => {
    for (const t of ["products", "sales", "customers", "shifts", "app_users"]) {
      expect(BACKUP_TABLES).toContain(t);
    }
  });

  it("no se corta en 1000 filas: trae las 2500 ventas completas", async () => {
    state.totals = { sales: 2500 };
    const snap = await buildBackupSnapshot();
    expect(snap.tables.sales).toHaveLength(2500);
    expect(new Set(snap.tables.sales.map((r: any) => r.id)).size).toBe(2500);
    expect(snap.counts.sales).toBe(2500);
    const salesCalls = state.calls.filter((c) => c.table === "sales").map((c) => [c.from, c.to]);
    expect(salesCalls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("con exactamente 1000 filas pide una página más y termina", async () => {
    state.totals = { products: 1000 };
    const snap = await buildBackupSnapshot();
    expect(snap.tables.products).toHaveLength(1000);
    expect(state.calls.filter((c) => c.table === "products")).toHaveLength(2);
  });

  it("filtra siempre por el negocio activo y deja tablas vacías como []", async () => {
    const snap = await buildBackupSnapshot();
    expect(state.calls.every((c) => c.businessId === "biz-1")).toBe(true);
    expect(snap.businessId).toBe("biz-1");
    expect(snap.tables.customers).toEqual([]);
    expect(Object.keys(snap.tables)).toEqual([...BACKUP_ALL_TABLES]);
    expect(snap.skipped).toEqual([]);
  });

  it("reintenta una vez un fallo transitorio y sigue", async () => {
    state.totals = { shifts: 3 };
    state.failures = [{ table: "shifts", times: 1 }];
    const snap = await buildBackupSnapshot();
    expect(snap.tables.shifts).toHaveLength(3);
  });

  it("si una tabla falla de forma persistente lanza error (nunca backup incompleto)", async () => {
    state.failures = [{ table: "sales", times: 5 }];
    await expect(buildBackupSnapshot()).rejects.toThrow(/BACKUP_FAILED \(sales\)/);
  });

  it("serializa un JSON válido que conserva toda la estructura", async () => {
    state.totals = { products: 4500, customers: 2 };
    const snap = await buildBackupSnapshot();
    const text = await new Response(await serializeBackup(snap)).text();
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe(1);
    expect(parsed.businessId).toBe("biz-1");
    expect(parsed.counts.products).toBe(4500);
    expect(parsed.tables.products).toHaveLength(4500);
    expect(parsed.tables.products[4499]).toEqual({ id: "products-4499" });
    expect(parsed.tables.customers).toHaveLength(2);
    expect(parsed.tables.sales).toEqual([]);
  });

  it("exporta customers_v2 con la fila completa y los puntos de fidelización", async () => {
    state.totals = { customers_v2: 3 };
    const snap = await buildBackupSnapshot();
    expect(BACKUP_ALL_TABLES).toContain("customers_v2");
    expect(snap.counts.customers_v2).toBe(3);
    expect(snap.tables.customers_v2[2]).toMatchObject({
      id: "c2-2",
      name: "Cliente 2",
      lifetime_points: 20,
      loyalty_tier: "bronce"
    });
    const cols = state.selects.find((s) => s.table === "customers_v2")!.columns.split(",");
    expect(cols).toEqual([...CUSTOMERS_V2_COLUMNS]);
    for (const c of ["lifetime_spent", "lifetime_points", "loyalty_tier", "legacy_points"]) {
      expect(cols).toContain(c);
    }
  });

  it("customers_v2 pagina igual: 2500 clientes completos", async () => {
    state.totals = { customers_v2: 2500 };
    const snap = await buildBackupSnapshot();
    expect(snap.tables.customers_v2).toHaveLength(2500);
  });

  it("si customers_v2 aún no existe en el proyecto, se omite y el resto del backup sale completo", async () => {
    state.totals = { products: 5 };
    state.failures = [{ table: "customers_v2", times: 99, code: "PGRST205", message: "Could not find the table 'public.customers_v2'" }];
    const snap = await buildBackupSnapshot();
    expect(snap.skipped).toEqual(["customers_v2"]);
    expect(snap.tables.customers_v2).toBeUndefined();
    expect(snap.counts.customers_v2).toBeUndefined();
    expect(snap.tables.products).toHaveLength(5);
    expect(state.calls.filter((c) => c.table === "customers_v2")).toHaveLength(1);
    const parsed = JSON.parse(await new Response(await serializeBackup(snap)).text());
    expect(parsed.skipped).toEqual(["customers_v2"]);
  });

  it("un error de permisos en customers_v2 NO se oculta: aborta el backup", async () => {
    state.failures = [{ table: "customers_v2", times: 5, code: "42501", message: "permission denied for table customers_v2" }];
    await expect(buildBackupSnapshot()).rejects.toThrow(/BACKUP_FAILED \(customers_v2\)/);
  });

  it("una tabla obligatoria ausente (ej. sales) sí aborta: solo customers_v2 es opcional", async () => {
    state.failures = [{ table: "sales", times: 5, code: "PGRST205", message: "Could not find the table 'public.sales'" }];
    await expect(buildBackupSnapshot()).rejects.toThrow(/BACKUP_FAILED \(sales\)/);
  });

  it("el nombre del archivo usa la fecha y hora LOCAL", () => {
    expect(backupFileName(new Date(2026, 10, 1, 23, 30))).toBe("vimdy-backup-2026-11-01-2330.json");
  });
});