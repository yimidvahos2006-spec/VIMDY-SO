// tests/unit/customerLocalSearch.test.ts
/* ===========================================================================
   Paso 5 — búsqueda de clientes local (IndexedDB), sin depender de la red.

   Se usa el CustomerRepository y el CustomerEngine REALES; solo se reemplazan
   los bordes: Supabase (SupabaseRepository), el caché IndexedDB, la cola de
   clientes pendientes y la conexión.
   =========================================================================== */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { Customer } from "../../src/core/entities/Entities";

const state = vi.hoisted(() => ({
  online: true,
  cache: [] as any[],
  pending: [] as any[],
  server: vi.fn(),
  replaceAll: vi.fn()
}));

vi.mock("../../src/infrastructure/di/repositories/SupabaseRepository", () => ({
  SupabaseRepository: class {
    async findAll() {
      return state.server();
    }
  }
}));
vi.mock("../../src/infrastructure/di/repositories/CustomerLocalRepository", () => ({
  CustomerLocalRepository: class {
    async findAll() {
      return [...state.cache];
    }
    async replaceAll(items: any[]) {
      state.replaceAll(items);
      state.cache = [...items];
    }
  }
}));
vi.mock("../../src/infrastructure/di/repositories/PendingCustomerOperationRepository", () => ({
  PendingCustomerOperationRepository: class {
    async findAll() {
      return [...state.pending];
    }
  }
}));
vi.mock("../../src/core/store/connectionStore", () => ({
  connectionStore: { isOnline: () => state.online, subscribe: () => () => {} }
}));
vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  getCurrentBusinessId: () => "biz-1",
  getCurrentBranchId: () => "branch-1"
}));
vi.mock("../../src/infrastructure/logging/opsLogger", () => ({
  logWarning: vi.fn(),
  logError: vi.fn()
}));

import { CustomerRepository } from "../../src/infrastructure/di/repositories/CustomerRepository";
import { CustomerEngine } from "../../src/core/engines/CustomerEngine";
import { searchCustomers } from "../../src/core/domain/customers/search";

function customer(id: string, name: string, phone?: string, extra: Partial<Customer> = {}): Customer {
  return { id, name, email: "", phone, points: 0, createdAt: new Date("2026-10-01"), ...extra } as Customer;
}

function pendingOp(c: Customer, status = "PENDING_SYNC") {
  return { id: c.id, customer: c, status, queuedAt: new Date(), attempts: 0, businessId: "biz-1", branchId: "branch-1" };
}

beforeEach(() => {
  state.online = true;
  state.cache = [];
  state.pending = [];
  state.server = vi.fn().mockResolvedValue([]);
  state.replaceAll = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CustomerRepository.findAllLocal — nunca toca la red", () => {
  it("devuelve el caché y NO llama a Supabase", async () => {
    state.cache = [customer("a", "Ana", "3001234567")];

    const list = await new CustomerRepository().findAllLocal();

    expect(list.map((c) => c.id)).toEqual(["a"]);
    expect(state.server).not.toHaveBeenCalled();
  });

  it("incluye los clientes creados offline que aún no están en el caché", async () => {
    state.cache = [customer("a", "Ana")];
    state.pending = [pendingOp(customer("p", "Pedro", "3109876543"))];

    const list = await new CustomerRepository().findAllLocal();

    expect(list.map((c) => c.id).sort()).toEqual(["a", "p"]);
  });

  it("no repite un cliente que está en el caché y en la cola", async () => {
    const same = customer("p", "Pedro", "3109876543");
    state.cache = [same];
    state.pending = [pendingOp(same)];

    const list = await new CustomerRepository().findAllLocal();

    expect(list).toHaveLength(1);
  });

  it("descarta clientes de otro negocio o sucursal", async () => {
    state.cache = [
      customer("mine", "Mío", undefined, { businessId: "biz-1", branchId: "branch-1" } as any),
      customer("other-biz", "Ajeno", undefined, { businessId: "biz-2" } as any),
      customer("other-branch", "Otra sede", undefined, { businessId: "biz-1", branchId: "branch-9" } as any)
    ];

    const list = await new CustomerRepository().findAllLocal();

    expect(list.map((c) => c.id)).toEqual(["mine"]);
  });
});

