import { describe, it, expect, vi, afterEach } from "vitest";
import { supabase } from "../../src/infrastructure/supabase/supabaseClient";
import { resolveDefaultBranchId } from "../../src/infrastructure/supabase/authBusinessContext";

function stubBranchQuery(result: { data: { id: string } | null; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const chain = {
    select: () => chain,
    eq: () => chain,
    insert: () => chain,
    maybeSingle
  };
  const from = vi.spyOn(supabase, "from").mockImplementation((() => chain) as never);
  return { from, maybeSingle };
}

describe("resolveDefaultBranchId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("llamadas seguidas del mismo negocio hacen UN solo viaje a la red", async () => {
    const { from } = stubBranchQuery({ data: { id: "sucursal-1" }, error: null });

    const [a, b, c] = await Promise.all([
      resolveDefaultBranchId("negocio-memo-1"),
      resolveDefaultBranchId("negocio-memo-1"),
      resolveDefaultBranchId("negocio-memo-1")
    ]);
    const later = await resolveDefaultBranchId("negocio-memo-1");

    expect([a, b, c, later]).toEqual(["sucursal-1", "sucursal-1", "sucursal-1", "sucursal-1"]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("un negocio distinto sí consulta por separado", async () => {
    const { from } = stubBranchQuery({ data: { id: "sucursal-x" }, error: null });

    await resolveDefaultBranchId("negocio-memo-2");
    await resolveDefaultBranchId("negocio-memo-3");

    expect(from).toHaveBeenCalledTimes(2);
  });

  it("si falla (null) NO se queda memorizado el fallo: el siguiente intento vuelve a consultar", async () => {
    const { from } = stubBranchQuery({ data: null, error: { message: "sin red" } });

    expect(await resolveDefaultBranchId("negocio-memo-4")).toBeNull();
    expect(await resolveDefaultBranchId("negocio-memo-4")).toBeNull();

    expect(from).toHaveBeenCalledTimes(2);
  });
});
