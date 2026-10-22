import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useCommandIntent } from "../../../hooks/useCommandIntent";
import { toast } from "../../../core/store/toastStore";
import { ConfirmModal } from "../ui/ConfirmModal";
import { VimdyButton } from "../ui/VimdyButton";
import { SkeletonCards, SkeletonRows, Skeleton } from "../ui/Skeleton";
import { MinusCircle, Search, X, Plus, Trash2, Pencil, Sparkles, Copy, Flame, RefreshCw, Tag, FileSpreadsheet, ChevronLeft, ChevronRight } from "lucide-react";
import { getStockStatus, StockStatus } from "../../../core/store/useInventory";
import { useCategories } from "../../../hooks/useCategories";
import { OfflineStatusBadge } from "../ui/OfflineStatusBadge";
import { usePendingInventoryAdjustmentsQueue } from "../../../core/offline/usePendingInventoryAdjustmentsQueue";
import { Product } from "../../../core/entities/Entities";
import { normalizeSearchText, productMatchesSearch } from "../../../core/utils/searchText";
import { ProductType, inferProductType } from "../../../core/types/productType";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useNavigate } from "react-router-dom";
import { getBranches, getCurrentBranchId, getCurrentBusinessId } from "../../../infrastructure/supabase/supabaseClient";
import { STATUS_CLASS, STATUS_LABEL, SortKey, money } from "./inventoryShared";
import type { InventoryState } from "./inventoryShared";
import { EmptyProductsState } from "./EmptyProductsState";
import { getProductProfitView } from "./productProfit";
import { AlertsPanel, CategoryChip, RecentMovementsPanel, SortableHeader } from "./InventoryWidgets";
import { useAuth } from "../../context/AuthContext";
import { QuickWasteModal } from "./QuickWasteModal";

// Las ventanas (modales) pesan mucho y solo se abren al hacer clic: se descargan
// aparte. Después del primer pintado se precargan en segundo plano para que al
// hacer clic abran al instante.
const loadProductFormModal = () => import("./ProductFormModal").then((m) => ({ default: m.ProductFormModal }));
const loadProductDetailModal = () => import("./ProductDetailModal").then((m) => ({ default: m.ProductDetailModal }));
const loadAiImportModal = () => import("./AiImportModal").then((m) => ({ default: m.AiImportModal }));
const loadProduceBatchModal = () => import("./ProduceBatchModal").then((m) => ({ default: m.ProduceBatchModal }));
const loadCategoriesManagerModal = () => import("./CategoriesManagerModal").then((m) => ({ default: m.CategoriesManagerModal }));
const ProductFormModal = lazy(loadProductFormModal);
const ProductDetailModal = lazy(loadProductDetailModal);
const AiImportModal = lazy(loadAiImportModal);
const CsvImportModal = lazy(() => import("./CsvImportModal").then((m) => ({ default: m.CsvImportModal })));
const ProduceBatchModal = lazy(loadProduceBatchModal);
const CategoriesManagerModal = lazy(loadCategoriesManagerModal);

