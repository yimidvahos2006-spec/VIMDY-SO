import { companyConfigStore } from "../../../core/store/companyConfigStore";
import React, { useMemo, useState } from "react";
import { toast } from "../../../core/store/toastStore";
import { confirmDialog } from "../../../core/store/confirmStore";
import { VimdyButton } from "../ui/VimdyButton";
import { parseMoneyInput } from "../../../core/utils/parseMoneyInput";
import { toMoneyInputValue } from "../../../core/utils/formatMoneyInput";
import { MoneyInput } from "../ui/MoneyInput";
import { compatibleUnits, convertQuantity, normalizeUnit } from "../../../core/utils/unitConversion";
import { X, Plus, ImagePlus, Trash2, ChefHat, Flame, Clock3, UserPlus, Sparkles } from "lucide-react";
import { Product, Category, Supplier, RecipeItem, ProductSizeOption, ProductExtraOption } from "../../../core/entities/Entities";
import { ProductInput } from "../../../core/engines/InventoryEngine";
import { ProductType, inferProductType, resolveProductFlags } from "../../../core/types/productType";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { fileToProductImage } from "../../utils/imageUtils";
import { ProductionIntelligencePanel } from "./ProductionIntelligencePanel";
import { parseDecimalInput } from "./importHelpers";
import { UNIT_OPTIONS } from "./inventoryShared";
import { CategoryStationEditor, collectKnownStations } from "./InventoryWidgets";
import { NewSupplierModal } from "./NewSupplierModal";
import { useCanUse } from "../../../hooks/useCanUse";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { discardQuickIngredients } from "./quickIngredientCleanup";
import { QuickIngredientCard, QuickIngredientPayload } from "./QuickIngredientCard";
import { vimdyCore } from "../../../core/VimdyCore";
import { filterIngredientOptions, findRecipeRowProblem, normalizeSearch, sanitizeQuantityInput } from "./recipeFormHelpers";
import { DishDraft, formatDishQuantity, planRecipeRow, storedUnitFor } from "./dishDraft";

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
const PRODUCT_TYPE_CHOICES: ReadonlyArray<{ id: ProductType; label: string; hint: string }> = [
  { id: "inventario", label: "Se compra y se vende igual", hint: "Tiene su propio stock: compras unidades y las vendes tal cual. Ej: gaseosa, agua, paquete de papas." },
  { id: "cocina", label: "Se prepara, sin receta", hint: "Va a cocina al venderlo, pero no descuenta nada del inventario. Ej: plato del día, jugo sin receta armada." },
  { id: "cocina_receta", label: "Con receta", hint: "Se prepara y descuenta solos los ingredientes de su receta. Ej: hamburguesa, pizza, tamal." },
  { id: "servicio", label: "No se controla", hint: "Sin stock ni cocina: nunca sale agotado. Ej: domicilio, propina, cover." }
];

