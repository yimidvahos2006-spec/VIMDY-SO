import React, { useMemo, useState } from "react";
import { useCommandIntent } from "../../../hooks/useCommandIntent";
import { toast } from "../../../core/store/toastStore";
import { EmptyState } from "../ui/EmptyState";
import { ConfirmModal } from "../ui/ConfirmModal";
import { VimdyButton } from "../ui/VimdyButton";
import { SkeletonCards, SkeletonRows, Skeleton } from "../ui/Skeleton";
import {
  Search,
  Package,
  AlertTriangle,
  PackageX,
  DollarSign,
  History,
  ArrowUpCircle,
  ArrowDownCircle,
  X,
  ChevronUp,
  ChevronDown,
  Plus,
  ImagePlus,
  Trash2,
  Pencil,
  Sparkles,
  Camera,
  Copy,
  ChefHat,
  Flame,
  Clock3,
  Scale,
  Download,
  ArrowLeftRight
} from "lucide-react";

import { useInventory, getStockStatus, StockStatus } from "../../../core/store/useInventory";
import { useCategories } from "../../../hooks/useCategories";
import { OfflineStatusBadge } from "../ui/OfflineStatusBadge";
import { usePendingInventoryAdjustmentsQueue } from "../../../core/offline/usePendingInventoryAdjustmentsQueue";
import { aiImportStore } from "../../../core/store/aiImportStore";
import { readMenuImage, MenuOcrItem } from "../../../core/ia/MenuVisionAI";
import { generateRecipeWithAI } from "../../../core/ia/RecipeAI";
import { Product, InventoryMovement, Category, Supplier, RecipeItem, LossCategory, ProductSizeOption, ProductExtraOption } from "../../../core/entities/Entities";
import { ProductInput } from "../../../core/engines/InventoryEngine";
import { ProductType, inferProductType, resolveProductFlags } from "../../../core/types/productType";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { fileToProductImage } from "../../utils/imageUtils";
import { ProductionIntelligencePanel } from "./ProductionIntelligencePanel";
import { buildProductInputFromImportRow, inferUnitFromProductName, ImportedProductRow } from "./importHelpers";
import { LOSS_CATEGORY_LABEL } from "../../../core/engines/lossCategoryLabels";
import { getBranches, getCurrentBranchId, getCurrentBusinessId } from "../../../infrastructure/supabase/supabaseClient";
import { formatMoney } from "../../../core/utils/formatMoney";
import { companyConfigStore } from "../../../core/store/companyConfigStore";

const UNIT_OPTIONS = ["unidad", "kg", "g", "litro", "ml", "libra", "servicio", "paquete", "caja"];

const money = (value: number) => {
  const currency = companyConfigStore.get().currency;
  const language = companyConfigStore.get().language;
  return formatMoney(value, currency, language);
};

const STATUS_LABEL: Record<StockStatus, string> = {
  normal: "Normal",
  bajo: "Stock bajo",
  agotado: "Agotado"
};

const STATUS_CLASS: Record<StockStatus, string> = {
  normal: "bg-vimdy-success/15 text-vimdy-success border border-vimdy-success/30",
  bajo: "bg-vimdy-warning/15 text-vimdy-warning border border-vimdy-warning/30",
  agotado: "bg-vimdy-danger/15 text-vimdy-danger border border-vimdy-danger/30"
};

// PASO 2.5 — Centro de Pérdidas: categorías reales para una salida de stock
// que NO es una venta. Las etiquetas viven en un solo lugar (lossCategoryLabels,
// importado arriba) para que Inventario, useLossCenter y el Gerente
// Inteligente digan siempre el mismo nombre.

type SortKey = "name" | "stock" | "price";

/**
 * PASO 1 (rediseño formulario de producto): "Tipo de producto" es el campo
 * que va arriba de todo y decide qué más muestra el formulario.
 * - inventario: se vende y descuenta directo del stock (ej: gaseosa, snack empacado).
 * - cocina: se prepara en cocina al venderlo, sin descontar stock propio (ej: hamburguesa).
 * - cocina_receta: se prepara en cocina Y descuenta ingredientes de una receta/BOM.
 * - servicio: no maneja stock ni preparación (ej: domicilio, propina, cover).
 *
 * La inferencia y la resolución de flags viven en core/types/productType.ts
 * (fuente única de verdad, testeable). Este archivo solo las consume.
 */

