import React, { useEffect, useMemo, useState } from "react";
import { toast } from "../../../core/store/toastStore";
import { EmptyState } from "../ui/EmptyState";
import { VimdyButton } from "../ui/VimdyButton";
import { SkeletonRows, Skeleton } from "../ui/Skeleton";
import { getStockStatus, StockStatus } from "../../../core/store/useInventory";
import type { InventoryState } from "./inventoryShared";
import { useCategories } from "../../../hooks/useCategories";
import { OfflineStatusBadge } from "../ui/OfflineStatusBadge";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { Product, Category, Supplier, LossCategory } from "../../../core/entities/Entities";
import { ProductInput } from "../../../core/engines/InventoryEngine";
import { ProductType, resolveProductFlags } from "../../../core/types/productType";
import { formatMoney } from "../../../core/utils/formatMoney";
import { parseMoneyInput } from "../../../core/utils/parseMoneyInput";
import { toMoneyInputValue } from "../../../core/utils/formatMoneyInput";
import { computePackUnitCost, isPackUnit } from "../../../core/utils/packageCost";
import { normalizeUnit } from "../../../core/utils/unitConversion";
import { MoneyInput } from "../ui/MoneyInput";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { getBranches, getCurrentBranchId, getCurrentBusinessId } from "../../../infrastructure/supabase/supabaseClient";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  X,
  Package,
  AlertTriangle,
  PackageX,
  Download,
  ChefHat,
  History
} from "lucide-react";
import { ConfirmModal } from "../ui/ConfirmModal";
import { QuickWasteModal } from "./QuickWasteModal";
import { useAuth } from "../../context/AuthContext";
import { hasMaskedStock, isStockMasked, stockMaskBadge } from "../../../core/utils/stockMask";

const money = (value: number) => {
  const currency = companyConfigStore.get().currency;
  const language = companyConfigStore.get().language;
  return formatMoney(value, currency, language);
};

type Tab = "insumos" | "recetas" | "historial";

// Motivos de un ajuste hacia abajo, en palabras del dueño. Cada uno queda
// guardado con su categoría de pérdida real en el historial de movimientos.
const ADJUST_REASONS: ReadonlyArray<{ id: LossCategory; label: string }> = [
  { id: "AJUSTE_ADMINISTRATIVO", label: "Al contar, no coincidía" },
  { id: "DAÑO", label: "Se dañó o se botó" },
  { id: "VENCIDO", label: "Se venció" },
  { id: "CONSUMO_INTERNO", label: "Lo usamos en la cocina o en casa" },
  { id: "OTRO", label: "Otro motivo" }
];

