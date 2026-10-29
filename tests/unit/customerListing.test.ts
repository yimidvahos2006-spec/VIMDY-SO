// tests/unit/customerListing.test.ts
/* Paso 6 — lógica de buscar y ordenar de la pantalla de Clientes (pura, sin pantalla). */

import { describe, it, expect } from "vitest";

import type { CustomerWithStats } from "../../src/core/store/useCustomers";
import {
  DEFAULT_SORT,
  buildCustomerSearchIndex,
  filterAndSortCustomers,
  filterAndSortWithIndex,
  getNeverPurchased,
  nextSortState,
  normalizePhoneDigits
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

describe("buscador instantáneo", () => {
  const people = [
    c("a", "Susana Gil", { phone: "300 111 2233", ltv: 10 }),
    c("b", "Ana María Anaya", { phone: "+57 310 555 6677", ltv: 5 }),
    c("c", "José Ángel Pérez", { phone: "3205550000", email: "Jose@Correo.com", ltv: 1 }),
    c("d", "Sin Teléfono", { ltv: 0 })
  ];
  const ids = (q: string, sort = DEFAULT_SORT) => filterAndSortCustomers(people, q, sort).map((x) => x.id);

  it("encuentra por las primeras letras del nombre", () => {
    // Ana María Anaya e Ángel (palabras que empiezan por "an") primero; Susana (en medio) al final.
    expect(ids("an")).toEqual(["b", "c", "a"]);
  });

  it("las coincidencias al inicio de una palabra salen antes que las del medio", () => {
    // "ana" está en medio de "Susana" y al inicio de "Ana"/"Anaya".
    expect(ids("ana")).toEqual(["b", "a"]);
  });

  it("ignora tildes y mayúsculas", () => {
    expect(ids("jose")).toEqual(["c"]);
    expect(ids("ANGEL")).toEqual(["c"]);
    expect(ids("maria")).toEqual(["b"]);
  });

  it("encuentra por teléfono sin importar espacios, guiones o el +57", () => {
    expect(ids("300111")).toEqual(["a"]);
    expect(ids("300 111 22")).toEqual(["a"]);
    expect(ids("300-111-2233")).toEqual(["a"]);
    expect(ids("+57 310")).toEqual(["b"]);
    expect(ids("573105556677")).toEqual(["b"]);
    expect(ids("5556677")).toEqual(["b"]);
  });

  it("el teléfono guardado con espacios o +57 también se encuentra", () => {
    expect(ids("3105556677")).toEqual(["b"]);
    expect(ids("3001112233")).toEqual(["a"]);
  });

  it("acepta varias partes: todas deben coincidir", () => {
    expect(ids("ana 310")).toEqual(["b"]);
    expect(ids("ana 999")).toEqual([]);
    expect(ids("jose perez")).toEqual(["c"]);
  });

  it("también busca en el correo", () => {
    expect(ids("correo.com")).toEqual(["c"]);
  });

  it("sin resultados devuelve lista vacía, y un cliente sin teléfono no rompe la búsqueda numérica", () => {
    expect(ids("zzzz")).toEqual([]);
    expect(ids("3")).not.toContain("d");
  });

  it("espacios solos equivalen a no buscar", () => {
    expect(ids("   ")).toEqual(ids(""));
  });

  it("el índice se puede reutilizar entre búsquedas y da lo mismo", () => {
    const index = buildCustomerSearchIndex(people);
    expect(filterAndSortWithIndex(index, "ana", DEFAULT_SORT).map((x) => x.id)).toEqual(ids("ana"));
    expect(filterAndSortWithIndex(index, "310", DEFAULT_SORT).map((x) => x.id)).toEqual(ids("310"));
  });

  it("rinde con miles de clientes (búsqueda sobre 20.000 en pocos milisegundos)", () => {
    const many = Array.from({ length: 20000 }, (_, i) =>
      c(String(i), `Cliente Número ${i} Gómez`, { phone: String(3000000000 + i) })
    );
    const index = buildCustomerSearchIndex(many);
    const start = performance.now();
    const result = filterAndSortWithIndex(index, "cliente 3000019", DEFAULT_SORT);
    const elapsed = performance.now() - start;
    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(250);
  });
});

describe("normalizePhoneDigits", () => {
  it("deja solo dígitos y quita el indicativo 57", () => {
    expect(normalizePhoneDigits("+57 (300) 123-4567")).toBe("3001234567");
    expect(normalizePhoneDigits("300 123 4567")).toBe("3001234567");
    expect(normalizePhoneDigits("")).toBe("");
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