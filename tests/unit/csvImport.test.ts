import { describe, it, expect } from "vitest";
import {
  buildImportPlan,
  buildTemplateCsv,
  parseCsv,
  parseImportCsv,
  rowToProductInput,
  rowToUpdatePatch
} from "../../src/presentation/components/inventory/csvImport";
import type { Category, Product } from "../../src/core/entities/Entities";

const product = (over: Partial<Product>): Product =>
  ({ id: "p1", name: "Agua", categoryId: "c1", price: 1000, stock: 3, minStock: 0, lastUpdated: new Date(), ...over }) as Product;
const category = (over: Partial<Category>): Category => ({ id: "c1", name: "Bebidas", ...over }) as Category;

describe("parseCsv", () => {
  it("lee CSV de Excel con BOM, ; y saltos de Windows", () => {
    const rows = parseCsv("﻿Nombre;Precio\r\nCafé;3.500\r\n\r\nTé;2500\r\n");
    expect(rows).toEqual([["Nombre", "Precio"], ["Café", "3.500"], ["Té", "2500"]]);
  });

  it("detecta coma como separador y respeta comillas con comas y comillas dobles", () => {
    const rows = parseCsv('nombre,precio\n"Pan, grande",1000\n"Dijo ""hola""",50');
    expect(rows[1]).toEqual(["Pan, grande", "1000"]);
    expect(rows[2]).toEqual(['Dijo "hola"', "50"]);
  });

  it("no confunde la coma decimal con el separador cuando se usa ;", () => {
    expect(parseCsv("nombre;stock\nCarne;5,5")[1]).toEqual(["Carne", "5,5"]);
  });
});

describe("plantilla", () => {
  it("la plantilla descargable se puede volver a importar sin errores", () => {
    const parsed = parseImportCsv(buildTemplateCsv());
    expect(parsed.fatalError).toBeUndefined();
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.every((r) => r.errors.length === 0)).toBe(true);
    expect(parsed.rows[2]).toMatchObject({ type: "ingrediente", stock: 5.5, cost: 22000, unit: "kg", price: 0 });
  });
});

describe("parseImportCsv", () => {
  it("avisa si falta la columna Nombre", () => {
    expect(parseImportCsv("precio;tipo\n100;producto").fatalError).toMatch(/Nombre/);
  });

  it("acepta encabezados con tildes, mayúsculas y alias", () => {
    const { rows } = parseImportCsv("PRODUCTO;Categoria;Precio;Existencias\nJugo;Bebidas;$ 4.500;10");
    expect(rows[0]).toMatchObject({ name: "Jugo", categoryName: "Bebidas", price: 4500, stock: 10, type: "inventario" });
  });

  it('lee "Stock actual" y "Stock mínimo" (si no, todo quedaba en 0 y salía Agotado)', () => {
    const csv =
      "SKU,Código de barras,Nombre,Categoría,Marca,Presentación,Costo,Precio de venta,Stock actual,Stock mínimo,Unidad,Proveedor,Estado,Descripción\n" +
      "VIM-00001,TEST0000000001,Medias NovaCasa Suave 100 g,Ropa y accesorios,NovaCasa,100 g,169400,211400,60,5,unidad,Surtimax,Activo,Prueba";
    const { rows } = parseImportCsv(csv);
    expect(rows[0]).toMatchObject({ name: "Medias NovaCasa Suave 100 g", stock: 60, minStock: 5, price: 211400, cost: 169400 });
    expect(rows[0].errors).toEqual([]);
    expect(rowToProductInput(rows[0], "c")).toMatchObject({ stock: 60, minStock: 5, trackStock: true });
  });

  it("marca errores por fila con su número de fila de Excel", () => {
    const { rows } = parseImportCsv("Nombre;Tipo;Categoría;Precio de venta;Costo;Stock inicial\n;Producto;A;100;;\nX;Raro;A;100;;\nY;Producto;A;abc;;\nZ;Producto;A;-5;;\nW;Producto;A;;;");
    expect(rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 6]);
    expect(rows[0].errors.join()).toMatch(/nombre/i);
    expect(rows[1].errors.join()).toMatch(/Tipo/);
    expect(rows[2].errors.join()).toMatch(/precio de venta no es un número/);
    expect(rows[3].errors.join()).toMatch(/negativo/);
    expect(rows[4].errors.join()).toMatch(/Falta el precio/);
  });

  it("ignora el stock de cocina/servicio con una advertencia y rechaza recetas", () => {
    const { rows } = parseImportCsv("Nombre;Tipo;Categoría;Precio;Stock\nSopa;Cocina;Platos;8000;5\nPlato;Receta;Platos;9000;");
    expect(rows[0].stock).toBe(0);
    expect(rows[0].warnings).toHaveLength(1);
    expect(rows[1].errors.join()).toMatch(/receta/i);
  });

  it("detecta código de barras en notación científica (Excel lo estropeó)", () => {
    const { rows } = parseImportCsv("Nombre;Categoría;Precio;Código de barras\nA;B;100;7,70E+12");
    expect(rows[0].errors.join()).toMatch(/notación científica/);
  });

  it("rechaza archivos con más de 2000 filas", () => {
    const body = Array.from({ length: 2001 }, (_, i) => `P${i};C;1`).join("\n");
    expect(parseImportCsv(`Nombre;Categoría;Precio\n${body}`).fatalError).toMatch(/máximo/);
  });
});

