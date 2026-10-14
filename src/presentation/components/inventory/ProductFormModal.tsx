import React, { useMemo, useState } from "react";
import { toast } from "../../../core/store/toastStore";
import { VimdyButton } from "../ui/VimdyButton";
import { parseMoneyInput } from "../../../core/utils/parseMoneyInput";
import { compatibleUnits, convertQuantity, normalizeUnit } from "../../../core/utils/unitConversion";
import { X, Plus, ImagePlus, Trash2, Sparkles, ChefHat, Flame, Clock3, UserPlus } from "lucide-react";
import { generateRecipeWithAI } from "../../../core/ia/RecipeAI";
import { Product, Category, Supplier, RecipeItem, ProductSizeOption, ProductExtraOption } from "../../../core/entities/Entities";
import { ProductInput } from "../../../core/engines/InventoryEngine";
import { ProductType, inferProductType, resolveProductFlags } from "../../../core/types/productType";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { fileToProductImage } from "../../utils/imageUtils";
import { ProductionIntelligencePanel } from "./ProductionIntelligencePanel";
import { parseDecimalInput } from "./importHelpers";
import { UNIT_OPTIONS } from "./inventoryShared";
import { CategoryStationEditor } from "./InventoryWidgets";

/**
 * Formulario completo de "Nuevo producto" (Parte 1).
 * Nombre, Categoría y Precio de venta son obligatorios (InventoryEngine
 * los valida). El resto son opcionales y solo se envían si el negocio
 * los llena. Ya no depende de seedProducts (eliminado en la Parte 2).
 */
/**
 * Formulario completo de producto (Parte 1 + Parte 3).
 * Se usa tanto para crear como para editar: si recibe `product`, precarga
 * sus datos y llama a InventoryEngine.updateProduct (vía onSave); si no,
 * crea uno nuevo. Nombre, Categoría y Precio de venta son obligatorios.
 * El Stock inicial solo se pide al crear: InventoryEngine.updateProduct
 * no toca el stock a propósito (para eso están Aumentar/Disminuir stock).
 */
