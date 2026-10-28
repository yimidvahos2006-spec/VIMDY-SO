// tests/unit/vimdy-ia-flujo.test.ts
/* ===========================================================================
   PRUEBAS — Flujo completo de VIMDY IA ("Describe tu plato")
   ---------------------------------------------------------------------------
   La Edge Function `vimdy-ia-dish` (Gemini) está SIMULADA con un mock de
   `supabase.functions.invoke`: no hay red, no hay costo y el resultado es
   siempre el mismo. Lo que se prueba es lo nuestro:

     A. parseDishWithAI: qué se le envía a la función, cómo se protege de
        textos vacíos/largos, sin internet o sin negocio, y cómo traduce
        los errores del servidor.
     B. sanitizeDishResult como red de seguridad ante respuestas raras.
     C. describeDishAIError: mensajes que ve la persona.
     D. Flujo completo: texto -> (IA simulada) -> borrador cruzado con el
        inventario REAL en memoria -> formulario precargado -> guardar el
        producto -> descuento de insumos al vender.

   NOTA sobre D: la lógica que rellena el formulario vive dentro de
   ProductFormModal.applyAiDraft (componente React) y el entorno de pruebas
   es "node", sin DOM. `aplicarBorradorComoElFormulario` copia esa lógica,
   usando los MISMOS helpers y el MISMO InventoryEngine que usa el
   formulario. Si cambias applyAiDraft, cambia también este helper.
=========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: { functions: { invoke: vi.fn() } },
  getCurrentBusinessId: vi.fn(),
  getCurrentBranchId: vi.fn(() => "test-branch-id"),
  setCurrentBusinessId: vi.fn(),
  setCurrentBranchId: vi.fn()
}));

vi.mock("../../src/core/store/connectionStore", () => ({
  connectionStore: { isOnline: vi.fn() }
}));

import type { Category, InventoryMovement, Product, RecipeItem } from "../../src/core/entities/Entities";
import {
  DISH_TEXT_MAX_LENGTH,
  describeDishAIError,
  parseDishWithAI,
  sanitizeDishResult,
  type DishAIResult
} from "../../src/core/ia/DishAI";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { RecipeEngine } from "../../src/core/engines/RecipeEngine";
import { connectionStore } from "../../src/core/store/connectionStore";
import { getCurrentBusinessId, supabase } from "../../src/infrastructure/supabase/supabaseClient";
import { convertQuantity, normalizeUnit } from "../../src/core/utils/unitConversion";
import {
  buildDishDraft,
  formatDishQuantity,
  planRecipeRow,
  storedUnitFor,
  type DishDraft
} from "../../src/presentation/components/inventory/dishDraft";
import { normalizeSearch } from "../../src/presentation/components/inventory/recipeFormHelpers";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;
const isOnline = connectionStore.isOnline as unknown as ReturnType<typeof vi.fn>;
const businessId = getCurrentBusinessId as unknown as ReturnType<typeof vi.fn>;

const HAMBURGUESA_IA = {
  name: "Hamburguesa especial",
  category: "Hamburguesas",
  suggestedCategory: null,
  station: "Parrilla",
  price: 22000,
  ingredients: [
    { name: "Carne molida", quantity: 150, unit: "g", estimated: false },
    { name: "Pan de hamburguesa", quantity: 1, unit: "unidad", estimated: false },
    { name: "Queso cheddar", quantity: 1, unit: "unidad", estimated: true },
    { name: "Tocineta", quantity: 30, unit: "g", estimated: true }
  ]
};

beforeEach(() => {
  invoke.mockReset();
  isOnline.mockReset();
  businessId.mockReset();
  isOnline.mockReturnValue(true);
  businessId.mockReturnValue("negocio-1");
});

/* ------------------------------------------------------------------ A */

