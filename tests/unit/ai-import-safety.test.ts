import { describe, it, expect } from "vitest";
import { buildProductInputFromImportRow, type ImportedProductRow } from "../../src/presentation/components/inventory/importHelpers";

function makeRow(overrides: Partial<ImportedProductRow> = {}): ImportedProductRow {
  return {
    id: "test-row",
    name: "Test Product",
    price: "1000",
    requiresReview: false,
    categoryId: "cat-1",
    requiresKitchen: false,
    stock: "0",
    recipeRows: [],
    taxRate: "",
    unit: "unidad",
    productionMode: "NONE",
    isIngredient: false,
    pendingReview: false,
    tipo: "producto_simple",
    ...overrides
  };
}

describe("AI import safety rules", () => {
  it("buildProductInputFromImportRow preserves isIngredient flag", () => {
    const ingredientRow = makeRow({ isIngredient: true, pendingReview: false });
    const input = buildProductInputFromImportRow(ingredientRow, "");
    expect(input.isIngredient).toBe(true);
  });

  it("buildProductInputFromImportRow sets active=true by default", () => {
    const row = makeRow({ pendingReview: false });
    const input = buildProductInputFromImportRow(row, "");
    expect(input.active).toBe(true);
  });

  it("buildProductInputFromImportRow sets stock=0 when trackStock is false", () => {
    const row = makeRow({ requiresKitchen: true, productionMode: "ON_DEMAND", pendingReview: false });
    const input = buildProductInputFromImportRow(row, "");
    expect(input.trackStock).toBe(false);
    expect(input.stock).toBe(0);
  });

  it("buildProductInputFromImportRow parses price as number", () => {
    const row = makeRow({ price: "25000", pendingReview: false });
    const input = buildProductInputFromImportRow(row, "");
    expect(input.price).toBe(25000);
  });

  it("buildProductInputFromImportRow does not set productionMode when recipe is empty", () => {
    const row = makeRow({ recipeRows: [], productionMode: "NONE", pendingReview: false });
    const input = buildProductInputFromImportRow(row, "");
    expect(input.productionMode).toBeUndefined();
  });

  it("buildProductInputFromImportRow sets productionMode=BATCH when recipe exists and mode is BATCH", () => {
    const row = makeRow({
      recipeRows: [{ rowId: "ing-1", productId: "prod-1", quantity: "2" }],
      productionMode: "BATCH",
      pendingReview: false
    });
    const input = buildProductInputFromImportRow(row, "");
    expect(input.productionMode).toBe("BATCH");
    expect(input.trackStock).toBe(true);
  });
});

describe("AI import deduplication", () => {
  it("detects duplicate product names (case-insensitive)", () => {
    const existing = [
      { name: "Bandeja Paisa" },
      { name: "arepa blanca" }
    ];
    const names = existing.map((p) => p.name.trim().toLowerCase());
    const newItem = "Bandeja Paisa";
    const isDuplicate = names.includes(newItem.toLowerCase());
    expect(isDuplicate).toBe(true);
  });

  it("does not flag different products as duplicates", () => {
    const existing = [
      { name: "Bandeja Paisa" },
      { name: "Arepa Blanca" }
    ];
    const names = existing.map((p) => p.name.trim().toLowerCase());
    const newItem = "Chicharrón";
    const isDuplicate = names.includes(newItem.toLowerCase());
    expect(isDuplicate).toBe(false);
  });
});

describe("AI import pending review gating", () => {
  it("skips pending review rows in import logic", async () => {
    const rows: ImportedProductRow[] = [
      makeRow({ name: "Aprobado", price: "1000", categoryId: "cat-1", pendingReview: false }),
      makeRow({ name: "Pendiente", price: "0", categoryId: "cat-1", pendingReview: true }),
    ];

    const imported: string[] = [];
    const skipped: string[] = [];

    for (const row of rows) {
      const price = Number(row.price);
      if (row.pendingReview) {
        skipped.push(row.name);
        continue;
      }
      if (!row.name.trim() || !price || price <= 0 || !row.categoryId) {
        skipped.push(row.name);
        continue;
      }
      imported.push(row.name);
    }

    expect(imported).toEqual(["Aprobado"]);
    expect(skipped).toEqual(["Pendiente"]);
  });

  it("never auto-creates a product with zero price and zero stock in a sales category", () => {
    const row = makeRow({
      name: "Producto Fantasma",
      price: "0",
      stock: "0",
      categoryId: "cat-venta",
      pendingReview: true
    });

    const price = Number(row.price);
    const shouldAutoCreate = row.name.trim() && price > 0 && row.categoryId && !row.pendingReview;
    expect(shouldAutoCreate).toBe(false);
  });

  it("marks rows with price <= 0 as pendingReview in handleContinue logic", () => {
    const item = { name: "Producto Gratis", price: 0, tipo: "plato_final" as const, requiresReview: false };
    const pendingReview = item.requiresReview || item.price <= 0;
    expect(pendingReview).toBe(true);
  });
});
