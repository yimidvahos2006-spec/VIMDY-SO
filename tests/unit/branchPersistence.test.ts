import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Persistencia de Sucursales (getBranches / createBranch / updateBranch /
 * deleteBranch en supabaseClient.ts).
 *
 * Se simula el cliente de Supabase con un "constructor de consultas" falso que
 * registra exactamente qué tabla, columnas y filtros se envían, y devuelve la
 * respuesta que cada prueba configure. Así se verifica lo que realmente se
 * guarda en la base sin necesitar internet ni cuenta de Supabase.
 */

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

interface RecordedCall {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  columns?: string;
  payload?: Record<string, unknown>;
  filters: Array<{ column: string; value: unknown }>;
  order?: { column: string; ascending: boolean };
}

const calls: RecordedCall[] = [];
let nextResult: QueryResult = { data: null, error: null };

function makeBuilder(table: string) {
  const call: RecordedCall = { table, op: "select", filters: [] };
  calls.push(call);

  const builder: Record<string, unknown> = {};
  const settle = () => Promise.resolve(nextResult);

  builder.select = (columns: string) => {
    call.columns = columns; // también cubre insert(...).select("id")
    return builder;
  };
  builder.insert = (payload: Record<string, unknown>) => {
    call.op = "insert";
    call.payload = payload;
    return builder;
  };
  builder.update = (payload: Record<string, unknown>) => {
    call.op = "update";
    call.payload = payload;
    return builder;
  };
  builder.delete = () => {
    call.op = "delete";
    return builder;
  };
  builder.eq = (column: string, value: unknown) => {
    call.filters.push({ column, value });
    return builder;
  };
  builder.order = (column: string, opts: { ascending: boolean }) => {
    call.order = { column, ascending: opts.ascending };
    return settle();
  };
  builder.single = () => settle();
  // `await supabase.from(...).update(...).eq(...)` termina en el propio builder.
  builder.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
    settle().then(resolve, reject);

  return builder;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => makeBuilder(table),
    rpc: async () => ({ data: null, error: null }),
    auth: {},
  }),
}));

type ClientModule = typeof import("../../src/infrastructure/supabase/supabaseClient");
let client: ClientModule;

beforeEach(async () => {
  calls.length = 0;
  nextResult = { data: null, error: null };
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
  client = await import("../../src/infrastructure/supabase/supabaseClient");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getBranches", () => {
  it("pide solo las columnas de la tarjeta, filtra por negocio y deja la principal primero", async () => {
    nextResult = {
      data: [{ id: "b1", name: "Centro", address: "Cra 7 # 10-20", phone: "3001234567", is_main: true, active: true }],
      error: null,
    };

    const rows = await client.getBranches("biz-1");

    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      table: "branches",
      op: "select",
      columns: "id, name, address, phone, is_main, active",
      filters: [{ column: "business_id", value: "biz-1" }],
      order: { column: "is_main", ascending: false },
    });
  });

  it("devuelve lista vacía si la base responde sin datos", async () => {
    nextResult = { data: null, error: null };
    expect(await client.getBranches("biz-1")).toEqual([]);
  });

  it("lanza el mensaje de la base si la lectura falla", async () => {
    nextResult = { data: null, error: { message: "permission denied for table branches" } };
    await expect(client.getBranches("biz-1")).rejects.toThrow("permission denied for table branches");
  });
});

describe("createBranch", () => {
  it("guarda negocio, nombre, dirección, teléfono, principal y activa", async () => {
    nextResult = { data: { id: "new-1" }, error: null };

    const created = await client.createBranch("biz-1", {
      name: "  Sede Norte  ",
      address: "  Calle 100 # 15-20  ",
      phone: " 300 123 4567 ",
      is_main: true,
    });

    expect(created).toEqual({ id: "new-1" });
    expect(calls[0]).toMatchObject({
      table: "branches",
      op: "insert",
      columns: "id",
      payload: {
        business_id: "biz-1",
        name: "Sede Norte",
        address: "Calle 100 # 15-20",
        phone: "300 123 4567",
        is_main: true,
        active: true,
      },
    });
  });

  it("guarda null (no texto vacío) si no se escribe dirección ni teléfono", async () => {
    nextResult = { data: { id: "new-2" }, error: null };

    await client.createBranch("biz-1", { name: "Sede Sur", address: "   ", phone: "" });

    expect(calls[0].payload).toMatchObject({ address: null, phone: null, is_main: false, active: true });
  });

  it("lanza el mensaje de la base si no se puede crear", async () => {
    nextResult = { data: null, error: { message: "duplicate key value violates unique constraint" } };
    await expect(client.createBranch("biz-1", { name: "Sede" })).rejects.toThrow(
      "duplicate key value violates unique constraint",
    );
  });

  it("lanza un mensaje claro si la base no devuelve la fila creada", async () => {
    nextResult = { data: null, error: null };
    await expect(client.createBranch("biz-1", { name: "Sede" })).rejects.toThrow("No se pudo crear la sucursal.");
  });
});

describe("updateBranch", () => {
  it("actualiza solo los campos enviados, con los textos limpios, y filtra por id", async () => {
    await client.updateBranch("b1", { name: "  Centro 2  ", address: " Cra 5 ", phone: "  " });

    expect(calls[0]).toMatchObject({
      table: "branches",
      op: "update",
      payload: { name: "Centro 2", address: "Cra 5", phone: null },
      filters: [{ column: "id", value: "b1" }],
    });
    expect(calls[0].payload).not.toHaveProperty("active");
    expect(calls[0].payload).not.toHaveProperty("is_main");
  });

  it("desactivar solo cambia `active` y no toca nombre, dirección ni teléfono", async () => {
    await client.updateBranch("b1", { active: false });

    expect(calls[0].payload).toEqual({ active: false });
  });

  it("permite borrar la dirección y el teléfono enviando null", async () => {
    await client.updateBranch("b1", { address: null, phone: null });

    expect(calls[0].payload).toEqual({ address: null, phone: null });
  });

  it("lanza el mensaje de la base si falla", async () => {
    nextResult = { data: null, error: { message: "new row violates row-level security policy" } };
    await expect(client.updateBranch("b1", { name: "X" })).rejects.toThrow(
      "new row violates row-level security policy",
    );
  });
});

describe("deleteBranch", () => {
  it("borra únicamente la sucursal indicada", async () => {
    await client.deleteBranch("b9");

    expect(calls[0]).toMatchObject({
      table: "branches",
      op: "delete",
      filters: [{ column: "id", value: "b9" }],
    });
  });

  it("lanza el mensaje de la base si falla (por ejemplo, tiene datos asociados)", async () => {
    nextResult = { data: null, error: { message: "violates foreign key constraint" } };
    await expect(client.deleteBranch("b9")).rejects.toThrow("violates foreign key constraint");
  });
});