describe("VIMDY IA · parseDishWithAI (Edge Function simulada)", () => {
  it("envía a la función el texto, el negocio y las listas reales de categorías y estaciones", async () => {
    invoke.mockResolvedValue({ data: HAMBURGUESA_IA, error: null });

    const result = await parseDishWithAI("  una hamburguesa especial a 22 mil  ", ["Hamburguesas", "Bebidas"], ["Parrilla"]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("vimdy-ia-dish", {
      body: {
        text: "una hamburguesa especial a 22 mil",
        businessId: "negocio-1",
        categories: ["Hamburguesas", "Bebidas"],
        stations: ["Parrilla"]
      }
    });
    expect(result.name).toBe("Hamburguesa especial");
    expect(result.price).toBe(22000);
    expect(result.ingredients).toHaveLength(4);
  });

  it("corta el texto largo al máximo permitido antes de enviarlo", async () => {
    invoke.mockResolvedValue({ data: HAMBURGUESA_IA, error: null });

    await parseDishWithAI("a".repeat(DISH_TEXT_MAX_LENGTH + 500), [], []);

    const sent = invoke.mock.calls[0][1].body.text as string;
    expect(sent).toHaveLength(DISH_TEXT_MAX_LENGTH);
  });

  it("texto vacío: falla con DISH_TEXT_REQUIRED y NO llama a la función", async () => {
    await expect(parseDishWithAI("   ", [], [])).rejects.toThrow("DISH_TEXT_REQUIRED");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sin internet: falla con VIMDY_IA_OFFLINE y NO llama a la función", async () => {
    isOnline.mockReturnValue(false);
    await expect(parseDishWithAI("una pizza", [], [])).rejects.toThrow("VIMDY_IA_OFFLINE");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sin negocio activo: falla con VIMDY_IA_UNAVAILABLE y NO llama a la función", async () => {
    businessId.mockReturnValue(undefined);
    await expect(parseDishWithAI("una pizza", [], [])).rejects.toThrow(/VIMDY_IA_UNAVAILABLE.*negocio activo/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("error del servidor: muestra el motivo real que viene en el cuerpo de la respuesta HTTP", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: { json: async () => ({ error: "SUBSCRIPTION_EXPIRED", detail: "plan vencido" }) }
      }
    });

    await expect(parseDishWithAI("una pizza", [], [])).rejects.toThrow(
      "VIMDY_IA_UNAVAILABLE: SUBSCRIPTION_EXPIRED — plan vencido"
    );
  });

  it("error con cuerpo ilegible: usa el mensaje genérico sin romperse", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: "Failed to send a request to the Edge Function",
        context: {
          json: async () => {
            throw new Error("no es JSON");
          }
        }
      }
    });

    await expect(parseDishWithAI("una pizza", [], [])).rejects.toThrow(
      "VIMDY_IA_UNAVAILABLE: Failed to send a request to the Edge Function"
    );
  });

  it("si la función devuelve basura, el resultado queda vacío pero válido (no truena)", async () => {
    invoke.mockResolvedValue({ data: null, error: null });

    await expect(parseDishWithAI("una pizza", [], [])).resolves.toEqual({
      name: "",
      category: null,
      suggestedCategory: null,
      station: null,
      price: null,
      ingredients: []
    });
  });
});

/* ------------------------------------------------------------------ B */

describe("VIMDY IA · sanitizeDishResult como red de seguridad", () => {
  it("descarta ingredientes con cantidad cero, negativa, NaN o unidad desconocida", () => {
    const result = sanitizeDishResult({
      name: "Plato",
      price: 10000,
      ingredients: [
        { name: "Bueno", quantity: 2, unit: "unidad" },
        { name: "Cero", quantity: 0, unit: "g" },
        { name: "Negativo", quantity: -1, unit: "g" },
        { name: "NaN", quantity: Number.NaN, unit: "g" },
        { name: "Texto", quantity: "5", unit: "g" },
        { name: "Tazas", quantity: 1, unit: "tazas" }
      ]
    });
    expect(result.ingredients.map((i) => i.name)).toEqual(["Bueno"]);
  });

  it("estimated solo es true cuando la IA lo manda explícitamente en true", () => {
    const result = sanitizeDishResult({
      name: "Plato",
      ingredients: [
        { name: "A", quantity: 1, unit: "g", estimated: true },
        { name: "B", quantity: 1, unit: "g", estimated: "true" },
        { name: "C", quantity: 1, unit: "g" }
      ]
    });
    expect(result.ingredients.map((i) => i.estimated)).toEqual([true, false, false]);
  });

  it("precio: redondea a entero y descarta cero, negativo e infinito", () => {
    expect(sanitizeDishResult({ price: 21999.6 }).price).toBe(22000);
    expect(sanitizeDishResult({ price: 0 }).price).toBeNull();
    expect(sanitizeDishResult({ price: -10 }).price).toBeNull();
    expect(sanitizeDishResult({ price: Number.POSITIVE_INFINITY }).price).toBeNull();
    expect(sanitizeDishResult({ price: "22000" }).price).toBeNull();
  });
});

