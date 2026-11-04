import { describe, expect, it } from "vitest";

import type { Waiter } from "../../src/core/entities/Entities";
import {
  WAITER_SESSION_MAX_AGE_MS,
  createWaiterSessionService,
  type WaiterSessionStorage
} from "../../src/core/services/waiterSessionService";

class MemoryStorage implements WaiterSessionStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

function waiter(id: string, overrides: Partial<Waiter> = {}): Waiter {
  return { id, name: `Mesero ${id}`, active: true, createdAt: new Date(0), ...overrides };
}

function setup(startMs = 1_000_000) {
  const storage = new MemoryStorage();
  const clock = { now: startMs };
  const service = createWaiterSessionService({ storage, now: () => clock.now });
  return { storage, clock, service };
}

describe("waiterSessionService", () => {
  it("guarda al mesero y lo devuelve mientras la sesión esté vigente", () => {
    const { service, clock } = setup();
    service.start("biz-1", "w1");

    clock.now += 60_000;
    expect(service.getWaiterId("biz-1")).toBe("w1");
  });

  it("aísla la sesión por negocio", () => {
    const { service } = setup();
    service.start("biz-1", "w1");

    expect(service.getWaiterId("biz-2")).toBeNull();
    expect(service.getWaiterId(null)).toBeNull();
  });

  it("vence a las 12 horas y limpia el almacenamiento", () => {
    const { service, clock, storage } = setup();
    service.start("biz-1", "w1");

    clock.now += WAITER_SESSION_MAX_AGE_MS - 1;
    expect(service.getWaiterId("biz-1")).toBe("w1");

    clock.now += 1;
    expect(service.getWaiterId("biz-1")).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it("descarta la sesión si el reloj del dispositivo retrocedió", () => {
    const { service, clock } = setup();
    service.start("biz-1", "w1");

    clock.now -= 5_000;
    expect(service.getWaiterId("biz-1")).toBeNull();
  });

  it("end() borra la sesión", () => {
    const { service } = setup();
    service.start("biz-1", "w1");
    service.end("biz-1");

    expect(service.getWaiterId("biz-1")).toBeNull();
  });

  it("start() con id vacío no guarda nada", () => {
    const { service, storage } = setup();
    service.start("biz-1", "");

    expect(storage.data.size).toBe(0);
  });

  it("lee el formato anterior (id como texto) y lo migra con fecha", () => {
    const { service, storage, clock } = setup();
    storage.setItem("vimdy.meseros.activeWaiter.biz-1", "w9");

    expect(service.getWaiterId("biz-1")).toBe("w9");

    const migrated = JSON.parse(storage.getItem("vimdy.meseros.activeWaiter.biz-1") as string);
    expect(migrated).toMatchObject({ waiterId: "w9", startedAt: clock.now });

    // Ya migrada, también vence.
    clock.now += WAITER_SESSION_MAX_AGE_MS;
    expect(service.getWaiterId("biz-1")).toBeNull();
  });

  it("descarta valores dañados sin lanzar", () => {
    const { service, storage } = setup();
    const key = "vimdy.meseros.activeWaiter.biz-1";

    for (const bad of ["{no es json", '{"waiterId":42,"startedAt":1}', '{"waiterId":"w1"}', "   "]) {
      storage.setItem(key, bad);
      expect(service.getWaiterId("biz-1")).toBeNull();
      expect(storage.getItem(key)).toBeNull();
    }
  });

  it("resolve() devuelve al mesero solo si está en la lista y activo", () => {
    const { service } = setup();
    service.start("biz-1", "w1");

    expect(service.resolve("biz-1", [waiter("w1"), waiter("w2")])?.id).toBe("w1");
    expect(service.resolve("biz-1", [waiter("w1", { active: false })])).toBeNull();
    expect(service.resolve("biz-1", [waiter("w2")])).toBeNull();
  });

  it("resolve() es solo lectura: una lista que no lo incluye no borra la sesión", () => {
    const { service } = setup();
    service.start("biz-1", "w1");

    service.resolve("biz-1", []); // p. ej. caché sin el mesero recién creado
    expect(service.getWaiterId("biz-1")).toBe("w1");
  });

  it("no lanza si el almacenamiento falla", () => {
    const broken: WaiterSessionStorage = {
      getItem() {
        throw new Error("denegado");
      },
      setItem() {
        throw new Error("lleno");
      },
      removeItem() {
        throw new Error("denegado");
      }
    };
    const service = createWaiterSessionService({ storage: broken });

    expect(() => service.start("biz-1", "w1")).not.toThrow();
    expect(service.getWaiterId("biz-1")).toBeNull();
    expect(() => service.end("biz-1")).not.toThrow();
  });

  it("funciona sin almacenamiento (storage: null)", () => {
    const service = createWaiterSessionService({ storage: null });

    expect(() => service.start("biz-1", "w1")).not.toThrow();
    expect(service.getWaiterId("biz-1")).toBeNull();
  });
});