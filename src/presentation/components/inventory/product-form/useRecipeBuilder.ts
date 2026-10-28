// src/presentation/components/inventory/product-form/useRecipeBuilder.ts
//
// Todo el estado y las acciones del constructor "¿Qué lleva?":
// filas de la receta, buscador de ingredientes y creación de insumos al vuelo.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Category, Product } from "../../../../core/entities/Entities";
import { toast } from "../../../../core/store/toastStore";
import { vimdyCore } from "../../../../core/VimdyCore";
import { container } from "../../../../infrastructure/di/CompositionRoot";
import { compatibleUnits } from "../../../../core/utils/unitConversion";
import { discardQuickIngredients } from "../quickIngredientCleanup";
import type { QuickIngredientPayload } from "../QuickIngredientCard";
import { filterIngredientOptions, normalizeSearch } from "../recipeFormHelpers";
import { createInsumo, ensureInsumoCategory } from "./insumoFactory";
import type { RecipeRowDraft } from "./productFormTypes";

interface Args {
  /** Producto que se edita (se excluye de los ingredientes posibles). */
  product?: Product;
  allProducts: Product[];
  setAllProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  insumoCategories: Category[];
  setInsumoCategories: React.Dispatch<React.SetStateAction<Category[]>>;
  initialRows: RecipeRowDraft[];
}

/** Unidad con la que nace la fila: gramos para insumos en kg/libra, ml para litros; si no, la del insumo. */
function defaultRowUnit(ingredient: Product | undefined): string {
  const units = compatibleUnits(ingredient?.unit);
  return units.length > 1 ? units[0] : "";
}