export function ProductFormModal({
  product,
  onClose,
  onSave,
  onBuyIngredient,
  onViewKardex,
  saveError,
  aiDraft
}: {
  product?: Product;
  /**
   * VIMDY IA: borrador interpretado desde texto/voz ("Una hamburguesa a
   * $22.000 con 150g de carne..."). Solo se usa al CREAR: precarga nombre,
   * categoría, estación, precio y receta. Nada se guarda hasta que la persona
   * pulse Guardar; los insumos nuevos que la IA haga falta crear se borran
   * solos si cierra sin guardar (mismo mecanismo del "ingrediente rápido").
   */
  aiDraft?: DishDraft;
  onClose: () => void;
  onSave: (input: ProductInput) => Promise<boolean>;
  /** Último error del inventario (ej. nombre duplicado): se muestra dentro del formulario, que tapa el banner de la página. */
  saveError?: string | null;
  /** PASO 2.3 (Producción Inteligente): abre el detalle del ingrediente limitante para reponer stock. */
  onBuyIngredient?: (ingredientId: string) => void;
  /** PASO 2.3 (Producción Inteligente): abre el Kardex (ProductDetailModal) de este producto. */
  onViewKardex?: (product: Product) => void;
}) {
  const isEditing = !!product;
  const { money } = useTranslation();
  // Receta rápida: buscador de ingredientes + foco automático en la cantidad.
  const [ingredientQuery, setIngredientQuery] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const [invalidRowId, setInvalidRowId] = useState<string | null>(null);
  const ingredientSearchRef = React.useRef<HTMLInputElement>(null);
  const recipeSectionRef = React.useRef<HTMLDivElement>(null);
  // Se marca al elegir "Con receta" para llevar el cursor al buscador de ingredientes.
  const pendingRecipeFocusRef = React.useRef(false);

  // Wizard corto: paso 1 = datos básicos, paso 2 = tipo/precios, paso 3 = receta, paso 4 = extras
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);

  // PASO 1 (rediseño formulario de producto): el campo más importante, va
  // arriba de todo. Los pasos siguientes lo usarán para decidir qué otras
  // secciones del formulario se muestran u ocultan.
  // Producto nuevo: "Se prepara, sin receta" si el negocio usa Cocina; si no, "Se compra y se vende igual".
  const kitchenEnabled = useCanUse("kitchen");
  const [productType, setProductType] = useState<ProductType>(() => {
    if (!product) return kitchenEnabled ? "cocina" : "inventario";
    if (product.isIngredient) return "ingrediente";
    return inferProductType(product);
  });

  const [name, setName] = useState(product?.name ?? "");
  // PASO 2 (rediseño formulario de producto — Información General): campos
  // que SIEMPRE se muestran, sin importar el tipo de producto.
  const [description, setDescription] = useState(product?.description ?? "");
  const [active, setActive] = useState<boolean>(product?.active ?? true);
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [purchasePrice, setPurchasePrice] = useState(
    product?.purchasePrice !== undefined ? toMoneyInputValue(product.purchasePrice) : ""
  );
  const [price, setPrice] = useState(product ? toMoneyInputValue(product.price) : "");
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

  // Solo categorías de productos de venta. Las de insumos (Carnes, Verduras...)
  // viven en la pestaña Insumos y no se mezclan aquí.
  const [categories, setCategories] = useState<Category[]>([]);
  const [insumoCategories, setInsumoCategories] = useState<Category[]>([]);
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
  // Resplandor temporal del buscador de ingredientes justo al elegir "Con receta".
  const [highlightSearch, setHighlightSearch] = useState(false);
  // Consejo "ten tus insumos listos": se puede cerrar y se recuerda en este dispositivo.
  const [showRecipeTip, setShowRecipeTip] = useState<boolean>(() => {
    try {
      return localStorage.getItem("vimdy:recipe-tip-dismissed") !== "1";
    } catch {
      return true;
    }
  });
  const [quickIngredientName, setQuickIngredientName] = useState("");
  const [creatingIngredient, setCreatingIngredient] = useState(false);
  // Insumos creados con "ingrediente rápido" en esta sesión del formulario.
  // Si el producto no se guarda, se borran al cerrar para no dejar basura.
  const quickIngredientIdsRef = React.useRef<string[]>([]);
  const productSavedRef = React.useRef(false);
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

  // Wizard corto de producto: paso 1 = nombre + categoría + precio (obligatorio),
  // pasos 2-4 son opcionales (tipo, receta, variantes).
  const [productWizardStep, setProductWizardStep] = useState<1 | 2 | 3 | 4>(1);

  // PASO 1 (rediseño formulario de producto): al cambiar el tipo, sincroniza
  // los flags reales que ya usa el resto del formulario y del motor de ventas
  // (requiresKitchen, hasRecipe), para que el nuevo campo no rompa nada de lo
  // que ya funciona mientras se implementan los pasos siguientes.
  function handleProductTypeChange(type: ProductType) {
    setProductType(type);
    setFormError(null);
    switch (type) {
      case "cocina":
        setRequiresKitchen(true);
        setHasRecipe(false);
        setProductionMode("ON_DEMAND");
        break;
      case "cocina_receta":
        setRequiresKitchen(true);
        setHasRecipe(true);
        pendingRecipeFocusRef.current = true;
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

  // UX: al elegir "Con receta", los ingredientes son lo primero: la pantalla baja
  // hasta la tarjeta, el cursor queda en el buscador y este brilla un instante.
  React.useEffect(() => {
    if (!pendingRecipeFocusRef.current) return;
    if (productType !== "cocina_receta" || !hasRecipe) return;
    pendingRecipeFocusRef.current = false;
    const reduceMotion =
      typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const frame = requestAnimationFrame(() => {
      recipeSectionRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      ingredientSearchRef.current?.focus({ preventScroll: true });
    });
    setHighlightSearch(true);
    const timer = window.setTimeout(() => setHighlightSearch(false), 2400);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      setHighlightSearch(false);
    };
  }, [productType, hasRecipe]);

  function dismissRecipeTip() {
    setShowRecipeTip(false);
    try {
      localStorage.setItem("vimdy:recipe-tip-dismissed", "1");
    } catch {
      /* sin almacenamiento: solo se oculta por ahora */
    }
  }

  function addIngredientToRecipe(productId: string) {
    if (recipeRows.some((r) => r.productId === productId)) return;
    const rowId = crypto.randomUUID();
    setRecipeRows((prev) => [...prev, { rowId, productId, quantity: "", optional: false, unit: "" }]);
    setIngredientQuery("");
    setSuggestOpen(false);
    setSuggestIndex(0);
    setFocusRowId(rowId);
    setFormError(null);
  }

  function startCreateIngredient() {
    // Con texto escrito, el nombre llega listo; sin texto (botón "Crear insumo rápido"), la tarjeta abre vacía.
    const typed = ingredientQuery.trim();
    setQuickIngredientName(typed);
    setShowQuickIngredient(true);
    setIngredientQuery("");
    setSuggestOpen(false);
  }

  function copyRecipeFrom(sourceId: string) {
    const source = allProducts.find((p) => p.id === sourceId);
    if (!source?.recipe?.length) return;
    const rows = source.recipe
      .filter((r) => allProducts.some((p) => p.id === r.productId))
      .map((r) => ({
        rowId: crypto.randomUUID(),
        productId: r.productId,
        quantity: String(r.entryQuantity ?? r.quantity).replace(".", ","),
        optional: r.optional ?? false,
        unit: r.entryUnit ?? ""
      }));
    setRecipeRows(rows);
    toast.success(`Receta copiada de "${source.name}". Ajusta las cantidades.`);
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

  const usedIngredientIds = useMemo(() => new Set(recipeRows.map((r) => r.productId)), [recipeRows]);
  const ingredientSuggestions = useMemo(
    () => filterIngredientOptions(ingredientOptions, ingredientQuery, usedIngredientIds),
    [ingredientOptions, ingredientQuery, usedIngredientIds]
  );
  const canCreateIngredient =
    ingredientQuery.trim().length > 0 &&
    !ingredientOptions.some((p) => normalizeSearch(p.name) === normalizeSearch(ingredientQuery));
  const suggestionCount = ingredientSuggestions.items.length + (canCreateIngredient ? 1 : 0);
  const copyableRecipes = useMemo(
    () => allProducts.filter((p) => p.id !== product?.id && !p.isIngredient && (p.recipe?.length ?? 0) > 0),
    [allProducts, product]
  );

  React.useEffect(() => {
    if (!focusRowId) return;
    const el = document.querySelector<HTMLInputElement>(`[data-qty-row="${focusRowId}"]`);
    el?.focus();
    el?.select?.();
    setFocusRowId(null);
  }, [focusRowId]);

  function handleIngredientSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestOpen(true);
      setSuggestIndex((i) => (suggestionCount === 0 ? 0 : (i + 1) % suggestionCount));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggestIndex((i) => (suggestionCount === 0 ? 0 : (i - 1 + suggestionCount) % suggestionCount));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = ingredientSuggestions.items[Math.min(suggestIndex, suggestionCount - 1)];
      if (picked && suggestIndex < ingredientSuggestions.items.length) addIngredientToRecipe(picked.id);
      else if (canCreateIngredient) startCreateIngredient();
    } else if (e.key === "Escape") {
      setSuggestOpen(false);
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
  // Panel lateral ancho: hay espacio de sobra, así que "Más opciones" (IVA,
  // estado, tamaños y extras) arranca abierto para verlo todo de un vistazo.
  const [showMore, setShowMore] = useState(true);
  // Anima la entrada del panel deslizándolo desde la derecha.
  const [panelEntered, setPanelEntered] = useState(false);
  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => setPanelEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const [saveFailed, setSaveFailed] = useState(false);
  const errorBannerRef = React.useRef<HTMLDivElement>(null);

  // VIMDY IA: avisos para revisar después de rellenar el formulario desde texto/voz.
  const [aiNotice, setAiNotice] = useState<string[]>([]);
  const aiAppliedRef = React.useRef(false);

  /**
   * VIMDY IA: vuelca el borrador en el formulario. No guarda nada: solo
   * precarga campos y receta. Los insumos que no existen en el inventario se
   * crean como "insumos rápidos" (sin precio de compra) y quedan registrados en
   * quickIngredientIdsRef, así que si la persona cierra sin guardar se borran.
   */
  async function applyAiDraft(
    draft: DishDraft,
    sellCats: Category[],
    insumoCats: Category[],
    prods: Product[]
  ) {
    const notices: string[] = [];

    setName(draft.name);

    if (draft.price) {
      setPrice(toMoneyInputValue(draft.price));
    } else {
      notices.push("No dijiste el precio de venta: escríbelo antes de guardar.");
    }

    // Categoría: solo se elige si es una que ya existe; si no, se deja la
    // opción "+ Nueva categoría" con el nombre sugerido para que la persona decida.
    const chosenCategory = draft.categoryId ? sellCats.find((c) => c.id === draft.categoryId) : undefined;
    if (chosenCategory) {
      setCategoryId(chosenCategory.id);
    } else {
      setCategoryId("__nueva__");
      if (draft.suggestedCategory) setNewCategoryName(draft.suggestedCategory);
      if (draft.station) setNewCategoryPrintStation(draft.station);
      notices.push(
        draft.suggestedCategory
          ? `Ninguna categoría tuya encajó. Sugerencia: "${draft.suggestedCategory}". Créala con el botón "Crear" o elige otra.`
          : "Ninguna categoría tuya encajó: elige una o crea una nueva."
      );
    }

    // Estación: solo se fija en el producto si es distinta a la de su categoría.
    if (draft.station) {
      const categoryStation = chosenCategory?.printStation ?? "";
      if (normalizeSearch(draft.station) !== normalizeSearch(categoryStation)) {
        setPrintStationOverride(draft.station);
      }
    }

    if (draft.ingredients.length === 0) {
      notices.push("No mencionaste ingredientes: el producto quedó sin receta. Puedes agregarla abajo.");
      setAiNotice(notices);
      return;
    }

    // Con ingredientes, el plato es "Con receta" (se prepara y descuenta insumos).
    setProductType("cocina_receta");
    setRequiresKitchen(true);
    setHasRecipe(true);
    setProductionMode("ON_DEMAND");

    const rows: { rowId: string; productId: string; quantity: string; optional: boolean; unit: string }[] = [];
    const usedIds = new Set<string>();
    const estimated: string[] = [];
    const created: string[] = [];
    const needsQuantity: string[] = [];
    const failed: string[] = [];
    let knownProducts = prods;
    let insumoCategoryId: string | undefined = insumoCats[0]?.id;

    for (const ingredient of draft.ingredients) {
      let productId = ingredient.match?.productId;
      let productName = ingredient.match?.name ?? ingredient.name;
      let storedUnit = ingredient.match?.unit;

      if (!productId) {
        // El insumo no existe todavía: se crea (sin precio de compra) para que la receta quede completa.
        try {
          if (!insumoCategoryId) {
            try {
              const cat = await container.categoryEngine.get().create({
                name: "Insumos",
                kind: "INSUMO",
                requiresKitchenByDefault: false
              });
              setInsumoCategories((prev) => [...prev, cat]);
              insumoCategoryId = cat.id;
            } catch {
              const all = await container.categoryEngine.get().listAll();
              insumoCategoryId =
                all.find((c) => c.kind === "INSUMO")?.id ??
                all.find((c) => c.name.trim().toLowerCase() === "insumos")?.id;
            }
          }
          if (!insumoCategoryId) throw new Error("INSUMO_CATEGORY_UNAVAILABLE");

          storedUnit = storedUnitFor(ingredient.unit);
          const insumo = await container.inventoryEngine.get().createProduct(
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
            { knownProducts, deferAudit: true }
          );
          quickIngredientIdsRef.current = [...quickIngredientIdsRef.current, insumo.id];
          knownProducts = [...knownProducts, insumo];
          setAllProducts(knownProducts);
          productId = insumo.id;
          productName = insumo.name;
          created.push(insumo.name);
        } catch {
          failed.push(ingredient.name);
          continue;
        }
      }

      if (usedIds.has(productId)) {
        notices.push(`"${ingredient.name}" ya estaba en la receta como "${productName}", no se repitió.`);
        continue;
      }
      usedIds.add(productId);

      const plan = planRecipeRow(ingredient, storedUnit);
      if (plan.needsManualQuantity) {
        needsQuantity.push(`${productName} (la IA dijo ${formatDishQuantity(ingredient.quantity, ingredient.unit)})`);
      } else if (ingredient.estimated) {
        estimated.push(`${productName} ${formatDishQuantity(ingredient.quantity, ingredient.unit)}`);
      }
      rows.push({ rowId: crypto.randomUUID(), productId, quantity: plan.quantity, optional: false, unit: plan.unit });
    }

    setRecipeRows(rows);

    if (estimated.length > 0) {
      notices.push(
        `No dijiste estas cantidades y VIMDY IA propuso valores típicos. Revísalas porque descuentan inventario: ${estimated.join(", ")}.`
      );
    }
    if (needsQuantity.length > 0) {
      notices.push(`Escribe la cantidad de: ${needsQuantity.join(", ")}.`);
    }
    if (created.length > 0) {
      notices.push(
        `Insumos nuevos creados sin precio de compra: ${created.join(", ")}. Ponles su costo en Insumos para que el margen sea real.`
      );
    }
    if (failed.length > 0) {
      notices.push(`No se pudieron crear estos insumos, agrégalos a mano en la receta: ${failed.join(", ")}.`);
    }
    setAiNotice(notices);
  }

  React.useEffect(() => {
    Promise.all([
      container.categoryEngine.get().listAll(),
      container.supplierEngine.get().listAll(),
      container.inventoryEngine.get().listAll()
    ])
      .then(async ([cats, provs, prods]) => {
        const sellCats = cats.filter((c) => c.kind !== "INSUMO");
        const insumoCats = cats.filter((c) => c.kind === "INSUMO");
        setCategories(sellCats);
        setInsumoCategories(insumoCats);
        setSuppliers(provs);
        setAllProducts(prods);

        if (aiDraft && !product) {
          // En desarrollo (StrictMode) este efecto corre dos veces: el borrador se aplica una sola.
          if (aiAppliedRef.current) return;
          aiAppliedRef.current = true;
          try {
            await applyAiDraft(aiDraft, sellCats, insumoCats, prods);
          } catch (err) {
            console.error("[ProductFormModal] No se pudo aplicar el borrador de VIMDY IA", err);
            setCategoryId((current) => current || (sellCats.length > 0 ? sellCats[0].id : "__nueva__"));
            setAiNotice(["VIMDY IA no pudo rellenar todo el formulario. Revisa los campos y complétalos a mano."]);
          }
          return;
        }

        if (!categoryId) {
          setCategoryId(sellCats.length > 0 ? sellCats[0].id : "__nueva__");
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

  // Envoltorio de seguridad: si algo lanza una excepción inesperada antes de
  // llegar al guardado, el botón parecía "no hacer nada". Ahora se muestra el
  // motivo en el aviso rojo y queda registrado en la consola.
  async function handleSave() {
    try {
      await handleSaveInner();
    } catch (err: any) {
      console.error("[ProductFormModal] Error inesperado al guardar", err);
      setSaving(false);
      setFormError(`Error inesperado al guardar: ${err?.message ?? String(err)}`);
    }
  }

  async function handleSaveInner() {
    // Un ingrediente no se vende: su precio de venta es 0 y no se pide.
    const isIngredientType = productType === "ingrediente";
    const flags = resolveProductFlags(productType, productionMode);
    const showsStock =
      productType === "inventario" || isIngredientType || (productType === "cocina_receta" && productionMode === "BATCH");
    const priceValue = isIngredientType && !price.trim() ? 0 : parseMoneyInput(price);
    // "No se controla" (servicio, domicilio, propina, cover) oculta costo, IVA y
    // estado: lo que el formulario no muestra no se toca. Al editar se
    // conserva lo que el producto ya tuviera; al crear queda sin definir.
    const isServiceType = productType === "servicio";
    const purchasePriceValue = isServiceType
      ? product?.purchasePrice
      : purchasePrice.trim()
        ? parseMoneyInput(purchasePrice)
        : undefined;
    const taxRateValue = isServiceType ? product?.taxRate : taxRate.trim() ? Number(taxRate) : undefined;
    const stockValue = isEditing ? product!.stock : showsStock && stock.trim() ? Number(stock) : 0;
    const minStockValue = minStock.trim() ? Number(minStock) : 0;
    const estimatedPrepMinutesValue =
      flags.requiresKitchen && estimatedPrepMinutes.trim() ? Number(estimatedPrepMinutes) : undefined;

    if (!name.trim()) {
      setFormError("El nombre del producto es obligatorio.");
      return;
    }

    if (!categoryId || categoryId === "__nueva__") {
      setFormError("Selecciona o crea una categoría.");
      return;
    }

    if (!isIngredientType && (!price.trim() || isNaN(priceValue) || priceValue < 0)) {
      setFormError("El precio de venta no es válido.");
      return;
    }

    // Protección contra el error más común: escribir "4" queriendo decir 4.000.
    const isPesos = (companyConfigStore.get().currency || "COP").toUpperCase() === "COP";
    if (isPesos && priceValue > 0 && priceValue < 100) {
      const ok = await confirmDialog({
        title: "Revisa el precio de venta",
        message: `El precio de venta es solo $${priceValue.toLocaleString("es-CO")} pesos. ¿Seguro que es correcto?\n\nSi quisiste escribir ${(priceValue * 1000).toLocaleString("es-CO")}, toca "Corregir" y cámbialo.`,
        confirmLabel: "Sí, es correcto",
        cancelLabel: "Corregir"
      });
      if (!ok) {
        setFormError("Revisa el precio de venta: se guarda solo si confirmas que es correcto.");
        return;
      }
    }
    if (!isServiceType && isPesos && purchasePriceValue !== undefined && !isNaN(purchasePriceValue) && purchasePriceValue > 0 && purchasePriceValue < 100) {
      const okCost = await confirmDialog({
        title: "Revisa el precio de compra",
        message: `El precio de compra es solo $${purchasePriceValue.toLocaleString("es-CO")} pesos. ¿Seguro que es correcto?`,
        confirmLabel: "Sí, es correcto",
        cancelLabel: "Corregir"
      });
      if (!okCost) {
        setFormError("Revisa el costo: se guarda solo si confirmas que es correcto.");
        return;
      }
    }

    if (
      estimatedPrepMinutes.trim() &&
      (isNaN(estimatedPrepMinutesValue as number) || (estimatedPrepMinutesValue as number) <= 0)
    ) {
      setFormError("El tiempo estimado de preparación debe ser un número mayor a 0.");
      return;
    }

    // Aviso antes de guardar: un producto "Se compra y se vende igual" con 0
    // unidades queda "Agotado". Es el error más común cuando el dueño en
    // realidad prepara el plato (ej. un tamal) y eligió esta opción.
    if (!isEditing && productType === "inventario" && stockValue === 0) {
      const okEmptyStock = await confirmDialog({
        title: "Producto con 0 unidades",
        message:
          `"${name.trim()}" se guardará con 0 unidades y va a salir como "Agotado".\n\n` +
          `Si lo preparas tú con ingredientes, toca "Corregir" y elige "Con receta" o "Se prepara, sin receta".\n\n` +
          `Si lo compras ya hecho, toca "Guardar así" y agrega el stock después con "Aumentar stock".`,
        confirmLabel: "Guardar así",
        cancelLabel: "Corregir"
      });
      if (!okEmptyStock) {
        setFormError(
          'Este producto tiene 0 unidades. Escribe el "Stock inicial", o cambia el tipo a "Con receta" / "Se prepara, sin receta".'
        );
        return;
      }
    }

    let recipeValue: RecipeItem[] | undefined;
    if (hasRecipe) {
      const problem = findRecipeRowProblem(
        recipeRows,
        (id) => allProducts.find((p) => p.id === id)?.name ?? "un ingrediente"
      );
      if (problem) {
        setFormError(problem.message);
        setInvalidRowId(problem.rowId ?? null);
        if (problem.rowId) setFocusRowId(problem.rowId);
        return;
      }
      setInvalidRowId(null);
      const validRows = recipeRows.filter((r) => r.productId);

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
    // Si la sección está oculta (tipo "Se compra y se vende igual" o ingrediente)
    // no se valida ni se modifica nada: se conservan las opciones que ya tuviera.
    const sizesValue: ProductSizeOption[] = showsOptionsSection ? [] : [...(product?.sizes ?? [])];
    for (const row of showsOptionsSection ? sizeRows : []) {
      if (!row.name.trim()) continue;
      const delta = row.priceDelta.trim() ? parseMoneyInput(row.priceDelta) : 0;
      if (isNaN(delta)) {
        setFormError(`El precio del tamaño "${row.name.trim()}" no es válido.`);
        return;
      }
      sizesValue.push({ id: crypto.randomUUID(), name: row.name.trim(), priceDelta: delta });
    }

    const extrasValue: ProductExtraOption[] = showsOptionsSection ? [] : [...(product?.extras ?? [])];
    for (const row of showsOptionsSection ? extraRows : []) {
      if (!row.name.trim()) continue;
      const delta = row.priceDelta.trim() ? parseMoneyInput(row.priceDelta) : 0;
      if (isNaN(delta)) {
        setFormError(`El precio del extra "${row.name.trim()}" no es válido.`);
        return;
      }
      extrasValue.push({ id: crypto.randomUUID(), name: row.name.trim(), priceDelta: delta });
    }

    setFormError(null);
    setSaveFailed(false);
    setSaving(true);

    let ok = false;
    try {
      ok = await onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      // Un servicio nuevo nunca nace "Agotado" (el selector está oculto).
      active: isServiceType && !isEditing ? true : active,
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
      requiresKitchen: flags.requiresKitchen,
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
      trackStock: flags.trackStock,
      isIngredient: productType === "ingrediente"
    });
    } catch {
      ok = false;
    } finally {
      // Sin esto, si algo lanzaba, "Guardar" se quedaba cargando para siempre.
      setSaving(false);
    }

    if (ok) {
      // Guardó: se conservan los insumos usados en alguna receta; los que se
      // creó y luego se quitaron de la receta se borran.
      productSavedRef.current = true;
      const used = new Set<string>();
      for (const r of recipeValue ?? []) used.add(r.productId);
      for (const sz of sizesValue ?? []) for (const r of sz.recipe ?? []) used.add(r.productId);
      for (const ex of extrasValue ?? []) for (const r of ex.recipe ?? []) used.add(r.productId);
      await cleanupQuickIngredients(used);
      onClose();
    } else {
      setSaveFailed(true);
    }
  }

  // Motivo real del fallo (ej. "Ya existe un producto con ese nombre") si el
  // inventario lo reportó; si no, un mensaje genérico.
  const failureMessage = saveFailed
    ? saveError ??
      (isEditing
        ? "No se pudo guardar los cambios. Intenta de nuevo."
        : "No se pudo guardar el producto. Intenta de nuevo.")
    : null;

  // El botón Guardar está abajo y el aviso arriba: al fallar, se lleva el
  // aviso a la vista para que nunca parezca que "no pasó nada".
  React.useEffect(() => {
    if (formError || saveFailed) {
      errorBannerRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }
  }, [formError, saveFailed, saveError]);

  /** Borra los insumos rápidos que no quedaron en una receta guardada (nunca lanza). */
  async function cleanupQuickIngredients(keepIds: ReadonlySet<string>) {
    const pending = quickIngredientIdsRef.current;
    quickIngredientIdsRef.current = [];
    if (pending.length === 0) return;
    const removed = await discardQuickIngredients(pending, keepIds, (id) =>
      container.inventoryEngine.get().deleteProduct(id)
    );
    if (removed > 0) vimdyCore.emit("inventory");
  }

  // Cierre sin guardar (Cancelar, X o clic afuera).
  function handleCancel() {
    void cleanupQuickIngredients(new Set());
    onClose();
  }

  // Si el formulario se desmonta por cualquier otro motivo sin haber guardado.
  const cleanupOnUnmountRef = React.useRef<() => void>(() => {});
  cleanupOnUnmountRef.current = () => {
    if (!productSavedRef.current) void cleanupQuickIngredients(new Set());
  };
  React.useEffect(() => () => cleanupOnUnmountRef.current(), []);

  async function handleCreateQuickIngredient(payload: QuickIngredientPayload) {
    const { name, purchasePrice, storedUnit, quantity, recipeUnit } = payload;
    setCreatingIngredient(true);
    try {
      // El insumo nuevo va a una categoría de INSUMOS, nunca a la del producto.
      let insumoCategoryId: string | undefined = insumoCategories[0]?.id;
      if (!insumoCategoryId) {
        try {
          const cat = await container.categoryEngine.get().create({
            name: "Insumos",
            kind: "INSUMO",
            requiresKitchenByDefault: false
          });
          setInsumoCategories((prev) => [...prev, cat]);
          insumoCategoryId = cat.id;
        } catch {
          const all = await container.categoryEngine.get().listAll();
          insumoCategoryId = all.find((c) => c.kind === "INSUMO")?.id ?? all.find((c) => c.name.trim().toLowerCase() === "insumos")?.id;
        }
      }
      if (!insumoCategoryId) {
        toast.error("No se pudo crear la categoría de insumos.");
        return;
      }
      const finalCategoryId: string = insumoCategoryId;
      const created = await container.inventoryEngine.get().createProduct({
        name,
        categoryId: finalCategoryId,
        price: 0,
        purchasePrice,
        stock: 0,
        minStock: 0,
        unit: storedUnit,
        isIngredient: true,
        active: true
      }, undefined, { knownProducts: allProducts, deferAudit: true });
      quickIngredientIdsRef.current = [...quickIngredientIdsRef.current, created.id];
      setAllProducts((prev) => [...prev, created]);

      const newRowId = crypto.randomUUID();
      // Si ya escribió la cantidad en la tarjeta, la fila nace completa (sin otro paso).
      setRecipeRows((prev) => [...prev, { rowId: newRowId, productId: created.id, quantity, optional: false, unit: recipeUnit }]);
      // Con cantidad lista, el foco vuelve al buscador para seguir con el siguiente ingrediente.
      if (quantity) ingredientSearchRef.current?.focus();
      else setFocusRowId(newRowId);

      setShowQuickIngredient(false);
      setQuickIngredientName("");
      toast.success(`"${name}" agregado a la receta. Se guardará en tus Insumos cuando guardes el producto.`);
    } catch {
      toast.error("No se pudo crear el ingrediente.");
    } finally {
      setCreatingIngredient(false);
    }
  }

  const isKitchenType = productType === "cocina" || productType === "cocina_receta";
  // "No se controla": solo Nombre, Categoría, Precio de venta y Descripción.
  const isServiceType = productType === "servicio";
  const isStockType = productType === "inventario" || productType === "ingrediente";
  const isBatchRecipe = productType === "cocina_receta" && productionMode === "BATCH";
  const showsStockFields = isStockType || isBatchRecipe;
  const showSalePrice = productType !== "ingrediente";
  // "Tamaños y extras" no aplica a productos empacados que se compran y se venden
  // igual (gaseosa, snacks) ni a ingredientes: se oculta por completo.
  const showsOptionsSection = productType !== "ingrediente" && productType !== "inventario";
  const knownStations = useMemo(() => collectKnownStations(categories, allProducts), [categories, allProducts]);
  const typeHint = PRODUCT_TYPE_CHOICES.find((t) => t.id === productType)?.hint ?? "";

  const descriptionField = (
          <div>
            <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
              Descripción <span className="text-vimdy-text-tertiary font-normal">(opcional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                productType === "inventario" || productType === "ingrediente"
                  ? "Ej: Botella 400 ml, sabor manzana"
                  : "Ej: Carne 150g, queso cheddar, lechuga, tomate y salsa especial"
              }
              rows={2}
              className="w-full px-3 py-2 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent resize-none"
            />
          </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm" onClick={handleCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? "Editar producto" : "Nuevo producto"}
        className={`w-full lg:w-[min(1100px,92vw)] h-full flex flex-col border-l border-vimdy-border bg-vimdy-surface shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${
          panelEntered ? "translate-x-0" : "translate-x-full"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 pt-5 pb-3 shrink-0">
          <h2 className="text-xl font-bold text-vimdy-text">
            {isEditing ? "Editar producto" : "Nuevo producto"}
          </h2>
          <button onClick={handleCancel} aria-label="Cerrar" className="text-vimdy-text-secondary hover:text-vimdy-text">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4">
        {aiDraft && !isEditing && (
          <div
            role="status"
            className="mb-4 rounded-vimdy-md border border-vimdy-ai/30 bg-vimdy-ai/10 px-3 py-3 text-sm text-vimdy-text"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="flex items-center gap-2 font-semibold text-vimdy-ai">
                <Sparkles size={16} />
                {loadingOptions ? "VIMDY IA está llenando el formulario…" : "VIMDY IA llenó el formulario. Revísalo y guarda."}
              </p>
              {aiNotice.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAiNotice([])}
                  aria-label="Ocultar avisos"
                  className="text-vimdy-text-tertiary hover:text-vimdy-text shrink-0"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {aiNotice.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-vimdy-text-secondary list-disc pl-5">
                {aiNotice.map((notice, i) => (
                  <li key={i}>{notice}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {(formError ?? failureMessage) && (
          <div
            ref={errorBannerRef}
            role="alert"
            className="mb-4 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-3 py-2"
          >
            {formError ?? failureMessage}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-3 items-start">
        <div className="space-y-3 min-w-0">
          {/* Tipo: decide qué campos se muestran. */}
          <div>
            <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">¿Qué vas a crear? *</label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de producto">
              {PRODUCT_TYPE_CHOICES.map((choice) => {
                const selected = productType === choice.id;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handleProductTypeChange(choice.id)}
                    className={`h-9 px-3 rounded-vimdy-md border text-sm font-medium transition-colors ${
                      selected
                        ? "border-vimdy-accent bg-vimdy-accent/10 text-vimdy-accent"
                        : "border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text hover:bg-vimdy-surface-hover"
                    }`}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>
            <p className="text-vimdy-text-tertiary text-xs mt-1.5">{typeHint}</p>
          </div>

          {/* Imagen + Nombre: siempre a la vista, justo debajo de las pestañas de tipo
              (carga rápida: foto a la izquierda, nombre y botones de foto a la derecha). */}
          <div className="flex items-start gap-3">
            <div className="w-[76px] h-[76px] rounded-vimdy-md border border-vimdy-border bg-vimdy-surface flex items-center justify-center overflow-hidden shrink-0">
              {image ? (
                <img src={image} alt="Vista previa" className="w-full h-full object-cover" />
              ) : (
                <ImagePlus size={22} className="text-vimdy-text-tertiary" />
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Nombre *</label>
                <input
                  autoFocus={!isEditing}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Hamburguesa Premium"
                  className="w-full h-10 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                />
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <label className="h-8 px-3 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary text-xs hover:bg-vimdy-surface cursor-pointer flex items-center gap-1.5">
                  <ImagePlus size={13} />
                  {processingImage ? "Procesando..." : "Subir imagen"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={processingImage}
                    onChange={handleImageChange}
                  />
                </label>
                <label className="h-8 px-3 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary text-xs hover:bg-vimdy-surface cursor-pointer flex items-center gap-1.5">
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
                  <button
                    type="button"
                    onClick={() => setImage(undefined)}
                    className="h-8 px-3 rounded-vimdy-sm border border-vimdy-danger/30 text-vimdy-danger text-xs hover:bg-vimdy-danger/10 flex items-center gap-1.5"
                  >
                    <Trash2 size={13} />
                    Quitar
                  </button>
                )}
              </div>
              {imageError && <p className="text-vimdy-danger text-xs">{imageError}</p>}
            </div>
          </div>

          {/* Categoría y precio de venta */}
          <div className={`grid grid-cols-1 ${showSalePrice ? "sm:grid-cols-2" : ""} gap-4 items-start`}>
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
                      list="vimdy-known-stations"
                      placeholder="Ej: Cocina"
                      className="w-full h-9 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-xs placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                    />
                  </div>
                </div>
              )}
              {/* La estación de impresión solo importa si el producto pasa por cocina. */}
              {isKitchenType && categoryId && categoryId !== "__nueva__" && (
                <CategoryStationEditor
                  key={categoryId}
                  category={categories.find((c) => c.id === categoryId)}
                  knownStations={knownStations}
                  onUpdated={(updated) =>
                    setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
                  }
                />
              )}
              {categoryError && <p className="text-vimdy-danger text-xs mt-1">{categoryError}</p>}
            </div>

            {showSalePrice && (
              <div>
                <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Precio de venta *</label>
                <MoneyInput
                  value={price}
                  onValueChange={setPrice}
                  placeholder="Ej: 15000"
                  className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                />
              </div>
            )}
          </div>

          {/* Costo, unidad, stock inicial / tiempo de preparación: solo lo que aplica al tipo. */}
          {!isServiceType && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
                {isStockType ? `Costo (por cada ${normalizeUnit(unit)})` : "Costo"}
                {!isStockType && <span className="text-vimdy-text-tertiary font-normal"> (opcional)</span>}
              </label>
              <MoneyInput
                value={purchasePrice}
                onValueChange={setPurchasePrice}
                placeholder="Ej: 8000"
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
            </div>

            {isStockType && (
              <div>
                <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Unidad</label>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {showsStockFields && !isEditing && (
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
              </div>
            )}

            {isKitchenType && (
              <div>
                <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
                  Minutos de preparación
                  <span className="text-vimdy-text-tertiary font-normal"> (opcional)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={estimatedPrepMinutes}
                  onChange={(e) => setEstimatedPrepMinutes(e.target.value)}
                  placeholder="Ej: 15"
                  className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                />
              </div>
            )}
          </div>
          )}

          {showsStockFields && !isEditing && (!stock.trim() || Number(stock) === 0) && (
            <p className="text-vimdy-warning text-xs -mt-2">
              Con 0 unidades el producto se va a ver como "Agotado" en Inventario y en Caja.
              {productType === "inventario" && " Si lo preparas tú, elige \"Con receta\" arriba."}
            </p>
          )}
          {showsStockFields && isEditing && (
            <p className="text-vimdy-text-tertiary text-xs -mt-2">
              El stock actual ({product!.stock}) se cambia desde "Aumentar stock" / "Disminuir stock", no aquí.
            </p>
          )}

        </div>

        <div className="space-y-3 min-w-0">
          {/* Receta: solo para "Preparado con receta". */}
          {productType === "cocina_receta" && (
          <div ref={recipeSectionRef} className="rounded-vimdy-md border border-vimdy-border bg-vimdy-background/60 p-4">
            <p className="flex items-center gap-1.5 text-vimdy-text text-sm font-medium">
              <ChefHat size={15} className="text-vimdy-recipe" />
              Ingredientes
            </p>
            <p className="text-vimdy-text-tertiary text-xs mt-1 mb-3">
              Escribe cada ingrediente y la cantidad que lleva <strong>una</strong> unidad de este producto.
            </p>
            <p className="text-vimdy-text-tertiary text-xs -mt-2 mb-3">
              Ej: una tajada de queso → <strong>1</strong> Unidad · carne molida → <strong>150</strong> g. Si no lo pesas, cuéntalo por pieza (tajada, huevo, pan).
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

            {hasRecipe && (
              <div className="space-y-2">
                {recipeRows.length === 0 && !showQuickIngredient && (ingredientOptions.length === 0 || showRecipeTip) && (
                  <div
                    role="note"
                    className="flex items-start gap-2.5 rounded-vimdy-sm border border-vimdy-recipe/30 bg-vimdy-recipe/10 px-3 py-2.5"
                  >
                    <span aria-hidden="true" className="text-base leading-5">💡</span>
                    <p className="min-w-0 flex-1 text-xs leading-5 text-vimdy-text-secondary">
                      {ingredientOptions.length === 0 ? (
                        <>
                          <strong className="text-vimdy-text">Empieza por tus ingredientes.</strong> Aún no tienes insumos
                          creados: escribe el primero abajo o toca <strong>Crear insumo rápido</strong>. Quedará guardado para
                          todos tus platos.
                        </>
                      ) : (
                        <>
                          <strong className="text-vimdy-text">Consejo Pro:</strong> te recomendamos tener tus insumos creados
                          primero en la pestaña de Insumos para que armar esta receta sea inmediato y fluido. Si te falta
                          alguno, créalo aquí mismo sin perder lo que llevas.
                        </>
                      )}
                    </p>
                    {ingredientOptions.length > 0 && (
                      <button
                        type="button"
                        onClick={dismissRecipeTip}
                        aria-label="Cerrar consejo"
                        className="h-6 w-6 shrink-0 rounded-vimdy-sm text-vimdy-text-tertiary hover:text-vimdy-text flex items-center justify-center"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                )}

                {recipeRows.length === 0 && copyableRecipes.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => e.target.value && copyRecipeFrom(e.target.value)}
                    aria-label="Copiar la receta de otro producto"
                    className="w-full h-9 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text-secondary text-xs focus:outline-none focus:border-vimdy-recipe"
                  >
                    <option value="">¿Parecida a otra? Copiar receta de...</option>
                    {copyableRecipes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}

                {recipeRows.map((row) => {
                  const ing = allProducts.find((p) => p.id === row.productId);
                  const units = compatibleUnits(ing?.unit);
                  const converted = resolveRecipeRowQuantity(row);
                  const unitCost = ing?.purchasePrice ?? 0;
                  const rowInvalid = invalidRowId === row.rowId && !(parseDecimalInput(row.quantity) > 0);
                  return (
                    <div
                      key={row.rowId}
                      className="flex items-center gap-2 rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-vimdy-text text-sm">{ing?.name ?? "Ingrediente eliminado"}</p>
                        {converted !== null && converted > 0 && (
                          <p className={`text-xs ${unitCost > 0 ? "text-vimdy-text-tertiary" : "text-vimdy-accent"}`}>
                            {unitCost > 0 ? money(converted * unitCost) : "✨ agrega su precio para ver el costo"}
                          </p>
                        )}
                      </div>
                      <input
                        data-qty-row={row.rowId}
                        type="text"
                        inputMode="decimal"
                        value={row.quantity}
                        onChange={(e) => updateRecipeRow(row.rowId, "quantity", sanitizeQuantityInput(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            ingredientSearchRef.current?.focus();
                          }
                        }}
                        placeholder="Cant."
                        title="Cuánto lleva UNA unidad del producto. Ej: 1 (una tajada) o 150 (gramos)."
                        aria-label={`Cantidad de ${ing?.name ?? "ingrediente"}`}
                        aria-invalid={rowInvalid}
                        className={`w-20 h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-recipe ${
                          rowInvalid ? "border-vimdy-danger" : "border-vimdy-border"
                        }`}
                      />
                      {units.length > 1 ? (
                        <select
                          value={row.unit || normalizeUnit(ing?.unit)}
                          onChange={(e) => updateRecipeRow(row.rowId, "unit", e.target.value)}
                          aria-label="Unidad de la cantidad"
                          className="w-20 h-10 px-2 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-recipe"
                        >
                          {units.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="w-14 text-vimdy-text-secondary text-sm">{normalizeUnit(ing?.unit)}</span>
                      )}
                      <label
                        title="El cliente puede pedirlo sin este ingrediente."
                        className="flex items-center gap-1 text-vimdy-text-tertiary text-xs cursor-pointer select-none"
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
                        aria-label={`Quitar ${ing?.name ?? "ingrediente"}`}
                        className="h-8 w-8 shrink-0 rounded-vimdy-sm text-vimdy-text-tertiary hover:text-vimdy-danger hover:bg-vimdy-danger/10 flex items-center justify-center"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  );
                })}

                {/* Un solo campo para agregar: escribe, Enter, cantidad, Enter. */}
                <div className="flex items-stretch gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    ref={ingredientSearchRef}
                    value={ingredientQuery}
                    onChange={(e) => {
                      setIngredientQuery(e.target.value);
                      setSuggestOpen(true);
                      setSuggestIndex(0);
                    }}
                    onFocus={() => setSuggestOpen(true)}
                    onBlur={() => setSuggestOpen(false)}
                    onKeyDown={handleIngredientSearchKeyDown}
                    placeholder={recipeRows.length === 0 ? "Escribe un ingrediente (ej: carne)..." : "Agregar otro ingrediente..."}
                    aria-label="Buscar o crear ingrediente"
                    autoComplete="off"
                    className={`w-full h-11 px-3 rounded-vimdy-sm bg-vimdy-surface border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-recipe transition-shadow duration-500 ${
                      highlightSearch
                        ? "border-vimdy-recipe ring-2 ring-vimdy-recipe/40 shadow-lg shadow-vimdy-recipe/25"
                        : recipeRows.length === 0
                          ? "border-vimdy-recipe/70"
                          : "border-vimdy-recipe/40"
                    }`}
                  />
                  {suggestOpen && suggestionCount > 0 && (
                    <ul
                      role="listbox"
                      className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface shadow-lg"
                    >
                      {ingredientSuggestions.items.map((p, i) => (
                        <li
                          key={p.id}
                          role="option"
                          aria-selected={i === suggestIndex}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => addIngredientToRecipe(p.id)}
                          className={`px-3 py-2 text-sm cursor-pointer flex justify-between gap-2 ${
                            i === suggestIndex ? "bg-vimdy-recipe/15 text-vimdy-text" : "text-vimdy-text-secondary hover:bg-vimdy-surface-hover"
                          }`}
                        >
                          <span className="truncate">{p.name}</span>
                          <span className="text-vimdy-text-tertiary text-xs shrink-0">{p.unit}</span>
                        </li>
                      ))}
                      {ingredientSuggestions.total > ingredientSuggestions.items.length && (
                        <li className="px-3 py-1.5 text-xs text-vimdy-text-tertiary">
                          Hay {ingredientSuggestions.total - ingredientSuggestions.items.length} más: sigue escribiendo para filtrar.
                        </li>
                      )}
                      {canCreateIngredient && (
                        <li
                          role="option"
                          aria-selected={suggestIndex === ingredientSuggestions.items.length}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={startCreateIngredient}
                          className={`px-3 py-2 text-sm cursor-pointer border-t border-vimdy-border text-vimdy-recipe ${
                            suggestIndex === ingredientSuggestions.items.length ? "bg-vimdy-recipe/15" : "hover:bg-vimdy-surface-hover"
                          }`}
                        >
                          + Crear "{ingredientQuery.trim()}" como ingrediente nuevo
                        </li>
                      )}
                    </ul>
                  )}
                </div>
                {!showQuickIngredient && (
                  <button
                    type="button"
                    onClick={startCreateIngredient}
                    className="h-11 shrink-0 px-3 rounded-vimdy-sm border border-vimdy-recipe/40 bg-vimdy-recipe/10 text-vimdy-recipe text-sm font-medium hover:bg-vimdy-recipe/20 transition-colors flex items-center gap-1.5"
                  >
                    <Plus size={16} />
                    <span className="hidden sm:inline">Crear insumo rápido</span>
                    <span className="sm:hidden">Nuevo</span>
                  </button>
                )}
                </div>
                <p className="text-vimdy-text-tertiary text-xs mt-1.5">
                  ¿No lo encuentras? Escríbelo y créalo al instante. Los ingredientes nuevos que dejes en la receta se guardan en tus Insumos al guardar el producto, para que los reutilices en otros platos. Si cancelas, no se guardan.
                </p>

                {showQuickIngredient && (
                  <QuickIngredientCard
                    initialName={quickIngredientName}
                    creating={creatingIngredient}
                    onSubmit={handleCreateQuickIngredient}
                    onCancel={() => {
                      setShowQuickIngredient(false);
                      setQuickIngredientName("");
                    }}
                  />
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

          {/* Más opciones (IVA, estado, tamaños y extras). "No se controla" solo lleva descripción. */}
          {isServiceType ? descriptionField : (
          <div className="rounded-vimdy-md border border-vimdy-border">
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              aria-expanded={showMore}
              className="w-full flex items-center justify-between px-4 h-11 text-sm font-medium text-vimdy-text-secondary hover:text-vimdy-text"
            >
              <span>Más opciones</span>
              <span aria-hidden="true">{showMore ? "▴" : "▾"}</span>
            </button>

            {showMore && (
              <div className="space-y-4 px-4 pb-4 border-t border-vimdy-border pt-4">
          {descriptionField}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {showSalePrice && (
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
                  )}
                  {showsStockFields && (
                    <div>
                      <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Stock mínimo</label>
                      <input
                        type="number"
                        min={0}
                        value={minStock}
                        onChange={(e) => setMinStock(e.target.value)}
                        className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                      />
                    </div>
                  )}
                  {isKitchenType && (
                    <div className="sm:col-span-2">
                      <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
                        Estación solo para este producto
                        <span className="text-vimdy-text-tertiary font-normal"> (opcional)</span>
                      </label>
                      <input
                        type="text"
                        value={printStationOverride}
                        onChange={(e) => setPrintStationOverride(e.target.value)}
                        list="vimdy-known-stations"
                        placeholder="Igual que su categoría"
                        className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                      />
                    </div>
                  )}
                </div>

                {isStockType && (
                  <>
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
                  </>
                )}

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

                {showsOptionsSection && (
                  <>
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
                      <MoneyInput
                        value={row.priceDelta}
                        onValueChange={(v) => updateSizeRow(row.rowId, "priceDelta", v)}
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
                      <MoneyInput
                        value={row.priceDelta}
                        onValueChange={(v) => updateExtraRow(row.rowId, "priceDelta", v)}
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
                  </>
                )}
              </div>
            )}
          </div>
          )}
        </div>
        </div>
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-vimdy-border shrink-0">
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
            onClick={handleCancel}
            variant="secondary"
          >
            Cancelar
          </VimdyButton>
        </div>
      </div>

      <datalist id="vimdy-known-stations">
        {knownStations.map((st) => (
          <option key={st} value={st} />
        ))}
      </datalist>

      <NewSupplierModal
        open={showNewSupplierModal}
        creating={creatingSupplier}
        onClose={() => setShowNewSupplierModal(false)}
        onCreate={async (input) => {
          setCreatingSupplier(true);
          try {
            const created = await container.supplierEngine.get().create(input);
            setSuppliers((prev) => [...prev, created]);
            setSupplierId(created.id);
            setShowNewSupplierModal(false);
          } catch {
            toast.error("No se pudo crear el proveedor.");
          } finally {
            setCreatingSupplier(false);
          }
        }}
      />
    </div>
  );
}