/* ------------------------------------------------------------------ C */

describe("VIMDY IA · mensajes de error para la persona", () => {
  it("traduce cada código a un mensaje claro", () => {
    expect(describeDishAIError(new Error("VIMDY_IA_UNAVAILABLE: SUBSCRIPTION_EXPIRED"))).toMatch(/suscripción venció/i);
    expect(describeDishAIError(new Error("VIMDY_IA_OFFLINE: sin red"))).toMatch(/necesita internet/i);
    expect(describeDishAIError(new Error("GEMINI_API_KEY_MISSING"))).toMatch(/clave de Gemini/i);
    expect(describeDishAIError(new Error("DISH_TEXT_REQUIRED"))).toMatch(/escribe o dicta/i);
    expect(describeDishAIError(new Error("TEXT_REQUIRED"))).toMatch(/escribe o dicta/i);
  });

  it("cualquier otro fallo ofrece reintentar o crear el producto a mano, sin mostrar detalles técnicos", () => {
    const message = describeDishAIError(new Error("TypeError: x is undefined"));
    expect(message).toMatch(/crea el producto a mano/i);
    expect(message).not.toMatch(/TypeError/);
    expect(describeDishAIError(undefined)).toMatch(/crea el producto a mano/i);
  });
});

/* ------------------------------------------------------------------ D */

interface FormularioSimulado {
  name: string;
  price: number | null;
  categoryId: string;
  newCategoryName: string;
  printStationOverride: string;
  productType: string;
  requiresKitchen: boolean;
  hasRecipe: boolean;
  productionMode: string;
  recipeRows: { productId: string; quantity: string; unit: string; optional: boolean }[];
  notices: string[];
  insumosCreados: string[];
}

/**
 * Copia fiel de ProductFormModal.applyAiDraft (ver nota arriba): mismo orden,
 * mismos helpers y mismos avisos, pero escribiendo en un objeto en vez de en
 * el estado de React.
 */
