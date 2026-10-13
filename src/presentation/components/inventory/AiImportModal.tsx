import React, { useState } from "react";
import { VimdyButton } from "../ui/VimdyButton";
import { parseMoneyInput } from "../../../core/utils/parseMoneyInput";
import { Package, DollarSign, X, Plus, ImagePlus, Trash2, Pencil, Sparkles, Camera, ChefHat } from "lucide-react";
import { aiImportStore } from "../../../core/store/aiImportStore";
import { readMenuImage, MenuOcrItem } from "../../../core/ia/MenuVisionAI";
import { Product, Category } from "../../../core/entities/Entities";
import { ProductInput } from "../../../core/engines/InventoryEngine";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { fileToProductImage } from "../../utils/imageUtils";
import { buildProductInputFromImportRow, inferUnitFromProductName, ImportedProductRow } from "./importHelpers";

/**
 * Botón + flujo de "Importar menú con IA" — VIMDY Smart Import.
 * Paso 1: seleccionar/tomar foto, ver vista previa, Continuar.
 * Paso 2: la IA (OCR real vía tesseract.js) lee el texto de la foto y arma
 * una tabla de revisión editable con Producto/Precio.
 * Paso 3 (nuevo): al pulsar "Importar productos", cada fila válida se crea
 * de verdad en InventoryEngine (Nombre, Precio, Categoría, Stock, IVA,
 * Estado activo), usando el mismo `createProduct` que usa "Nuevo producto".
 * Paso 2.3 (Categorías con IA): cada fila trae su propio selector de
 * categoría, precargado con la sugerencia de la IA (MenuVisionAI) pero
 * editable a mano.
 * Paso 2.4: ya no existe un selector único de categoría para todo el lote —
 * cada fila manda su propia categoría al importar (handleImport usa
 * row.categoryId). Una fila solo se importa si tiene nombre, precio válido
 * Y categoría elegida; si falta la categoría, queda listada como pendiente
 * y no se crea, igual que si le faltara nombre o precio.
 */
export interface ReviewRow {
  id: string;
  name: string;
  price: string;
  requiresReview: boolean;
  /**
   * Categoría sugerida por la IA para esta fila en particular (Paso 2.3),
   * editable por el negocio. "" significa "sin clasificar / sin elegir
   * todavía" — hasta el Paso 2.4 esto es solo informativo: lo que de
   * verdad se usa al importar sigue siendo el selector único de abajo.
   */
  categoryId: string;
  /**
   * Paso 2.5 (Cocina por fila): igual que Product.requiresKitchen, decide
   * si este producto entra a la comanda de cocina o no (ej: gaseosas,
   * paquetes, cosas que no se preparan). Editable con un switch por fila,
   * junto a la columna "Estado". Default true, igual que el resto del
   * catálogo (InventoryEngine.resolveRequiresKitchenDefault).
   */
  requiresKitchen: boolean;
  /**
   * Stock inicial de ESTA fila (Paso 2.6 — Stock por fila). Solo se usa y
   * se muestra cuando requiresKitchen es false: un producto sin cocina se
   * vende directo del stock, así que necesita cuántas unidades entran.
   * Si requiresKitchen es true, este valor se ignora al importar (ver
   * handleImport) porque el stock lo dan los ingredientes, no la fila.
   */
  stock: string;
  /**
   * Receta/ingredientes de ESTA fila (Paso 2.6), solo aplica cuando
   * requiresKitchen es true: en vez de pedir un stock inicial, el negocio
   * arma aquí de qué ingredientes (otros productos ya en Inventario) sale
   * este plato y en qué cantidad — igual que "Producto con receta" en el
   * formulario normal de Nuevo producto.
   */
  recipeRows: { rowId: string; productId: string; quantity: string }[];
  /**
   * Paso 2.7 — IVA por fila: "" significa "usa el % general de abajo"
   * (batchTax, aplicado a todos por defecto). Si el negocio escribe algo
   * acá, esta fila usa SU propio % en vez del general — así por defecto
   * todos los productos importan con el mismo IVA, y solo hay que tocar
   * la fila que sea distinta (ej: un producto exento).
   */
  taxRate: string;
}

export interface ImportResult {
  success: number;
  failed: string[];
}