export function InsumosPanel({ inventory }: { inventory: InventoryState }) {
  // Costos: solo quien tenga inventory.viewCosts (ADMIN).
  const { can } = useAuth();
  const canViewCosts = can("inventory.viewCosts");
  const {
    products,
    loading,
    error,
    createProduct,
    updateProduct,
    deleteProduct,
    increaseStock,
    decreaseStock
  } = inventory;

  const { categories, insumoCategories, createCategory } = useCategories();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StockStatus | "todos">("todos");
  const [categoryFilter, setCategoryFilter] = useState<string>("todos");
  const [showNewInsumo, setShowNewInsumo] = useState(false);
  const [editingInsumo, setEditingInsumo] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [wasteTarget, setWasteTarget] = useState<Product | null>(null);
  const [purchaseTarget, setPurchaseTarget] = useState<Product | null>(null);
  const [purchaseQty, setPurchaseQty] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [adjustCount, setAdjustCount] = useState("");
  const [adjustReason, setAdjustReason] = useState<LossCategory>("AJUSTE_ADMINISTRATIVO");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: "", phone: "", email: "", address: "" });
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  const insumos = useMemo(() => {
    return products.filter((p) => p.isIngredient === true);
  }, [products]);

  // Conteo a ciegas activo: el servidor entrega stock y costo enmascarados.
  // Se muestra solo el estado (🟢 / 🟡 / 🔴), nunca cantidades ni costos.
  const countMasked = useMemo(() => hasMaskedStock(products), [products]);

  // Categorías propias de insumos (Carnes, Verduras, Lácteos, Empaques...).
  // Se suman las categorías que ya usan insumos creados antes de existir esta
  // separación, para no dejarlos "Sin categoría".
  const visibleCategories = useMemo(() => {
    const usedIds = new Set(insumos.map((p) => p.categoryId));
    const legacy = categories.filter((c) => c.kind !== "INSUMO" && usedIds.has(c.id));
    return [...insumoCategories, ...legacy].sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, insumoCategories, insumos]);

  const filteredInsumos = useMemo(() => {
    let list = insumos;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          (p.barcode && p.barcode.toLowerCase().includes(q))
      );
    }

    if (statusFilter !== "todos") {
      list = list.filter((p) => getStockStatus(p) === statusFilter);
    }

    if (categoryFilter !== "todos") {
      list = list.filter((p) => p.categoryId === categoryFilter);
    }

    return list;
  }, [insumos, search, statusFilter, categoryFilter]);

  useEffect(() => {
    async function loadSuppliers() {
      const businessId = getCurrentBusinessId();
      if (!businessId) return;
      setLoadingSuppliers(true);
      try {
        const all = await container.supplierEngine.get().listAll();
        setSuppliers(all);
      } catch (err) {
        console.error("[InsumosPanel] No se pudieron cargar los proveedores:", err);
        setSuppliers([]);
      } finally {
        setLoadingSuppliers(false);
      }
    }
    loadSuppliers();
  }, []);

  async function confirmDelete() {
    const product = productToDelete;
    if (!product) return;
    const ok = await deleteProduct(product.id);
    if (ok) {
      setProductToDelete(null);
    }
  }

  // Qué productos de venta consumen cada insumo (receta vinculada).
  const usedIn = new Map<string, string[]>();
  products.forEach((p) => {
    if (p.isIngredient === true || !p.recipe) return;
    p.recipe.forEach((r) => usedIn.set(r.productId, [...(usedIn.get(r.productId) ?? []), p.name]));
  });
  const grouped = (() => {
    const m = new Map<string, Product[]>();
    filteredInsumos.forEach((i) => m.set(i.categoryId, [...(m.get(i.categoryId) ?? []), i]));
    return [...m.entries()]
      .map(([id, items]) => ({
        id,
        name: categories.find((c) => c.id === id)?.name ?? "Sin categoría",
        items: [...items].sort((x, y) => x.name.localeCompare(y.name))
      }))
      .sort((x, y) => x.name.localeCompare(y.name));
  })();

  async function confirmPurchase() {
    if (!purchaseTarget) return;
    const qty = Number(purchaseQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Ingresa una cantidad mayor que 0.");
      return;
    }
    const cost = purchaseCost.trim() === "" ? undefined : parseMoneyInput(purchaseCost);
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) {
      toast.error("El costo unitario no es válido.");
      return;
    }
    const ok = await increaseStock(purchaseTarget.id, qty, "Compra de insumo", undefined, cost);
    if (ok) {
      toast.success(`Entrada registrada: ${qty} ${purchaseTarget.unit ?? "und"} de ${purchaseTarget.name}.`);
      setPurchaseTarget(null);
      setPurchaseQty("");
      setPurchaseCost("");
    }
  }

  // Ajustar: siempre se compara contra el stock ACTUAL del insumo (no contra
  // el que se veía al abrir la ventana), por si otra caja vendió mientras tanto.
  const adjustCurrent = adjustTarget ? products.find((p) => p.id === adjustTarget.id) ?? adjustTarget : null;
  const adjustReal = adjustCount.trim() === "" ? null : Number(adjustCount);
  const adjustDiff =
    adjustCurrent && adjustReal !== null && Number.isFinite(adjustReal) && adjustReal >= 0
      ? Math.round((adjustReal - adjustCurrent.stock) * 10000) / 10000
      : null;

  function closeAdjust() {
    setAdjustTarget(null);
    setAdjustCount("");
    setAdjustReason("AJUSTE_ADMINISTRATIVO");
  }

  async function confirmAdjust() {
    if (!adjustCurrent) return;
    if (adjustDiff === null) {
      toast.error("Escribe cuánto hay de verdad (0 o más).");
      return;
    }
    const unit = adjustCurrent.unit ?? "und";
    if (adjustDiff === 0) {
      toast.success("Sin cambios: el stock ya coincide.");
      closeAdjust();
      return;
    }
    if (adjustDiff > 0) {
      const ok = await increaseStock(adjustCurrent.id, adjustDiff, "Ajuste de conteo");
      if (ok) {
        toast.success(`Ajuste guardado: se sumaron ${adjustDiff} ${unit} de ${adjustCurrent.name}.`);
        closeAdjust();
      }
      return;
    }
    const reasonLabel = ADJUST_REASONS.find((r) => r.id === adjustReason)?.label ?? "Ajuste";
    const ok = await decreaseStock(adjustCurrent.id, Math.abs(adjustDiff), `Ajuste de conteo: ${reasonLabel}`, adjustReason);
    if (ok) {
      toast.success(`Ajuste guardado: se descontaron ${Math.abs(adjustDiff)} ${unit} de ${adjustCurrent.name}.`);
      closeAdjust();
    }
  }

  return (
    <div className="w-full flex flex-col space-y-4">
      <div className="rounded-vimdy-lg border border-vimdy-warning/30 bg-vimdy-warning/5 p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-vimdy-warning/20 text-vimdy-warning">Lo que compras</span>
              <span className="text-xs text-vimdy-text-tertiary">No se venden en Caja</span>
            </div>
            <h2 className="text-2xl font-bold text-vimdy-text mt-1">Insumos</h2>
            <p className="text-vimdy-text-secondary text-sm mt-1">
              Lo que compras y guardas. Se descuenta solo cuando se vende un producto cuya receta lo usa.
            </p>
          </div>
          <VimdyButton onClick={() => { setEditingInsumo(null); setShowNewInsumo(true); }} size="sm" icon={<Plus size={16} />}>
            Nuevo insumo
          </VimdyButton>
        </div>
      </div>

      {countMasked && (
        <div role="status" className="rounded-vimdy-md border border-vimdy-warning/30 bg-vimdy-warning/10 px-4 py-3 text-sm text-vimdy-text-secondary">
          Tienes un conteo a ciegas abierto: aquí ves solo el estado de cada insumo (🟢 Disponible, 🟡 Stock bajo, 🔴 Agotado), sin cantidades ni costos. Se muestran de nuevo cuando se cierre el conteo.
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-vimdy-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar insumo..."
            className="w-full h-10 pl-9 pr-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm outline-none focus:border-vimdy-accent"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StockStatus | "todos")} aria-label="Filtrar por estado" className="h-10 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm outline-none focus:border-vimdy-accent">
          <option value="todos">Todos los estados</option>
          <option value="normal">Normal</option>
          <option value="bajo">Stock bajo</option>
          <option value="agotado">Agotado</option>
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filtrar por categoría" className="h-10 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm outline-none focus:border-vimdy-accent">
          <option value="todos">Todas las categorías</option>
          {visibleCategories.map((cat) => (<option key={cat.id} value={cat.id}>{cat.name}</option>))}
        </select>
      </div>

      {loading ? (
        <SkeletonRows rows={6} />
      ) : filteredInsumos.length === 0 ? (
        <EmptyState
          icon={<Package size={48} />}
          title="No hay insumos"
          description={search.trim() || statusFilter !== "todos" || categoryFilter !== "todos" ? "No se encontraron insumos con ese filtro." : "Agrega tu primer insumo (carne, verduras, empaques...) para armar recetas."}
          action={!search.trim() && statusFilter === "todos" && categoryFilter === "todos" ? { label: "Nuevo insumo", onClick: () => setShowNewInsumo(true) } : undefined}
        />
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.id} className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface overflow-hidden">
              <div className="px-4 py-2 bg-vimdy-background/50 border-b border-vimdy-border flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-vimdy-text-secondary">{group.name}</h3>
                <span className="text-xs text-vimdy-text-tertiary">{group.items.length}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-vimdy-text-tertiary">
                      <th className="px-4 py-2 font-medium">Insumo</th>
                      <th className="px-4 py-2 font-medium">Stock actual</th>
                      <th className="px-4 py-2 font-medium">Mínimo</th>
                      {canViewCosts && <th className="px-4 py-2 font-medium">Costo</th>}
                      <th className="px-4 py-2 font-medium">Usado en</th>
                      <th className="px-4 py-2 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-vimdy-border">
                    {group.items.map((insumo) => {
                      const status = getStockStatus(insumo);
                      const unit = insumo.unit || "und";
                      const uses = usedIn.get(insumo.id) ?? [];
                      const rowMasked = isStockMasked(insumo);
                      return (
                        <tr key={insumo.id} className="hover:bg-vimdy-background/30 transition">
                          <td className="px-4 py-3">
                            <p className="text-vimdy-text font-semibold">{insumo.name}</p>
                            {insumo.sku && <p className="text-vimdy-text-tertiary text-xs">SKU: {insumo.sku}</p>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-2 font-medium text-vimdy-text">
                              <span className={`w-2 h-2 rounded-full ${status === "normal" ? "bg-vimdy-success" : status === "bajo" ? "bg-vimdy-warning" : "bg-vimdy-danger"}`} />
                              {rowMasked ? stockMaskBadge(insumo).text : `${insumo.stock} ${unit}`}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-vimdy-text-secondary whitespace-nowrap">{insumo.minStock} {unit}</td>
                          {canViewCosts && (
                          <td className="px-4 py-3 text-vimdy-text whitespace-nowrap">
                            {rowMasked ? (
                              <span className="text-vimdy-text-tertiary text-xs">Oculto durante el conteo</span>
                            ) : insumo.purchasePrice !== undefined ? (
                              `${money(insumo.purchasePrice)} / ${unit}`
                            ) : (
                              <span className="text-vimdy-warning text-xs">Sin costo</span>
                            )}
                          </td>
                          )}
                          <td className="px-4 py-3">
                            {uses.length > 0 ? (
                              <span title={uses.join(", ")} className="text-xs px-2 py-0.5 rounded-vimdy-sm bg-vimdy-recipe/20 text-vimdy-recipe border border-vimdy-recipe/30">
                                {uses.length} {uses.length === 1 ? "receta" : "recetas"}
                              </span>
                            ) : (
                              <span className="text-xs text-vimdy-text-tertiary">Sin receta</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {rowMasked ? (
                              <div className="text-right text-xs text-vimdy-text-tertiary">Solo lectura</div>
                            ) : (
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => { setPurchaseTarget(insumo); setPurchaseCost(canViewCosts && insumo.purchasePrice !== undefined ? toMoneyInputValue(insumo.purchasePrice) : ""); }} className="h-8 px-3 rounded-vimdy-sm bg-vimdy-success/15 text-vimdy-success border border-vimdy-success/30 text-xs font-bold hover:bg-vimdy-success/25 transition whitespace-nowrap">+ Compré</button>
                              {insumo.stock > 0 && (
                                <button onClick={() => setWasteTarget(insumo)} className="h-8 px-3 rounded-vimdy-sm border border-vimdy-warning/30 text-vimdy-warning text-xs font-bold hover:bg-vimdy-warning/10 transition whitespace-nowrap">Merma</button>
                              )}
                              <button onClick={() => { setAdjustTarget(insumo); setAdjustCount(""); setAdjustReason("AJUSTE_ADMINISTRATIVO"); }} className="h-8 px-3 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary text-xs font-bold hover:text-vimdy-text hover:border-vimdy-accent transition whitespace-nowrap">Ajustar</button>
                              <button onClick={() => { setEditingInsumo(insumo); setShowNewInsumo(true); }} title="Editar" aria-label="Editar" className="w-8 h-8 rounded-vimdy-sm flex items-center justify-center text-vimdy-text-secondary hover:text-vimdy-text hover:bg-vimdy-background transition">
                                <Pencil size={16} />
                              </button>
                              <button onClick={() => setProductToDelete(insumo)} title="Eliminar" aria-label="Eliminar" className="w-8 h-8 rounded-vimdy-sm flex items-center justify-center text-vimdy-danger hover:bg-vimdy-danger/10 transition">
                                <Trash2 size={16} />
                              </button>
                            </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {purchaseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-vimdy-text">Registrar compra</h3>
                <p className="text-sm text-vimdy-text-secondary">{purchaseTarget.name} · stock {purchaseTarget.stock} {purchaseTarget.unit ?? "und"}</p>
              </div>
              <button onClick={() => setPurchaseTarget(null)} aria-label="Cerrar" className="text-vimdy-text-secondary hover:text-vimdy-text"><X size={20} /></button>
            </div>
            <label className="block text-xs font-semibold text-vimdy-text-secondary">Cantidad que entra ({purchaseTarget.unit ?? "und"})
              <input type="number" min="0" step="any" autoFocus value={purchaseQty} onChange={(e) => setPurchaseQty(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm" />
            </label>
            {canViewCosts && (
            <label className="block text-xs font-semibold text-vimdy-text-secondary">Costo por {purchaseTarget.unit ?? "und"} (opcional)
              <MoneyInput value={purchaseCost} onValueChange={setPurchaseCost} placeholder="0" className="mt-1 w-full h-10 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm" />
            </label>
            )}
            <div className="flex justify-end gap-2">
              <VimdyButton variant="secondary" onClick={() => setPurchaseTarget(null)}>Cancelar</VimdyButton>
              <VimdyButton onClick={confirmPurchase}>Guardar compra</VimdyButton>
            </div>
          </div>
        </div>
      )}

      {adjustTarget && adjustCurrent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-vimdy-text">Ajustar stock</h3>
                <p className="text-sm text-vimdy-text-secondary">{adjustCurrent.name} · en el sistema hay {adjustCurrent.stock} {adjustCurrent.unit ?? "und"}</p>
              </div>
              <button onClick={closeAdjust} aria-label="Cerrar" className="text-vimdy-text-secondary hover:text-vimdy-text"><X size={20} /></button>
            </div>
            <label className="block text-xs font-semibold text-vimdy-text-secondary">¿Cuánto hay de verdad? ({adjustCurrent.unit ?? "und"})
              <input type="number" min="0" step="any" autoFocus value={adjustCount} onChange={(e) => setAdjustCount(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm" />
            </label>
            {adjustDiff !== null && (
              <p className={`text-sm font-medium ${adjustDiff < 0 ? "text-vimdy-danger" : adjustDiff > 0 ? "text-vimdy-success" : "text-vimdy-text-secondary"}`}>
                {adjustDiff === 0
                  ? "Sin cambios: ya coincide."
                  : adjustDiff > 0
                    ? `Se van a sumar ${adjustDiff} ${adjustCurrent.unit ?? "und"}.`
                    : `Se van a descontar ${Math.abs(adjustDiff)} ${adjustCurrent.unit ?? "und"}.`}
              </p>
            )}
            {adjustDiff !== null && adjustDiff < 0 && (
              <label className="block text-xs font-semibold text-vimdy-text-secondary">¿Por qué faltó?
                <select value={adjustReason} onChange={(e) => setAdjustReason(e.target.value as LossCategory)} className="mt-1 w-full h-10 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm">
                  {ADJUST_REASONS.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <VimdyButton variant="secondary" onClick={closeAdjust}>Cancelar</VimdyButton>
              <VimdyButton onClick={confirmAdjust}>Guardar ajuste</VimdyButton>
            </div>
          </div>
        </div>
      )}

      {showNewInsumo && (
        <InsumoFormModal
          insumo={editingInsumo}
          categories={visibleCategories}
          onCreateCategory={async (name) => {
            const created = await createCategory({ name, kind: "INSUMO", requiresKitchenByDefault: false });
            return created;
          }}
          suppliers={suppliers}
          onClose={() => {
            setShowNewInsumo(false);
            setEditingInsumo(null);
          }}
          onSave={async (input) => {
            // createProduct/updateProduct NO lanzan error: devuelven false si
            // algo falla (nombre repetido, etc.). Antes se ignoraba ese valor y
            // se mostraba "Insumo creado" aunque no se hubiera guardado nada.
            const saved = editingInsumo
              ? await updateProduct(editingInsumo.id, input)
              : await createProduct(input);
            if (!saved) {
              throw new Error(
                "No se pudo guardar el insumo. Revisa que el nombre, el SKU o el código de barras no estén repetidos."
              );
            }
            toast.success(editingInsumo ? "Insumo actualizado." : "Insumo creado.");
            setShowNewInsumo(false);
            setEditingInsumo(null);
            return true;
          }}
          onCreateSupplier={async (input) => {
            const created = await container.supplierEngine.get().create(input);
            setSuppliers((prev) => [...prev, created]);
            return created;
          }}
        />
      )}

      {wasteTarget && (
        <QuickWasteModal
          product={products.find((p) => p.id === wasteTarget.id) ?? wasteTarget}
          decreaseStock={decreaseStock}
          onClose={() => setWasteTarget(null)}
        />
      )}

      {productToDelete && (
        <ConfirmModal
          title="Eliminar insumo"
          message={`¿Eliminar "${productToDelete.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          cancelLabel="Cancelar"
          onConfirm={confirmDelete}
          onCancel={() => setProductToDelete(null)}
          danger
        />
      )}
    </div>
  );
}

function InsumoFormModal({
  insumo,
  categories,
  onCreateCategory,
  suppliers,
  onClose,
  onSave,
  onCreateSupplier
}: {
  insumo: Product | null;
  categories: Category[];
  onCreateCategory: (name: string) => Promise<Category | null>;
  suppliers: Supplier[];
  onClose: () => void;
  onSave: (input: ProductInput) => Promise<boolean>;
  onCreateSupplier: (input: { name: string; phone?: string; email?: string; address?: string }) => Promise<Supplier>;
}) {
  const { can } = useAuth();
  const canViewCosts = can("inventory.viewCosts");
  const [name, setName] = useState(insumo?.name ?? "");
  const [categoryId, setCategoryId] = useState(insumo?.categoryId ?? categories[0]?.id ?? "");
  const [price, setPrice] = useState(insumo?.price ?? 0);
  const [purchasePrice, setPurchasePrice] = useState(toMoneyInputValue(insumo?.purchasePrice ?? 0));
  const [stock, setStock] = useState(insumo?.stock ? String(insumo.stock) : "");
  const [minStock, setMinStock] = useState(insumo?.minStock ? String(insumo.minStock) : "");
  const [unit, setUnit] = useState(insumo?.unit ?? "");
  // Solo cuando compra por Paquete / Caja: cuántas unidades trae (el precio total va en `purchasePrice`).
  const [packUnits, setPackUnits] = useState("");
  const [sku, setSku] = useState(insumo?.sku ?? "");
  const [barcode, setBarcode] = useState(insumo?.barcode ?? "");
  const [supplierId, setSupplierId] = useState(insumo?.supplierId ?? "");
  const [alternateSupplierId, setAlternateSupplierId] = useState(insumo?.alternateSupplierId ?? "");
  const [active, setActive] = useState(insumo?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: "", phone: "", email: "", address: "" });
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  // Modo paquete/caja: dos datos obligatorios y VIMDY calcula el costo por unidad.
  // Un insumo viejo que ya está guardado como "paquete"/"caja" (con stock contado en paquetes)
  // conserva su comportamiento anterior para no descuadrar su inventario.
  const keepsLegacyPack =
    !!insumo && isPackUnit(insumo.unit) && normalizeUnit(unit) === normalizeUnit(insumo.unit);
  const packMode = canViewCosts && isPackUnit(unit) && !keepsLegacyPack;
  const packCost = useMemo(
    () => (packMode ? computePackUnitCost(packUnits, purchasePrice) : null),
    [packMode, packUnits, purchasePrice]
  );

  async function handleCreateCategory(rawName?: string) {
    const name = (rawName ?? newCategoryName).trim();
    if (!name) {
      setError("Escribe el nombre de la categoría.");
      return;
    }
    setError(null);
    setCreatingCategory(true);
    try {
      const created = await onCreateCategory(name);
      if (created) {
        setCategoryId(created.id);
        setNewCategoryName("");
      } else {
        setError("No se pudo crear la categoría (¿ya existe una con ese nombre?).");
      }
    } finally {
      setCreatingCategory(false);
    }
  }

  useEffect(() => {
    if (!insumo && categories.length > 0 && !categoryId) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId, insumo]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Escribe el nombre del insumo.");
      return;
    }
    if (!categoryId || categoryId === "__nueva__") {
      setError("Selecciona o crea una categoría.");
      return;
    }
    let purchasePriceValue = purchasePrice.trim() === "" ? 0 : parseMoneyInput(purchasePrice);
    let unitToSave: string | undefined = unit.trim() || undefined;
    if (packMode) {
      const noun = normalizeUnit(unit) === "caja" ? "caja" : "paquete";
      if (!packUnits.trim()) {
        setError(`Escribe cuántas unidades trae ${noun === "caja" ? "la" : "el"} ${noun}.`);
        return;
      }
      if (!purchasePrice.trim()) {
        setError(`Escribe el precio total ${noun === "caja" ? "de la" : "del"} ${noun}.`);
        return;
      }
      if (!packCost) {
        setError("Revisa los datos: las unidades y el precio deben ser números mayores que cero.");
        return;
      }
      // Se guarda por unidad suelta: así la receta y el inventario descuentan exacto.
      purchasePriceValue = packCost.unitCost;
      unitToSave = "unidad";
    }
    if (!Number.isFinite(purchasePriceValue) || purchasePriceValue < 0) {
      setError("El precio de compra no es válido.");
      return;
    }
    // Los campos de stock se guardan como texto para poder borrarlos por completo;
    // vacío = 0 solo al momento de guardar.
    const stockValue = stock.trim() === "" ? 0 : Number(stock.replace(",", "."));
    const minStockValue = minStock.trim() === "" ? 0 : Number(minStock.replace(",", "."));
    if (!Number.isFinite(stockValue) || stockValue < 0) {
      setError("El stock inicial no es válido.");
      return;
    }
    if (!Number.isFinite(minStockValue) || minStockValue < 0) {
      setError("El stock mínimo no es válido.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: trimmedName,
        categoryId,
        price,
        purchasePrice: purchasePriceValue,
        stock: stockValue,
        minStock: minStockValue,
        unit: unitToSave,
        sku: sku.trim() || undefined,
        barcode: barcode.trim() || undefined,
        supplierId: supplierId || undefined,
        alternateSupplierId: alternateSupplierId || undefined,
        active,
        isIngredient: true,
        trackStock: true,
        requiresKitchen: false
      } as any);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo guardar el insumo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierForm.name.trim()) {
      toast.error("Escribe el nombre del proveedor.");
      return;
    }
    setCreatingSupplier(true);
    try {
      await onCreateSupplier({
        name: supplierForm.name.trim(),
        phone: supplierForm.phone.trim() || undefined,
        email: supplierForm.email.trim() || undefined,
        address: supplierForm.address.trim() || undefined
      });
      setSupplierForm({ name: "", phone: "", email: "", address: "" });
      setShowNewSupplier(false);
      toast.success("Proveedor creado.");
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo crear el proveedor.");
    } finally {
      setCreatingSupplier(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <h2 className="text-xl font-bold text-vimdy-text">
            {insumo ? "Editar insumo" : "Nuevo insumo"}
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-vimdy-text-secondary hover:text-vimdy-text">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-3 py-2">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Nombre *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Carne molida, Harina, Leche..."
              className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Categoría *</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm outline-none focus:border-vimdy-accent"
              >
                {categories.length === 0 && <option value="">Crea una categoría abajo</option>}
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
                <option value="__nueva__">+ Nueva categoría...</option>
              </select>
              {(categoryId === "__nueva__" || categories.length === 0) && (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="Ej: Carnes"
                      className="flex-1 h-10 px-3 rounded-vimdy-sm bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                    />
                    <VimdyButton type="button" variant="secondary" loading={creatingCategory} onClick={() => handleCreateCategory()}>
                      Crear
                    </VimdyButton>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {["Carnes", "Verduras", "Lácteos", "Empaques"]
                      .filter((n) => !categories.some((c) => c.name.toLowerCase() === n.toLowerCase()))
                      .map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => handleCreateCategory(n)}
                          className="px-2.5 py-1 rounded-full border border-vimdy-border text-xs text-vimdy-text-secondary hover:text-vimdy-text hover:bg-vimdy-surface-hover"
                        >
                          + {n}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Unidad</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm outline-none focus:border-vimdy-accent"
              >
                <option value="">Sin unidad</option>
                <option value="kg">Kilogramo (kg)</option>
                <option value="g">Gramo (g)</option>
                <option value="lt">Litro (lt)</option>
                <option value="ml">Mililitro (ml)</option>
                <option value="lb">Libra (lb)</option>
                <option value="unidad">Unidad</option>
                <option value="paquete">Paquete</option>
                <option value="caja">Caja</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {canViewCosts && packMode && (
            <div className="sm:col-span-2 rounded-vimdy-md border border-vimdy-border bg-vimdy-background p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
                    Unidades que trae {normalizeUnit(unit) === "caja" ? "la caja" : "el paquete"} <span className="text-vimdy-danger">*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={packUnits}
                    onChange={(e) => setPackUnits(e.target.value.replace(/[^\d.,]/g, ""))}
                    placeholder="Ej: 40"
                    aria-required="true"
                    className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                  />
                  <p className="text-vimdy-text-tertiary text-xs mt-1">Cuántas piezas sueltas vienen adentro (tajadas, huevos...).</p>
                </div>
                <div>
                  <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
                    Precio total {normalizeUnit(unit) === "caja" ? "de la caja" : "del paquete"} <span className="text-vimdy-danger">*</span>
                  </label>
                  <MoneyInput
                    value={purchasePrice}
                    onValueChange={setPurchasePrice}
                    placeholder="Ej: 16.000"
                    aria-required="true"
                    className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                  />
                  <p className="text-vimdy-text-tertiary text-xs mt-1">Lo que pagaste por {normalizeUnit(unit) === "caja" ? "la caja" : "el paquete"} completo.</p>
                </div>
              </div>
              {packCost ? (
                <p className="text-vimdy-accent text-sm" aria-live="polite">
                  Cada unidad te cuesta <strong>≈ {money(packCost.unitCost)}</strong>{" "}
                  <span className="text-vimdy-text-tertiary text-xs">
                    ({money(packCost.packPrice)} ÷ {packCost.units.toLocaleString("es-CO")}). Se guarda por unidad.
                  </span>
                </p>
              ) : (
                <p className="text-vimdy-text-tertiary text-xs" aria-live="polite">
                  Escribe las dos cosas y VIMDY calcula el costo de cada unidad por ti.
                </p>
              )}
            </div>
            )}
            {canViewCosts && !packMode && (
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Precio de compra *</label>
              <MoneyInput
                value={purchasePrice}
                onValueChange={setPurchasePrice}
                placeholder="0"
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
              <p className="text-vimdy-text-tertiary text-xs mt-1">Precio que te cuesta comprar este insumo.</p>
            </div>
            )}
            {insumo ? (
              <div>
                <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Stock actual</label>
                <p className="h-11 px-3 flex items-center rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm">
                  {insumo.stock} {insumo.unit ?? "und"}
                </p>
                <p className="text-vimdy-text-tertiary text-xs mt-1">Para cambiarlo usa "Registrar compra" o "Ajustar stock".</p>
              </div>
            ) : (
              <div>
                <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">
                  Stock inicial{packMode ? " (en unidades sueltas)" : ""}
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  placeholder="0"
                  className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Stock mínimo</label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                placeholder="0"
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
            </div>
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Proveedor principal</label>
              <div className="flex gap-2">
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="flex-1 h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm outline-none focus:border-vimdy-accent"
                >
                  <option value="">Sin proveedor</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowNewSupplier(true)}
                  className="h-11 px-3 rounded-vimdy-md bg-vimdy-accent/10 border border-vimdy-border text-vimdy-accent hover:bg-vimdy-accent/20 transition"
                  title="Nuevo proveedor"
                >
                  <Plus size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">SKU</label>
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Ej: INS-001"
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
            </div>
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Código de barras</label>
              <input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Ej: 7701234567890"
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="active"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 rounded border-vimdy-border bg-vimdy-background accent-vimdy-accent"
            />
            <label htmlFor="active" className="text-sm text-vimdy-text-secondary">
              Insumo activo (disponible para usar en recetas)
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-vimdy-border">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-xl border border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text hover:bg-vimdy-background transition text-sm font-medium"
            >
              Cancelar
            </button>
            <VimdyButton type="submit" disabled={saving} className="h-10 px-6">
              {saving ? "Guardando..." : insumo ? "Guardar cambios" : "Crear insumo"}
            </VimdyButton>
          </div>
        </form>
      </div>

      {showNewSupplier && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-vimdy-border bg-vimdy-surface shadow-2xl p-6">
            <h3 className="text-vimdy-text font-bold text-lg mb-4">Nuevo proveedor</h3>
            <form onSubmit={handleCreateSupplier} className="space-y-3">
              <div>
                <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Nombre *</label>
                <input
                  value={supplierForm.name}
                  onChange={(e) => setSupplierForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: Distribuidora ABC"
                  className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                />
              </div>
              <div>
                <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Teléfono</label>
                <input
                  value={supplierForm.phone}
                  onChange={(e) => setSupplierForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="Ej: 3001234567"
                  className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                />
              </div>
              <div>
                <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Email</label>
                <input
                  value={supplierForm.email}
                  onChange={(e) => setSupplierForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="Ej: ventas@distribuidora.com"
                  className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                />
              </div>
              <div>
                <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Dirección</label>
                <input
                  value={supplierForm.address}
                  onChange={(e) => setSupplierForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Ej: Calle 10 # 15-20"
                  className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowNewSupplier(false)}
                  className="h-10 px-4 rounded-xl border border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text transition text-sm font-medium"
                >
                  Cancelar
                </button>
                <VimdyButton type="submit" disabled={creatingSupplier} className="h-10 px-4">
                  {creatingSupplier ? "Guardando..." : "Guardar proveedor"}
                </VimdyButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}