export function InventoryDashboard() {
  const {
    products,
    recentMovements,
    kpis,
    loading,
    error,
    getHistory,
    increaseStock,
    decreaseStock,
    produceBatch,
    createProduct,
    updateProduct,
    deleteProduct,
    productsWithCost
  } = useInventory();

  const { categories } = useCategories();

  // PASO 1.10 (offline elegante en Inventario) — cuántos ajustes de stock
  // hechos sin conexión siguen esperando sincronizarse, para el badge del
  // encabezado (ver OfflineStatusBadge más abajo).
  const { count: pendingAdjustmentsCount } = usePendingInventoryAdjustmentsQueue();

  // PASO 2 (Motor de Producción): mapa id->Product reutilizado por
  // RecipeEngine para resolver costo/capacidad sin volver a consultar el
  // repositorio en cada fila de la tabla.
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StockStatus | "todos">("todos");
  const [categoryFilter, setCategoryFilter] = useState<string>("todos");
  const [productTypeFilter, setProductTypeFilter] = useState<ProductType | "todos">("todos");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Product | null>(null);
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showAiImport, setShowAiImport] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  // BLOQUEANTE (auditoría Fase 2 — Panadería): productos elaborados que se
  // producen por tanda (ver Product.productionMode) — son los únicos que
  // puede recibir InventoryEngine.produceBatch(). Si no hay ninguno, el
  // botón "Producir tanda" ni se muestra (nada que producir todavía).
  const batchProducts = useMemo(
    () => products.filter((p) => p.recipe && p.recipe.length > 0 && p.productionMode === "BATCH"),
    [products]
  );
  const [showProduceModal, setShowProduceModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferProduct, setTransferProduct] = useState<Product | null>(null);
  const [transferQuantity, setTransferQuantity] = useState(1);
  const [transferTargetBranchId, setTransferTargetBranchId] = useState<string>("");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  const [duplicating, setDuplicating] = useState<string | null>(null);

  // PASO 6 — Comandos Inteligentes: "crea un producto" abre este modal solo.
  useCommandIntent("OPEN_NEW_PRODUCT", () => setShowNewProduct(true));
  useCommandIntent("SEARCH_INVENTORY", (intent) => setSearch(intent.params?.query ?? ""));

  function handleDeleteProduct(product: Product) {
    setProductToDelete(product);
  }

  async function openTransferModal(product: Product) {
    setTransferProduct(product);
    setTransferQuantity(1);
    setTransferTargetBranchId("");
    setShowTransferModal(true);
    const businessId = getCurrentBusinessId();
    if (businessId) {
      setLoadingBranches(true);
      try {
        const all = await getBranches(businessId);
        const current = getCurrentBranchId();
        setBranches(
          all
            .filter((b) => b.active && b.id !== current)
            .map((b) => ({ id: b.id, name: b.name }))
        );
      } catch {
        setBranches([]);
      } finally {
        setLoadingBranches(false);
      }
    }
  }

  async function confirmTransfer() {
    const product = transferProduct;
    if (!product || !transferTargetBranchId) return;

    try {
      await container.inventoryEngine.get().transferStock(
        product.id,
        getCurrentBranchId() ?? "",
        transferTargetBranchId,
        transferQuantity
      );
      toast.success(`Transferidos ${transferQuantity} unidades de ${product.name}`);
      setShowTransferModal(false);
      setTransferProduct(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error en la transferencia");
    }
  }

  async function confirmDeleteProduct() {
    const product = productToDelete;
    if (!product) return;

    const ok = await deleteProduct(product.id);
    if (ok) {
      if (selected?.id === product.id) setSelected(null);
      if (editingProduct?.id === product.id) setEditingProduct(null);
    }
    setProductToDelete(null);
  }

  /**
   * Duplicar (Parte 3): crea un producto nuevo con los mismos datos, vía el
   * mismo InventoryEngine.createProduct que usa "Nuevo producto". El stock
   * arranca en 0 (duplicar no debe duplicar existencias físicas) y se quita
   * el SKU/código de barras porque deben ser únicos por producto.
   */
  async function handleDuplicateProduct(product: Product) {
    setDuplicating(product.id);
    await createProduct({
      name: `${product.name} (copia)`,
      description: product.description,
      categoryId: product.categoryId,
      price: product.price,
      purchasePrice: product.purchasePrice,
      taxRate: product.taxRate,
      stock: 0,
      minStock: product.minStock,
      unit: product.unit,
      supplierId: product.supplierId,
      alternateSupplierId: product.alternateSupplierId,
      image: product.image,
      barcode: undefined,
      sku: undefined,
      active: product.active,
      favorite: product.favorite,
      aliases: product.aliases,
      recipe: product.recipe,
      productionMode: product.productionMode,
      requiresKitchen: product.requiresKitchen,
      estimatedPrepMinutes: product.estimatedPrepMinutes,
      printStationOverride: product.printStationOverride,
      sizes: product.sizes,
      extras: product.extras,
      trackStock: product.trackStock,
      isIngredient: product.isIngredient
    });
    setDuplicating(null);
  }

  const filtered = useMemo(() => {
    let list = products;

    if (search.trim() !== "") {
      const value = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(value) ||
          p.categoryId.toLowerCase().includes(value) ||
          (p.barcode ?? "").toLowerCase().includes(value) ||
          (p.sku ?? "").toLowerCase().includes(value)
      );
    }

    if (statusFilter !== "todos") {
      list = list.filter((p) => getStockStatus(p) === statusFilter);
    }

    if (categoryFilter !== "todos") {
      list = list.filter((p) => p.categoryId === categoryFilter);
    }

    if (productTypeFilter !== "todos") {
      list = list.filter((p) => inferProductType(p) === productTypeFilter);
    }

    const sorted = [...list].sort((a, b) => {
      let diff = 0;
      if (sortKey === "name") diff = a.name.localeCompare(b.name);
      if (sortKey === "stock") diff = a.stock - b.stock;
      if (sortKey === "price") diff = a.price - b.price;
      return sortDir === "asc" ? diff : -diff;
    });

    return sorted;
  }, [products, search, statusFilter, categoryFilter, sortKey, sortDir]);

  // Nombre visible de cada categoría dentro de la tabla (product.categoryId
  // es un id interno; esto lo resuelve al nombre real sin tocar el motor).
  const categoryNameById = useMemo(() => {
    const map: Record<string, string> = {};
    categories.forEach((c) => {
      map[c.id] = c.name;
    });
    return map;
  }, [categories]);

  // Solo mostramos como chip las categorías que de verdad tienen productos,
  // para no llenar la barra de filtros con categorías vacías.
  const categoryChips = useMemo(() => {
    const countByCategory: Record<string, number> = {};
    products.forEach((p) => {
      countByCategory[p.categoryId] = (countByCategory[p.categoryId] ?? 0) + 1;
    });
    return categories
      .filter((c) => countByCategory[c.id] > 0)
      .map((c) => ({ id: c.id, name: c.name, count: countByCategory[c.id] }));
  }, [categories, products]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function exportInventoryToCsv() {
    const headers = ["nombre", "sku", "categoria", "stockActual", "stockMinimo", "precioCompra", "precioVenta", "estado"];
    const rows = products.map((p) => {
      const status = getStockStatus(p);
      return [
        p.name,
        p.sku ?? "",
        categoryNameById[p.categoryId] ?? p.categoryId,
        p.stock,
        p.minStock,
        p.purchasePrice ?? 0,
        p.price,
        STATUS_LABEL[status]
      ];
    });

    const csvContent = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

    const bom = "\uFEFF";
    const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().split("T")[0];
    link.setAttribute("href", url);
    link.setAttribute("download", `inventario_${date}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <SkeletonCards count={4} />
        <div className="rounded-vimdy-lg border border-vimdy-border-subtle bg-vimdy-background/60 p-4">
          <SkeletonRows rows={6} columns={5} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold text-vimdy-text">Inventario</h1>
            <OfflineStatusBadge
              pendingCount={pendingAdjustmentsCount}
              pendingLabelSingular="1 ajuste de stock pendiente"
              pendingLabelPlural="{count} ajustes de stock pendientes"
            />
          </div>
          <p className="text-vimdy-text-secondary text-sm mt-1">
            Productos, stock y movimientos en tiempo real.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/*
            Fase 3 (5.1): "Producir tanda" e "Importar menú con IA" se
            quedan como botones con estilo propio a propósito — no son
            VimdyButton. Usan vimdy-warning/vimdy-ai, tokens que YA existían
            en tailwind.config.js específicamente para marcar visualmente
            una función especial (IA, producción por lotes) distinta de una
            acción neutra. Forzarlos a "secondary" les quitaría esa señal
            visual a propósito. "Nuevo producto" sí es la acción principal
            real de la pantalla -> VimdyButton primary, y por la regla
            suprema del sistema no puede haber un segundo primary aquí.
          */}
          {batchProducts.length > 0 && (
            <button
              onClick={() => setShowProduceModal(true)}
              className="h-11 px-5 rounded-vimdy-md border border-vimdy-warning/40 bg-vimdy-warning/10 text-vimdy-warning font-bold hover:bg-vimdy-warning/20 flex items-center gap-2"
            >
              <Flame size={18} />
              Producir tanda
            </button>
          )}
          <button
            onClick={() => setShowAiImport(true)}
            className="h-11 px-5 rounded-vimdy-md border border-vimdy-ai/40 bg-vimdy-ai/10 text-vimdy-ai font-bold hover:bg-vimdy-ai/20 flex items-center gap-2"
          >
            <Sparkles size={18} />
            Importar menú con IA
          </button>
          {products.length > 0 && (
            <VimdyButton
              onClick={() => openTransferModal(selected ?? products[0])}
              variant="secondary"
              size="lg"
              icon={<ArrowLeftRight size={18} />}
            >
              Transferir
            </VimdyButton>
          )}
          {products.length > 0 && (
            <VimdyButton
              onClick={exportInventoryToCsv}
              variant="secondary"
              size="lg"
              icon={<Download size={18} />}
            >
              Exportar CSV
            </VimdyButton>
          )}
          <VimdyButton
            onClick={() => setShowNewProduct(true)}
            variant="primary"
            size="lg"
            icon={<Plus size={18} />}
          >
            Nuevo producto
          </VimdyButton>
        </div>
      </div>

      {showProduceModal && (
        <ProduceBatchModal
          products={batchProducts}
          productMap={productMap}
          onClose={() => setShowProduceModal(false)}
          onProduce={produceBatch}
          error={error}
        />
      )}

      {showTransferModal && transferProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-vimdy-surface border border-vimdy-border rounded-vimdy-lg p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-vimdy-text font-bold text-lg">Transferir stock</h3>
              <button
                onClick={() => setShowTransferModal(false)}
                className="text-vimdy-text-secondary hover:text-vimdy-text"
              >
                <X size={20} />
              </button>
            </div>
            <p className="text-vimdy-text-secondary text-sm mb-4">
              {transferProduct.name} — Stock disponible: {transferProduct.stock}
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-vimdy-text-secondary text-xs font-semibold mb-1">
                  Sucursal destino
                </label>
                <select
                  value={transferTargetBranchId}
                  onChange={(e) => setTransferTargetBranchId(e.target.value)}
                  className="w-full h-11 px-3 rounded-vimdy-md border border-vimdy-border bg-vimdy-background text-vimdy-text"
                >
                  <option value="">Selecciona una sucursal</option>
                  {loadingBranches ? (
                    <option value="" disabled>
                      Cargando...
                    </option>
                  ) : (
                    branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="block text-vimdy-text-secondary text-xs font-semibold mb-1">
                  Cantidad
                </label>
                <input
                  type="number"
                  min={1}
                  max={transferProduct.stock}
                  value={transferQuantity}
                  onChange={(e) => setTransferQuantity(Number(e.target.value))}
                  className="w-full h-11 px-3 rounded-vimdy-md border border-vimdy-border bg-vimdy-background text-vimdy-text"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowTransferModal(false)}
                  className="h-10 px-4 rounded-vimdy-md border border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface-hover"
                >
                  Cancelar
                </button>
                <VimdyButton
                  onClick={confirmTransfer}
                  disabled={!transferTargetBranchId || transferQuantity <= 0}
                  variant="primary"
                >
                  Confirmar transferencia
                </VimdyButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-4 py-3">
          {error}
        </div>
      )}

      {products.length === 0 ? (
        <EmptyProductsState onCreate={() => setShowNewProduct(true)} />
      ) : (
        <>
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Package size={20} className="text-vimdy-accent" />}
          label="Total de productos"
          value={kpis.totalProducts.toString()}
        />
        <KpiCard
          icon={<AlertTriangle size={20} className="text-vimdy-warning" />}
          label="Stock bajo"
          value={kpis.lowStockCount.toString()}
          highlight={kpis.lowStockCount > 0 ? "yellow" : undefined}
        />
        <KpiCard
          icon={<PackageX size={20} className="text-vimdy-danger" />}
          label="Agotados"
          value={kpis.outOfStockCount.toString()}
          highlight={kpis.outOfStockCount > 0 ? "red" : undefined}
        />
        <KpiCard
          icon={<DollarSign size={20} className="text-vimdy-success" />}
          label="Valor del inventario"
          value={kpis.productsWithCost > 0 ? money(kpis.totalValue) : "Sin costo configurado"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tabla de productos */}
        <div className="lg:col-span-2 rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface overflow-hidden">
          <div className="p-4 border-b border-vimdy-border flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-vimdy-text-tertiary" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, SKU o código de barras..."
                className="w-full h-10 pl-9 pr-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StockStatus | "todos")}
              className="h-10 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
            >
              <option value="todos">Todos los estados</option>
              <option value="normal">Normal</option>
              <option value="bajo">Stock bajo</option>
              <option value="agotado">Agotado</option>
            </select>

            <select
              value={productTypeFilter}
              onChange={(e) => setProductTypeFilter(e.target.value as ProductType | "todos")}
              className="h-10 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
            >
              <option value="todos">Todos los tipos</option>
              <option value="inventario">Producto para vender</option>
              <option value="ingrediente">Ingrediente</option>
              <option value="cocina">Producto preparado</option>
              <option value="cocina_receta">Producto con receta</option>
              <option value="servicio">Servicio</option>
            </select>
          </div>

          {categoryChips.length > 0 && (
            <div className="px-4 py-3 border-b border-vimdy-border flex items-center gap-2 flex-wrap">
              <CategoryChip
                label="Todos"
                active={categoryFilter === "todos"}
                onClick={() => setCategoryFilter("todos")}
              />
              {categoryChips.map((c) => (
                <CategoryChip
                  key={c.id}
                  label={c.name}
                  count={c.count}
                  active={categoryFilter === c.id}
                  onClick={() => setCategoryFilter(c.id)}
                />
              ))}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-vimdy-text-secondary border-b border-vimdy-border">
                  <SortableHeader label="Producto" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                  <th className="px-4 py-3 font-medium">Categoría</th>
                  <SortableHeader label="Stock" active={sortKey === "stock"} dir={sortDir} onClick={() => toggleSort("stock")} />
                  <th className="px-4 py-3 font-medium">Mínimo</th>
                  <SortableHeader label="Precio" active={sortKey === "price"} dir={sortDir} onClick={() => toggleSort("price")} />
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-vimdy-text-tertiary">
                      No se encontraron productos.
                    </td>
                  </tr>
                )}
                {filtered.map((product) => {
                  const status = getStockStatus(product);
                  const capacity =
                    product.recipe && product.recipe.length > 0
                      ? container.recipeEngine.get().getProductionCapacity(product, productMap)
                      : null;
                  return (
                    <tr
                      key={product.id}
                      onClick={() => setSelected(product)}
                      className="border-b border-vimdy-border-subtle hover:bg-vimdy-surface-hover/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 text-vimdy-text font-medium">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            {product.name}
                            {product.recipe && product.recipe.length > 0 && (
                              <span
                                title={`Receta con ${product.recipe.length} ingrediente(s)`}
                                className="text-xs px-1.5 py-0.5 rounded-vimdy-xs bg-vimdy-recipe/20 text-vimdy-recipe border border-vimdy-recipe/30"
                              >
                                Receta
                              </span>
                            )}
                            {product.recipe && product.recipe.length > 0 && product.productionMode === "BATCH" && (
                              <span
                                title="Se produce por tandas con anticipación (ej. panadería) — no a la orden."
                                className="text-xs px-1.5 py-0.5 rounded-vimdy-xs bg-vimdy-warning/20 text-vimdy-warning border border-vimdy-warning/30"
                              >
                                Por tanda
                              </span>
                            )}
                            {product.requiresKitchen === false && (
                              <span
                                title="No pasa por Cocina: se cobra y se entrega directo"
                                className="text-xs px-1.5 py-0.5 rounded-vimdy-xs bg-vimdy-text-tertiary/20 text-vimdy-text-secondary border border-vimdy-text-tertiary/30"
                              >
                                Sin cocina
                              </span>
                            )}
                          </div>
                          {capacity && (
                            <span
                              title={
                                capacity.limitingIngredient
                                  ? `Ingrediente limitante: ${capacity.limitingIngredient.name} (${capacity.limitingIngredient.stockAvailable} disponible)`
                                  : undefined
                              }
                              className={`text-xs ${capacity.maxUnits > 0 ? "text-vimdy-text-secondary" : "text-vimdy-danger font-semibold"}`}
                            >
                              {capacity.maxUnits > 0
                                ? `Alcanza para ${capacity.maxUnits} und.`
                                : `Sin stock: falta ${capacity.limitingIngredient?.name ?? "un ingrediente"}`}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-vimdy-text-secondary">
                        {categoryNameById[product.categoryId] ?? product.categoryId}
                      </td>
                      <td className="px-4 py-3 text-vimdy-text">{product.stock}</td>
                      <td className="px-4 py-3 text-vimdy-text-secondary">{product.minStock}</td>
                      <td className="px-4 py-3 text-vimdy-accent font-semibold">{money(product.price)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-vimdy-sm ${STATUS_CLASS[status]}`}>
                          {STATUS_LABEL[status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingProduct(product);
                            }}
                            aria-label="Editar"
                            title="Editar"
                            className="w-8 h-8 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface-hover flex items-center justify-center"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDuplicateProduct(product);
                            }}
                            disabled={duplicating === product.id}
                            aria-label="Duplicar"
                            title="Duplicar"
                            className="w-8 h-8 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface-hover flex items-center justify-center disabled:opacity-50"
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteProduct(product);
                            }}
                            aria-label="Eliminar"
                            title="Eliminar"
                            className="w-8 h-8 rounded-vimdy-sm border border-vimdy-danger/30 text-vimdy-danger hover:bg-vimdy-danger/10 flex items-center justify-center"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Alertas + últimos movimientos */}
        <div className="space-y-6">
          <AlertsPanel products={products} onSelect={setSelected} />
          <RecentMovementsPanel movements={recentMovements} products={products} />
        </div>
      </div>
        </>
      )}

      {selected && (
        <ProductDetailModal
          product={selected}
          allProducts={products}
          onClose={() => setSelected(null)}
          getHistory={getHistory}
          increaseStock={increaseStock}
          decreaseStock={decreaseStock}
          onUpdated={(p) => setSelected(p)}
          onEdit={() => {
            setEditingProduct(selected);
            setSelected(null);
          }}
          onDuplicate={() => {
            handleDuplicateProduct(selected);
            setSelected(null);
          }}
          onDelete={() => handleDeleteProduct(selected)}
        />
      )}

      {showNewProduct && (
        <ProductFormModal
          onClose={() => setShowNewProduct(false)}
          onSave={createProduct}
          onBuyIngredient={(ingredientId) => {
            const ingredient = productMap.get(ingredientId);
            if (ingredient) {
              setShowNewProduct(false);
              setSelected(ingredient);
            }
          }}
        />
      )}

      {editingProduct && (
        <ProductFormModal
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSave={(input) => updateProduct(editingProduct.id, input)}
          onBuyIngredient={(ingredientId) => {
            const ingredient = productMap.get(ingredientId);
            if (ingredient) {
              setEditingProduct(null);
              setSelected(ingredient);
            }
          }}
          onViewKardex={(p) => {
            setEditingProduct(null);
            setSelected(p);
          }}
        />
      )}

      {showAiImport && (
        <AiImportModal onClose={() => setShowAiImport(false)} createProduct={createProduct} />
      )}

      {productToDelete && (
        <ConfirmModal
          title="Eliminar producto"
          message={
            <>
              ¿Eliminar <span className="text-vimdy-text font-semibold">"{productToDelete.name}"</span> definitivamente? Esta acción no se puede deshacer.
            </>
          }
          confirmLabel="Eliminar"
          cancelLabel="Cancelar"
          danger
          onConfirm={confirmDeleteProduct}
          onCancel={() => setProductToDelete(null)}
        />
      )}
    </div>
  );
}

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
interface ReviewRow {
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

interface ImportResult {
  success: number;
  failed: string[];
}

function AiImportModal({
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
          // Precargado con la sugerencia de la IA (item.categoryId ya viene
          // resuelto contra las categorías reales del negocio, o null si no
          // matcheó ninguna) — pero el negocio puede cambiarlo en la tabla.
          categoryId: item.categoryId ?? "",
          // Default true (igual que el resto del catálogo): el negocio
          // apaga el switch fila por fila para lo que no va a cocina.
          requiresKitchen: true,
          stock: "0",
          recipeRows: [],
          taxRate: "",
          unit: inferUnitFromProductName(item.name),
          productionMode: "NONE",
          isIngredient: false
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

  function updateRow(id: string, field: "name" | "price" | "categoryId" | "stock" | "taxRate", value: string) {
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
        isIngredient: false
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
    (r) => r.name.trim() && Number(r.price) > 0 && !r.categoryId
  ).length;
  const validRowsCount = rows.filter(
    (r) => r.name.trim() && Number(r.price) > 0 && !!r.categoryId
  ).length;
  const canImport = validRowsCount > 0 && screen === "review";

  /**
   * Crea de verdad cada fila válida en InventoryEngine (Paso 3). Las filas
   * sin nombre, sin precio válido o sin categoría elegida (Paso 2.4: la
   * categoría ahora es por fila) se saltan y quedan listadas para que el
   * negocio las revise manualmente después.
   */
  async function handleImport() {
    if (!canImport) return;

    setScreen("importing");

    let success = 0;
    const failed: string[] = [];

    for (const row of rows) {
      const name = row.name.trim();
      const price = Number(row.price);

      if (!name || !price || price <= 0 || !row.categoryId) {
        if (name) failed.push(name);
        continue;
      }

      const input = buildProductInputFromImportRow(row, batchTax);
      const ok = await createProduct(input);

      if (ok) success++;
      else failed.push(name);
    }

    setResult({ success, failed });
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
                      className={`grid ${REVIEW_GRID_COLS} gap-2 items-center px-3 py-2 border-t border-vimdy-border`}
                    >
                    <input
                      value={row.name}
                      onChange={(e) => updateRow(row.id, "name", e.target.value)}
                      placeholder="Nombre del producto"
                      className={`h-9 px-2 rounded-vimdy-sm bg-vimdy-surface border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-ai ${
                        row.requiresReview ? "border-vimdy-warning/50" : "border-vimdy-border"
                      }`}
                    />
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-vimdy-text-tertiary text-sm">
                        $
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={row.price}
                        onChange={(e) => updateRow(row.id, "price", e.target.value)}
                        placeholder="0"
                        className={`w-full h-9 pl-5 pr-2 rounded-vimdy-sm bg-vimdy-surface border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-ai ${
                          row.requiresReview ? "border-vimdy-warning/50" : "border-vimdy-border"
                        }`}
                      />
                    </div>
                    <select
                      value={row.categoryId}
                      onChange={(e) => updateRow(row.id, "categoryId", e.target.value)}
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
                    {row.requiresReview ? (
                      <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-vimdy-warning/10 border border-vimdy-warning/40 text-vimdy-warning text-[11px] font-semibold w-fit">
                        Revisar
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
              </button>
            </div>
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
                  Puedes crearlos manualmente desde "Nuevo producto".
                </p>
              </div>
            )}

            <button
              onClick={handleCloseAndReset}
              className="w-full h-11 rounded-vimdy-md bg-vimdy-accent text-vimdy-background font-bold hover:bg-vimdy-accent-hover"
            >
              Aceptar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyProductsState({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyState
      icon={<Package size={28} />}
      title="Todavía no tienes productos."
      description="Crea tu primer producto para empezar a vender desde Caja y controlar tu inventario."
      action={{ label: "Crear mi primer producto", onClick: onCreate, icon: <Plus size={18} /> }}
    />
  );
}

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
function ProductFormModal({
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
    product?.requiresKitchen ?? true
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
    { rowId: string; productId: string; quantity: string; optional: boolean }[]
  >(
    product?.recipe?.map((r) => ({
      rowId: crypto.randomUUID(),
      productId: r.productId,
      quantity: String(r.quantity),
      optional: r.optional ?? false
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
      { rowId: crypto.randomUUID(), productId: "", quantity: "1", optional: false }
    ]);
  }

  function removeRecipeRow(rowId: string) {
    setRecipeRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  function updateRecipeRow(rowId: string, field: "productId" | "quantity", value: string) {
    setRecipeRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r)));
  }

  function toggleRecipeRowOptional(rowId: string) {
    setRecipeRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, optional: !r.optional } : r))
    );
  }