export function AiImportModal({
  onClose,
  createProduct
}: {
  onClose: () => void;
  createProduct: (input: ProductInput) => Promise<boolean>;
}) {
  const [screen, setScreen] = useState<"capture" | "reading" | "review" | "importing" | "done">(
    "capture"
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportedProductRow[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [readingPhase, setReadingPhase] = useState(0);

  // Categorías del negocio, precargadas para poder pasárselas a la IA y
  // para poblar el selector de categoría de cada fila (Paso 2.4: ya no hay
  // un "categoryId" único para todo el lote, cada fila manda el suyo).
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryRequiresKitchen, setNewCategoryRequiresKitchen] = useState(true);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [batchTax, setBatchTax] = useState("");

  // Paso 2.6 — Stock/Ingredientes por fila: productos ya existentes en el
  // inventario, para poblar el selector de ingredientes de cada fila que
  // tenga "Cocina" activado (igual que ingredientOptions en ProductFormModal).
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  // Solo una fila puede tener el panel de ingredientes abierto a la vez,
  // para no llenar la tabla de paneles largos uno debajo del otro.
  const [openRecipeRowId, setOpenRecipeRowId] = useState<string | null>(null);

  React.useEffect(() => {
    container.inventoryEngine.get().listAll().then(setAllProducts);
  }, []);

  const steps = [
    { icon: <Camera size={16} />, label: "Foto" },
    { icon: <Sparkles size={16} />, label: "IA reconoce" },
    { icon: <Pencil size={16} />, label: "Nombre" },
    { icon: <DollarSign size={16} />, label: "Precio" },
    { icon: <Package size={16} />, label: "Categoría" },
    { icon: <Plus size={16} />, label: "Crear automáticamente" }
  ];

  // Fase 5 — experiencia visual: mientras la imagen viaja y el modelo
  // responde (2-5s), la pantalla no se queda congelada. Estos mensajes van
  // rotando solos; no dependen de eventos reales del backend porque la
  // llamada es una sola petición (no hay pasos intermedios que reportar),
  // pero le muestran al usuario que sí está pasando algo, en el orden en el
  // que conceptualmente ocurre.
  const READING_MESSAGES = [
    "Analizando imagen...",
    "Detectando productos...",
    "Corrigiendo nombres...",
    "Construyendo menú..."
  ];

  React.useEffect(() => {
    if (screen !== "reading") {
      setReadingPhase(0);
      return;
    }
    const interval = setInterval(() => {
      setReadingPhase((p) => Math.min(p + 1, READING_MESSAGES.length - 1));
    }, 700);
    return () => clearInterval(interval);
  }, [screen]);

  // Se carga apenas se abre el modal (no solo al llegar a "review"): así,
  // cuando se llama a readMenuImage durante "reading", ya tenemos la lista
  // real de categorías del negocio para pasársela y que la IA sugiera una
  // por producto — si esperáramos a "review", la IA nunca tendría contra
  // qué clasificar.
  React.useEffect(() => {
    container.categoryEngine.get().listAll().then(setCategories);
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setProcessing(true);

    try {
      const dataUrl = await fileToProductImage(file);
      setPreview(dataUrl);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo procesar la imagen.");
    } finally {
      setProcessing(false);
    }
  }

  async function handleContinue() {
    if (!preview) return;

    // Guarda la imagen (Paso 1) y de una vez arranca la lectura (Paso 2).
    aiImportStore.saveImage(preview);
    setScreen("reading");
    setReadError(null);

    try {
      const items: MenuOcrItem[] = await readMenuImage(preview, categories);
      setRows(
        items.map((item) => ({
          id: crypto.randomUUID(),
          name: item.name,
          price: String(item.price),
          requiresReview: item.requiresReview,
          categoryId: item.categoryId ?? "",
          requiresKitchen: true,
          stock: "0",
          recipeRows: [],
          taxRate: "",
          unit: inferUnitFromProductName(item.name),
          productionMode: "NONE",
          isIngredient: item.tipo === "ingrediente",
          pendingReview: item.requiresReview || item.price <= 0,
          tipo: item.tipo
        }))
      );
    } catch (err: any) {
      // Se muestra el detalle técnico (además del mensaje amigable) para
      // poder diagnosticar rápido si algo falla del lado del servidor.
      const detail = err?.message ? ` (${err.message})` : "";
      setReadError(
        `No pudimos leer la imagen automáticamente. Puedes agregar los productos a mano abajo.${detail}`
      );
      setRows([]);
    } finally {
      setScreen("review");
    }
  }

  function handleRetake() {
    setPreview(null);
    setError(null);
    setReadError(null);
    setRows([]);
    setResult(null);
    setScreen("capture");
  }

  function updateRow(id: string, field: "name" | "price" | "categoryId" | "stock" | "taxRate" | "pendingReview", value: string | boolean) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  /**
   * Paso 2.6 — Ingredientes por fila: agrega/quita/edita una fila de
   * receta dentro de una fila del import (mismo patrón que
   * addRecipeRow/removeRecipeRow/updateRecipeRow de ProductFormModal, pero
   * anidado por producto porque acá hay varias filas a la vez).
   */
  function addIngredientRow(rowId: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              recipeRows: [...r.recipeRows, { rowId: crypto.randomUUID(), productId: "", quantity: "1" }]
            }
          : r
      )
    );
  }

  function removeIngredientRow(rowId: string, ingredientRowId: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, recipeRows: r.recipeRows.filter((ing) => ing.rowId !== ingredientRowId) }
          : r
      )
    );
  }

  function updateIngredientRow(
    rowId: string,
    ingredientRowId: string,
    field: "productId" | "quantity",
    value: string
  ) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              recipeRows: r.recipeRows.map((ing) =>
                ing.rowId === ingredientRowId ? { ...ing, [field]: value } : ing
              )
            }
          : r
      )
    );
  }

  /** Abre/cierra el panel de ingredientes de una fila (solo uno abierto a la vez). */
  function toggleRecipePanel(rowId: string) {
    setOpenRecipeRowId((prev) => (prev === rowId ? null : rowId));
    // La primera vez que se abre el panel para una fila sin ingredientes
    // todavía, se le agrega una fila vacía para no arrancar en blanco.
    setRows((prev) =>
      prev.map((r) => (r.id === rowId && r.recipeRows.length === 0
        ? { ...r, recipeRows: [{ rowId: crypto.randomUUID(), productId: "", quantity: "1" }] }
        : r
      ))
    );
  }

  /** Prende/apaga el switch "Cocina" de una fila (Paso 2.5). */
  function toggleRowKitchen(id: string) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, requiresKitchen: !r.requiresKitchen } : r))
    );
    setOpenRecipeRowId((prev) => (prev === id ? null : prev));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: "",
        price: "",
        requiresReview: false,
        categoryId: "",
        requiresKitchen: true,
        stock: "0",
        recipeRows: [],
        taxRate: "",
        unit: "unidad",
        productionMode: "NONE",
        isIngredient: false,
        pendingReview: false,
        tipo: "producto_simple"
      }
    ]);
  }

  async function handleCreateCategory() {
    const trimmed = newCategoryName.trim();

    if (!trimmed) {
      setCategoryError("Escribe un nombre para la categoría.");
      return;
    }

    setCategoryError(null);
    setCreatingCategory(true);

    try {
      const created = await container.categoryEngine.get().create({
        name: trimmed,
        requiresKitchenByDefault: newCategoryRequiresKitchen
      });
      setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCategoryName("");
      setNewCategoryRequiresKitchen(true);
    } catch (err: any) {
      const messages: Record<string, string> = {
        CATEGORY_NAME_REQUIRED: "Escribe un nombre para la categoría.",
        CATEGORY_NAME_DUPLICATE: "Ya existe una categoría con ese nombre."
      };
      setCategoryError(messages[err?.message] ?? "No se pudo crear la categoría.");
    } finally {
      setCreatingCategory(false);
    }
  }

  // Paso 2.4: cada fila manda su propia categoría, ya no hay un selector
  // único para todo el lote. Una fila está "lista" cuando tiene nombre,
  // precio válido Y categoría elegida — igual que exige InventoryEngine
  // (CATEGORIA_REQUERIDA) para crear cualquier producto.
  const rowsMissingCategory = rows.filter(
    (r) => r.name.trim() && parseMoneyInput(r.price) > 0 && !r.categoryId
  ).length;
  const validRowsCount = rows.filter(
    (r) => r.name.trim() && parseMoneyInput(r.price) > 0 && !!r.categoryId && !r.pendingReview
  ).length;
  const pendingRowsCount = rows.filter((r) => r.pendingReview).length;
  const canImport = validRowsCount > 0 && screen === "review";

  /**
   * Crea de verdad cada fila válida en InventoryEngine (Paso 3). Las filas
   * sin nombre, sin precio válido o sin categoría elegida (Paso 2.4: la
   * categoría ahora es por fila) se saltan y quedan listadas para que el
   * negocio las revise manualmente después.
   *
   * Las filas marcadas como pendingReview NO se importan automáticamente:
   * la IA no está segura del precio/stock y el usuario debe confirmarlas
   * manualmente antes de crearlas en el inventario activo.
   */
  async function handleImport() {
    if (!canImport) return;

    setScreen("importing");

    let success = 0;
    const failed: string[] = [];
    const pending: string[] = [];

    const existingNames = new Set(
      (await container.inventoryEngine.get().listAll()).map((p) => p.name.trim().toLowerCase())
    );

    for (const row of rows) {
      const name = row.name.trim();
      const price = parseMoneyInput(row.price);

      if (row.pendingReview) {
        pending.push(name);
        continue;
      }

      if (!name || !price || price <= 0 || !row.categoryId) {
        if (name) failed.push(name);
        continue;
      }

      if (existingNames.has(name.toLowerCase())) {
        failed.push(`${name} (ya existe)`);
        continue;
      }

      const input = buildProductInputFromImportRow(row, batchTax);
      const ok = await createProduct(input);

      if (ok) {
        success++;
        existingNames.add(name.toLowerCase());
      } else {
        failed.push(name);
      }
    }

    setResult({ success, failed: [...failed, ...pending] });
    setScreen("done");
  }

  function handleCloseAndReset() {
    aiImportStore.clear();
    setPreview(null);
    setRows([]);
    setResult(null);
    setScreen("capture");
    onClose();
  }

  // Plantilla de columnas de la tabla de revisión — un solo lugar para
  // header y filas, así si el negocio agrega otra columna (ya avisó que
  // viene una más) solo hay que tocar esta línea y el ancho del modal de
  // abajo, no cada fila una por una. El wrapper con scroll horizontal
  // (REVIEW_TABLE_MIN_WIDTH) evita que las últimas columnas —el switch
  // "Cocina" y el botón de eliminar fila— se corten en pantallas angostas
  // en vez de simplemente achicarse hasta desaparecer.
  const REVIEW_GRID_COLS = "grid-cols-[minmax(140px,1fr)_86px_124px_64px_54px_58px_54px_34px]";
  const REVIEW_TABLE_MIN_WIDTH = "min-w-[670px]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className={`w-full ${
          screen === "review" ? "max-w-4xl" : "max-w-lg"
        } max-h-[90vh] overflow-y-auto rounded-vimdy-lg border border-vimdy-ai/30 bg-vimdy-surface p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-vimdy-ai" />
            <h2 className="text-xl font-bold text-vimdy-text">Importar menú con IA</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-vimdy-text-secondary hover:text-vimdy-text">
            <X size={20} />
          </button>
        </div>

        {screen === "capture" && (
          <>
            <p className="text-vimdy-text-secondary text-sm mb-5">
              Toma o sube una foto de tu menú. La IA leerá los nombres y precios para que
              solo tengas que revisarlos.
            </p>

            <div className="rounded-vimdy-md border border-dashed border-vimdy-border bg-vimdy-surface p-5 mb-5">
              {preview ? (
                <img src={preview} alt="Menú" className="w-full max-h-56 object-contain rounded-vimdy-sm mb-3" />
              ) : (
                <div className="w-full h-32 rounded-vimdy-sm bg-vimdy-surface flex items-center justify-center mb-3">
                  <Camera size={28} className="text-vimdy-text-tertiary" />
                </div>
              )}

              <div className="flex gap-2 flex-wrap justify-center">
                <label className="h-9 px-3 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary text-sm hover:bg-vimdy-surface cursor-pointer flex items-center gap-2">
                  <ImagePlus size={14} />
                  {preview ? "Elegir otra imagen" : "Seleccionar imagen"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={processing}
                    onChange={handleFile}
                  />
                </label>
                <label className="h-9 px-3 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary text-sm hover:bg-vimdy-surface cursor-pointer flex items-center gap-2">
                  <Camera size={14} />
                  Tomar foto
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    disabled={processing}
                    onChange={handleFile}
                  />
                </label>
              </div>
              {processing && <p className="text-vimdy-text-tertiary text-xs text-center mt-2">Procesando imagen...</p>}
              {error && <p className="text-vimdy-danger text-xs text-center mt-2">{error}</p>}
            </div>

            <div className="flex items-center justify-between gap-1 mb-6 overflow-x-auto">
              {steps.map((s, i) => (
                <React.Fragment key={s.label}>
                  <div className="flex flex-col items-center gap-1 shrink-0 w-16">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center border ${
                        i === 0 && preview
                          ? "bg-vimdy-ai/20 border-vimdy-ai/50 text-vimdy-ai"
                          : "border-vimdy-border text-vimdy-text-tertiary bg-vimdy-surface"
                      }`}
                    >
                      {s.icon}
                    </div>
                    <p className="text-xs text-vimdy-text-tertiary text-center leading-tight">{s.label}</p>
                  </div>
                  {i < steps.length - 1 && <div className="h-px flex-1 bg-vimdy-surface-hover -mt-4" />}
                </React.Fragment>
              ))}
            </div>

            <button
              onClick={handleContinue}
              disabled={!preview || processing}
              className="w-full h-11 rounded-vimdy-md bg-vimdy-ai text-vimdy-background font-bold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-vimdy-ai-hover"
            >
              Continuar
            </button>
          </>
        )}

        {screen === "reading" && (
          <div className="py-14 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-vimdy-lg bg-vimdy-ai/15 border border-vimdy-ai/30 flex items-center justify-center mb-4 animate-pulse">
              <Sparkles size={26} className="text-vimdy-ai" />
            </div>
            <p className="text-vimdy-text font-semibold mb-1">{READING_MESSAGES[readingPhase]}</p>
            <p className="text-vimdy-text-secondary text-sm max-w-xs mb-5">
              VIMDY está viendo tu menú como lo vería una persona: ignorando decoración y
              quedándose solo con productos reales.
            </p>
            <div className="w-full max-w-xs h-1.5 rounded-full bg-vimdy-surface overflow-hidden">
              <div
                className="h-full bg-vimdy-ai rounded-full transition-all duration-500 ease-out"
                style={{ width: `${((readingPhase + 1) / READING_MESSAGES.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {screen === "review" && (
          <>
            <p className="text-vimdy-text-secondary text-sm mb-4">
              {rows.length > 0
                ? "Esto fue lo que la IA reconoció. Revisa y corrige antes de importar."
                : "No reconocimos productos automáticamente. Agrégalos a mano abajo."}
            </p>

            {readError && (
              <div className="mb-4 rounded-vimdy-md border border-vimdy-warning/40 bg-vimdy-warning/10 text-vimdy-warning text-sm px-3 py-2">
                {readError}
              </div>
            )}

            <div className="rounded-vimdy-md border border-vimdy-border mb-3 overflow-x-auto">
              <div className={REVIEW_TABLE_MIN_WIDTH}>
                <div className={`grid ${REVIEW_GRID_COLS} gap-2 divide-x divide-slate-700/70 bg-vimdy-surface text-vimdy-text-secondary text-xs font-medium px-3 py-2`}>
                  <span>Producto</span>
                  <span className="pl-2">Precio</span>
                  <span className="pl-2">Categoría</span>
                  <span className="pl-2">Estado</span>
                  <span className="pl-2">Cocina</span>
                  <span className="pl-2 text-center">Stock</span>
                  <span className="pl-2 text-center">IVA</span>
                  <span></span>
                </div>
                {rows.length === 0 ? (
                  <p className="text-vimdy-text-tertiary text-sm text-center py-6">Todavía no hay filas.</p>
                ) : (
                  rows.map((row) => (
                    <React.Fragment key={row.id}>
                    <div
                      className={`grid ${REVIEW_GRID_COLS} gap-2 items-center px-3 py-2 border-t border-vimdy-border ${
                        row.pendingReview ? "bg-vimdy-warning/5" : ""
                      }`}
                    >
                    <input
                      value={row.name}
                      onChange={(e) => updateRow(row.id, "name", e.target.value)}
                      placeholder="Nombre del producto"
                      className={`h-9 px-2 rounded-vimdy-sm bg-vimdy-surface border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-ai ${
                        row.requiresReview || row.pendingReview ? "border-vimdy-warning/50" : "border-vimdy-border"
                      }`}
                    />
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-vimdy-text-tertiary text-sm">
                        $
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.price}
                        onChange={(e) => {
                          const newPrice = e.target.value;
                          updateRow(row.id, "price", newPrice);
                          if (row.pendingReview && parseMoneyInput(newPrice) > 0 && row.categoryId) {
                            updateRow(row.id, "pendingReview", false);
                          }
                        }}
                        placeholder="0"
                        className={`w-full h-9 pl-5 pr-2 rounded-vimdy-sm bg-vimdy-surface border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-ai ${
                          row.requiresReview || row.pendingReview ? "border-vimdy-warning/50" : "border-vimdy-border"
                        }`}
                      />
                    </div>
                     <select
                       value={row.categoryId}
                       onChange={(e) => {
                         updateRow(row.id, "categoryId", e.target.value);
                         if (row.pendingReview && e.target.value) {
                           updateRow(row.id, "pendingReview", false);
                         }
                       }}
                       title={
                         row.categoryId
                           ? undefined
                           : "La IA no pudo sugerir categoría para este producto — elígela a mano."
                       }
                       className={`h-9 px-2 rounded-vimdy-sm bg-vimdy-surface border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-ai ${
                         row.categoryId ? "border-vimdy-border" : "border-vimdy-warning/50"
                       }`}
                     >
                      <option value="">Sin clasificar</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {(row.pendingReview || row.requiresReview) ? (
                      <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-vimdy-warning/10 border border-vimdy-warning/40 text-vimdy-warning text-[11px] font-semibold w-fit">
                        {row.pendingReview ? "Pendiente" : "Revisar"}
                        {row.pendingReview && (
                          <button
                            type="button"
                            onClick={() => updateRow(row.id, "pendingReview", false)}
                            title="Marcar como revisado"
                            className="ml-1 text-vimdy-warning hover:text-vimdy-text"
                          >
                            ✓
                          </button>
                        )}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-vimdy-success/10 border border-vimdy-success/30 text-vimdy-success text-[11px] font-semibold w-fit">
                        OK
                      </span>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.requiresKitchen}
                      onClick={() => toggleRowKitchen(row.id)}
                      title={
                        row.requiresKitchen
                          ? "Este producto sí manda comanda a cocina. Click para desactivar."
                          : "Este producto no manda comanda a cocina. Click para activar."
                      }
                      className={`relative h-6 w-11 rounded-full border transition-colors shrink-0 ${
                        row.requiresKitchen
                          ? "bg-vimdy-ai border-vimdy-ai"
                          : "bg-vimdy-surface-hover border-vimdy-border"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                          row.requiresKitchen ? "translate-x-[22px]" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                    {row.requiresKitchen ? (
                      // Paso 2.6: con Cocina activada, el stock no se carga a
                      // mano — sale de los ingredientes. Este botón abre el
                      // panel de receta de esta fila en vez de mostrar un
                      // input de stock. Icono + contador (no texto largo)
                      // para que quepa en la columna angosta sin empujar el
                      // botón de eliminar fuera de la vista.
                      <button
                        type="button"
                        onClick={() => toggleRecipePanel(row.id)}
                        aria-label={
                          row.recipeRows.filter((ing) => ing.productId).length > 0
                            ? `${row.recipeRows.filter((ing) => ing.productId).length} ingrediente(s) definidos — click para editar`
                            : "Definir de qué ingredientes sale este producto"
                        }
                        title={
                          row.recipeRows.filter((ing) => ing.productId).length > 0
                            ? `${row.recipeRows.filter((ing) => ing.productId).length} ingrediente(s) definidos — click para editar`
                            : "Definir de qué ingredientes sale este producto"
                        }
                        className={`relative h-9 w-full rounded-vimdy-sm border flex items-center justify-center ${
                          openRecipeRowId === row.id
                            ? "border-vimdy-recipe bg-vimdy-recipe/10 text-vimdy-recipe"
                            : "border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface"
                        }`}
                      >
                        <ChefHat size={15} />
                        {row.recipeRows.filter((ing) => ing.productId).length > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-vimdy-recipe text-vimdy-text text-[10px] font-bold flex items-center justify-center">
                            {row.recipeRows.filter((ing) => ing.productId).length}
                          </span>
                        )}
                      </button>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        value={row.stock}
                        onChange={(e) => updateRow(row.id, "stock", e.target.value)}
                        placeholder="0"
                        title="Stock inicial de este producto"
                        className="w-full h-9 px-1.5 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm text-center focus:outline-none focus:border-vimdy-ai"
                      />
                    )}
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={row.taxRate}
                      onChange={(e) => updateRow(row.id, "taxRate", e.target.value)}
                      placeholder={batchTax.trim() || "0"}
                      title={
                        row.taxRate.trim()
                          ? "IVA % de este producto en particular"
                          : `Sin IVA propio: usa el % general (${batchTax.trim() || "0"}%). Escribe uno acá para que este producto sea distinto.`
                      }
                      className="w-full h-9 px-1 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm text-center focus:outline-none focus:border-vimdy-ai"
                    />
                    <button
                      onClick={() => removeRow(row.id)}
                      aria-label="Quitar fila"
                            title="Quitar fila"
                      className="w-9 h-9 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-danger hover:border-vimdy-danger/30 flex items-center justify-center shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Paso 2.6: panel de ingredientes de esta fila, solo visible
                      cuando Cocina está activada Y el negocio lo abrió con el
                      botón "Ingredientes" de arriba. Mismo patrón que la
                      receta de ProductFormModal, pero anidado por fila. */}
                  {row.requiresKitchen && openRecipeRowId === row.id && (
                    <div className="px-3 py-3 border-t border-vimdy-border bg-vimdy-background/60 space-y-2">
                      <p className="text-vimdy-text-secondary text-xs mb-1">
                        ¿De qué ingredientes sale <span className="text-vimdy-text">{row.name || "este producto"}</span>? Al venderlo se descontará el stock de cada ingrediente, no el de este producto.
                      </p>
                      {row.recipeRows.map((ing) => (
                        <div key={ing.rowId} className="flex items-center gap-2">
                          <select
                            value={ing.productId}
                            onChange={(e) => updateIngredientRow(row.id, ing.rowId, "productId", e.target.value)}
                            className="flex-1 h-9 px-2 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-recipe"
                          >
                            <option value="">Selecciona un ingrediente...</option>
                            {allProducts.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                           <input
                             type="number"
                             min={0}
                             step="0.01"
                             value={ing.quantity}
                             onChange={(e) => updateIngredientRow(row.id, ing.rowId, "quantity", e.target.value)}
                             onKeyDown={(e) => {
                               if (["e", "E", "+", "-"].includes(e.key)) {
                                 e.preventDefault();
                               }
                             }}
                             inputMode="decimal"
                             placeholder="Cant."
                             className="w-20 h-9 px-2 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-recipe"
                           />
                          <button
                            type="button"
                            onClick={() => removeIngredientRow(row.id, ing.rowId)}
                            aria-label="Quitar ingrediente"
                            title="Quitar ingrediente"
                            className="w-9 h-9 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-danger hover:border-vimdy-danger/30 flex items-center justify-center shrink-0"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addIngredientRow(row.id)}
                        className="h-8 px-3 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary text-xs hover:bg-vimdy-surface flex items-center gap-1"
                      >
                        <Plus size={12} />
                        Agregar ingrediente
                      </button>
                      {allProducts.length === 0 && (
                        <p className="text-vimdy-warning text-[11px]">
                          Todavía no tienes otros productos en Inventario para usar como ingredientes.
                        </p>
                      )}
                    </div>
                  )}
                  </React.Fragment>
                ))
              )}
              </div>
            </div>

            <VimdyButton
              onClick={addRow}
              variant="secondary"
              size="sm"
              icon={<Plus size={14} />}
              className="mb-5"
            >
              Agregar fila
            </VimdyButton>

            {/* Paso 2.4: la categoría ya no es un dato único para todo el
                lote — cada fila manda la suya (columna "Categoría" de la
                tabla de arriba). Acá solo queda un aviso si falta elegir
                alguna, y un atajo para crear una categoría nueva si al
                negocio le falta alguna en la lista. */}
            {rowsMissingCategory > 0 && (
              <div className="mb-4 rounded-vimdy-md border border-vimdy-warning/40 bg-vimdy-warning/10 text-vimdy-warning text-sm px-3 py-2">
                {rowsMissingCategory} producto(s) sin categoría todavía: elígela en la columna
                "Categoría" de cada fila para poder importarlos.
              </div>
            )}

            <div className="rounded-vimdy-md border border-vimdy-border bg-vimdy-surface p-4 mb-6 space-y-3">
              <p className="text-vimdy-text font-semibold text-sm">Antes de importar</p>

              <div>
                <label className="block text-vimdy-text-secondary text-xs font-medium mb-1">
                  ¿Falta una categoría en la lista? Créala acá
                </label>
                <div className="flex gap-2">
                  <input
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="Ej: Bebidas"
                    className="flex-1 h-9 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-ai"
                  />
                  <button
                    type="button"
                    disabled={creatingCategory}
                    onClick={handleCreateCategory}
                    className="px-3 h-9 rounded-vimdy-sm bg-vimdy-ai text-vimdy-background text-sm font-semibold hover:bg-vimdy-ai-hover disabled:opacity-50 shrink-0"
                  >
                    {creatingCategory ? "Creando..." : "Crear"}
                  </button>
                </div>
                <label className="flex items-center gap-2 text-vimdy-text-secondary text-xs mt-2">
                  <input
                    type="checkbox"
                    checked={newCategoryRequiresKitchen}
                    onChange={(e) => setNewCategoryRequiresKitchen(e.target.checked)}
                    className="rounded border-vimdy-border bg-vimdy-surface accent-vimdy-ai"
                  />
                  Los productos de esta categoría requieren cocina por defecto
                </label>
                <p className="text-vimdy-text-tertiary text-[11px] mt-1">
                  Queda disponible al instante en el selector de cada fila.
                </p>
                {categoryError && <p className="text-vimdy-danger text-xs mt-1">{categoryError}</p>}
              </div>

              <div>
                <label className="block text-vimdy-text-secondary text-xs font-medium mb-1">
                  IVA % por defecto (aplica a todos)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={batchTax}
                  onChange={(e) => setBatchTax(e.target.value)}
                  placeholder="Ej: 19"
                  className="w-full h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-ai"
                />
                <p className="text-vimdy-text-tertiary text-[11px] mt-1">
                  Se aplica a todos los productos. Si uno necesita un IVA distinto (o sin
                  IVA), escríbeselo directo en su propia columna "IVA" de la fila —
                  eso manda por encima de este valor general. El stock inicial también
                  se define fila por fila arriba: en la columna "Stock" para los que no
                  van a Cocina, y con el botón "Ingredientes" para los que sí.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <VimdyButton
                onClick={handleRetake}
                variant="secondary"
                fullWidth
              >
                Elegir otra foto
              </VimdyButton>
              <button
                onClick={handleImport}
                disabled={!canImport}
                title={validRowsCount === 0 ? "Agrega al menos un producto con nombre, precio y categoría" : undefined}
                className="flex-1 h-11 rounded-vimdy-md bg-vimdy-ai text-vimdy-background font-bold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-vimdy-ai-hover"
              >
                Importar {validRowsCount > 0 ? `${validRowsCount} ` : ""}productos
                {pendingRowsCount > 0 && (
                  <span className="text-xs opacity-80">({pendingRowsCount} pendientes)</span>
                )}
              </button>
            </div>
            {pendingRowsCount > 0 && (
              <p className="text-vimdy-warning text-xs text-center">
                Los productos pendientes no se importan automáticamente. Corrígelos en la tabla para aprobarlos.
              </p>
            )}
            <VimdyButton
              onClick={handleCloseAndReset}
              variant="ghost"
              size="sm"
              fullWidth
              className="mt-2 text-vimdy-text-tertiary hover:text-vimdy-text-secondary"
            >
              Cerrar sin importar
            </VimdyButton>
          </>
        )}

        {screen === "importing" && (
          <div className="py-14 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-vimdy-lg bg-vimdy-ai/15 border border-vimdy-ai/30 flex items-center justify-center mb-4 animate-pulse">
              <Plus size={26} className="text-vimdy-ai" />
            </div>
            <p className="text-vimdy-text font-semibold mb-1">Creando productos...</p>
            <p className="text-vimdy-text-secondary text-sm max-w-xs">
              Estamos guardando cada producto en tu inventario. No cierres esta ventana.
            </p>
          </div>
        )}

        {screen === "done" && result && (
          <div className="py-6 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-vimdy-lg bg-vimdy-success/15 border border-vimdy-success/30 flex items-center justify-center mb-4">
              <Package size={26} className="text-vimdy-success" />
            </div>
            <p className="text-vimdy-text font-bold text-lg mb-1">
              {result.success} producto{result.success === 1 ? "" : "s"} importado
              {result.success === 1 ? "" : "s"}
            </p>
            <p className="text-vimdy-text-secondary text-sm mb-4">
              Ya aparecen en Inventario y en Caja.
            </p>

            {result.failed.length > 0 && (
              <div className="w-full rounded-vimdy-md border border-vimdy-warning/40 bg-vimdy-warning/10 text-left px-4 py-3 mb-4">
                <p className="text-vimdy-warning text-sm font-semibold mb-1">
                  {result.failed.length} producto{result.failed.length === 1 ? "" : "s"} no se
                  {result.failed.length === 1 ? " pudo" : " pudieron"} importar:
                </p>
                <ul className="text-vimdy-warning/80 text-xs space-y-0.5">
                  {result.failed.map((name, i) => (
                    <li key={i}>• {name}</li>
                  ))}
                </ul>
                <p className="text-vimdy-warning/60 text-xs mt-2">
                  Los productos pendientes requieren que revises el precio o la categoría en la tabla antes de importarlos.
                </p>
              </div>
            )}

            <button
              onClick={handleCloseAndReset}
              className="w-full h-11 rounded-vimdy-md bg-vimdy-accent text-vimdy-background font-bold hover:bg-vimdy-accent-hover"
            >
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}