export function ProductFormModal({
  product,
  onClose,
  onSave,
  onBuyIngredient,
  onViewKardex
}: {
  product?: Product;
  onClose: () => void;
  onSave: (input: ProductInput) => Promise<boolean>;
  /** PASO 2.3 (Producción Inteligente): abre el detalle del ingrediente limitante para reponer stock. */
  onBuyIngredient?: (ingredientId: string) => void;
  /** PASO 2.3 (Producción Inteligente): abre el Kardex (ProductDetailModal) de este producto. */
  onViewKardex?: (product: Product) => void;
}) {
  const isEditing = !!product;
  const recipeSectionRef = React.useRef<HTMLDivElement>(null);

  // Wizard corto: paso 1 = datos básicos, paso 2 = tipo/precios, paso 3 = receta, paso 4 = extras
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);

  // PASO 1 (rediseño formulario de producto): el campo más importante, va
  // arriba de todo. Los pasos siguientes lo usarán para decidir qué otras
  // secciones del formulario se muestran u ocultan.
  const [productType, setProductType] = useState<ProductType>(() => {
    if (product?.isIngredient) return "ingrediente";
    return inferProductType(product);
  });

  const [name, setName] = useState(product?.name ?? "");
  // PASO 2 (rediseño formulario de producto — Información General): campos
  // que SIEMPRE se muestran, sin importar el tipo de producto.
  const [description, setDescription] = useState(product?.description ?? "");
  const [active, setActive] = useState<boolean>(product?.active ?? true);
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [purchasePrice, setPurchasePrice] = useState(
    product?.purchasePrice !== undefined ? String(product.purchasePrice) : ""
  );
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [taxRate, setTaxRate] = useState(product?.taxRate !== undefined ? String(product.taxRate) : "");
  const [stock, setStock] = useState("");
  const [minStock, setMinStock] = useState(product ? String(product.minStock) : "0");
  const [unit, setUnit] = useState(product?.unit ?? "unidad");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [supplierId, setSupplierId] = useState(product?.supplierId ?? "");
  const [alternateSupplierId, setAlternateSupplierId] = useState(product?.alternateSupplierId ?? "");
  const [image, setImage] = useState<string | undefined>(product?.image);
  const [imageError, setImageError] = useState<string | null>(null);
  const [processingImage, setProcessingImage] = useState(false);

  // Base de todo el enrutamiento a cocina (ver Product.requiresKitchen):
  // si un producto nuevo no dice lo contrario, se asume que SÍ necesita
  // preparación — mismo default seguro que usa InventoryEngine.
  const [requiresKitchen, setRequiresKitchen] = useState<boolean>(
    product?.requiresKitchen ?? false
  );
  const [estimatedPrepMinutes, setEstimatedPrepMinutes] = useState(
    product?.estimatedPrepMinutes ? String(product.estimatedPrepMinutes) : ""
  );
  const [printStationOverride, setPrintStationOverride] = useState(product?.printStationOverride ?? "");

  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryRequiresKitchen, setNewCategoryRequiresKitchen] = useState(true);
  const [newCategoryPrintStation, setNewCategoryPrintStation] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [showNewSupplierModal, setShowNewSupplierModal] = useState(false);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [showQuickIngredient, setShowQuickIngredient] = useState(false);
  const [quickIngredientName, setQuickIngredientName] = useState("");
  const [quickIngredientPurchasePrice, setQuickIngredientPurchasePrice] = useState("");
  const [quickIngredientUnit, setQuickIngredientUnit] = useState("unidad");
  const [creatingIngredient, setCreatingIngredient] = useState(false);
  // stock, se descuenta cada ingrediente (ver InventoryEngine.consumeForSale).
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [hasRecipe, setHasRecipe] = useState<boolean>(!!product?.recipe && product.recipe.length > 0);
  // BLOQUEANTE (auditoría Fase 2 — Panadería): ver Product.productionMode.
  // 'ON_DEMAND' (default) = se prepara al vender, como una Hamburguesa.
  // 'BATCH' = se produce con anticipación en tandas, como el Pan.
  const [productionMode, setProductionMode] = useState<"ON_DEMAND" | "BATCH">(
    product?.productionMode ?? "ON_DEMAND"
  );
  const [recipeRows, setRecipeRows] = useState<
    { rowId: string; productId: string; quantity: string; optional: boolean; unit: string }[]
  >(
    product?.recipe?.map((r) => ({
      rowId: crypto.randomUUID(),
      productId: r.productId,
      quantity: String(r.entryQuantity ?? r.quantity),
      optional: r.optional ?? false,
      // "" = la unidad del propio ingrediente.
      unit: r.entryUnit ?? ""
    })) ?? []
  );

  // PASO 9 (rediseño formulario de producto — Opciones): Tamaños y Extras
  // configurables. Mismo patrón que recipeRows: filas editables que se
  // "aplanan" a ProductSizeOption[]/ProductExtraOption[] al guardar.
  const [sizeRows, setSizeRows] = useState<{ rowId: string; name: string; priceDelta: string }[]>(
    product?.sizes?.map((s) => ({ rowId: crypto.randomUUID(), name: s.name, priceDelta: String(s.priceDelta) })) ??
      []
  );
  const [extraRows, setExtraRows] = useState<{ rowId: string; name: string; priceDelta: string }[]>(
    product?.extras?.map((x) => ({ rowId: crypto.randomUUID(), name: x.name, priceDelta: String(x.priceDelta) })) ??
      []
  );

  function addSizeRow() {
    setSizeRows((prev) => [...prev, { rowId: crypto.randomUUID(), name: "", priceDelta: "0" }]);
  }
  function updateSizeRow(rowId: string, field: "name" | "priceDelta", value: string) {
    setSizeRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r)));
  }
  function removeSizeRow(rowId: string) {
    setSizeRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  function addExtraRow() {
    setExtraRows((prev) => [...prev, { rowId: crypto.randomUUID(), name: "", priceDelta: "0" }]);
  }
  function updateExtraRow(rowId: string, field: "name" | "priceDelta", value: string) {
    setExtraRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r)));
  }
  function removeExtraRow(rowId: string) {
    setExtraRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  // ✨ Generar receta con IA: el usuario escribe/confirma el nombre del
  // plato y Claude propone ingredientes (solo del inventario real, ver
  // RecipeAI.ts), categoría y precio sugerido.
  const [showRecipeAiPrompt, setShowRecipeAiPrompt] = useState(false);

  // Wizard corto de producto: paso 1 = nombre + categoría + precio (obligatorio),
  // pasos 2-4 son opcionales (tipo, receta, variantes).
  const [productWizardStep, setProductWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [recipeAiDishName, setRecipeAiDishName] = useState("");
  const [generatingRecipe, setGeneratingRecipe] = useState(false);
  const [recipeAiError, setRecipeAiError] = useState<string | null>(null);

  // PASO 1 (rediseño formulario de producto): al cambiar el tipo, sincroniza
  // los flags reales que ya usa el resto del formulario y del motor de ventas
  // (requiresKitchen, hasRecipe), para que el nuevo campo no rompa nada de lo
  // que ya funciona mientras se implementan los pasos siguientes.
  function handleProductTypeChange(type: ProductType) {
    setProductType(type);
    switch (type) {
      case "cocina":
        setRequiresKitchen(true);
        setHasRecipe(false);
        setProductionMode("ON_DEMAND");
        break;
      case "cocina_receta":
        setRequiresKitchen(true);
        setHasRecipe(true);
        break;
      case "servicio":
        setRequiresKitchen(false);
        setHasRecipe(false);
        setProductionMode("ON_DEMAND");
        break;
      case "ingrediente":
        setRequiresKitchen(false);
        setHasRecipe(false);
        setProductionMode("ON_DEMAND");
        break;
      case "inventario":
      default:
        setRequiresKitchen(false);
        setHasRecipe(false);
        setProductionMode("ON_DEMAND");
        break;
    }
  }

  // FASE 1: sincronizar el selector de tipo con la receta. Si el usuario
  // activa "Producto con receta", el tipo debe pasar a cocina_receta.
  // Si la desactiva, volver a cocina o inventario según corresponda.
  React.useEffect(() => {
    if (hasRecipe && productType !== "cocina_receta") {
      setProductType("cocina_receta");
    } else if (!hasRecipe && productType === "cocina_receta") {
      setProductType(requiresKitchen ? "cocina" : "inventario");
    }
  }, [hasRecipe, productType, requiresKitchen]);

  function addRecipeRow() {
    setRecipeRows((prev) => [
      ...prev,
      { rowId: crypto.randomUUID(), productId: "", quantity: "1", optional: false, unit: "" }
    ]);
  }

  function removeRecipeRow(rowId: string) {
    setRecipeRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  function updateRecipeRow(rowId: string, field: "productId" | "quantity" | "unit", value: string) {
    setRecipeRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        // Al cambiar de ingrediente la unidad vuelve a la del nuevo ingrediente.
        if (field === "productId") return { ...r, productId: value, unit: "" };
        return { ...r, [field]: value };
      })
    );
  }

  /**
   * Cantidad de la fila ya convertida a la unidad en la que se guarda el
   * ingrediente (la que descuenta el stock y usa el costo). null si la
   * cantidad no es válida o la unidad elegida no es compatible.
   */
  function resolveRecipeRowQuantity(row: { productId: string; quantity: string; unit: string }): number | null {
    const typed = parseDecimalInput(row.quantity);
    if (!Number.isFinite(typed) || typed <= 0) return null;
    const ingredient = allProducts.find((p) => p.id === row.productId);
    return convertQuantity(typed, row.unit || ingredient?.unit, ingredient?.unit);
  }

  function toggleRecipeRowOptional(rowId: string) {
    setRecipeRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, optional: !r.optional } : r))
    );
  }

  // Ingredientes disponibles: solo productos marcados como ingrediente
  // (no se mezclan productos de venta directa ni servicios).
  const ingredientOptions = useMemo(
    () => allProducts.filter((p) => p.id !== product?.id && p.isIngredient === true),
    [allProducts, product]
  );

  async function handleGenerateRecipeAI() {
    const dishName = recipeAiDishName.trim() || name.trim();

    if (!dishName) {
      setRecipeAiError("Escribe el nombre del plato primero.");
      return;
    }

    setGeneratingRecipe(true);
    setRecipeAiError(null);

    try {
      const result = await generateRecipeWithAI(dishName, ingredientOptions, categories);

      if (result.ingredients.length === 0) {
        setRecipeAiError(
          result.unmatchedIngredients.length > 0
            ? `La IA sugirió ${result.unmatchedIngredients.join(", ")}, pero ninguno existe todavía en tu inventario. Créalos primero en Inventario y vuelve a intentar.`
            : "La IA no pudo proponer ingredientes para ese plato. Intenta con un nombre más específico."
        );
        return;
      }

      setHasRecipe(true);
      setRecipeRows(
        result.ingredients.map((ing) => ({
          rowId: crypto.randomUUID(),
          productId: ing.productId,
          quantity: String(ing.quantity),
          optional: false,
          unit: ""
        }))
      );

      // Solo se autocompletan categoría y precio si el usuario todavía no
      // los había definido — la IA nunca pisa un dato que el usuario ya
      // escribió a mano.
      if (result.category && !categoryId) {
        const matched = categories.find((c) => c.name === result.category);
        if (matched) setCategoryId(matched.id);
      }
      if (result.suggestedPrice && !price.trim()) {
        setPrice(String(result.suggestedPrice));
      }

      if (result.unmatchedIngredients.length > 0) {
        toast.warning(
          `Receta generada. La IA también sugirió ${result.unmatchedIngredients.join(", ")}, pero no existen todavía en tu inventario — créalos si quieres agregarlos.`,
          7000
        );
      } else {
        toast.success("Receta generada con IA. Revisa las cantidades antes de guardar.");
      }

      setShowRecipeAiPrompt(false);
    } catch (e: any) {
      setRecipeAiError(
        e?.message?.startsWith("RECIPE_AI_UNAVAILABLE")
          ? "No se pudo generar la receta en este momento. Intenta de nuevo."
          : "No se pudo generar la receta. Intenta de nuevo."
      );
    } finally {
      setGeneratingRecipe(false);
    }
  }

  // PASO 2 (Motor de Producción): mientras se arma la receta, se recalcula
  // en vivo con RecipeEngine (mismo motor que usa el resto de VIMDY) sobre
  // un producto "borrador" con las filas actuales — sin necesidad de
  // guardar primero. Así el usuario ve el costo/ganancia real antes de
  // confirmar.
  const recipeSummary = useMemo(() => {
    if (!hasRecipe) return null;

    const draftRecipe: RecipeItem[] = [];
    for (const r of recipeRows) {
      if (!r.productId || !r.quantity.trim()) continue;
      const converted = resolveRecipeRowQuantity(r);
      if (converted === null || converted <= 0) continue;
      draftRecipe.push({ productId: r.productId, quantity: converted });
    }
    if (draftRecipe.length === 0) return null;
    const productMap = new Map(allProducts.map((p) => [p.id, p]));

    const draftProduct: Product = {
      id: product?.id ?? "__draft__",
      name: name.trim() || "Este producto",
      categoryId: categoryId || "",
      price: parseMoneyInput(price) || 0,
      stock: 0,
      minStock: minStock.trim() ? Number(minStock) : 0,
      lastUpdated: new Date(),
      recipe: draftRecipe
    };

    const cost = container.recipeEngine.get().getRecipeCost(draftProduct, productMap);
    const profitability = container.recipeEngine.get().getProfitability(draftProduct, productMap);
    const capacity = container.recipeEngine.get().getProductionCapacity(draftProduct, productMap);

    return cost && profitability && capacity ? { cost, profitability, capacity } : null;
  }, [hasRecipe, recipeRows, allProducts, price, product?.id, name, categoryId, minStock]);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  React.useEffect(() => {
    Promise.all([
      container.categoryEngine.get().listAll(),
      container.supplierEngine.get().listAll(),
      container.inventoryEngine.get().listAll()
    ])
      .then(([cats, provs, prods]) => {
        setCategories(cats);
        setSuppliers(provs);
        setAllProducts(prods);
        if (!categoryId) {
          setCategoryId(cats.length > 0 ? cats[0].id : "__nueva__");
        }
      })
      .finally(() => setLoadingOptions(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        requiresKitchenByDefault: newCategoryRequiresKitchen,
        printStation: newCategoryPrintStation.trim() || undefined
      });
      setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryId(created.id);
      setNewCategoryName("");
      setNewCategoryRequiresKitchen(true);
      setNewCategoryPrintStation("");
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

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImageError(null);
    setProcessingImage(true);

    try {
      const dataUrl = await fileToProductImage(file);
      setImage(dataUrl);
    } catch (err: any) {
      setImageError(err?.message ?? "No se pudo procesar la imagen.");
    } finally {
      setProcessingImage(false);
    }
  }

  async function handleSave() {
    const priceValue = parseMoneyInput(price);
    const purchasePriceValue = purchasePrice.trim() ? parseMoneyInput(purchasePrice) : undefined;
    const taxRateValue = taxRate.trim() ? Number(taxRate) : undefined;
    const stockValue = isEditing ? product!.stock : stock.trim() ? Number(stock) : 0;
    const minStockValue = minStock.trim() ? Number(minStock) : 0;
    const estimatedPrepMinutesValue =
      requiresKitchen && estimatedPrepMinutes.trim() ? Number(estimatedPrepMinutes) : undefined;

    if (!name.trim()) {
      setFormError("El nombre del producto es obligatorio.");
      return;
    }

    if (!categoryId || categoryId === "__nueva__") {
      setFormError("Selecciona o crea una categoría.");
      return;
    }

    if (!price.trim() || isNaN(priceValue) || priceValue < 0) {
      setFormError("El precio de venta no es válido.");
      return;
    }

    if (
      estimatedPrepMinutes.trim() &&
      (isNaN(estimatedPrepMinutesValue as number) || (estimatedPrepMinutesValue as number) <= 0)
    ) {
      setFormError("El tiempo estimado de preparación debe ser un número mayor a 0.");
      return;
    }

    let recipeValue: RecipeItem[] | undefined;
    if (hasRecipe) {
      const validRows = recipeRows.filter((r) => r.productId && r.quantity.trim());

      if (validRows.length === 0) {
        setFormError("Agrega al menos un ingrediente a la receta, o desactiva \"Producto con receta\".");
        return;
      }

      const parsedRows: RecipeItem[] = [];
      for (const row of validRows) {
        const typed = parseDecimalInput(row.quantity);
        if (!Number.isFinite(typed) || typed <= 0) {
          setFormError("Cada ingrediente de la receta necesita una cantidad válida mayor a 0.");
          return;
        }
        const ingredient = allProducts.find((p) => p.id === row.productId);
        const converted = convertQuantity(typed, row.unit || ingredient?.unit, ingredient?.unit);
        if (converted === null || converted <= 0) {
          setFormError(
            `La unidad elegida para "${ingredient?.name ?? "un ingrediente"}" no se puede convertir a ${normalizeUnit(ingredient?.unit)}. Elige una unidad de la misma clase (peso con peso, líquido con líquido).`
          );
          return;
        }
        const item: RecipeItem = { productId: row.productId, quantity: converted, optional: row.optional };
        // Se recuerda lo que escribió la persona solo cuando eligió otra unidad.
        parsedRows.push(
          row.unit && normalizeUnit(row.unit) !== normalizeUnit(ingredient?.unit)
            ? { ...item, entryQuantity: typed, entryUnit: row.unit }
            : item
        );
      }
      recipeValue = parsedRows;
    } else if (isEditing && product?.recipe && product.recipe.length > 0) {
      // El producto tenía receta y el usuario la desactivó: se envía un
      // array vacío para que updateProduct la borre explícitamente.
      recipeValue = [];
    }

    // PASO 9 (Opciones): filas vacías (sin nombre) se ignoran en silencio en
    // vez de bloquear el guardado -- es común dejar una fila a medio llenar
    // mientras se arma la lista. Solo se valida lo que sí tiene nombre.
    const sizesValue: ProductSizeOption[] = [];
    for (const row of sizeRows) {
      if (!row.name.trim()) continue;
      const delta = row.priceDelta.trim() ? parseMoneyInput(row.priceDelta) : 0;
      if (isNaN(delta)) {
        setFormError(`El precio del tamaño "${row.name.trim()}" no es válido.`);
        return;
      }
      sizesValue.push({ id: crypto.randomUUID(), name: row.name.trim(), priceDelta: delta });
    }

    const extrasValue: ProductExtraOption[] = [];
    for (const row of extraRows) {
      if (!row.name.trim()) continue;
      const delta = row.priceDelta.trim() ? parseMoneyInput(row.priceDelta) : 0;
      if (isNaN(delta)) {
        setFormError(`El precio del extra "${row.name.trim()}" no es válido.`);
        return;
      }
      extrasValue.push({ id: crypto.randomUUID(), name: row.name.trim(), priceDelta: delta });
    }

    setFormError(null);
    setSaving(true);

    const ok = await onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      active,
      categoryId,
      price: priceValue,
      purchasePrice: purchasePriceValue,
      taxRate: taxRateValue,
      stock: stockValue,
      minStock: minStockValue,
      unit,
      barcode: barcode.trim() || undefined,
      sku: sku.trim() || undefined,
      supplierId: supplierId || undefined,
      alternateSupplierId: alternateSupplierId || undefined,
      image,
      recipe: recipeValue,
      productionMode: hasRecipe ? productionMode : undefined,
      requiresKitchen,
      estimatedPrepMinutes: estimatedPrepMinutesValue,
      printStationOverride: printStationOverride.trim() || undefined,
      sizes: sizesValue,
      extras: extrasValue,
      // FASE 1 (arreglo cocina_receta ON_DEMAND): los flags persistidos
      // salen de resolveProductFlags(), la ÚNICA fuente de verdad que es
      // inversa exacta de inferProductType(). Así el estado guardado es
      // ESTABLE y al recargar/editar el tipo se recupera idéntico.
      //
      // Reglas (ver core/types/productType.ts):
      //  - inventario:     trackStock=true,  requiresKitchen=false
      //  - ingrediente:    trackStock=true,  requiresKitchen=false
      //  - cocina:         trackStock=false, requiresKitchen=true
      //  - cocina_receta:  requiresKitchen=true; trackStock=false si
      //                    ON_DEMAND (consume ingredientes directo), true
      //                    si BATCH (maneja stock propio de tandas).
      //  - servicio:       trackStock=false, requiresKitchen=false
      trackStock: resolveProductFlags(productType, productionMode).trackStock,
      isIngredient: productType === "ingrediente"
    });

    setSaving(false);

    if (ok) {
      onClose();
    } else {
      setFormError(
        isEditing
          ? "No se pudo guardar los cambios. Intenta de nuevo."
          : "No se pudo guardar el producto. Intenta de nuevo."
      );
    }
  }

  async function handleCreateQuickIngredient(name: string) {
    const purchasePrice = quickIngredientPurchasePrice.trim() ? parseMoneyInput(quickIngredientPurchasePrice) : undefined;
    setCreatingIngredient(true);
    try {
      const created = await container.inventoryEngine.get().createProduct({
        name,
        categoryId: categoryId || categories[0]?.id || "",
        price: 0,
        purchasePrice,
        stock: 0,
        minStock: 0,
        unit: quickIngredientUnit,
        isIngredient: true,
        active: true
      });
      setAllProducts((prev) => [...prev, created]);

      const emptyRow = recipeRows.find((r) => !r.productId);
      if (emptyRow) {
        setRecipeRows((prev) =>
          prev.map((r) => (r.rowId === emptyRow.rowId ? { ...r, productId: created.id, quantity: "1", unit: "" } : r))
        );
      } else {
        const newRowId = crypto.randomUUID();
        setRecipeRows((prev) => [...prev, { rowId: newRowId, productId: created.id, quantity: "1", optional: false, unit: "" }]);
      }

      setShowQuickIngredient(false);
      setQuickIngredientName("");
      setQuickIngredientPurchasePrice("");
      setQuickIngredientUnit("unidad");
      toast.success(`Ingrediente "${name}" creado.`);
    } catch {
      toast.error("No se pudo crear el ingrediente.");
    } finally {
      setCreatingIngredient(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <h2 className="text-xl font-bold text-vimdy-text">
            {isEditing ? "Editar producto" : "Nuevo producto"}
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-vimdy-text-secondary hover:text-vimdy-text">
            <X size={20} />
          </button>
        </div>

        {formError && (
          <div className="mb-4 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-3 py-2">
            {formError}
          </div>
        )}

        <div className="space-y-4">
          {/* PASO 1 (rediseño formulario de producto): Tipo de producto, el campo más
              importante, va arriba de todo. Decide qué otras secciones se muestran
              (eso se implementa en los pasos siguientes). */}
          <div>
            <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Tipo de producto *</label>
            <select
              value={productType}
              onChange={(e) => handleProductTypeChange(e.target.value as ProductType)}
              className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
            >
              <option value="inventario">Producto para vender</option>
              <option value="ingrediente">Ingrediente</option>
              <option value="cocina">Producto preparado</option>
              <option value="cocina_receta">Producto preparado con receta</option>
              <option value="servicio">Servicio</option>
            </select>
            <p className="text-vimdy-text-tertiary text-xs mt-1">
              {productType === "inventario" &&
                "Se vende y descuenta directo del stock. Ej: gaseosa, cerveza, snack empacado."}
              {productType === "ingrediente" &&
                "Existencias usadas para preparar otros productos. No aparece en Caja por defecto. Ej: carne, harina, tomate."}
              {productType === "cocina" &&
                "Se prepara en cocina al venderlo; no maneja stock propio ni receta fija. Ej: plato del día, caldo de costilla."}
              {productType === "cocina_receta" &&
                "Se prepara en cocina y descuenta los ingredientes de su receta. Ej: hamburguesa, pizza."}
              {productType === "servicio" &&
                "No maneja stock ni preparación en cocina. Ej: domicilio, propina, cover."}
            </p>
          </div>

          {/* Imagen */}
          <div>
            <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Imagen</label>
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface flex items-center justify-center overflow-hidden shrink-0">
                {image ? (
                  <img src={image} alt="Vista previa" className="w-full h-full object-cover" />
                ) : (
                  <ImagePlus size={22} className="text-vimdy-text-tertiary" />
                )}
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex gap-2 flex-wrap">
                  <label className="h-9 px-3 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary text-sm hover:bg-vimdy-surface cursor-pointer flex items-center gap-2">
                    <ImagePlus size={14} />
                    {processingImage ? "Procesando..." : "Subir imagen"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={processingImage}
                      onChange={handleImageChange}
                    />
                  </label>
                  <label className="h-9 px-3 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary text-sm hover:bg-vimdy-surface cursor-pointer flex items-center gap-2">
                    Tomar foto
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      disabled={processingImage}
                      onChange={handleImageChange}
                    />
                  </label>
                  {image && (
                    <VimdyButton
                      type="button"
                      onClick={() => setImage(undefined)}
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={14} />}
                    >
                      Quitar
                    </VimdyButton>
                  )}
                </div>
                {imageError && <p className="text-vimdy-danger text-xs">{imageError}</p>}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Nombre *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Hamburguesa Premium"
              className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
            />
          </div>

          {/* PASO 2 (Información General): Descripción, siempre visible, opcional. */}
          <div>
            <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
              Descripción <span className="text-vimdy-text-tertiary font-normal">(opcional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Carne 150g, queso cheddar, lechuga, tomate y salsa especial"
              rows={2}
              className="w-full px-3 py-2 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Categoría *</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={loadingOptions}
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="__nueva__">+ Nueva categoría...</option>
              </select>

              {categoryId === "__nueva__" && (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="Ej: Bebidas"
                      className="flex-1 h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                    />
                    <VimdyButton
                      type="button"
                      loading={creatingCategory}
                      onClick={handleCreateCategory}
                      variant="secondary"
                      className="shrink-0"
                    >
                      Crear
                    </VimdyButton>
                  </div>
                  <label className="flex items-center gap-2 text-vimdy-text-secondary text-xs">
                    <input
                      type="checkbox"
                      checked={newCategoryRequiresKitchen}
                      onChange={(e) => setNewCategoryRequiresKitchen(e.target.checked)}
                      className="rounded border-vimdy-border bg-vimdy-surface accent-cyan-500"
                    />
                    Los productos de esta categoría requieren cocina por defecto
                  </label>
                  <div>
                    <label className="block text-vimdy-text-secondary text-xs mb-1">
                      Estación de impresión <span className="text-vimdy-text-tertiary">(opcional, ej: Barra, Pastelería)</span>
                    </label>
                    <input
                      value={newCategoryPrintStation}
                      onChange={(e) => setNewCategoryPrintStation(e.target.value)}
                      placeholder="Ej: Cocina"
                      className="w-full h-9 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-xs placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                    />
                  </div>
                </div>
              )}
              {categoryId && categoryId !== "__nueva__" && (
                <CategoryStationEditor
                  key={categoryId}
                  category={categories.find((c) => c.id === categoryId)}
                  onUpdated={(updated) =>
                    setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
                  }
                />
              )}
              {categoryError && <p className="text-vimdy-danger text-xs mt-1">{categoryError}</p>}
            </div>

            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Unidad</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">{`Precio de compra (por cada ${normalizeUnit(unit)})`}</label>
              <input
                type="text"
                inputMode="decimal"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="Ej: 8000"
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
            </div>

            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Precio de venta *</label>
              <input
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Ej: 15000"
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
            </div>

            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">IVA (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                placeholder="Ej: 19"
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
            </div>
          </div>

          {/* PASO 2 (Información General): Estado, siempre visible. Es un
              interruptor manual (independiente del stock) para que el
              negocio pueda marcar "Agotado" al instante -- ej. se acabó
              el ingrediente clave de un plato -- sin tener que tocar
              stock ni categoría. */}
          <div>
            <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Estado</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setActive(true)}
                aria-pressed={active}
                className={`flex-1 h-11 rounded-vimdy-md border text-sm font-medium transition-colors ${
                  active
                    ? "border-vimdy-success/60 bg-vimdy-success/10 text-vimdy-success"
                    : "border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface"
                }`}
              >
                🟢 Disponible
              </button>
              <button
                type="button"
                onClick={() => setActive(false)}
                aria-pressed={!active}
                className={`flex-1 h-11 rounded-vimdy-md border text-sm font-medium transition-colors ${
                  !active
                    ? "border-vimdy-danger/60 bg-vimdy-danger/10 text-vimdy-danger"
                    : "border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface"
                }`}
              >
                🔴 Agotado
              </button>
            </div>
            {!active && (
              <p className="text-vimdy-text-tertiary text-xs mt-1">
                Mientras esté "Agotado" no aparece en Caja para vender, sin importar el stock.
              </p>
            )}
          </div>

          {/* PASO 3 (rediseño formulario de producto): Stock inicial y Stock
              mínimo solo tienen sentido para productos de tipo "Inventario"
              -- un producto de Cocina se prepara al venderse (no se
              descuenta stock propio) y un Servicio tampoco tiene unidades
              físicas que contar.
              BLOQUEANTE (auditoría Fase 2 — Panadería): excepción — un
              producto "cocina_receta" en modo BATCH (ej. Pan) sí tiene
              stock propio real, así que también necesita estos campos. */}
          {productType === "inventario" || (productType === "cocina_receta" && productionMode === "BATCH") ? (
            <>
              <div className={`grid grid-cols-1 ${isEditing ? "" : "sm:grid-cols-2"} gap-4`}>
                {!isEditing && (
                  <div>
                    <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Stock inicial</label>
                    <input
                      type="number"
                      min={0}
                      value={stock}
                      onChange={(e) => setStock(e.target.value)}
                      placeholder="Ej: 20"
                      className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                    />
                    {(!stock.trim() || Number(stock) === 0) && (
                      <p className="text-vimdy-warning text-xs mt-1">
                        Con 0 unidades el producto se va a ver como "Agotado" en Inventario y en Caja.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Stock mínimo</label>
                  <input
                    type="number"
                    min={0}
                    value={minStock}
                    onChange={(e) => setMinStock(e.target.value)}
                    className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
                  />
                </div>
              </div>

              {isEditing && (
                <p className="text-vimdy-text-tertiary text-xs -mt-2">
                  El stock actual ({product!.stock}) se cambia desde "Aumentar stock" / "Disminuir stock", no aquí.
                </p>
              )}
            </>
          ) : (
            <p className="text-vimdy-text-tertiary text-xs -mt-1">
              {productType === "servicio"
                ? "Los productos de tipo Servicio no manejan stock."
                : "Los productos de Cocina se preparan al venderse: no manejan stock propio."}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Código de barras</label>
              <input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Ej: 7701234567890"
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
            </div>

            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">SKU</label>
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Ej: HAM-001"
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Proveedor principal</label>
              <div className="flex gap-2">
                <select
                  value={supplierId}
                  onChange={(e) => {
                    setSupplierId(e.target.value);
                    if (e.target.value && e.target.value === alternateSupplierId) {
                      setAlternateSupplierId("");
                    }
                  }}
                  disabled={loadingOptions}
                  className="flex-1 h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
                >
                  <option value="">Sin proveedor</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowNewSupplierModal(true)}
                  className="h-11 px-3 rounded-vimdy-md bg-vimdy-accent/10 border border-vimdy-border text-vimdy-accent hover:bg-vimdy-accent/20 transition"
                  title="Nuevo proveedor"
                >
                  <UserPlus size={18} />
                </button>
              </div>
            </div>
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
                Proveedor alternativo
                <span className="text-vimdy-text-tertiary font-normal"> (opcional)</span>
              </label>
              <select
                value={alternateSupplierId}
                onChange={(e) => setAlternateSupplierId(e.target.value)}
                disabled={loadingOptions}
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
              >
                <option value="">Sin proveedor alternativo</option>
                {suppliers
                  .filter((s) => s.id !== supplierId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="rounded-vimdy-md border border-vimdy-border bg-vimdy-background/60 p-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={requiresKitchen}
                onChange={(e) => setRequiresKitchen(e.target.checked)}
                className="w-4 h-4 rounded border-vimdy-border bg-vimdy-surface accent-orange-500"
              />
              <span className="flex items-center gap-1.5 text-vimdy-text text-sm font-medium">
                <Flame size={15} className="text-vimdy-warning" />
                Este producto necesita preparación en cocina
              </span>
            </label>
            <p className="text-vimdy-text-tertiary text-xs mt-1">
              {requiresKitchen
                ? "Al venderlo, se enviará una comanda a Cocina (ej. una hamburguesa, un plato)."
                : "Al venderlo, NO se enviará comanda a Cocina: se cobra y se entrega directo (ej. una gaseosa embotellada, un paquete, una playera)."}
            </p>

            {requiresKitchen && (
              <div className="mt-3">
                <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
                  <span className="flex items-center gap-1.5">
                    <Clock3 size={14} className="text-vimdy-accent" />
                    Tiempo estimado de preparación
                    <span className="text-vimdy-text-tertiary font-normal"> (opcional)</span>
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={estimatedPrepMinutes}
                    onChange={(e) => setEstimatedPrepMinutes(e.target.value)}
                    placeholder="Ej: 15"
                    className="w-32 h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
                  />
                  <span className="text-vimdy-text-secondary text-sm">minutos</span>
                </div>
                <p className="text-vimdy-text-tertiary text-xs mt-1">
                  Sirve para que Cocina se organice y para mostrarle un tiempo estimado al
                  mesero/cliente. Si lo dejas vacío, no se muestra ningún tiempo.
                </p>

                <div className="mt-3">
                  <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
                    Estación (si es distinta a la de su categoría)
                    <span className="text-vimdy-text-tertiary font-normal"> (opcional)</span>
                  </label>
                  <input
                    type="text"
                    value={printStationOverride}
                    onChange={(e) => setPrintStationOverride(e.target.value)}
                    placeholder="Hereda la estación de su categoría"
                    className="w-full h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                  />
                  <p className="text-vimdy-text-tertiary text-xs mt-1">
                    Casi ningún producto necesita esto: la mayoría hereda la estación de su
                    categoría (arriba). Úsalo solo para una excepción puntual.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* PASO 4 (rediseño formulario de producto): "usa ingredientes" ya
              existía como "Este producto es elaborado (receta/BOM)" -- es el
              mismo interruptor que pide el plan. Solo aplica a productos de
              Cocina: un producto de Inventario o Servicio no tiene BOM. Si
              está desmarcado, la lista de ingredientes permanece oculta
              (eso ya lo hacía `{hasRecipe && (...)}` más abajo). */}
          {(productType === "cocina" || productType === "cocina_receta") && (
          <div ref={recipeSectionRef} className="rounded-vimdy-md border border-vimdy-border bg-vimdy-background/60 p-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hasRecipe}
                onChange={(e) => {
                  setHasRecipe(e.target.checked);
                  if (e.target.checked && recipeRows.length === 0) {
                    addRecipeRow();
                  }
                }}
                className="w-4 h-4 rounded border-vimdy-border bg-vimdy-surface accent-vimdy-recipe"
              />
              <span className="flex items-center gap-1.5 text-vimdy-text text-sm font-medium">
                <ChefHat size={15} className="text-vimdy-recipe" />
                Este producto es elaborado (tiene receta / BOM)
              </span>
            </label>
            <p className="text-vimdy-text-tertiary text-xs mt-1 mb-3">
              Al vender este producto NO se descontará su propio stock: se descontará el de
              cada ingrediente, en la cantidad indicada.
            </p>

            {hasRecipe && (
              <div className="mb-4 rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface p-3">
                <label className="block text-vimdy-text-secondary text-xs font-medium mb-2">
                  ¿Cómo se prepara?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setProductionMode("ON_DEMAND")}
                    aria-pressed={productionMode === "ON_DEMAND"}
                    className={`h-11 px-3 rounded-vimdy-sm border text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                      productionMode === "ON_DEMAND"
                        ? "border-vimdy-recipe bg-vimdy-recipe/15 text-vimdy-recipe"
                        : "border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text"
                    }`}
                  >
                    <ChefHat size={15} />
                    A la orden
                  </button>
                  <button
                    type="button"
                    onClick={() => setProductionMode("BATCH")}
                    aria-pressed={productionMode === "BATCH"}
                    className={`h-11 px-3 rounded-vimdy-sm border text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                      productionMode === "BATCH"
                        ? "border-vimdy-warning bg-vimdy-warning/15 text-vimdy-warning"
                        : "border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text"
                    }`}
                  >
                    <Flame size={15} />
                    Por tanda
                  </button>
                </div>
                <p className="text-vimdy-text-tertiary text-xs mt-2">
                  {productionMode === "ON_DEMAND" ? (
                    <>Se prepara en el momento de la venta (ej. una hamburguesa). Cada venta descuenta directo los ingredientes.</>
                  ) : (
                    <>Se produce con anticipación, en tandas (ej. hornear pan en la mañana). Vas a poder registrar producciones desde el botón "Producir tanda" en Inventario — cada venta descuenta unidades ya producidas, no los ingredientes de nuevo.</>
                  )}
                </p>
              </div>
            )}

            <div className="mb-3">
              {!showRecipeAiPrompt ? (
                <button
                  type="button"
                  onClick={() => {
                    setRecipeAiDishName(name.trim());
                    setRecipeAiError(null);
                    setShowRecipeAiPrompt(true);
                  }}
                  className="h-9 px-3 rounded-vimdy-sm border border-vimdy-recipe/40 bg-vimdy-recipe/10 text-vimdy-recipe text-sm font-medium hover:bg-vimdy-recipe/20 flex items-center gap-2"
                >
                  <Sparkles size={14} />
                  Generar receta con IA
                </button>
              ) : (
                <div className="rounded-vimdy-sm border border-vimdy-recipe/30 bg-vimdy-recipe/5 p-3 space-y-2">
                  <label className="text-vimdy-text-secondary text-xs font-medium flex items-center gap-1.5">
                    <Sparkles size={13} className="text-vimdy-recipe" />
                    ¿Qué plato quieres que la IA proponga?
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={recipeAiDishName}
                      onChange={(e) => setRecipeAiDishName(e.target.value)}
                      placeholder="Ej: Hamburguesa doble con tocineta"
                      disabled={generatingRecipe}
                      className="flex-1 h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-recipe disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={handleGenerateRecipeAI}
                      disabled={generatingRecipe}
                      className="h-10 px-4 rounded-vimdy-sm bg-vimdy-recipe text-vimdy-text text-sm font-semibold hover:bg-vimdy-recipe-hover disabled:opacity-60 flex items-center gap-2 shrink-0"
                    >
                      {generatingRecipe ? "Generando..." : "Generar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowRecipeAiPrompt(false);
                        setRecipeAiError(null);
                      }}
                      disabled={generatingRecipe}
                      aria-label="Cancelar sugerencia de receta con IA"
                      className="h-10 w-10 shrink-0 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text flex items-center justify-center disabled:opacity-60"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <p className="text-vimdy-text-tertiary text-xs">
                    Solo usa ingredientes que ya existen en tu inventario. Si sugiere algo que no
                    tienes todavía, te avisa aparte — nunca lo inventa como si ya existiera.
                  </p>
                  {recipeAiError && <p className="text-vimdy-danger text-xs">{recipeAiError}</p>}
                </div>
              )}
            </div>

            {hasRecipe && (
              <div className="space-y-2">
                {recipeRows.map((row) => {
                  const selectedIngredient = allProducts.find((p) => p.id === row.productId);
                  return (
                    <div key={row.rowId} className="flex items-center gap-2">
                      <div className="flex-1 flex gap-2">
                        <select
                          value={row.productId}
                          onChange={(e) => updateRecipeRow(row.rowId, "productId", e.target.value)}
                          className="flex-1 h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-recipe"
                        >
                          <option value="">Selecciona un ingrediente...</option>
                          {ingredientOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} {p.unit ? `(${p.unit})` : ""}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setShowQuickIngredient(true)}
                          className="h-10 px-3 rounded-vimdy-sm bg-vimdy-recipe/10 border border-vimdy-border text-vimdy-recipe hover:bg-vimdy-recipe/20 transition text-xs font-medium whitespace-nowrap"
                          title="Crear nuevo ingrediente"
                        >
                          + Nuevo
                        </button>
                      </div>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.quantity}
                        onChange={(e) => updateRecipeRow(row.rowId, "quantity", e.target.value)}
                        onKeyDown={(e) => {
                          if (["e", "E", "+", "-"].includes(e.key)) {
                            e.preventDefault();
                          }
                        }}
                        inputMode="decimal"
                        placeholder="Cant."
                        className="w-24 h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-recipe"
                      />
                      {selectedIngredient && (
                        <select
                          value={row.unit || normalizeUnit(selectedIngredient.unit)}
                          onChange={(e) => updateRecipeRow(row.rowId, "unit", e.target.value)}
                          disabled={compatibleUnits(selectedIngredient.unit).length <= 1}
                          aria-label="Unidad de la cantidad"
                          className="w-24 h-10 px-2 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-recipe disabled:opacity-70"
                        >
                          {compatibleUnits(selectedIngredient.unit).map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      )}
                      <label
                        title="El cliente puede pedirlo sin este ingrediente, o agregarlo aparte."
                        className="flex items-center gap-1.5 h-10 px-2.5 shrink-0 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary text-xs cursor-pointer hover:bg-vimdy-surface"
                      >
                        <input
                          type="checkbox"
                          checked={row.optional}
                          onChange={() => toggleRecipeRowOptional(row.rowId)}
                          className="w-3.5 h-3.5 rounded border-vimdy-border bg-vimdy-surface accent-vimdy-recipe"
                        />
                        Opcional
                      </label>
                      <button
                        type="button"
                        onClick={() => removeRecipeRow(row.rowId)}
                        aria-label="Quitar ingrediente"
                        className="h-10 w-10 shrink-0 rounded-vimdy-sm border border-vimdy-danger/30 text-vimdy-danger hover:bg-vimdy-danger/10 flex items-center justify-center"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}

                <VimdyButton
                  type="button"
                  onClick={addRecipeRow}
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                >
                  Agregar ingrediente
                </VimdyButton>

                {showQuickIngredient && (
                  <div className="flex items-center gap-2 p-3 rounded-vimdy-sm bg-vimdy-recipe/5 border border-vimdy-recipe/20">
                    <input
                      autoFocus
                      value={quickIngredientName}
                      onChange={(e) => setQuickIngredientName(e.target.value)}
                      placeholder="Nombre del ingrediente (ej: Leche, Harina...)"
                      className="flex-1 h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-recipe"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const trimmed = quickIngredientName.trim();
                          if (!trimmed) return;
                          handleCreateQuickIngredient(trimmed);
                        }
                        if (e.key === "Escape") {
                          setShowQuickIngredient(false);
                          setQuickIngredientName("");
                          setQuickIngredientPurchasePrice("");
                        }
                      }}
                     />
                     <select
                       value={quickIngredientUnit}
                       onChange={(e) => setQuickIngredientUnit(e.target.value)}
                       className="h-10 px-2 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-recipe"
                     >
                       <option value="unidad">Unidad</option>
                       <option value="kg">kg</option>
                       <option value="g">g</option>
                       <option value="lt">lt</option>
                       <option value="ml">ml</option>
                       <option value="lb">lb</option>
                       <option value="paquete">Paquete</option>
                       <option value="caja">Caja</option>
                     </select>
                     <input
                       type="text"
                       inputMode="decimal"
                       value={quickIngredientPurchasePrice}
                      onChange={(e) => setQuickIngredientPurchasePrice(e.target.value)}
                      placeholder="Precio compra (opcional)"
                      min={0}
                      step="0.01"
                      className="w-36 h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-recipe"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const trimmed = quickIngredientName.trim();
                        if (!trimmed) return;
                        await handleCreateQuickIngredient(trimmed);
                      }}
                      disabled={creatingIngredient || !quickIngredientName.trim()}
                      className="h-10 px-4 rounded-vimdy-sm bg-vimdy-recipe text-white hover:bg-vimdy-recipe/90 disabled:opacity-40 transition text-sm font-medium whitespace-nowrap"
                    >
                      {creatingIngredient ? "Creando..." : "Crear y agregar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowQuickIngredient(false);
                        setQuickIngredientName("");
                        setQuickIngredientPurchasePrice("");
                      }}
                      className="h-10 w-10 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface flex items-center justify-center"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}

                {recipeSummary && (
                  <div className="mt-2">
                    <ProductionIntelligencePanel
                      productName={name.trim() || "unidades"}
                      cost={recipeSummary.cost}
                      profitability={recipeSummary.profitability}
                      capacity={recipeSummary.capacity}
                      minStock={minStock.trim() ? Number(minStock) : 0}
                      estimatedPrepMinutes={
                        requiresKitchen && estimatedPrepMinutes.trim() ? Number(estimatedPrepMinutes) : undefined
                      }
                      onViewInventory={onClose}
                      onEditRecipe={() => recipeSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      onBuyIngredients={
                        recipeSummary.capacity.limitingIngredient
                          ? () => onBuyIngredient?.(recipeSummary.capacity.limitingIngredient!.productId)
                          : undefined
                      }
                      onViewKardex={isEditing && product ? () => onViewKardex?.(product) : undefined}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {/* PASO 9 (rediseño formulario de producto — Opciones): Tamaños y
              Extras configurables. Aplica a cualquier tipo de producto (una
              gaseosa puede tener tamaños, una hamburguesa puede tener
              extras), por eso NO está gateado por `productType` como la
              sección de receta.
              IMPORTANTE: esto solo guarda el CATÁLOGO de opciones en el
              producto. El selector para que el cajero elija un tamaño/extra
              al vender (y que el precio se ajuste en el carrito) todavía no
              existe en Caja -- es una integración aparte, más grande, que
              toca PosProducts/CartEngine/el ticket de cocina. Lo dejo
              anotado para no dar a entender que ya funciona de punta a
              punta. */}
          <div className="rounded-vimdy-md border border-vimdy-border bg-vimdy-background/60 p-4 space-y-4">
            <div>
              <h3 className="text-vimdy-text text-sm font-semibold mb-1">Opciones</h3>
              <p className="text-vimdy-text-tertiary text-xs">
                Tamaños y extras que el cliente puede elegir. Ajustan el precio base del producto.
              </p>
            </div>

            {/* Tamaños */}
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-2">
                Tamaños <span className="text-vimdy-text-tertiary font-normal">(opcional, ej: Pequeño, Mediano, Grande)</span>
              </label>
              <div className="space-y-2">
                {sizeRows.map((row) => (
                  <div key={row.rowId} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateSizeRow(row.rowId, "name", e.target.value)}
                      placeholder="Ej: Grande"
                      className="flex-1 h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-vimdy-text-tertiary text-xs">+$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.priceDelta}
                        onChange={(e) => updateSizeRow(row.rowId, "priceDelta", e.target.value)}
                        placeholder="0"
                        className="w-24 h-10 px-2 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSizeRow(row.rowId)}
                      aria-label="Quitar tamaño"
                      className="h-10 w-10 shrink-0 rounded-vimdy-sm border border-vimdy-danger/30 text-vimdy-danger hover:bg-vimdy-danger/10 flex items-center justify-center"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <VimdyButton
                  type="button"
                  onClick={addSizeRow}
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                >
                  Agregar tamaño
                </VimdyButton>
              </div>
            </div>

            {/* Extras */}
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-2">
                Extras <span className="text-vimdy-text-tertiary font-normal">(opcional, ej: Queso, Tocineta, Huevo)</span>
              </label>
              <div className="space-y-2">
                {extraRows.map((row) => (
                  <div key={row.rowId} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateExtraRow(row.rowId, "name", e.target.value)}
                      placeholder="Ej: Tocineta"
                      className="flex-1 h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-vimdy-text-tertiary text-xs">+$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.priceDelta}
                        onChange={(e) => updateExtraRow(row.rowId, "priceDelta", e.target.value)}
                        placeholder="0"
                        className="w-24 h-10 px-2 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExtraRow(row.rowId)}
                      aria-label="Quitar extra"
                      className="h-10 w-10 shrink-0 rounded-vimdy-sm border border-vimdy-danger/30 text-vimdy-danger hover:bg-vimdy-danger/10 flex items-center justify-center"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <VimdyButton
                  type="button"
                  onClick={addExtraRow}
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                >
                  Agregar extra
                </VimdyButton>
              </div>
            </div>

            {(sizeRows.length > 0 || extraRows.length > 0) && (
              <p className="text-vimdy-warning/80 text-xs">
                Nota: por ahora estas opciones quedan guardadas en el producto, pero Caja todavía no
                muestra un selector para elegirlas al vender.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <VimdyButton
            loading={saving}
            onClick={handleSave}
            variant="primary"
            fullWidth
          >
            {isEditing ? "Guardar cambios" : "Guardar"}
          </VimdyButton>
          <VimdyButton
            disabled={saving}
            onClick={onClose}
            variant="secondary"
          >
            Cancelar
          </VimdyButton>
        </div>
      </div>
    </div>
  );
}