export function InventoryDashboard({ inventory }: { inventory: InventoryState }) {
  const navigate = useNavigate();

  useEffect(() => {
    const preload = () => {
      void loadProductFormModal();
      void loadProductDetailModal();
      void loadProduceBatchModal();
      void loadCategoriesManagerModal();
      void loadAiImportModal();
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(preload);
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(preload, 1500);
    return () => window.clearTimeout(id);
  }, []);
  const {
    // `allProducts` incluye insumos: solo para resolver recetas/capacidad,
    // movimientos y el selector de ingredientes. La tabla, filtros, alertas y
    // KPIs de esta pestaña usan `products` (solo lo que se vende).
    products: allProducts,
    sellableProducts: products,
    recentMovements,
    loading,
    error,
    getHistory,
    increaseStock,
    decreaseStock,
    produceBatch,
    createProduct,
    updateProduct,
    deleteProduct,
    reactivateProduct,
    productsWithCost,
    refresh
  } = inventory;
  const { user } = useAuth();

  const { productCategories: categories } = useCategories();

  // PASO 1.10 (offline elegante en Inventario) — cuántos ajustes de stock
  // hechos sin conexión siguen esperando sincronizarse, para el badge del
  // encabezado (ver OfflineStatusBadge más abajo).
  const { count: pendingAdjustmentsCount } = usePendingInventoryAdjustmentsQueue();

  // PASO 2 (Motor de Producción): mapa id->Product reutilizado por
  // RecipeEngine para resolver costo/capacidad sin volver a consultar el
  // repositorio en cada fila de la tabla.
  const productMap = useMemo(() => new Map(allProducts.map((p) => [p.id, p])), [allProducts]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StockStatus | "todos">("todos");
  const [showInactive, setShowInactive] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("todos");
  const [productTypeFilter, setProductTypeFilter] = useState<ProductType | "todos">("todos");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // Paginación por bloques: con catálogos grandes (500+) pintar todas las filas
  // de golpe vuelve pesada la tabla en celulares y tablets sencillas.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [selected, setSelected] = useState<Product | null>(null);
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showAiImport, setShowAiImport] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [wasteProduct, setWasteProduct] = useState<Product | null>(null);
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
    try {
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
    } finally {
      setDuplicating(null);
    }
  }

  // Nombre visible de cada categoría dentro de la tabla (product.categoryId
  // es un id interno; esto lo resuelve al nombre real sin tocar el motor).
  const categoryNameById = useMemo(() => {
    const map: Record<string, string> = {};
    categories.forEach((c) => {
      map[c.id] = c.name;
    });
    return map;
  }, [categories]);

  const filtered = useMemo(() => {
    let list = products;

    if (!showInactive) {
      list = list.filter((p) => p.active !== false);
    }

    if (search.trim() !== "") {
      const value = normalizeSearchText(search);
      list = list.filter((p) => productMatchesSearch(p, value, categoryNameById[p.categoryId]));
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
  }, [
    products,
    search,
    statusFilter,
    categoryFilter,
    productTypeFilter,
    showInactive,
    sortKey,
    sortDir,
    categoryNameById
  ]);

  // Al cambiar búsqueda, filtros u orden se vuelve a la primera página.
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, categoryFilter, productTypeFilter, showInactive, sortKey, sortDir, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Si la lista se encoge (ej. se borró un producto en la última página), no
  // se queda parada en una página que ya no existe.
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = useMemo(
    () => filtered.slice(pageStart, pageStart + pageSize),
    [filtered, pageStart, pageSize]
  );

  // "Te cuesta / Ganas" de cada fila VISIBLE, calculado una sola vez por cambio
  // de página/lista (no en cada tecla que se escribe en el buscador).
  const profitById = useMemo(() => {
    const engine = container.recipeEngine.get();
    return new Map(pageItems.map((p) => [p.id, getProductProfitView(p, () => engine.getProfitability(p, productMap))]));
  }, [pageItems, productMap]);

  // Solo mostramos como chip las categorías que de verdad tienen productos,
  // para no llenar la barra de filtros con categorías vacías.
  const categoryChips = useMemo(() => {
    const countByCategory: Record<string, number> = {};
    products.forEach((p) => {
      if (p.active === false && !showInactive) return;
      countByCategory[p.categoryId] = (countByCategory[p.categoryId] ?? 0) + 1;
    });
    return categories
      .filter((c) => countByCategory[c.id] > 0)
      .map((c) => ({ id: c.id, name: c.name, count: countByCategory[c.id] }));
  }, [categories, products, showInactive]);

  // Si el chip de la categoría seleccionada desaparece (se borró, se movió su
  // último producto, se ocultó un desactivado...), el filtro quedaba "pegado"
  // en una categoría invisible y la tabla se veía vacía sin explicación.
  useEffect(() => {
    if (categoryFilter !== "todos" && !categoryChips.some((c) => c.id === categoryFilter)) {
      setCategoryFilter("todos");
    }
  }, [categoryChips, categoryFilter]);

  const hasActiveFilters =
    search.trim() !== "" ||
    statusFilter !== "todos" ||
    categoryFilter !== "todos" ||
    productTypeFilter !== "todos";

  function clearFilters() {
    setSearch("");
    setStatusFilter("todos");
    setCategoryFilter("todos");
    setProductTypeFilter("todos");
  }

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
    const activeProducts = products.filter((p) => p.active !== false);
    const rows = activeProducts.map((p) => {
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-vimdy-accent/20 text-vimdy-accent">Lo que vendes</span>
              <span className="text-xs text-vimdy-text-tertiary">Aparecen en Caja</span>
            </div>
            <h1 className="text-2xl font-bold text-vimdy-text mt-1">Productos</h1>
            <p className="text-vimdy-text-secondary text-sm mt-1">
              Platos, bebidas y servicios del menú. Los que llevan receta descuentan sus insumos al venderse.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <OfflineStatusBadge
              pendingCount={pendingAdjustmentsCount}
              pendingLabelSingular="1 ajuste de stock pendiente"
              pendingLabelPlural="{count} ajustes de stock pendientes"
            />
            <VimdyButton
              onClick={() => setShowNewProduct(true)}
              size="sm"
              icon={<Plus size={16} />}
            >
              Nuevo producto
            </VimdyButton>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-vimdy-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-vimdy-border"
            />
            Mostrar desactivados
          </label>
          {batchProducts.length > 0 && (
            <button
              onClick={() => setShowProduceModal(true)}
              className="h-10 px-4 rounded-vimdy-md border border-vimdy-warning/40 bg-vimdy-warning/10 text-vimdy-warning font-bold hover:bg-vimdy-warning/20 flex items-center gap-2 text-sm"
            >
              <Flame size={16} />
              Producir tanda
            </button>
          )}
          <button
            onClick={() => setShowCategories(true)}
            className="h-10 px-4 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface text-vimdy-text-secondary font-bold hover:border-vimdy-accent hover:text-vimdy-text flex items-center gap-2 text-sm"
          >
            <Tag size={16} />
            Categorías
          </button>
          <button
            onClick={() => setShowAiImport(true)}
            className="h-10 px-4 rounded-vimdy-md border border-vimdy-ai/40 bg-vimdy-ai/10 text-vimdy-ai font-bold hover:bg-vimdy-ai/20 flex items-center gap-2 text-sm"
          >
            <Sparkles size={16} />
            Importar con IA
          </button>
          <button
            onClick={() => setShowCsvImport(true)}
            className="h-10 px-4 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface text-vimdy-text-secondary font-bold hover:border-vimdy-accent hover:text-vimdy-text flex items-center gap-2 text-sm"
          >
            <FileSpreadsheet size={16} />
            Importar Excel
          </button>
        </div>
      </div>

      {showProduceModal && (
        <Suspense fallback={null}>
          <ProduceBatchModal
            products={batchProducts}
            productMap={productMap}
            onClose={() => setShowProduceModal(false)}
            onProduce={produceBatch}
            error={error}
          />
        </Suspense>
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
                  disabled={!transferTargetBranchId || transferQuantity <= 0 || transferQuantity > transferProduct.stock}
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
      <div className="grid grid-cols-1 gap-6">
        {/* Tabla de productos */}
        <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface overflow-hidden">
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
              aria-label="Filtrar por estado de stock"
              className={`h-10 px-3 rounded-vimdy-md bg-vimdy-surface border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent ${
                statusFilter !== "todos" ? "border-vimdy-accent" : "border-vimdy-border"
              }`}
            >
              <option value="todos">Todos los estados</option>
              <option value="normal">Normal</option>
              <option value="bajo">Stock bajo</option>
              <option value="agotado">Agotado</option>
            </select>

            <select
              value={productTypeFilter}
              onChange={(e) => setProductTypeFilter(e.target.value as ProductType | "todos")}
              aria-label="Filtrar por tipo de producto"
              className={`h-10 px-3 rounded-vimdy-md bg-vimdy-surface border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent ${
                productTypeFilter !== "todos" ? "border-vimdy-accent" : "border-vimdy-border"
              }`}
            >
              <option value="todos">Todos los tipos</option>
              <option value="inventario">Producto para vender</option>
              <option value="cocina">Producto preparado</option>
              <option value="cocina_receta">Producto con receta</option>
              <option value="servicio">Servicio</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-10 px-3 rounded-vimdy-md border border-vimdy-accent/40 text-vimdy-accent text-sm font-semibold hover:bg-vimdy-accent/10 flex items-center gap-1.5 shrink-0"
              >
                <X size={14} />
                Limpiar filtros
              </button>
            )}
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
                  <th className="px-4 py-3 font-medium">Receta</th>
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
                    <td colSpan={8} className="px-4 py-10 text-center text-vimdy-text-tertiary">
                      {hasActiveFilters ? (
                        <div className="flex flex-col items-center gap-3">
                          <span>Ningún producto coincide con los filtros activos.</span>
                          <button
                            type="button"
                            onClick={clearFilters}
                            className="h-9 px-4 rounded-vimdy-md border border-vimdy-accent/40 text-vimdy-accent text-sm font-semibold hover:bg-vimdy-accent/10"
                          >
                            Limpiar filtros
                          </button>
                        </div>
                      ) : (
                        "No se encontraron productos."
                      )}
                    </td>
                  </tr>
                )}
                {pageItems.map((product) => {
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
                      <td className="px-4 py-3 whitespace-nowrap">
                        {product.recipe && product.recipe.length > 0 ? (
                          <span className="text-xs px-2 py-0.5 rounded-vimdy-sm bg-vimdy-recipe/20 text-vimdy-recipe border border-vimdy-recipe/30">
                            Receta · {product.recipe.length} {product.recipe.length === 1 ? "insumo" : "insumos"}
                          </span>
                        ) : (
                          <span className="text-xs text-vimdy-text-tertiary">{product.trackStock === false && !product.requiresKitchen ? "No aplica" : "Sin receta"}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-vimdy-text">{product.stock}</td>
                      <td className="px-4 py-3 text-vimdy-text-secondary">{product.minStock}</td>
                      <td className="px-4 py-3">
                        <p className="text-vimdy-accent font-semibold">{money(product.price)}</p>
                        {(() => {
                          const profit = profitById.get(product.id);
                          if (!profit || profit.kind === "none") return null;
                          if (profit.kind === "missing-cost") {
                            return (
                              <p className="text-xs text-vimdy-warning" title="Agrega el costo (del producto o de sus insumos) para saber cuánto ganas.">
                                Falta el costo
                              </p>
                            );
                          }
                          return (
                            <p className="text-xs text-vimdy-text-secondary whitespace-nowrap">
                              Te cuesta {money(profit.cost)} ·{" "}
                              {profit.profit < 0 ? (
                                <span className="text-vimdy-danger font-semibold">Pierdes {money(Math.abs(profit.profit))}</span>
                              ) : (
                                <span className="text-vimdy-success font-semibold">Ganas {money(profit.profit)}</span>
                              )}
                            </p>
                          );
                        })()}
                      </td>
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
                          {product.trackStock !== false && product.active !== false && product.stock > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setWasteProduct(product);
                              }}
                              aria-label="Registrar merma"
                              title="Registrar merma"
                              className="w-8 h-8 rounded-vimdy-sm border border-vimdy-warning/30 text-vimdy-warning hover:bg-vimdy-warning/10 flex items-center justify-center"
                            >
                              <MinusCircle size={14} />
                            </button>
                          )}
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
                          {product.active === false && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                reactivateProduct(product.id);
                              }}
                              aria-label="Reactivar"
                              title="Reactivar producto"
                              className="w-8 h-8 rounded-vimdy-sm border border-vimdy-success/30 text-vimdy-success hover:bg-vimdy-success/10 flex items-center justify-center"
                            >
                              <RefreshCw size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length > 0 && (
            <div className="px-4 py-3 border-t border-vimdy-border flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between text-sm text-vimdy-text-secondary">
              <span>
                Mostrando {pageStart + 1}–{Math.min(pageStart + pageSize, filtered.length)} de {filtered.length}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-2">
                  <span className="text-vimdy-text-tertiary">Por página</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    aria-label="Productos por página"
                    className="h-9 px-2 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  aria-label="Página anterior"
                  className="w-9 h-9 rounded-vimdy-md border border-vimdy-border flex items-center justify-center hover:bg-vimdy-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="tabular-nums min-w-[5.5rem] text-center">
                  Página {currentPage} de {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  aria-label="Página siguiente"
                  className="w-9 h-9 rounded-vimdy-md border border-vimdy-border flex items-center justify-center hover:bg-vimdy-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Alertas + últimos movimientos */}
        <div className="space-y-6">
          <AlertsPanel products={products} onSelect={setSelected} />
          <RecentMovementsPanel movements={recentMovements} products={allProducts} />
        </div>
      </div>
        </>
      )}

      {selected && (
        <Suspense fallback={null}>
          <ProductDetailModal
            product={selected}
            categoryName={categoryNameById[selected.categoryId]}
            saveError={error}
            allProducts={allProducts}
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
        </Suspense>
      )}

      {wasteProduct && (
        <QuickWasteModal
          product={allProducts.find((p) => p.id === wasteProduct.id) ?? wasteProduct}
          decreaseStock={decreaseStock}
          onClose={() => setWasteProduct(null)}
        />
      )}

      {showCategories && (
        <Suspense fallback={null}>
          <CategoriesManagerModal onClose={() => setShowCategories(false)} />
        </Suspense>
      )}

      {showNewProduct && (
        <Suspense fallback={null}>
          <ProductFormModal
            onClose={() => setShowNewProduct(false)}
            onSave={createProduct}
            saveError={error}
            onBuyIngredient={(ingredientId) => {
              const ingredient = productMap.get(ingredientId);
              if (ingredient) {
                setShowNewProduct(false);
                setSelected(ingredient);
              }
            }}
          />
        </Suspense>
      )}

      {editingProduct && (
        <Suspense fallback={null}>
          <ProductFormModal
            product={editingProduct}
            onClose={() => setEditingProduct(null)}
            onSave={(input) => updateProduct(editingProduct.id, input)}
            saveError={error}
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
        </Suspense>
      )}

      {showAiImport && (
        <Suspense fallback={null}>
          <AiImportModal onClose={() => setShowAiImport(false)} createProduct={createProduct} />
        </Suspense>
      )}

      {showCsvImport && (
        <Suspense fallback={null}>
          <CsvImportModal
            onClose={() => setShowCsvImport(false)}
            existingProducts={allProducts}
            performedBy={user?.name}
            onImported={refresh}
          />
        </Suspense>
      )}

      {productToDelete && (
        <ConfirmModal
          title="Eliminar producto"
          message={
            <>
              {productToDelete.price > 0 || (productToDelete.stock ?? 0) > 0
                ? <>Si el producto tiene historial de ventas o movimientos, se ocultará del inventario en vez de borrarse por completo, para no perder ese historial. Si nunca se ha usado, se elimina para siempre.</>
                : <>Este producto no tiene historial y se eliminará permanentemente. Esta acción no se puede deshacer.</>}
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