// src/presentation/components/inventory/product-form/useProductForm.ts
//
// Orquesta el formulario "Plato / Receta": campos principales, carga de
// categorías e insumos, borrador de VIMDY IA y guardado.

import { useEffect, useMemo, useState } from "react";
import type { Category, Product } from "../../../../core/entities/Entities";
import type { ProductInput } from "../../../../core/engines/InventoryEngine";
import { companyConfigStore } from "../../../../core/store/companyConfigStore";
import { confirmDialog } from "../../../../core/store/confirmStore";
import { toMoneyInputValue } from "../../../../core/utils/formatMoneyInput";
import { container } from "../../../../infrastructure/di/CompositionRoot";
import type { DishDraft } from "../dishDraft";
import { collectKnownStations } from "../InventoryWidgets";
import { applyAiDraft, sameStation } from "./applyAiDraft";
import { buildProductInput, isKitchenFormType, kindOfProduct, resolveFormType } from "./buildProductInput";
import type { FormKind } from "./buildProductInput";
import { DEFAULT_STATION, NEW_CATEGORY_VALUE, RecipeRowDraft, SUGGESTED_STATIONS } from "./productFormTypes";
import { computeRecipeSummary } from "./recipeSummary";
import { useRecipeBuilder } from "./useRecipeBuilder";

interface Args {
  product?: Product;
  aiDraft?: DishDraft;
  saveError?: string | null;
  onSave: (input: ProductInput) => Promise<boolean>;
  onClose: () => void;
  /** Permiso inventory.viewCosts: sin él no se muestra ni se toca el costo. */
  canViewCosts: boolean;
}

const CATEGORY_ERRORS: Record<string, string> = {
  CATEGORY_NAME_REQUIRED: "Escribe un nombre para la categoría.",
  CATEGORY_NAME_DUPLICATE: "Ya existe una categoría con ese nombre."
};

