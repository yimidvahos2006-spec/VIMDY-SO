// tests/unit/customerListing.test.ts
/* Paso 6 — lógica de buscar y ordenar de la pantalla de Clientes (pura, sin pantalla). */

import { describe, it, expect } from "vitest";

import type { CustomerWithStats } from "../../src/core/store/useCustomers";
import {
  DEFAULT_SORT,
  filterAndSortCustomers,
  getNeverPurchased,
  nextSortState
} from "../../src/presentation/components/customers/customerListing";

function c(id: string, name: string, extra: Partial<CustomerWithStats> = {}): CustomerWithStats {
  return {
    id,
    name,
    email: "",
    points: 0,
    ltv: 0,
    purchaseCount: 0,
    lastPurchaseAt: null,
    createdAt: new Date("2026-10-01"),
    ...extra
  } as CustomerWithStats;
}

const list = [
  c("1", "Ana Pérez", { phone: "3001234567", email: "ana@correo.com", ltv: 50000, points: 40, purchaseCount: 3 }),
  c("2", "Luis Gómez", { phone: "3109876543", ltv: 120000, points: 200, purchaseCount: 8 }),
  c("3", "Zoe Ríos", { ltv: 0, points: 0, purchaseCount: 0 })
];

describe("filterAndSortCustomers", () => {
  it("sin búsqueda devuelve todos, por valor generado de mayor a menor (orden por defecto)", () => {
    expect(filterAndSortCustomers(list, "", DEFAULT_SORT).map((x) => x.id)).toEqual(["2", "1", "3"]);
  });

  it("busca por nombre sin importar mayúsculas", () => {
    expect(filterAndSortCustomers(list, "LUIS", DEFAULT_SORT).map((x) => x.id)).toEqual(["2"]);
  });

  it("busca por teléfono", () => {
    expect(filterAndSortCustomers(list, "4567", DEFAULT_SORT).map((x) => x.id)).toEqual(["1"]);
  });

  it("busca por correo", () => {
    expect(filterAndSortCustomers(list, "correo.com", DEFAULT_SORT).map((x) => x.id)).toEqual(["1"]);
  });

  it("ordena por nombre ascendente y descendente", () => {
    expect(filterAndSortCustomers(list, "", { key: "name", dir: "asc" }).map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect(filterAndSortCustomers(list, "", { key: "name", dir: "desc" }).map((x) => x.id)).toEqual(["3", "2", "1"]);
  });

  it("ordena por puntos y por compras", () => {
    expect(filterAndSortCustomers(list, "", { key: "points", dir: "desc" }).map((x) => x.id)).toEqual(["2", "1", "3"]);
    expect(filterAndSortCustomers(list, "", { key: "purchases", dir: "asc" }).map((x) => x.id)).toEqual(["3", "1", "2"]);
  });

  it("no modifica la lista original", () => {
    const copy = [...list];
    filterAndSortCustomers(list, "", { key: "name", dir: "asc" });
    expect(list).toEqual(copy);
  });
});

describe("nextSortState", () => {
  it("misma columna: invierte el orden", () => {
    expect(nextSortState({ key: "ltv", dir: "desc" }, "ltv")).toEqual({ key: "ltv", dir: "asc" });
    expect(nextSortState({ key: "ltv", dir: "asc" }, "ltv")).toEqual({ key: "ltv", dir: "desc" });
  });

  it("otra columna: nombre arranca ascendente, el resto descendente", () => {
    expect(nextSortState({ key: "ltv", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSortState({ key: "name", dir: "asc" }, "points")).toEqual({ key: "points", dir: "desc" });
  });
});

describe("getNeverPurchased", () => {
  it("devuelve solo los clientes sin compras", () => {
    expect(getNeverPurchased(list).map((x) => x.id)).toEqual(["3"]);
  });
});