async function aplicarBorradorComoElFormulario(
  draft: DishDraft,
  sellCats: Category[],
  inventory: InventoryEngine,
  insumoCategoryId: string
): Promise<FormularioSimulado> {
  const form: FormularioSimulado = {
    name: draft.name,
    price: null,
    categoryId: "",
    newCategoryName: "",
    printStationOverride: "",
    productType: "",
    requiresKitchen: false,
    hasRecipe: false,
    productionMode: "",
    recipeRows: [],
    notices: [],
    insumosCreados: []
  };

  if (draft.price) form.price = draft.price;
  else form.notices.push("No dijiste el precio de venta: escríbelo antes de guardar.");

  const chosen = draft.categoryId ? sellCats.find((c) => c.id === draft.categoryId) : undefined;
  if (chosen) {
    form.categoryId = chosen.id;
  } else {
    form.categoryId = "__nueva__";
    if (draft.suggestedCategory) form.newCategoryName = draft.suggestedCategory;
    form.notices.push(
      draft.suggestedCategory
        ? `Ninguna categoría tuya encajó. Sugerencia: "${draft.suggestedCategory}". Créala con el botón "Crear" o elige otra.`
        : "Ninguna categoría tuya encajó: elige una o crea una nueva."
    );
  }

  if (draft.station) {
    const categoryStation = (chosen as (Category & { printStation?: string }) | undefined)?.printStation ?? "";
    if (normalizeSearch(draft.station) !== normalizeSearch(categoryStation)) {
      form.printStationOverride = draft.station;
    }
  }

  if (draft.ingredients.length === 0) {
    form.notices.push("No mencionaste ingredientes: el producto quedó sin receta. Puedes agregarla abajo.");
    return form;
  }

  form.productType = "cocina_receta";
  form.requiresKitchen = true;
  form.hasRecipe = true;
  form.productionMode = "ON_DEMAND";

  const usedIds = new Set<string>();
  const estimated: string[] = [];
  const created: string[] = [];
  const needsQuantity: string[] = [];
  const failed: string[] = [];
  let known = await inventory.listAll();

  for (const ingredient of draft.ingredients) {
    let productId = ingredient.match?.productId;
    let productName = ingredient.match?.name ?? ingredient.name;
    let storedUnit = ingredient.match?.unit;

    if (!productId) {
      try {
        storedUnit = storedUnitFor(ingredient.unit);
        const insumo = await inventory.createProduct(
          {
            name: ingredient.name,
            categoryId: insumoCategoryId,
            price: 0,
            stock: 0,
            minStock: 0,
            unit: storedUnit,
            isIngredient: true,
            active: true
          },
          undefined,
          { knownProducts: known, deferAudit: true }
        );
        known = [...known, insumo];
        productId = insumo.id;
        productName = insumo.name;
        created.push(insumo.name);
        form.insumosCreados.push(insumo.id);
      } catch {
        failed.push(ingredient.name);
        continue;
      }
    }

    if (usedIds.has(productId)) {
      form.notices.push(`"${ingredient.name}" ya estaba en la receta como "${productName}", no se repitió.`);
      continue;
    }
    usedIds.add(productId);

    const plan = planRecipeRow(ingredient, storedUnit);
    if (plan.needsManualQuantity) {
      needsQuantity.push(`${productName} (la IA dijo ${formatDishQuantity(ingredient.quantity, ingredient.unit)})`);
    } else if (ingredient.estimated) {
      estimated.push(`${productName} ${formatDishQuantity(ingredient.quantity, ingredient.unit)}`);
    }
    form.recipeRows.push({ productId, quantity: plan.quantity, unit: plan.unit, optional: false });
  }

  if (estimated.length > 0) {
    form.notices.push(
      `No dijiste estas cantidades y VIMDY IA propuso valores típicos. Revísalas porque descuentan inventario: ${estimated.join(", ")}.`
    );
  }
  if (needsQuantity.length > 0) form.notices.push(`Escribe la cantidad de: ${needsQuantity.join(", ")}.`);
  if (created.length > 0) {
    form.notices.push(
      `Insumos nuevos creados sin precio de compra: ${created.join(", ")}. Ponles su costo en Insumos para que el margen sea real.`
    );
  }
  if (failed.length > 0) {
    form.notices.push(`No se pudieron crear estos insumos, agrégalos a mano en la receta: ${failed.join(", ")}.`);
  }
  return form;
}

/** Negocio de prueba: inventario real en memoria con algunos insumos y categorías. */
async function armarNegocio() {
  const movements = new InMemoryRepository<InventoryMovement>("inventory_movements");
  const products = new FakeProductRepository(movements);
  const kardex = new KardexEngine(movements);
  const inventory = new InventoryEngine(products, kardex);
  const recipes = new RecipeEngine(products);

  const make = (input: Partial<Product> & { name: string }) =>
    inventory.createProduct({ categoryId: "cat-insumos", isIngredient: true, ...input });

  const carne = await make({ name: "Carne molida", unit: "kg", stock: 5, purchasePrice: 28000 });
  const pan = await make({ name: "Pan de hamburguesa", unit: "unidad", stock: 40, purchasePrice: 800 });
  const queso = await make({ name: "Queso cheddar lonchas", unit: "unidad", stock: 30, purchasePrice: 500 });

  const sellCats = [
    { id: "cat-ham", name: "Hamburguesas" },
    { id: "cat-beb", name: "Bebidas" }
  ] as unknown as Category[];

  return { movements, products, kardex, inventory, recipes, carne, pan, queso, sellCats };
}