export function useProductForm({ product, aiDraft, saveError, onSave, onClose, canViewCosts }: Args) {
  const isEditing = !!product;

  // ── Campos principales ──────────────────────────────────────────────────
  const [kind, setKind] = useState<FormKind>(() => kindOfProduct(product));
  const [name, setName] = useState(product?.name ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [price, setPrice] = useState(product ? toMoneyInputValue(product.price) : "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [station, setStation] = useState(product?.printStationOverride ?? "");
  const [image, setImage] = useState(product?.image ?? "");
  const [cost, setCost] = useState(product?.purchasePrice !== undefined ? toMoneyInputValue(product.purchasePrice) : "");

  // ── Datos de apoyo ──────────────────────────────────────────────────────
  const [categories, setCategories] = useState<Category[]>([]);
  const [insumoCategories, setInsumoCategories] = useState<Category[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Categoría nueva (inline) ────────────────────────────────────────────
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  // ── Estado del guardado ─────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [aiNotice, setAiNotice] = useState<string[]>([]);

  // ── Receta ──────────────────────────────────────────────────────────────
  const initialRows = useMemo<RecipeRowDraft[]>(
    () =>
      product?.recipe?.map((r) => ({
        rowId: crypto.randomUUID(),
        productId: r.productId,
        quantity: String(r.entryQuantity ?? r.quantity).replace(".", ","),
        unit: r.entryUnit ?? "",
        optional: r.optional ?? false
      })) ?? [],
    // Solo al abrir: después las filas viven en el constructor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const builder = useRecipeBuilder({
    product,
    allProducts,
    setAllProducts,
    insumoCategories,
    setInsumoCategories,
    initialRows
  });
  const { setRows, registerCreated } = builder;

  // ── Carga inicial (+ borrador de VIMDY IA al crear) ─────────────────────
  useEffect(() => {
    let cancelled = false;

    Promise.all([container.categoryEngine.get().listAll(), container.inventoryEngine.get().listAll()])
      .then(async ([cats, prods]) => {
        if (cancelled) return;
        const sellCats = cats.filter((c) => c.kind !== "INSUMO");
        const insumoCats = cats.filter((c) => c.kind === "INSUMO");
        setCategories(sellCats);
        setInsumoCategories(insumoCats);
        setAllProducts(prods);

        if (aiDraft && !product) {
          try {
            const ai = await applyAiDraft(aiDraft, sellCats, insumoCats, prods);
            registerCreated(ai.createdProducts.map((p) => p.id));
            if (cancelled) {
              void builder.discardAll();
              return;
            }
            if (ai.createdCategory) setInsumoCategories((prev) => [...prev, ai.createdCategory!]);
            if (ai.createdProducts.length > 0) setAllProducts((prev) => [...prev, ...ai.createdProducts]);

            setName(ai.name);
            if (ai.price) setPrice(toMoneyInputValue(ai.price));
            if (ai.categoryId) {
              setCategoryId(ai.categoryId);
            } else {
              setCategoryId(NEW_CATEGORY_VALUE);
              if (ai.suggestedCategory) setNewCategoryName(ai.suggestedCategory);
            }
            if (ai.station) {
              const inherited = sellCats.find((c) => c.id === ai.categoryId)?.printStation || DEFAULT_STATION;
              if (!sameStation(ai.station, inherited)) setStation(ai.station);
            }
            setRows(ai.rows);
            setAiNotice(ai.notices);
          } catch (err) {
            console.error("[ProductFormModal] No se pudo aplicar el borrador de VIMDY IA", err);
            setCategoryId((current) => current || sellCats[0]?.id || NEW_CATEGORY_VALUE);
            setAiNotice(["VIMDY IA no pudo rellenar todo el formulario. Revisa los campos y complétalos a mano."]);
          }
          return;
        }

        // Sin categorías todavía: se abre directo el campo para crear la primera (no se bloquea).
        setCategoryId((current) => current || sellCats[0]?.id || NEW_CATEGORY_VALUE);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derivados ───────────────────────────────────────────────────────────
  /** Con ingredientes solo si es "Preparado": en reventa o servicio las filas escritas se ignoran. */
  const recipeActive = kind === "preparado" && builder.rows.length > 0;
  const type = resolveFormType(product, recipeActive, kind);
  /** Receta y estación solo aplican a "Preparado"; reventa, servicio e insumos no las muestran. */
  const isKitchenProduct = isKitchenFormType(type);
  /** Costo directo: preparado sin receta y reventa. Insumos (costo por compras) y servicios no lo piden. */
  const showCostField = canViewCosts && (kind === "preparado" || kind === "reventa");
  /** Código de barras: solo reventa (para escanear en caja). */
  const showBarcodeField = kind === "reventa";
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const knownStations = useMemo(() => {
    const found = collectKnownStations(categories, allProducts);
    const seen = new Set(found.map((s) => s.toLowerCase()));
    return [...found, ...SUGGESTED_STATIONS.filter((s) => !seen.has(s.toLowerCase()))];
  }, [categories, allProducts]);
  const autoStationLabel = selectedCategory?.printStation?.trim() || DEFAULT_STATION;
  const summary = useMemo(
    () => computeRecipeSummary(builder.rows, allProducts, price),
    [builder.rows, allProducts, price]
  );

  // ── Acciones ────────────────────────────────────────────────────────────
  async function createCategory(): Promise<Category | null> {
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      setCategoryError("Escribe un nombre para la categoría.");
      return null;
    }
    setCategoryError(null);
    setCreatingCategory(true);
    try {
      const created = await container.categoryEngine.get().create({ name: trimmed, requiresKitchenByDefault: true });
      setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryId(created.id);
      setNewCategoryName("");
      return created;
    } catch (err: any) {
      setCategoryError(CATEGORY_ERRORS[err?.message] ?? "No se pudo crear la categoría.");
      return null;
    } finally {
      setCreatingCategory(false);
    }
  }

  async function save() {
    if (saving) return;
    try {
      await saveInner();
    } catch (err: any) {
      console.error("[ProductFormModal] Error inesperado al guardar", err);
      setSaving(false);
      setFormError(`Error inesperado al guardar: ${err?.message ?? String(err)}`);
    }
  }

  async function saveInner() {
    setFormError(null);
    setSaveFailed(false);

    // Si dejó escrita una categoría nueva sin tocar "Crear", se crea ahora: no se le obliga a volver.
    let finalCategories = categories;
    let finalCategoryId = categoryId;
    if (categoryId === NEW_CATEGORY_VALUE) {
      if (!newCategoryName.trim()) {
        setFormError("Elige una categoría o crea una nueva.");
        return;
      }
      const created = await createCategory();
      if (!created) return;
      finalCategories = [...categories, created];
      finalCategoryId = created.id;
    }

    const built = buildProductInput({
      product,
      name,
      categoryId: finalCategoryId,
      price,
      cost: showCostField ? cost : undefined,
      image,
      kind,
      barcode: showBarcodeField ? barcode : undefined,
      station,
      rows: builder.rows,
      allProducts,
      categories: finalCategories
    });
    if (!built.ok) {
      setFormError(built.error);
      builder.flagRow(built.rowId ?? null);
      return;
    }
    builder.flagRow(null);

    // Pasar un plato con receta a Reventa o Servicio borra su receta: se pide confirmación.
    const savedIngredients = product?.recipe?.length ?? 0;
    if (kind !== "preparado" && savedIngredients > 0) {
      const ok = await confirmDialog({
        title: "Se borrará la receta",
        message: `Este producto tiene una receta con ${savedIngredients} ${savedIngredients === 1 ? "ingrediente" : "ingredientes"}. Si lo guardas como ${kind === "reventa" ? "Reventa" : "Servicio"}, la receta se borra y ya no descontará esos ingredientes.\n\nSi no quieres perderla, toca "Volver" y elige Preparado.`,
        confirmLabel: "Sí, borrar la receta",
        cancelLabel: "Volver"
      });
      if (!ok) return;
    }

    // Error más común: escribir "4" queriendo decir 4.000.
    const isPesos = (companyConfigStore.get().currency || "COP").toUpperCase() === "COP";
    const priceValue = built.input.price ?? 0;
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

    setSaving(true);
    let ok = false;
    try {
      ok = await onSave(built.input);
    } catch {
      ok = false;
    } finally {
      setSaving(false);
    }

    if (ok) {
      await builder.markSaved(new Set((built.recipe ?? []).map((r) => r.productId)));
      onClose();
    } else {
      setSaveFailed(true);
    }
  }

  function cancel() {
    void builder.discardAll();
    onClose();
  }

  // Motivo real del fallo (ej. nombre duplicado) si el inventario lo reportó.
  const failureMessage = saveFailed
    ? saveError ?? (isEditing ? "No se pudieron guardar los cambios. Intenta de nuevo." : "No se pudo guardar el plato. Intenta de nuevo.")
    : null;

  return {
    isEditing,
    loading,
    // campos
    name,
    setName,
    price,
    setPrice,
    kind,
    setKind,
    barcode,
    setBarcode,
    showBarcodeField,
    recipeActive,
    image,
    setImage,
    cost,
    setCost,
    showCostField,
    categoryId,
    setCategoryId,
    categories,
    newCategoryName,
    setNewCategoryName,
    creatingCategory,
    categoryError,
    createCategory,
    // receta
    builder,
    ingredientsReady: !loading,
    allProducts,
    summary,
    isKitchenProduct,
    // cocina
    station,
    setStation,
    knownStations,
    autoStationLabel,
    // guardado
    saving,
    save,
    cancel,
    error: formError ?? failureMessage,
    aiNotice,
    dismissAiNotice: () => setAiNotice([])
  };
}