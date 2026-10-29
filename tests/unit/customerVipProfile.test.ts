// tests/unit/customerVipProfile.test.ts
/* ===========================================================================
   Perfil VIP de un cliente — dominio puro.
   Valida lo que muestra la tarjeta: total gastado, visitas, ticket promedio,
   favoritos, primera/última visita y nivel, con las mismas reglas de
   fidelización (solo PAID/CLOSED, neto de reembolsos).
=========================================================================== */

import { describe, expect, it } from "vitest";

import type { Sale, SaleItem } from "../../src/core/entities/Entities";
import {
  buildCustomerVipProfile,
  calculateFavoriteProducts
} from "../../src/core/domain/customers";

function item(productId: string, quantity: number, price = 10_000): SaleItem {
  return { productId, quantity, price };
}

function makeSale(overrides: Partial<Sale> & { id: string }): Sale {
  const items = overrides.items ?? [item("burger", 1)];
  const total = overrides.total ?? items.reduce((sum, it) => sum + it.price * it.quantity, 0);
  return {
    customerId: "cust-1",
    items,
    total,
    status: "PAID",
    createdAt: new Date("2026-10-01T12:00:00Z"),
    updatedAt: new Date("2026-10-01T12:00:00Z"),
    ...overrides
  } as Sale;
}

describe("buildCustomerVipProfile — totales", () => {
  it("cliente sin compras: todo en cero y sin fechas", () => {
    const vip = buildCustomerVipProfile([]);

    expect(vip.totalSpent).toBe(0);
    expect(vip.visitCount).toBe(0);
    expect(vip.averageTicket).toBe(0);
    expect(vip.firstVisitAt).toBeNull();
    expect(vip.lastVisitAt).toBeNull();
    expect(vip.favorites).toEqual([]);
    expect(vip.tier).toBe("bronce");
  });

  it("suma gasto y visitas, calcula ticket promedio y fechas", () => {
    const vip = buildCustomerVipProfile([
      makeSale({ id: "s1", total: 30_000, createdAt: new Date("2026-09-01T10:00:00Z") }),
      makeSale({ id: "s2", total: 50_000, createdAt: new Date("2026-10-05T10:00:00Z") }),
      makeSale({ id: "s3", total: 20_000, createdAt: new Date("2026-09-20T10:00:00Z"), status: "CLOSED" })
    ]);

    expect(vip.totalSpent).toBe(100_000);
    expect(vip.visitCount).toBe(3);
    expect(vip.averageTicket).toBeCloseTo(33_333.33, 2);
    expect(vip.firstVisitAt).toEqual(new Date("2026-09-01T10:00:00Z"));
    expect(vip.lastVisitAt).toEqual(new Date("2026-10-05T10:00:00Z"));
    expect(vip.points).toBe(100); // 1 punto por cada $1.000
  });

  it("ventas sin cobrar o canceladas NO cuentan como visita ni como gasto", () => {
    const vip = buildCustomerVipProfile([
      makeSale({ id: "paid", total: 40_000 }),
      makeSale({ id: "pending", total: 99_000, status: "PENDING_PAYMENT" }),
      makeSale({ id: "cancelled", total: 99_000, status: "CANCELLED" }),
      makeSale({ id: "open", total: 99_000, status: "OPEN" })
    ]);

    expect(vip.totalSpent).toBe(40_000);
    expect(vip.visitCount).toBe(1);
  });

  it("un reembolso parcial descuenta el gasto pero la visita sigue contando", () => {
    const vip = buildCustomerVipProfile([
      makeSale({
        id: "s1",
        items: [item("burger", 2, 20_000)],
        total: 40_000,
        refunds: [{ id: "r1", items: [{ productId: "burger", quantity: 1 }], amount: 20_000 }] as Sale["refunds"]
      })
    ]);

    expect(vip.totalSpent).toBe(20_000);
    expect(vip.visitCount).toBe(1);
  });

  it("una venta devuelta por completo no es una visita", () => {
    const vip = buildCustomerVipProfile([
      makeSale({
        id: "s1",
        items: [item("burger", 1, 25_000)],
        total: 25_000,
        refunds: [{ id: "r1", items: [{ productId: "burger", quantity: 1 }], amount: 25_000 }] as Sale["refunds"]
      })
    ]);

    expect(vip.totalSpent).toBe(0);
    expect(vip.visitCount).toBe(0);
    expect(vip.favorites).toEqual([]);
  });

  it("el nivel sube con el gasto (500 puntos = oro) y reporta el progreso", () => {
    const silver = buildCustomerVipProfile([makeSale({ id: "s1", total: 200_000 })]);
    expect(silver.tier).toBe("plata");
    expect(silver.tierProgress.nextTier).toBe("oro");
    expect(silver.tierProgress.pointsToNextTier).toBe(300);

    const gold = buildCustomerVipProfile([makeSale({ id: "s2", total: 600_000 })]);
    expect(gold.tier).toBe("oro");
    expect(gold.tierProgress.nextTier).toBeNull();
  });
});