  // Ingredientes disponibles: cualquier otro producto del inventario (no el
  // producto que se está editando, para evitar que una receta se referencie
  // a sí misma).
  const ingredientOptions = useMemo(
    () => allProducts.filter((p) => p.id !== product?.id),
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
          optional: false
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

    const validRows = recipeRows.filter(
      (r) => r.productId && r.quantity.trim() && !isNaN(Number(r.quantity)) && Number(r.quantity) > 0
    );
    if (validRows.length === 0) return null;

    const draftRecipe: RecipeItem[] = validRows.map((r) => ({
      productId: r.productId,
      quantity: Number(r.quantity)
    }));
    const productMap = new Map(allProducts.map((p) => [p.id, p]));

    const draftProduct: Product = {
      id: product?.id ?? "__draft__",
      name: name.trim() || "Este producto",
      categoryId: categoryId || "",
      price: Number(price) || 0,
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
    const priceValue = Number(price);
    const purchasePriceValue = purchasePrice.trim() ? Number(purchasePrice) : undefined;
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
        const qty = Number(row.quantity);
        if (isNaN(qty) || qty <= 0) {
          setFormError("Cada ingrediente de la receta necesita una cantidad válida mayor a 0.");
          return;
        }
        parsedRows.push({ productId: row.productId, quantity: qty, optional: row.optional });
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
      const delta = row.priceDelta.trim() ? Number(row.priceDelta) : 0;
      if (isNaN(delta)) {
        setFormError(`El precio del tamaño "${row.name.trim()}" no es válido.`);
        return;
      }
      sizesValue.push({ id: crypto.randomUUID(), name: row.name.trim(), priceDelta: delta });
    }

    const extrasValue: ProductExtraOption[] = [];
    for (const row of extraRows) {
      if (!row.name.trim()) continue;
      const delta = row.priceDelta.trim() ? Number(row.priceDelta) : 0;
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
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Precio de compra</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="Ej: 8000"
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
            </div>

            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Precio de venta *</label>
              <input
                type="number"
                min={0}
                step="0.01"
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
              <select
                value={supplierId}
                onChange={(e) => {
                  setSupplierId(e.target.value);
                  if (e.target.value && e.target.value === alternateSupplierId) {
                    setAlternateSupplierId("");
                  }
                }}
                disabled={loadingOptions}
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
              >
                <option value="">Sin proveedor</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
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
                {recipeRows.map((row) => (
                  <div key={row.rowId} className="flex items-center gap-2">
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
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.quantity}
                      onChange={(e) => updateRecipeRow(row.rowId, "quantity", e.target.value)}
                      placeholder="Cant."
                      className="w-24 h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-recipe"
                    />
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
                ))}

                <VimdyButton
                  type="button"
                  onClick={addRecipeRow}
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                >
                  Agregar ingrediente
                </VimdyButton>

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
                        type="number"
                        step="0.01"
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
                        type="number"
                        step="0.01"
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

/**
 * BLOQUEANTE (auditoría Fase 2 — Panadería): pantalla de "Producir tanda".
 * Registra UNA tanda real (InventoryEngine.produceBatch): elige un producto
 * elaborado en modo 'BATCH' (ej. Pan), cuántas unidades se van a producir, y
 * muestra en vivo qué ingredientes se van a descontar y con qué stock
 * quedan — antes de confirmar, para que el negocio nunca reciba la sorpresa
 * de un ingrediente insuficiente después de intentarlo.
 */
function ProduceBatchModal({
  products,
  productMap,
  onClose,
  onProduce,
  error
}: {
  /** Solo productos con receta y productionMode === 'BATCH' (ver batchProducts en InventoryDashboard). */
  products: Product[];
  productMap: Map<string, Product>;
  onClose: () => void;
  onProduce: (productId: string, quantity: number) => Promise<boolean>;
  error: string | null;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selectedProduct = productId ? productMap.get(productId) : undefined;
  const quantityValue = Number(quantity);

  // Vista previa en vivo: reutiliza RecipeEngine (misma fuente de verdad que
  // usa ProductionIntelligencePanel), nunca recalcula el costo/capacidad por
  // su cuenta.
  const preview = useMemo(() => {
    if (!selectedProduct || !selectedProduct.recipe || isNaN(quantityValue) || quantityValue <= 0) {
      return null;
    }

    return selectedProduct.recipe.map((item) => {
      const ingredient = productMap.get(item.productId);
      const needed = item.quantity * quantityValue;
      const available = ingredient?.stock ?? 0;
      return {
        productId: item.productId,
        name: ingredient?.name ?? "Ingrediente eliminado",
        unit: ingredient?.unit,
        needed,
        available,
        remaining: available - needed,
        insufficient: available < needed
      };
    });
  }, [selectedProduct, quantityValue, productMap]);

  const hasInsufficientIngredient = preview?.some((row) => row.insufficient) ?? false;

  async function handleSubmit() {
    if (!productId) {
      setFormError("Selecciona qué producto vas a producir.");
      return;
    }
    if (isNaN(quantityValue) || quantityValue <= 0) {
      setFormError("La cantidad a producir debe ser mayor a 0.");
      return;
    }

    setFormError(null);
    setSaving(true);
    const ok = await onProduce(productId, quantityValue);
    setSaving(false);

    if (ok) {
      setDone(true);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-vimdy-text flex items-center gap-2">
              <Flame size={20} className="text-vimdy-warning" />
              Producir tanda
            </h2>
            <p className="text-vimdy-text-secondary text-sm mt-1">
              Descuenta los ingredientes de la receta y suma unidades listas al stock del
              producto.
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-vimdy-text-secondary hover:text-vimdy-text">
            <X size={20} />
          </button>
        </div>

        {done ? (
          <div className="text-center py-6 space-y-3">
            <div className="w-12 h-12 mx-auto rounded-full bg-vimdy-success/15 border border-vimdy-success/30 flex items-center justify-center">
              <Flame size={22} className="text-vimdy-success" />
            </div>
            <p className="text-vimdy-text font-semibold">
              Tanda registrada: {quantityValue} x {selectedProduct?.name}
            </p>
            <p className="text-vimdy-text-secondary text-sm">
              El stock ya quedó actualizado — puedes ver el detalle en el Kardex del producto.
            </p>
            <VimdyButton
              onClick={onClose}
              variant="primary"
            >
              Listo
            </VimdyButton>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Producto</label>
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-warning"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
                  Unidades a producir
                </label>
                <input
                  type="number"
                  min={1}
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-warning"
                />
              </div>

              {preview && preview.length > 0 && (
                <div className="rounded-vimdy-md border border-vimdy-border bg-vimdy-background/60 p-3">
                  <p className="text-vimdy-text-secondary text-xs font-medium mb-2">
                    Esto va a descontar:
                  </p>
                  <div className="space-y-1.5">
                    {preview.map((row) => (
                      <div key={row.productId} className="flex items-center justify-between text-xs">
                        <span className={row.insufficient ? "text-vimdy-danger" : "text-vimdy-text-secondary"}>
                          {row.name}
                        </span>
                        <span className={row.insufficient ? "text-vimdy-danger font-medium" : "text-vimdy-text-secondary"}>
                          {row.needed.toLocaleString("es-CO")} {row.unit ?? ""}
                          {" · "}
                          {row.insufficient
                            ? `solo hay ${row.available.toLocaleString("es-CO")}`
                            : `quedan ${row.remaining.toLocaleString("es-CO")}`}
                        </span>
                      </div>
                    ))}
                  </div>
                  {hasInsufficientIngredient && (
                    <p className="text-vimdy-danger text-xs mt-2 flex items-center gap-1.5">
                      <AlertTriangle size={13} />
                      No hay suficiente de uno o más ingredientes para esta tanda.
                    </p>
                  )}
                </div>
              )}

              {products.length === 0 && (
                <p className="text-vimdy-text-secondary text-sm">
                  No tienes productos configurados como "Por tanda" todavía. Márcalo en la
                  receta del producto (Editar producto → Este producto es elaborado → Por
                  tanda).
                </p>
              )}

              {(formError || error) && (
                <p className="text-vimdy-danger text-sm">{formError ?? error}</p>
              )}
            </div>

            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={handleSubmit}
                disabled={saving || products.length === 0}
                className="flex-1 h-11 rounded-vimdy-md bg-vimdy-warning text-vimdy-background font-bold hover:bg-vimdy-warning-hover disabled:opacity-60"
              >
                {saving ? "Produciendo..." : "Confirmar producción"}
              </button>
              <VimdyButton
                disabled={saving}
                onClick={onClose}
                variant="secondary"
              >
                Cancelar
              </VimdyButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  highlight
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: "yellow" | "red";
}) {
  const border =
    highlight === "red"
      ? "border-vimdy-danger/40"
      : highlight === "yellow"
      ? "border-vimdy-warning/40"
      : "border-vimdy-border";

  return (
    <div className={`rounded-vimdy-lg border ${border} bg-vimdy-surface p-4 flex items-center gap-3`}>
      <div className="w-11 h-11 rounded-vimdy-md bg-vimdy-surface flex items-center justify-center">{icon}</div>
      <div>
        <p className="text-vimdy-text-secondary text-xs">{label}</p>
        <p className="text-vimdy-text text-xl font-bold">{value}</p>
      </div>
    </div>
  );
}

/**
 * Editor rápido, inline, para la estación de impresión de la categoría YA
 * seleccionada en el formulario de producto (ej. si "Bebidas" todavía no
 * tiene estación, o si el negocio quiere cambiarla de "Barra" a "Bar").
 * No hay una pantalla aparte de "gestionar categorías" todavía — esto es
 * lo mínimo real para poder configurar/corregir la estación sin tener que
 * borrar y recrear la categoría.
 */
function CategoryStationEditor({
  category,
  onUpdated
}: {
  category: Category | undefined;
  onUpdated: (updated: Category) => void;
}) {
  const [value, setValue] = useState(category?.printStation ?? "");
  const [saving, setSaving] = useState(false);

  if (!category) return null;

  const dirty = value.trim() !== (category.printStation ?? "");

  async function handleSave() {
    if (!category) return;
    setSaving(true);
    try {
      const updated = await container.categoryEngine.get().update(category.id, {
        printStation: value.trim() || undefined
      });
      onUpdated(updated);
      toast.success(`Estación de "${category.name}" actualizada.`);
    } catch {
      toast.error("No se pudo guardar la estación de esta categoría.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2">
      <label className="block text-vimdy-text-secondary text-xs mb-1">
        Estación de impresión de "{category.name}"{" "}
        <span className="text-vimdy-text-tertiary">(ej: Barra, Cocina, Pastelería)</span>
      </label>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Sin estación configurada"
          className="flex-1 h-9 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-xs placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
        />
        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-3 h-9 rounded-vimdy-sm bg-vimdy-accent text-vimdy-background text-xs font-semibold hover:bg-vimdy-accent-hover disabled:opacity-50 shrink-0"
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
        )}
      </div>
    </div>
  );
}

function CategoryChip({
  label,
  count,
  active,
  onClick
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`h-8 px-3 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5 ${
        active
          ? "bg-vimdy-accent border-vimdy-accent text-vimdy-background"
          : "border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface-hover"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={active ? "text-vimdy-background/70" : "text-vimdy-text-tertiary"}>{count}</span>
      )}
    </button>
  );
}

function SortableHeader({
  label,
  active,
  dir,
  onClick
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th
      className="px-4 py-3 font-medium"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button onClick={onClick} className="flex items-center gap-1 hover:text-vimdy-text transition-colors">
        {label}
        {active && (dir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
      </button>
    </th>
  );
}

function AlertsPanel({
  products,
  onSelect
}: {
  products: Product[];
  onSelect: (p: Product) => void;
}) {
  const alerts = products
    .filter((p) => getStockStatus(p) !== "normal")
    .sort((a, b) => a.stock - b.stock);

  return (
    <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={18} className="text-vimdy-warning" />
        <h2 className="text-vimdy-text font-bold">Alertas de stock</h2>
      </div>

      {alerts.length === 0 ? (
        <p className="text-vimdy-text-tertiary text-sm">Todo el inventario está en niveles normales.</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((product) => {
            const status = getStockStatus(product);
            return (
              <li
                key={product.id}
                className="flex items-center justify-between rounded-vimdy-md border border-vimdy-border bg-vimdy-surface px-3 py-2"
              >
                <div>
                  <p className="text-vimdy-text text-sm font-medium">{product.name}</p>
                  <p className="text-vimdy-text-tertiary text-xs">
                    Stock: {product.stock} / mínimo {product.minStock}
                  </p>
                </div>
                <button
                  onClick={() => onSelect(product)}
                  className={`text-xs px-3 py-1.5 rounded-vimdy-sm font-semibold ${
                    status === "agotado"
                      ? "bg-vimdy-danger text-vimdy-text hover:bg-vimdy-danger-hover"
                      : "bg-vimdy-warning text-vimdy-background hover:bg-vimdy-warning-hover"
                  }`}
                >
                  Reabastecer
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RecentMovementsPanel({
  movements,
  products
}: {
  movements: InventoryMovement[];
  products: Product[];
}) {
  // Orden de prioridad: 1) el nombre real guardado en el propio movimiento
  // (ya no se pierde aunque el producto se edite o se elimine después),
  // 2) el nombre actual en la lista de productos (por si el movimiento es
  // viejo, de antes de este cambio, y no trae productName), 3) si ninguno
  // existe (producto eliminado y movimiento viejo), un texto claro en vez
  // del id crudo (UUID) que no le dice nada al usuario.
  const nameOf = (m: InventoryMovement) =>
    m.productName ?? products.find((p) => p.id === m.productId)?.name ?? "Producto eliminado";

  return (
    <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <History size={18} className="text-vimdy-accent" />
        <h2 className="text-vimdy-text font-bold">Últimos movimientos</h2>
      </div>

      {movements.length === 0 ? (
        <p className="text-vimdy-text-tertiary text-sm">Todavía no hay movimientos registrados.</p>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto">
          {movements.map((m) => (
            <li key={m.id} className="flex items-start gap-2 text-sm">
              {m.type === "INCREASE" ? (
                <ArrowUpCircle size={16} className="text-vimdy-success mt-0.5 shrink-0" />
              ) : (
                <ArrowDownCircle size={16} className="text-vimdy-danger mt-0.5 shrink-0" />
              )}
              <div>
                <p className="text-vimdy-text">
                  {nameOf(m)}{" "}
                  <span className={m.type === "INCREASE" ? "text-vimdy-success" : "text-vimdy-danger"}>
                    {m.type === "INCREASE" ? "+" : "-"}
                    {m.quantity}
                  </span>
                </p>
                <p className="text-vimdy-text-tertiary text-xs">{m.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProductDetailModal({
  product,
  allProducts,
  onClose,
  getHistory,
  increaseStock,
  decreaseStock,
  onUpdated,
  onEdit,
  onDuplicate,
  onDelete
}: {
  product: Product;
  allProducts: Product[];
  onClose: () => void;
  getHistory: (id: string) => Promise<InventoryMovement[]>;
  increaseStock: (id: string, qty: number, reason: string) => Promise<boolean>;
  decreaseStock: (id: string, qty: number, reason: string, lossCategory?: LossCategory) => Promise<boolean>;
  onUpdated: (p: Product) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [history, setHistory] = useState<InventoryMovement[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [mode, setMode] = useState<"increase" | "decrease" | "adjust" | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [lossCategory, setLossCategory] = useState<LossCategory | "">("");
  const [newStock, setNewStock] = useState("");
  const [saving, setSaving] = useState(false);

  // PASO 2 (Motor de Producción): costo real, rentabilidad y capacidad de
  // producción, calculados por la misma fuente de verdad que usa el resto
  // de VIMDY (BusinessAnalyzer, Gerente Inteligente). Solo aplica si el
  // producto tiene receta; para un producto simple no hay nada que calcular
  // aquí (su "capacidad" es directamente su stock, ya visible arriba).
  const hasRecipe = !!product.recipe && product.recipe.length > 0;
  const productMap = useMemo(() => new Map(allProducts.map((p) => [p.id, p])), [allProducts]);
  const recipeCost = useMemo(
    () => (hasRecipe ? container.recipeEngine.get().getRecipeCost(product, productMap) : null),
    [hasRecipe, product, productMap]
  );
  const profitability = useMemo(
    () => (hasRecipe ? container.recipeEngine.get().getProfitability(product, productMap) : null),
    [hasRecipe, product, productMap]
  );
  const capacity = useMemo(
    () => (hasRecipe ? container.recipeEngine.get().getProductionCapacity(product, productMap) : null),
    [hasRecipe, product, productMap]
  );

  React.useEffect(() => {
    setLoadingHistory(true);
    getHistory(product.id)
      .then(setHistory)
      .finally(() => setLoadingHistory(false));
  }, [product.id, getHistory]);

  async function handleConfirm() {
    setSaving(true);

    try {
      let ok = false;

      if (mode === "increase") {
        const qty = Number(quantity);
        if (!qty || qty <= 0) {
          toast.warning("Ingresa una cantidad válida.");
          setSaving(false);
          return;
        }
        ok = await increaseStock(product.id, qty, reason.trim() || "Entrada de inventario");
      } else if (mode === "decrease") {
        const qty = Number(quantity);
        if (!qty || qty <= 0) {
          toast.warning("Ingresa una cantidad válida.");
          setSaving(false);
          return;
        }
        if (!lossCategory) {
          toast.warning("Selecciona la categoría de la pérdida (merma, vencido, consumo interno, robo o error).");
          setSaving(false);
          return;
        }
        ok = await decreaseStock(product.id, qty, reason.trim() || "Salida de inventario", lossCategory || undefined);
      } else if (mode === "adjust") {
        const target = Number(newStock);
        if (Number.isNaN(target) || target < 0) {
          toast.warning("Ingresa un stock nuevo válido.");
          setSaving(false);
          return;
        }
        const diff = target - product.stock;
        if (diff === 0) {
          toast.info("El stock nuevo es igual al actual.");
          setSaving(false);
          return;
        }
        if (diff > 0) {
          ok = await increaseStock(product.id, diff, reason.trim() || "Ajuste de inventario");
        } else {
          ok = await decreaseStock(product.id, Math.abs(diff), reason.trim() || "Ajuste de inventario", "AJUSTE_ADMINISTRATIVO");
        }
      }

      if (ok) {
        setMode(null);
        setQuantity("");
        setReason("");
        setLossCategory("");
        setNewStock("");
        const fresh = await getHistory(product.id);
        setHistory(fresh);
        onUpdated({ ...product, stock: mode === "increase" ? product.stock + Number(quantity) : mode === "decrease" ? product.stock - Number(quantity) : Number(newStock) });
      }
    } finally {
      setSaving(false);
    }
  }

  const status = getStockStatus(product);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-vimdy-text">{product.name}</h2>
            <p className="text-vimdy-text-secondary text-sm">{product.categoryId}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onEdit}
              aria-label="Editar"
                            title="Editar"
              className="w-9 h-9 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface-hover flex items-center justify-center"
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={onDuplicate}
              aria-label="Duplicar"
                            title="Duplicar"
              className="w-9 h-9 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface-hover flex items-center justify-center"
            >
              <Copy size={16} />
            </button>
            <button
              onClick={onDelete}
              aria-label="Eliminar"
                            title="Eliminar"
              className="w-9 h-9 rounded-vimdy-sm border border-vimdy-danger/30 text-vimdy-danger hover:bg-vimdy-danger/10 flex items-center justify-center"
            >
              <Trash2 size={16} />
            </button>
            <button onClick={onClose} aria-label="Cerrar" className="text-vimdy-text-secondary hover:text-vimdy-text ml-1">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <InfoBox label="Stock actual" value={product.stock.toString()} />
          <InfoBox label="Mínimo" value={product.minStock.toString()} />
          <InfoBox label="Precio" value={money(product.price)} />
          {product.purchasePrice !== undefined && (
            <InfoBox label="Costo unitario" value={money(product.purchasePrice)} />
          )}
          {product.purchasePrice !== undefined && (
            <InfoBox label="Valor en inventario" value={money(product.purchasePrice * product.stock)} />
          )}
          {product.purchasePrice === undefined && product.trackStock !== false && (
            <InfoBox label="Valor en inventario" value="Sin costo configurado" />
          )}
        </div>

        <span className={`inline-block text-xs px-2 py-1 rounded-vimdy-sm mb-5 ${STATUS_CLASS[status]}`}>
          {STATUS_LABEL[status]}
        </span>
        {product.requiresKitchen !== false && !!product.estimatedPrepMinutes && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-vimdy-sm mb-5 ml-2 bg-vimdy-accent/10 text-vimdy-accent border border-vimdy-accent/30">
            <Clock3 size={12} />
            {product.estimatedPrepMinutes} min
          </span>
        )}

        {hasRecipe && recipeCost && profitability && capacity && (
          <div className="rounded-vimdy-md border border-vimdy-recipe/30 bg-vimdy-recipe/5 p-4 mb-6 space-y-3">
            <div className="flex items-center gap-2">
              <ChefHat size={15} className="text-vimdy-recipe" />
              <h3 className="text-vimdy-text font-semibold text-sm">Motor de producción</h3>
            </div>

            <ul className="space-y-1">
              {recipeCost.perIngredient.map((ing) => (
                <li key={ing.productId} className="flex items-center justify-between text-xs text-vimdy-text-secondary">
                  <span>
                    {ing.name} · {ing.quantity}
                    {ing.unit ? ` ${ing.unit}` : ""}
                    {ing.optional && (
                      <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-vimdy-recipe/15 text-vimdy-recipe border border-vimdy-recipe/30">
                        Opcional
                      </span>
                    )}
                  </span>
                  <span className={recipeCost.missingCostIngredients.includes(ing.name) ? "text-vimdy-warning" : "text-vimdy-text-secondary"}>
                    {recipeCost.missingCostIngredients.includes(ing.name) ? "Sin costo" : money(ing.subtotal)}
                  </span>
                </li>
              ))}
            </ul>

            {recipeCost.missingCostIngredients.length > 0 && (
              <p className="text-vimdy-warning text-xs flex items-center gap-1.5">
                <AlertTriangle size={12} className="shrink-0" />
                Costo no confiable: falta precio de compra de {recipeCost.missingCostIngredients.join(", ")}.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 border-t border-vimdy-recipe/20 pt-3">
              <InfoBox label="Costo por porción" value={money(recipeCost.costPerPortion)} />
              <InfoBox
                label="Ganancia por unidad"
                value={`${money(profitability.profit)} (${Math.round(profitability.marginPercent)}%)`}
              />
              {!!product.estimatedPrepMinutes && (
                <InfoBox label="Tiempo estimado" value={`${product.estimatedPrepMinutes} min`} />
              )}
            </div>

            <div
              className={`rounded-vimdy-sm px-3 py-2 text-sm ${
                capacity.maxUnits > 0
                  ? "bg-vimdy-surface border border-vimdy-border text-vimdy-text"
                  : "bg-vimdy-danger/10 border border-vimdy-danger/30 text-vimdy-danger font-semibold"
              }`}
            >
              {capacity.maxUnits > 0 ? (
                <>
                  Con el stock actual alcanza para preparar <strong>{capacity.maxUnits}</strong> unidad(es).
                </>
              ) : (
                <>No se puede preparar más: falta {capacity.limitingIngredient?.name ?? "un ingrediente"}.</>
              )}
              {capacity.limitingIngredient && capacity.maxUnits > 0 && (
                <p className="text-vimdy-text-tertiary text-xs mt-1">
                  Ingrediente limitante: {capacity.limitingIngredient.name} ({capacity.limitingIngredient.stockAvailable}{" "}
                  disponible)
                </p>
              )}
            </div>
          </div>
        )}

        {mode === null ? (
          <div className="flex gap-3 mb-6">
            <button
              onClick={() => setMode("increase")}
              className="flex-1 h-11 rounded-vimdy-md bg-vimdy-success/15 border border-vimdy-success/40 text-vimdy-success font-semibold hover:bg-vimdy-success/25 flex items-center justify-center gap-2"
            >
              <ArrowUpCircle size={18} />
              Entrada
            </button>
            <button
              onClick={() => setMode("decrease")}
              className="flex-1 h-11 rounded-vimdy-md bg-vimdy-danger/15 border border-vimdy-danger/40 text-vimdy-danger font-semibold hover:bg-vimdy-danger/25 flex items-center justify-center gap-2"
            >
              <ArrowDownCircle size={18} />
              Salida / Merma
            </button>
            <button
              onClick={() => setMode("adjust")}
              className="flex-1 h-11 rounded-vimdy-md bg-vimdy-warning/15 border border-vimdy-warning/40 text-vimdy-warning font-semibold hover:bg-vimdy-warning/25 flex items-center justify-center gap-2"
            >
              <Scale size={18} />
              Ajuste
            </button>
          </div>
        ) : (
          <div className="rounded-vimdy-md border border-vimdy-border bg-vimdy-surface p-4 mb-6 space-y-3">
            <p className="text-vimdy-text font-semibold text-sm">
              {mode === "increase" && "Registrar entrada"}
              {mode === "decrease" && "Registrar salida / merma"}
              {mode === "adjust" && "Ajuste de inventario"}
            </p>

            {mode === "adjust" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-vimdy-text-secondary mb-1">Stock actual</label>
                    <input
                      type="text"
                      value={product.stock.toString()}
                      disabled
                      className="w-full h-10 px-3 rounded-vimdy-sm bg-vimdy-background/60 border border-vimdy-border text-vimdy-text-tertiary text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-vimdy-text-secondary mb-1">Stock nuevo</label>
                    <input
                      type="number"
                      min={0}
                      value={newStock}
                      onChange={(e) => setNewStock(e.target.value)}
                      placeholder="Cantidad final"
                      className="w-full h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
                    />
                  </div>
                </div>
                {newStock && !Number.isNaN(Number(newStock)) && (
                  <p className="text-xs text-vimdy-text-secondary">
                    Diferencia: <span className={Number(newStock) - product.stock >= 0 ? "text-vimdy-success" : "text-vimdy-danger"}>{Number(newStock) - product.stock >= 0 ? "+" : ""}{Number(newStock) - product.stock}</span>
                  </p>
                )}
              </>
            ) : (
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Cantidad"
                className="w-full h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
              />
            )}

            {mode === "decrease" && (
              <select
                value={lossCategory}
                onChange={(e) => setLossCategory(e.target.value as LossCategory | "")}
                className="w-full h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
              >
                <option value="">Categoría de la pérdida...</option>
                {(Object.keys(LOSS_CATEGORY_LABEL) as LossCategory[]).map((key) => (
                  <option key={key} value={key}>
                    {LOSS_CATEGORY_LABEL[key]}
                  </option>
                ))}
              </select>
            )}

            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                mode === "increase"
                  ? "Motivo (ej: compra a proveedor)"
                  : mode === "decrease"
                  ? "Detalle (ej: se cayó al piso)"
                  : "Motivo del ajuste (ej: conteo físico)"
              }
              className="w-full h-10 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
            />
            <div className="flex gap-2">
              <VimdyButton
                loading={saving}
                onClick={handleConfirm}
                variant="primary"
                size="sm"
                fullWidth
              >
                Confirmar
              </VimdyButton>
              <VimdyButton
                disabled={saving}
                onClick={() => {
                  setMode(null);
                  setLossCategory("");
                  setQuantity("");
                  setNewStock("");
                }}
                variant="secondary"
                size="sm"
              >
                Cancelar
              </VimdyButton>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center gap-2 mb-3">
            <History size={16} className="text-vimdy-accent" />
            <h3 className="text-vimdy-text font-semibold text-sm">Historial (Kardex)</h3>
          </div>

          {loadingHistory ? (
            <p className="text-vimdy-text-tertiary text-sm">Cargando historial...</p>
          ) : history.length === 0 ? (
            <p className="text-vimdy-text-tertiary text-sm">Este producto no tiene movimientos todavía.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between text-sm rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {m.type === "INCREASE" ? (
                      <ArrowUpCircle size={15} className="text-vimdy-success" />
                    ) : (
                      <ArrowDownCircle size={15} className="text-vimdy-danger" />
                    )}
                    <span className="text-vimdy-text-secondary">{m.reason}</span>
                    {m.lossCategory && (
                      <span className="text-xs px-1.5 py-0.5 rounded-vimdy-xs bg-vimdy-danger/15 text-vimdy-danger border border-vimdy-danger/30">
                        {LOSS_CATEGORY_LABEL[m.lossCategory]}
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <p className={m.type === "INCREASE" ? "text-vimdy-success" : "text-vimdy-danger"}>
                      {m.type === "INCREASE" ? "+" : "-"}
                      {m.quantity}
                    </p>
                    <p className="text-vimdy-text-tertiary text-xs">
                      {new Date(m.date).toLocaleString("es-CO")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-vimdy-md border border-vimdy-border bg-vimdy-surface p-3">
      <p className="text-vimdy-text-tertiary text-xs">{label}</p>
      <p className="text-vimdy-text font-bold">{value}</p>
    </div>
  );
}