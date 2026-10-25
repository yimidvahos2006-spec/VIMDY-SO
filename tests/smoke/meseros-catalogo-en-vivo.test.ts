// tests/smoke/meseros-catalogo-en-vivo.test.ts
/* ===========================================================================
   SMOKE TEST — Catálogo en vivo en Meseros (startLiveCatalog)
   ---------------------------------------------------------------------------
   Antes, Meseros leía los productos una sola vez al abrir la pantalla. Si el
   dueño cambiaba un precio, desactivaba un producto o cambiaba requiresKitchen,
   la tablet del salón seguía con datos viejos hasta recargar la página. El
   precio que se cobra lo decide el servidor, así que el mesero mostraba un
   precio distinto al que luego se cobraba.

   Esta prueba cubre el helper que usa Meseros.tsx, contra el bus real
   (vimdyCore): el evento "inventory" recarga el catálogo, las ráfagas no
   generan lecturas simultáneas, una falla conserva el catálogo anterior y
   al desmontar se deja de escuchar.
=========================================================================== */

import { describe, it, expect, afterEach } from "vitest";

import { vimdyCore } from "../../src/core/VimdyCore";
import { startLiveCatalog } from "../../src/core/utils/liveCatalog";

type Catalog = { id: string; price: number }[];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Smoke: Meseros refresca el catálogo en vivo", () => {
  let stop: (() => void) | null = null;

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it("un evento 'inventory' vuelve a leer el catálogo y lo aplica (precio nuevo)", async () => {
    let price = 18000;
    const applied: Catalog[] = [];

    stop = startLiveCatalog<Catalog>({
      load: async () => [{ id: "burger", price }],
      apply: (catalog) => applied.push(catalog)
    });

    price = 20000;
    vimdyCore.emit("inventory", { source: "remote-sync" });
    await flush();

    expect(applied).toEqual([[{ id: "burger", price: 20000 }]]);
  });

  it("otros eventos (mesas, ventas) NO recargan el catálogo", async () => {
    let loads = 0;
    stop = startLiveCatalog<Catalog>({
      load: async () => {
        loads += 1;
        return [];
      },
      apply: () => undefined
    });

    vimdyCore.emit("table", {});
    vimdyCore.emit("sale", {});
    vimdyCore.emit("kitchen", {});
    await flush();

    expect(loads).toBe(0);
  });

  it("una ráfaga de eventos nunca corre lecturas simultáneas y termina con el dato más reciente", async () => {
    const first = deferred<Catalog>();
    const second = deferred<Catalog>();
    const pending = [first, second];
    let running = 0;
    let maxRunning = 0;
    let loads = 0;
    const applied: Catalog[] = [];

    stop = startLiveCatalog<Catalog>({
      load: async () => {
        const gate = pending[loads];
        loads += 1;
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        try {
          return await gate.promise;
        } finally {
          running -= 1;
        }
      },
      apply: (catalog) => applied.push(catalog)
    });

    vimdyCore.emit("inventory", {});
    vimdyCore.emit("inventory", {});
    vimdyCore.emit("inventory", {});
    await flush();
    expect(loads).toBe(1);

    first.resolve([{ id: "burger", price: 18000 }]);
    await flush();
    expect(loads).toBe(2);

    second.resolve([{ id: "burger", price: 20000 }]);
    await flush();

    expect(maxRunning).toBe(1);
    expect(applied[applied.length - 1]).toEqual([{ id: "burger", price: 20000 }]);
  });

  it("si la lectura falla (sin internet) NO aplica nada, avisa, y el siguiente evento sí funciona", async () => {
    let fail = true;
    const applied: Catalog[] = [];
    const errors: unknown[] = [];

    stop = startLiveCatalog<Catalog>({
      load: async () => {
        if (fail) throw new Error("NETWORK_DOWN");
        return [{ id: "burger", price: 18000 }];
      },
      apply: (catalog) => applied.push(catalog),
      onError: (error) => errors.push(error)
    });

    vimdyCore.emit("inventory", {});
    await flush();
    expect(applied).toHaveLength(0);
    expect(errors).toHaveLength(1);

    fail = false;
    vimdyCore.emit("inventory", {});
    await flush();
    expect(applied).toEqual([[{ id: "burger", price: 18000 }]]);
  });

  it("al desmontar deja de escuchar y descarta una lectura que venía en vuelo", async () => {
    const inFlight = deferred<Catalog>();
    let loads = 0;
    const applied: Catalog[] = [];

    const unsubscribe = startLiveCatalog<Catalog>({
      load: () => {
        loads += 1;
        return inFlight.promise;
      },
      apply: (catalog) => applied.push(catalog)
    });

    vimdyCore.emit("inventory", {});
    await flush();
    expect(loads).toBe(1);

    unsubscribe();
    inFlight.resolve([{ id: "burger", price: 99999 }]);
    await flush();
    expect(applied).toHaveLength(0);

    vimdyCore.emit("inventory", {});
    await flush();
    expect(loads).toBe(1);
  });
});