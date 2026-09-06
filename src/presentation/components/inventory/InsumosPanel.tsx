import React, { useEffect, useMemo, useState } from "react";
import { toast } from "../../../core/store/toastStore";
import { EmptyState } from "../ui/EmptyState";
import { VimdyButton } from "../ui/VimdyButton";
import { SkeletonRows, Skeleton } from "../ui/Skeleton";
import { useInventory, getStockStatus, StockStatus } from "../../../core/store/useInventory";
import { useCategories } from "../../../hooks/useCategories";
import { OfflineStatusBadge } from "../ui/OfflineStatusBadge";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { Product, Category, Supplier } from "../../../core/entities/Entities";
import { ProductInput } from "../../../core/engines/InventoryEngine";
import { ProductType, resolveProductFlags } from "../../../core/types/productType";
import { formatMoney } from "../../../core/utils/formatMoney";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { getBranches, getCurrentBranchId, getCurrentBusinessId } from "../../../infrastructure/supabase/supabaseClient";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  ArrowUpCircle,
  ArrowDownCircle,
  X,
  Package,
  AlertTriangle,
  PackageX,
  Download,
  ChefHat,
  History
} from "lucide-react";
import { ConfirmModal } from "../ui/ConfirmModal";

const money = (value: number) => {
  const currency = companyConfigStore.get().currency;
  const language = companyConfigStore.get().language;
  return formatMoney(value, currency, language);
};

type Tab = "insumos" | "recetas" | "historial";