describe("buildImportPlan", () => {
  const csv = "Nombre;Tipo;Categoría;Precio;Costo\nagua ;Producto;bebidas;1500;800\nCafé;Producto;Bebidas;3000;\ncafe;Producto;Bebidas;3000;\nSal;Insumo;;;100";

  it("omite duplicados sin distinguir mayúsculas ni tildes y marca repetidos en el archivo", () => {
    const plan = buildImportPlan(parseImportCsv(csv).rows, [product({ name: "Agua" })], [category({})], "skip");
    expect(plan.planned.map((p) => p.action)).toEqual(["skip", "create", "error", "create"]);
    expect(plan.planned[2].errors.join()).toMatch(/fila 3/);
  });

  it("en modo actualizar cambia precio y costo pero nunca el stock", () => {
    const existing = product({ name: "Agua", stock: 7 });
    const plan = buildImportPlan(parseImportCsv(csv).rows, [existing], [category({})], "update");
    expect(plan.planned[0].action).toBe("update");
    const patch = rowToUpdatePatch(plan.planned[0].row, existing, "c1");
    expect(patch).toMatchObject({ name: "Agua", price: 1500, purchasePrice: 800 });
    expect("stock" in patch).toBe(false);
  });

  it("lista las categorías que faltan, una sola vez, y los insumos van a 'Insumos'", () => {
    const plan = buildImportPlan(parseImportCsv(csv).rows, [], [], "skip");
    expect(plan.missingCategories).toEqual([
      { name: "bebidas", insumo: false },
      { name: "Insumos", insumo: true }
    ]);
  });

  it("no mezcla categorías de insumos con las de venta", () => {
    const plan = buildImportPlan(
      parseImportCsv("Nombre;Tipo;Categoría;Precio\nSal;Insumo;Bebidas;").rows,
      [],
      [category({ name: "Bebidas" })],
      "skip"
    );
    expect(plan.planned[0].action).toBe("error");
    expect(plan.planned[0].errors.join()).toMatch(/productos de venta/);
  });

  it("rechaza un código de barras que ya usa otro producto", () => {
    const plan = buildImportPlan(
      parseImportCsv("Nombre;Categoría;Precio;Código de barras\nNuevo;Bebidas;100;7701").rows,
      [product({ name: "Otro", barcode: "7701" })],
      [category({})],
      "skip"
    );
    expect(plan.planned[0].errors.join()).toMatch(/lo usa "Otro"/);
  });
});

describe("rowToProductInput", () => {
  it("usa las mismas banderas que el formulario según el tipo", () => {
    const [stockRow, kitchenRow, serviceRow, insumoRow] = parseImportCsv(
      "Nombre;Tipo;Categoría;Precio;Stock\nA;Producto;C;100;4\nB;Cocina;C;100;\nC;Servicio;C;100;\nD;Insumo;;;2"
    ).rows;
    expect(rowToProductInput(stockRow, "c")).toMatchObject({ trackStock: true, requiresKitchen: false, isIngredient: false, stock: 4 });
    expect(rowToProductInput(kitchenRow, "c")).toMatchObject({ trackStock: false, requiresKitchen: true, stock: 0 });
    expect(rowToProductInput(serviceRow, "c")).toMatchObject({ trackStock: false, requiresKitchen: false });
    expect(rowToProductInput(insumoRow, "c")).toMatchObject({ trackStock: true, isIngredient: true, price: 0, stock: 2 });
  });
});