describe("CustomerRepository.refreshFromServer", () => {
  it("guarda la lista fresca y CONSERVA los clientes que siguen en cola offline", async () => {
    state.server.mockResolvedValue([customer("a", "Ana", "3001234567")]);
    state.pending = [pendingOp(customer("p", "Pedro", "3109876543"))];

    const merged = await new CustomerRepository().refreshFromServer();

    expect(merged.map((c) => c.id).sort()).toEqual(["a", "p"]);
    expect(state.replaceAll.mock.calls[0][0].map((c: Customer) => c.id).sort()).toEqual(["a", "p"]);
  });

  it("si el servidor ya trae al cliente pendiente, no lo duplica", async () => {
    state.server.mockResolvedValue([customer("p", "Pedro", "3109876543")]);
    state.pending = [pendingOp(customer("p", "Pedro", "3109876543"), "SYNCING")];

    const merged = await new CustomerRepository().refreshFromServer();

    expect(merged).toHaveLength(1);
  });

  it("los clientes con error permanente NO se conservan", async () => {
    state.server.mockResolvedValue([]);
    state.pending = [
      pendingOp(customer("f", "Fallido"), "FAILED"),
      pendingOp(customer("x", "Permanente"), "PERMANENT_FAILURE")
    ];

    const merged = await new CustomerRepository().refreshFromServer();

    expect(merged).toEqual([]);
  });

  it("varias llamadas a la vez comparten UNA sola petición a Supabase", async () => {
    let release!: (value: Customer[]) => void;
    state.server.mockImplementation(() => new Promise<Customer[]>((resolve) => { release = resolve; }));

    const repo = new CustomerRepository();
    const first = repo.refreshFromServer();
    const second = repo.refreshFromServer();
    await Promise.resolve();
    await Promise.resolve();
    release([customer("a", "Ana")]);
    await Promise.all([first, second]);

    expect(state.server).toHaveBeenCalledTimes(1);
  });

  it("con mala señal se rinde a los 8 s y el siguiente intento arranca limpio", async () => {
    vi.useFakeTimers();
    state.server.mockImplementation(() => new Promise<Customer[]>(() => {}));

    const repo = new CustomerRepository();
    const attempt = repo.refreshFromServer();
    const assertion = expect(attempt).rejects.toThrow("CUSTOMER_REFRESH_TIMEOUT");
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;

    state.server.mockResolvedValue([customer("a", "Ana")]);
    const retry = await repo.refreshFromServer();

    expect(state.server).toHaveBeenCalledTimes(2);
    expect(retry.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("CustomerRepository.findAll", () => {
  it("responde con el caché al instante aunque Supabase esté colgado", async () => {
    state.cache = [customer("a", "Ana")];
    state.server.mockImplementation(() => new Promise<Customer[]>(() => {}));

    const list = await new CustomerRepository().findAll();

    expect(list.map((c) => c.id)).toEqual(["a"]);
  });

  it("sin conexión no intenta refrescar", async () => {
    state.online = false;
    state.cache = [customer("a", "Ana")];

    await new CustomerRepository().findAll();

    expect(state.server).not.toHaveBeenCalled();
  });
});

describe("CustomerEngine — lectura local", () => {
  it("usa findAllLocal / refreshFromServer cuando el repositorio los tiene", async () => {
    state.cache = [customer("a", "Ana")];
    const engine = new CustomerEngine(new CustomerRepository() as any, {} as any);

    expect((await engine.getCustomersFromLocal()).map((c) => c.id)).toEqual(["a"]);
    expect(await engine.refreshCustomers()).toBe(true);
    expect(state.server).toHaveBeenCalledTimes(1);
  });

  it("con un repositorio sin caché local cae a findAll y refreshCustomers devuelve false", async () => {
    const findAll = vi.fn().mockResolvedValue([customer("z", "Zoe")]);
    const engine = new CustomerEngine({ findAll } as any, {} as any);

    expect((await engine.getCustomersFromLocal()).map((c) => c.id)).toEqual(["z"]);
    expect(await engine.refreshCustomers()).toBe(false);
  });
});

describe("búsqueda por teléfono sobre el caché local", () => {
  const list = [
    customer("1", "Ana Pérez", "300 123 4567"),
    customer("2", "Luis Gómez", "+57 310 987 6543"),
    customer("3", "María Ríos", "(601) 555 0101")
  ];

  it("encuentra por los últimos dígitos", () => {
    expect(searchCustomers(list, "4567").map((c) => c.id)).toEqual(["1"]);
  });

  it("encuentra el número completo aunque esté guardado con +57 y espacios", () => {
    expect(searchCustomers(list, "3109876543").map((c) => c.id)).toEqual(["2"]);
  });

  it("ignora espacios y guiones al escribir", () => {
    expect(searchCustomers(list, "300-123 4567").map((c) => c.id)).toEqual(["1"]);
  });
});