export function useRecipeBuilder({
  product,
  allProducts,
  setAllProducts,
  insumoCategories,
  setInsumoCategories,
  initialRows
}: Args) {
  const [rows, setRows] = useState<RecipeRowDraft[]>(initialRows);
  const [query, setQuery] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const [invalidRowId, setInvalidRowId] = useState<string | null>(null);
  /** null = tarjeta de "crear ingrediente" cerrada; texto = abierta con ese nombre. */
  const [quickName, setQuickName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  // Insumos creados en esta sesión: si el plato no se guarda, se borran para no dejar basura.
  const createdIdsRef = useRef<string[]>([]);
  const savedRef = useRef(false);

  // ── Búsqueda ────────────────────────────────────────────────────────────
  const ingredientOptions = useMemo(
    () => allProducts.filter((p) => p.id !== product?.id && p.isIngredient === true),
    [allProducts, product?.id]
  );
  const usedIds = useMemo(() => new Set(rows.map((r) => r.productId)), [rows]);
  const suggestions = useMemo(
    () => filterIngredientOptions(ingredientOptions, query, usedIds).items,
    [ingredientOptions, query, usedIds]
  );
  const canCreate =
    query.trim().length > 0 && !ingredientOptions.some((p) => normalizeSearch(p.name) === normalizeSearch(query));
  /** Cantidad de opciones navegables: sugerencias + "Crear «texto»". */
  const optionCount = suggestions.length + (canCreate ? 1 : 0);

  // ── Filas ───────────────────────────────────────────────────────────────
  const addIngredient = useCallback(
    (productId: string) => {
      if (rows.some((r) => r.productId === productId)) return;
      const ingredient = allProducts.find((p) => p.id === productId);
      const rowId = crypto.randomUUID();
      setRows((prev) => [
        ...prev,
        { rowId, productId, quantity: "", unit: defaultRowUnit(ingredient), optional: false }
      ]);
      setQuery("");
      setSuggestOpen(false);
      setActiveIndex(0);
      setFocusRowId(rowId);
    },
    [rows, allProducts]
  );

  const updateRow = useCallback((rowId: string, field: "quantity" | "unit", value: string) => {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r)));
    setInvalidRowId((current) => (current === rowId ? null : current));
  }, []);

  const removeRow = useCallback((rowId: string) => {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }, []);

  /** Lleva el cursor a la cantidad de la fila (al agregarla o cuando falta). */
  useEffect(() => {
    if (!focusRowId) return;
    const el = document.querySelector<HTMLInputElement>(`[data-qty-row="${focusRowId}"]`);
    el?.focus();
    el?.select?.();
    setFocusRowId(null);
  }, [focusRowId]);

  const focusSearch = useCallback(() => searchRef.current?.focus(), []);

  // ── Crear ingrediente al vuelo ──────────────────────────────────────────
  const openQuickCreate = useCallback(() => {
    setQuickName(query.trim());
    setQuery("");
    setSuggestOpen(false);
  }, [query]);

  const closeQuickCreate = useCallback(() => {
    setQuickName(null);
    searchRef.current?.focus();
  }, []);

  const submitQuickCreate = useCallback(
    async (payload: QuickIngredientPayload) => {
      const { name, purchasePrice, storedUnit, quantity, recipeUnit } = payload;
      setCreating(true);
      try {
        const insumoCategory = await ensureInsumoCategory(insumoCategories);
        if (!insumoCategory) {
          toast.error("No se pudo preparar la categoría de insumos. Intenta de nuevo.");
          return;
        }
        const { created: newCategory } = insumoCategory;
        if (newCategory) setInsumoCategories((prev) => (prev.some((c) => c.id === newCategory.id) ? prev : [...prev, newCategory]));

        const insumo = await createInsumo(
          { name, categoryId: insumoCategory.categoryId, unit: storedUnit, purchasePrice },
          allProducts
        );
        createdIdsRef.current = [...createdIdsRef.current, insumo.id];
        setAllProducts((prev) => [...prev, insumo]);

        const rowId = crypto.randomUUID();
        // Si ya escribió la cantidad en la tarjeta, la fila nace completa.
        setRows((prev) => [...prev, { rowId, productId: insumo.id, quantity, unit: recipeUnit, optional: false }]);
        setQuickName(null);
        if (quantity) searchRef.current?.focus();
        else setFocusRowId(rowId);
        toast.success(`"${name}" agregado a la receta. Se guarda en tus Insumos junto con el plato.`);
      } catch {
        toast.error("No se pudo crear el ingrediente. Revisa que no exista ya con ese nombre.");
      } finally {
        setCreating(false);
      }
    },
    [allProducts, insumoCategories, setAllProducts, setInsumoCategories]
  );

  // ── Teclado del buscador ────────────────────────────────────────────────
  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggestOpen(true);
        setActiveIndex((i) => (optionCount === 0 ? 0 : (i + 1) % optionCount));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (optionCount === 0 ? 0 : (i - 1 + optionCount) % optionCount));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const picked = suggestions[activeIndex];
        if (picked) addIngredient(picked.id);
        else if (canCreate) openQuickCreate();
      } else if (e.key === "Escape" && suggestOpen) {
        // Cierra solo la lista; no el modal entero.
        e.stopPropagation();
        setSuggestOpen(false);
      }
    },
    [optionCount, suggestions, activeIndex, canCreate, suggestOpen, addIngredient, openQuickCreate]
  );

  // ── Limpieza de insumos huérfanos ───────────────────────────────────────
  const discardCreated = useCallback(async (keepIds: ReadonlySet<string>) => {
    const pending = createdIdsRef.current;
    createdIdsRef.current = [];
    if (pending.length === 0) return;
    const removed = await discardQuickIngredients(pending, keepIds, (id) =>
      container.inventoryEngine.get().deleteProduct(id)
    );
    if (removed > 0) vimdyCore.emit("inventory");
  }, []);

  /** El plato se guardó: se conservan los insumos usados en la receta y se borran los demás. */
  const markSaved = useCallback(
    (keepIds: ReadonlySet<string>) => {
      savedRef.current = true;
      return discardCreated(keepIds);
    },
    [discardCreated]
  );

  /** Se cierra sin guardar: se borran todos los insumos creados en esta sesión. */
  const discardAll = useCallback(() => discardCreated(new Set()), [discardCreated]);

  /** El borrador de VIMDY IA también crea insumos: se registran para la misma limpieza. */
  const registerCreated = useCallback((ids: readonly string[]) => {
    createdIdsRef.current = [...createdIdsRef.current, ...ids];
  }, []);

  // Si el formulario se desmonta por cualquier otro motivo sin haber guardado.
  const cleanupOnUnmountRef = useRef<() => void>(() => {});
  cleanupOnUnmountRef.current = () => {
    if (!savedRef.current) void discardCreated(new Set());
  };
  useEffect(() => () => cleanupOnUnmountRef.current(), []);

  return {
    rows,
    setRows,
    // buscador
    searchRef,
    query,
    setQuery: (value: string) => {
      setQuery(value);
      setSuggestOpen(true);
      setActiveIndex(0);
    },
    suggestOpen,
    setSuggestOpen,
    activeIndex,
    setActiveIndex,
    suggestions,
    canCreate,
    onSearchKeyDown,
    ingredientCount: ingredientOptions.length,
    // filas
    addIngredient,
    updateRow,
    removeRow,
    focusSearch,
    invalidRowId,
    flagRow: (rowId: string | null) => {
      setInvalidRowId(rowId);
      if (rowId) setFocusRowId(rowId);
    },
    // crear al vuelo
    quickName,
    creating,
    openQuickCreate,
    closeQuickCreate,
    submitQuickCreate,
    // ciclo de vida
    markSaved,
    discardAll,
    registerCreated
  };
}

export type RecipeBuilderState = ReturnType<typeof useRecipeBuilder>;