/** El mismo recorrido que VimdyAiDishModal.handleSubmit, con la IA simulada. */
async function describirPlato(
  texto: string,
  negocio: Awaited<ReturnType<typeof armarNegocio>>,
  respuestaIA: unknown
): Promise<DishDraft> {
  invoke.mockResolvedValue({ data: respuestaIA, error: null });
  const todos = await negocio.inventory.listAll();
  const insumos = todos.filter((p) => p.isIngredient === true);
  const ai: DishAIResult = await parseDishWithAI(
    texto,
    negocio.sellCats.map((c) => c.name),
    []
  );
  return buildDishDraft(ai, negocio.sellCats, insumos);
}

describe("VIMDY IA · flujo completo hasta el formulario", () => {
  it("la hamburguesa: reutiliza los insumos que ya existen y crea solo los que faltan", async () => {
    const negocio = await armarNegocio();
    const draft = await describirPlato(
      "Una hamburguesa especial a $22.000 con 150g de carne molida, pan, queso cheddar y tocineta",
      negocio,
      HAMBURGUESA_IA
    );

    expect(draft.categoryId).toBe("cat-ham");
    expect(draft.ingredients.map((i) => i.match?.productId ?? null)).toEqual([
      negocio.carne.id,
      negocio.pan.id,
      negocio.queso.id, // "Queso cheddar" ↔ "Queso cheddar lonchas"
      null // Tocineta no existe todavía
    ]);

    const insumosAntes = (await negocio.inventory.listAll()).filter((p) => p.isIngredient).length;
    const form = await aplicarBorradorComoElFormulario(draft, negocio.sellCats, negocio.inventory, "cat-insumos");

    expect(form).toMatchObject({
      name: "Hamburguesa especial",
      price: 22000,
      categoryId: "cat-ham",
      productType: "cocina_receta",
      requiresKitchen: true,
      hasRecipe: true,
      productionMode: "ON_DEMAND",
      printStationOverride: "Parrilla"
    });

    // Solo se creó 1 insumo nuevo (la tocineta), sin precio de compra y en kg.
    const insumosDespues = (await negocio.inventory.listAll()).filter((p) => p.isIngredient);
    expect(insumosDespues).toHaveLength(insumosAntes + 1);
    const tocineta = insumosDespues.find((p) => p.name === "Tocineta")!;
    expect(tocineta).toMatchObject({ unit: "kg", stock: 0, isIngredient: true });
    expect(tocineta.purchasePrice).toBeUndefined();

    // Filas de la receta: 150 g de carne (insumo en kg), 1 pan, 1 queso, 30 g de tocineta.
    expect(form.recipeRows).toEqual([
      { productId: negocio.carne.id, quantity: "150", unit: "g", optional: false },
      { productId: negocio.pan.id, quantity: "1", unit: "", optional: false },
      { productId: negocio.queso.id, quantity: "1", unit: "", optional: false },
      { productId: tocineta.id, quantity: "30", unit: "g", optional: false }
    ]);
  });

  it("avisa lo que la persona debe revisar: cantidades estimadas e insumos sin costo", async () => {
    const negocio = await armarNegocio();
    const draft = await describirPlato("hamburguesa", negocio, HAMBURGUESA_IA);
    const form = await aplicarBorradorComoElFormulario(draft, negocio.sellCats, negocio.inventory, "cat-insumos");

    const avisos = form.notices.join("\n");
    expect(avisos).toMatch(/propuso valores típicos/i);
    expect(avisos).toContain("Queso cheddar lonchas 1 und");
    expect(avisos).toContain("Tocineta 30 g");
    expect(avisos).toMatch(/Insumos nuevos creados sin precio de compra: Tocineta/);
    expect(avisos).not.toMatch(/No dijiste el precio/);
  });

  it("sin precio dicho: el precio queda vacío y se avisa, nunca se inventa", async () => {
    const negocio = await armarNegocio();
    const draft = await describirPlato("una hamburguesa", negocio, { ...HAMBURGUESA_IA, price: null });
    const form = await aplicarBorradorComoElFormulario(draft, negocio.sellCats, negocio.inventory, "cat-insumos");

    expect(form.price).toBeNull();
    expect(form.notices).toContain("No dijiste el precio de venta: escríbelo antes de guardar.");
  });

  it("categoría que no existe: abre '+ Nueva categoría' con la sugerencia, sin crearla", async () => {
    const negocio = await armarNegocio();
    const draft = await describirPlato("pizza", negocio, {
      name: "Pizza hawaiana",
      category: null,
      suggestedCategory: "Pizzas",
      station: null,
      price: 18000,
      ingredients: []
    });
    const form = await aplicarBorradorComoElFormulario(draft, negocio.sellCats, negocio.inventory, "cat-insumos");

    expect(form.categoryId).toBe("__nueva__");
    expect(form.newCategoryName).toBe("Pizzas");
    expect(form.notices.join(" ")).toMatch(/Sugerencia: "Pizzas"/);
  });

  it("sin ingredientes: el producto queda sin receta y se avisa", async () => {
    const negocio = await armarNegocio();
    const draft = await describirPlato("una gaseosa a 4 mil", negocio, {
      name: "Gaseosa",
      category: "Bebidas",
      suggestedCategory: null,
      station: null,
      price: 4000,
      ingredients: []
    });
    const form = await aplicarBorradorComoElFormulario(draft, negocio.sellCats, negocio.inventory, "cat-insumos");

    expect(form.hasRecipe).toBe(false);
    expect(form.recipeRows).toEqual([]);
    expect(form.notices.join(" ")).toMatch(/quedó sin receta/i);
  });

  it("unidades incompatibles (IA dice 2 unidades de un insumo en kg): cantidad vacía y se pide escribirla", async () => {
    const negocio = await armarNegocio();
    const draft = await describirPlato("hamburguesa", negocio, {
      ...HAMBURGUESA_IA,
      ingredients: [{ name: "Carne molida", quantity: 2, unit: "unidad", estimated: false }]
    });
    const form = await aplicarBorradorComoElFormulario(draft, negocio.sellCats, negocio.inventory, "cat-insumos");

    expect(form.recipeRows).toEqual([{ productId: negocio.carne.id, quantity: "", unit: "", optional: false }]);
    expect(form.notices.join(" ")).toContain("Escribe la cantidad de: Carne molida (la IA dijo 2 und)");
  });

  it("el mismo insumo dicho dos veces no se repite en la receta", async () => {
    const negocio = await armarNegocio();
    const draft = await describirPlato("hamburguesa", negocio, {
      ...HAMBURGUESA_IA,
      ingredients: [
        { name: "Carne molida", quantity: 150, unit: "g", estimated: false },
        { name: "carne", quantity: 50, unit: "g", estimated: true }
      ]
    });
    const form = await aplicarBorradorComoElFormulario(draft, negocio.sellCats, negocio.inventory, "cat-insumos");

    expect(form.recipeRows).toHaveLength(1);
    expect(form.notices.join(" ")).toMatch(/ya estaba en la receta como "Carne molida"/);
  });

  it("si crear un insumo falla, el resto de la receta se arma y se avisa cuál faltó", async () => {
    const negocio = await armarNegocio();
    const draft = await describirPlato("hamburguesa", negocio, HAMBURGUESA_IA);
    const original = negocio.inventory.createProduct.bind(negocio.inventory);
    vi.spyOn(negocio.inventory, "createProduct").mockImplementation(async (input, by, opts) => {
      if (input.name === "Tocineta") throw new Error("red caída");
      return original(input, by, opts);
    });

    const form = await aplicarBorradorComoElFormulario(draft, negocio.sellCats, negocio.inventory, "cat-insumos");

    expect(form.recipeRows).toHaveLength(3);
    expect(form.notices.join(" ")).toContain("No se pudieron crear estos insumos, agrégalos a mano en la receta: Tocineta.");
  });

  it("IA no inventa nada por su cuenta: VIMDY IA solo propone, el producto NO existe hasta que la persona guarda", async () => {
    const negocio = await armarNegocio();
    const draft = await describirPlato("hamburguesa", negocio, { ...HAMBURGUESA_IA, ingredients: [] });
    await aplicarBorradorComoElFormulario(draft, negocio.sellCats, negocio.inventory, "cat-insumos");

    const productosDeVenta = (await negocio.inventory.listAll()).filter((p) => !p.isIngredient);
    expect(productosDeVenta).toHaveLength(0);
  });

  it("de punta a punta: dictado -> formulario -> guardar -> la venta descuenta los insumos", async () => {
    const negocio = await armarNegocio();
    const draft = await describirPlato("hamburguesa", negocio, HAMBURGUESA_IA);
    const form = await aplicarBorradorComoElFormulario(draft, negocio.sellCats, negocio.inventory, "cat-insumos");

    // La persona ajusta lo que la IA dejó pendiente (costo de la tocineta) y guarda.
    const tocinetaId = form.insumosCreados[0];
    await negocio.inventory.increaseStock(tocinetaId, 2, "Compra", "admin", undefined, 40000);

    const all = await negocio.products.findAll();
    const receta: RecipeItem[] = form.recipeRows.map((r) => {
      const insumo = all.find((p) => p.id === r.productId)!;
      const typed = Number(r.quantity);
      const converted = convertQuantity(typed, r.unit || insumo.unit, insumo.unit)!;
      return normalizeUnit(r.unit || insumo.unit) === normalizeUnit(insumo.unit)
        ? { productId: r.productId, quantity: converted, optional: r.optional }
        : { productId: r.productId, quantity: converted, optional: r.optional, entryQuantity: typed, entryUnit: r.unit };
    });

    const burger = await negocio.inventory.createProduct({
      name: form.name,
      categoryId: form.categoryId,
      price: form.price!,
      requiresKitchen: form.requiresKitchen,
      productionMode: "ON_DEMAND",
      recipe: receta
    });

    // Costo real: 0,15×28000 + 800 + 500 + 0,03×40000 = 6.700 -> margen sobre 22.000.
    const mapa = new Map((await negocio.products.findAll()).map((p) => [p.id, p]));
    const profit = negocio.recipes.getProfitability(burger, mapa);
    expect(profit.cost).toBeCloseTo(6700, 6);
    expect(profit.profit).toBeCloseTo(22000 - 6700, 6);
    expect(profit.costUnreliable).toBe(false);

    await negocio.inventory.consumeForSale([{ productId: burger.id, quantity: 2 }]);

    expect((await negocio.products.findById(negocio.carne.id))?.stock).toBeCloseTo(4.7, 9);
    expect((await negocio.products.findById(negocio.pan.id))?.stock).toBe(38);
    expect((await negocio.products.findById(negocio.queso.id))?.stock).toBe(28);
    expect((await negocio.products.findById(tocinetaId))?.stock).toBeCloseTo(1.94, 9);
  });

  it("si la IA falla, no se crea nada y el error es legible", async () => {
    const negocio = await armarNegocio();
    invoke.mockResolvedValue({
      data: null,
      error: { message: "boom", context: { json: async () => ({ error: "GEMINI_API_KEY_MISSING" }) } }
    });

    const insumosAntes = (await negocio.inventory.listAll()).length;
    let mensaje = "";
    try {
      await parseDishWithAI("una pizza", [], []);
    } catch (err) {
      mensaje = describeDishAIError(err);
    }

    expect(mensaje).toMatch(/clave de Gemini/i);
    expect((await negocio.inventory.listAll()).length).toBe(insumosAntes);
  });
});