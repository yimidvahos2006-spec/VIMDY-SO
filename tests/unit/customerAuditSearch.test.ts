import { describe, it, expect, beforeEach } from "vitest";

import { CustomerEngine } from "../../src/core/engines/CustomerEngine";
import { AuditEngine } from "../../src/core/engines/AuditEngine";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import type { Customer, AuditLog } from "../../src/core/entities/Entities";
import type { SaleRepository } from "../../src/infrastructure/di/repositories/SaleRepository";

/**
 * Paso 6 — Auditoria y busqueda de clientes.
 *
 * El modelo real de Customer declara id, name, email, phone, points: NO tiene
 * documento, y el id es un UUID (useCustomers.createCustomer). Por eso la
 * busqueda cubre nombre/telefono/correo, que es exactamente lo que anuncia la
 * UI ("Buscar por nombre o telefono").
 */
function buildContext() {
  const customers = new InMemoryRepository<Customer>("customers");
  const audits = new InMemoryRepository<AuditLog>("audit_logs");
  const audit = new AuditEngine(audits);
  const sales = {
    findByCustomer: async () => []
  } as unknown as SaleRepository;

  const engine = new CustomerEngine(customers, sales, audit);
  return { customers, audits, audit, engine, sales };
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-1",
    name: "Ana Cliente",
    email: "ana@example.com",
    phone: "3001112222",
    points: 0,
    businessId: "biz-1",
    ...overrides
  };
}

describe("Paso 6 — CustomerEngine: auditoria y busqueda", () => {
  beforeEach(() => {
    // sin estado global que limpiar: cada test arma su propio contexto
  });

  it("create registra auditoria con actor, modulo y entidad", async () => {
    const ctx = buildContext();
    const customer = makeCustomer();

    await ctx.engine.save(customer);

    const logs = await ctx.audits.findAll();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("CUSTOMER_CREATED");
    expect(logs[0].module).toBe("customers");
    expect(logs[0].entityId).toBe("cust-1");
    expect(logs[0].actorId).toBe("biz-1");
    expect(logs[0].description).toContain("Ana Cliente");
  });

  it("update registra auditoria", async () => {
    const ctx = buildContext();
    await ctx.engine.save(makeCustomer());
    await ctx.engine.update(makeCustomer({ name: "Ana Editada" }));

    const logs = await ctx.audits.findAll();
    const actions = logs.map((l) => l.action);
    expect(actions).toContain("CUSTOMER_UPDATED");
    const update = logs.find((l) => l.action === "CUSTOMER_UPDATED")!;
    expect(update.description).toContain("Ana Editada");
  });

  it("delete registra auditoria y borra el cliente", async () => {
    const ctx = buildContext();
    await ctx.engine.save(makeCustomer());
    await ctx.engine.delete("cust-1");

    expect(await ctx.customers.findById("cust-1")).toBeNull();
    const logs = await ctx.audits.findAll();
    expect(logs.map((l) => l.action)).toContain("CUSTOMER_DELETED");
  });

  it("delete de un cliente inexistente no borra ni audita", async () => {
    const ctx = buildContext();
    await expect(ctx.engine.delete("no-existe")).rejects.toThrow("CUSTOMER_NOT_FOUND");
    expect(await ctx.audits.findAll()).toHaveLength(0);
  });

  it("la auditoria no tumba la operacion si el log falla", async () => {
    const ctx = buildContext();
    const brokenAudit = { log: async () => { throw new Error("AUDIT_DOWN"); } } as unknown as AuditEngine;
    const engine = new CustomerEngine(ctx.customers, ctx.sales, brokenAudit);

    // La operacion principal debe completarse aunque la auditoria falle.
    await engine.save(makeCustomer());
    expect(await ctx.customers.findById("cust-1")).not.toBeNull();
  });

  it("search encuentra por nombre, telefono y correo", async () => {
    const ctx = buildContext();
    await ctx.engine.save(makeCustomer({ id: "c1", name: "Ana Cliente", phone: "3001112222", email: "ana@example.com" }));
    await ctx.engine.save(makeCustomer({ id: "c2", name: "Carlos Otro", phone: "3009998888", email: "carlos@example.com" }));

    expect((await ctx.engine.search("Ana")).map((c) => c.id)).toEqual(["c1"]);
    expect((await ctx.engine.search("3009998888")).map((c) => c.id)).toEqual(["c2"]);
    expect((await ctx.engine.search("carlos@")).map((c) => c.id)).toEqual(["c2"]);
  });

  it("search es insensible a mayusculas y tolera query vacia", async () => {
    const ctx = buildContext();
    await ctx.engine.save(makeCustomer({ id: "c1", name: "Ana Cliente" }));

    expect((await ctx.engine.search("ANA")).map((c) => c.id)).toEqual(["c1"]);
    expect(await ctx.engine.search("   ")).toEqual([]);
  });

  it("search respeta el limite", async () => {
    const ctx = buildContext();
    await ctx.engine.save(makeCustomer({ id: "c1", name: "Ana Uno" }));
    await ctx.engine.save(makeCustomer({ id: "c2", name: "Ana Dos" }));
    await ctx.engine.save(makeCustomer({ id: "c3", name: "Ana Tres" }));

    expect(await ctx.engine.search("Ana", 2)).toHaveLength(2);
  });

  it("search no cruza negocios: el RLS del repositorio decide que es visible", async () => {
    const ctx = buildContext();
    // El repositorio es el que aplica el alcance; el motor solo filtra texto.
    // Guardamos dos negocios y solo el repositorio podria filtrar, asi que se
    // verifica que el motor NO agrega su propio filtro de negocio (no inventa).
    await ctx.engine.save(makeCustomer({ id: "c1", businessId: "biz-1", name: "Ana" }));
    await ctx.engine.save(makeCustomer({ id: "c2", businessId: "biz-2", name: "Ana" }));

    const found = await ctx.engine.search("Ana");
    expect(found.map((c) => c.businessId).sort()).toEqual(["biz-1", "biz-2"]);
  });
});