describe("calculateFavoriteProducts", () => {
  it("ordena por unidades y cuenta en cuántas visitas apareció cada producto", () => {
    const favorites = calculateFavoriteProducts([
      makeSale({ id: "s1", items: [item("burger", 2), item("soda", 1)] }),
      makeSale({ id: "s2", items: [item("burger", 1), item("fries", 1)] }),
      makeSale({ id: "s3", items: [item("soda", 1)] })
    ]);

    expect(favorites.map((f) => f.productId)).toEqual(["burger", "soda", "fries"]);
    expect(favorites[0]).toEqual({ productId: "burger", units: 3, visits: 2 });
    expect(favorites[1]).toEqual({ productId: "soda", units: 2, visits: 2 });
    expect(favorites[2]).toEqual({ productId: "fries", units: 1, visits: 1 });
  });

  it("empata por visitas y luego por id, de forma determinista", () => {
    const favorites = calculateFavoriteProducts([
      makeSale({ id: "s1", items: [item("zeta", 2)] }),
      makeSale({ id: "s2", items: [item("alfa", 1)] }),
      makeSale({ id: "s3", items: [item("alfa", 1)] })
    ]);

    // Mismas unidades (2): alfa gana por haber venido en más visitas.
    expect(favorites.map((f) => f.productId)).toEqual(["alfa", "zeta"]);
  });

  it("respeta el límite pedido", () => {
    const sales = [
      makeSale({ id: "s1", items: [item("a", 5), item("b", 4), item("c", 3), item("d", 2), item("e", 1)] })
    ];

    expect(calculateFavoriteProducts(sales, 3).map((f) => f.productId)).toEqual(["a", "b", "c"]);
    expect(calculateFavoriteProducts(sales, 0)).toEqual([]);
    expect(buildCustomerVipProfile(sales).favorites).toHaveLength(5);
  });

  it("no cuenta ventas sin cobrar ni unidades ya reembolsadas", () => {
    const favorites = calculateFavoriteProducts([
      makeSale({
        id: "s1",
        items: [item("burger", 3, 10_000), item("soda", 1, 5_000)],
        total: 35_000,
        refunds: [{ id: "r1", items: [{ productId: "burger", quantity: 2 }], amount: 20_000 }] as Sale["refunds"]
      }),
      makeSale({ id: "s2", items: [item("pizza", 9)], status: "PENDING_PAYMENT" })
    ]);

    expect(favorites.find((f) => f.productId === "pizza")).toBeUndefined();
    expect(favorites.find((f) => f.productId === "burger")?.units).toBe(1);
  });

  it("dos líneas del mismo producto en una venta cuentan como una sola visita", () => {
    const favorites = calculateFavoriteProducts([
      makeSale({ id: "s1", items: [item("burger", 1), { ...item("burger", 1), note: "sin cebolla" }] })
    ]);

    expect(favorites).toEqual([{ productId: "burger", units: 2, visits: 1 }]);
  });
});