export function InsumosPanel() {
  const {
    products,
    loading,
    error,
    createProduct,
    updateProduct,
    deleteProduct,
    increaseStock,
    decreaseStock
  } = useInventory();

  const { categories } = useCategories();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StockStatus | "todos">("todos");
  const [categoryFilter, setCategoryFilter] = useState<string>("todos");
  const [showNewInsumo, setShowNewInsumo] = useState(false);
  const [editingInsumo, setEditingInsumo] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [tab, setTab] = useState<Tab>("insumos");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: "", phone: "", email: "", address: "" });
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  const insumos = useMemo(() => {
    return products.filter((p) => p.isIngredient === true);
  }, [products]);

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
      } catch {
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

  return (
    <div className="w-full min-h-screen flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-vimdy-text">Insumos</h1>
              <p className="text-vimdy-text-secondary text-sm mt-1">
                Gestiona tus ingredientes y materias primas
              </p>
            </div>
            <VimdyButton
              onClick={() => setShowNewInsumo(true)}
              icon={<Plus size={18} />}
            >
              Nuevo insumo
            </VimdyButton>
          </div>

          <div className="flex gap-2 border-b border-vimdy-border">
            <button
              onClick={() => setTab("insumos")}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${
                tab === "insumos"
                  ? "border-vimdy-accent text-vimdy-accent"
                  : "border-transparent text-vimdy-text-secondary hover:text-vimdy-text"
              }`}
            >
              Insumos
            </button>
            <button
              onClick={() => setTab("recetas")}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${
                tab === "recetas"
                  ? "border-vimdy-accent text-vimdy-accent"
                  : "border-transparent text-vimdy-text-secondary hover:text-vimdy-text"
              }`}
            >
              Recetas
            </button>
            <button
              onClick={() => setTab("historial")}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${
                tab === "historial"
                  ? "border-vimdy-accent text-vimdy-accent"
                  : "border-transparent text-vimdy-text-secondary hover:text-vimdy-text"
              }`}
            >
              Historial
            </button>
          </div>

          {tab === "insumos" && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-vimdy-text-tertiary" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar insumo..."
                    className="w-full h-11 pl-10 pr-4 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm outline-none focus:border-vimdy-accent"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StockStatus | "todos")}
                  className="h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm outline-none focus:border-vimdy-accent"
                >
                  <option value="todos">Todos los estados</option>
                  <option value="normal">Normal</option>
                  <option value="bajo">Stock bajo</option>
                  <option value="agotado">Agotado</option>
                </select>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-11 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm outline-none focus:border-vimdy-accent"
                >
                  <option value="todos">Todas las categorías</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              {loading ? (
                <SkeletonRows rows={6} />
              ) : filteredInsumos.length === 0 ? (
                <EmptyState
                  icon={<Package size={48} />}
                  title="No hay insumos"
                  description={
                    search.trim() || statusFilter !== "todos" || categoryFilter !== "todos"
                      ? "No se encontraron insumos con ese filtro."
                      : "Agregá tu primer insumo para comenzar a gestionar tu inventario."
                  }
                  action={
                    !search.trim() && statusFilter === "todos" && categoryFilter === "todos"
                      ? {
                          label: "Nuevo insumo",
                          onClick: () => setShowNewInsumo(true)
                        }
                      : undefined
                  }
                />
              ) : (
                <div className="bg-vimdy-surface border border-vimdy-border rounded-vimdy-lg overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-vimdy-background/50">
                      <tr>
                        <th className="px-4 py-3 text-vimdy-text-secondary text-xs font-semibold uppercase tracking-wider">
                          Insumo
                        </th>
                        <th className="px-4 py-3 text-vimdy-text-secondary text-xs font-semibold uppercase tracking-wider">
                          Categoría
                        </th>
                        <th className="px-4 py-3 text-vimdy-text-secondary text-xs font-semibold uppercase tracking-wider">
                          Stock
                        </th>
                        <th className="px-4 py-3 text-vimdy-text-secondary text-xs font-semibold uppercase tracking-wider">
                          Precio compra
                        </th>
                        <th className="px-4 py-3 text-vimdy-text-secondary text-xs font-semibold uppercase tracking-wider text-right">
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-vimdy-border">
                      {filteredInsumos.map((insumo) => {
                        const status = getStockStatus(insumo);
                        const category = categories.find((c) => c.id === insumo.categoryId);
                        return (
                          <tr key={insumo.id} className="hover:bg-vimdy-background/30 transition">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-vimdy-sm bg-vimdy-background flex items-center justify-center text-lg overflow-hidden shrink-0">
                                  {insumo.image ? (
                                    <img src={insumo.image} alt={insumo.name} className="w-full h-full object-cover" />
                                  ) : (
                                    "📦"
                                  )}
                                </div>
                                <div>
                                  <p className="text-vimdy-text font-semibold text-sm">{insumo.name}</p>
                                  {insumo.sku && (
                                    <p className="text-vimdy-text-tertiary text-xs">SKU: {insumo.sku}</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-vimdy-text-secondary text-sm">
                              {category?.name ?? "Sin categoría"}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${
                                  status === "normal" ? "bg-vimdy-success" :
                                  status === "bajo" ? "bg-vimdy-warning" : "bg-vimdy-danger"
                                }`} />
                                <span className="text-sm font-medium">
                                  {insumo.stock} {insumo.unit || "unidades"}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-vimdy-text text-sm font-medium">
                              {insumo.purchasePrice !== undefined ? money(insumo.purchasePrice) : "—"}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => {
                                    setEditingInsumo(insumo);
                                    setShowNewInsumo(true);
                                  }}
                                  className="w-8 h-8 rounded-vimdy-sm flex items-center justify-center text-vimdy-text-secondary hover:text-vimdy-text hover:bg-vimdy-surface transition"
                                  title="Editar"
                                >
                                  <Pencil size={16} />
                                </button>
                                <button
                                  onClick={() => setProductToDelete(insumo)}
                                  className="w-8 h-8 rounded-vimdy-sm flex items-center justify-center text-vimdy-danger hover:bg-vimdy-danger/10 transition"
                                  title="Eliminar"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "recetas" && (
            <div className="text-center py-12 text-vimdy-text-tertiary">
              <ChefHat size={48} className="mx-auto mb-3 opacity-50" />
              <p>Las recetas se gestionan desde el formulario de cada producto elaborado.</p>
            </div>
          )}

          {tab === "historial" && (
            <div className="text-center py-12 text-vimdy-text-tertiary">
              <History size={48} className="mx-auto mb-3 opacity-50" />
              <p>El historial de movimientos está disponible en el kardex de cada insumo.</p>
            </div>
          )}
        </div>
      </div>

      {showNewInsumo && (
        <InsumoFormModal
          insumo={editingInsumo}
          categories={categories}
          suppliers={suppliers}
          onClose={() => {
            setShowNewInsumo(false);
            setEditingInsumo(null);
          }}
          onSave={async (input) => {
            if (editingInsumo) {
              await updateProduct(editingInsumo.id, input);
              toast.success("Insumo actualizado.");
            } else {
              await createProduct(input);
              toast.success("Insumo creado.");
            }
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
  suppliers,
  onClose,
  onSave,
  onCreateSupplier
}: {
  insumo: Product | null;
  categories: Category[];
  suppliers: Supplier[];
  onClose: () => void;
  onSave: (input: ProductInput) => Promise<boolean>;
  onCreateSupplier: (input: { name: string; phone?: string; email?: string; address?: string }) => Promise<Supplier>;
}) {
  const [name, setName] = useState(insumo?.name ?? "");
  const [categoryId, setCategoryId] = useState(insumo?.categoryId ?? categories[0]?.id ?? "");
  const [price, setPrice] = useState(insumo?.price ?? 0);
  const [purchasePrice, setPurchasePrice] = useState(insumo?.purchasePrice ?? 0);
  const [stock, setStock] = useState(insumo?.stock ?? 0);
  const [minStock, setMinStock] = useState(insumo?.minStock ?? 0);
  const [unit, setUnit] = useState(insumo?.unit ?? "");
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
    if (!categoryId) {
      setError("Selecciona una categoría.");
      return;
    }
    if (purchasePrice < 0) {
      setError("El precio de compra no puede ser negativo.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: trimmedName,
        categoryId,
        price,
        purchasePrice,
        stock,
        minStock,
        unit: unit.trim() || undefined,
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
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
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
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Precio de compra *</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(Number(e.target.value))}
                placeholder="0.00"
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
              <p className="text-vimdy-text-tertiary text-xs mt-1">Precio que te cuesta comprar este insumo.</p>
            </div>
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Stock inicial</label>
              <input
                type="number"
                min={0}
                step="1"
                value={stock}
                onChange={(e) => setStock(Number(e.target.value))}
                className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Stock mínimo</label>
              <input
                type="number"
                min={0}
                step="1"
                value={minStock}
                onChange={(e) => setMinStock(Number(e.target.value))}
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
