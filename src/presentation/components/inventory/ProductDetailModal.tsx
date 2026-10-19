import React, { useMemo, useState } from "react";
import { toast } from "../../../core/store/toastStore";
import { VimdyButton } from "../ui/VimdyButton";
import { AlertTriangle, History, ArrowUpCircle, ArrowDownCircle, X, Trash2, Pencil, Copy, ChefHat, Clock3, Scale } from "lucide-react";
import { getStockStatus } from "../../../core/store/useInventory";
import { getProductInventoryCost } from "../../../core/utils/inventoryValuation";
import { Product, InventoryMovement, LossCategory } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { LOSS_CATEGORY_LABEL } from "../../../core/engines/lossCategoryLabels";
import { STATUS_CLASS, STATUS_LABEL, money } from "./inventoryShared";
import { InfoBox } from "./InventoryWidgets";

export function ProductDetailModal({
  product,
  categoryName,
  saveError,
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
  /** Nombre visible de la categoría (product.categoryId es un id interno). */
  categoryName?: string;
  /** Último error del inventario: se muestra aquí porque este modal tapa el banner de la página. */
  saveError?: string | null;
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
  const [opFailed, setOpFailed] = useState(false);
  const inventoryCost = getProductInventoryCost(product);
  const purchaseCostIsValid = typeof product.purchasePrice === "number"
    && Number.isFinite(product.purchasePrice)
    && product.purchasePrice >= 0;

  // getHistory llega como función nueva en cada render del padre; si fuera
  // dependencia del efecto, el Kardex se volvería a pedir (y parpadearía en
  // "Cargando historial...") cada vez que Inventario se recarga.
  const getHistoryRef = React.useRef(getHistory);
  getHistoryRef.current = getHistory;

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
    let cancelled = false;
    setLoadingHistory(true);
    getHistoryRef
      .current(product.id)
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  async function handleConfirm() {
    setSaving(true);
    setOpFailed(false);

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

      if (!ok) {
        setOpFailed(true);
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
            <p className="text-vimdy-text-secondary text-sm">{categoryName ?? product.categoryId}</p>
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
          {purchaseCostIsValid && product.active !== false && product.trackStock !== false && (
            <InfoBox label="Costo unitario" value={money(product.purchasePrice as number)} />
          )}
          <InfoBox
            label="Valor en inventario"
            value={
              inventoryCost.status === "VALUED"
                ? money(inventoryCost.value ?? 0)
                : inventoryCost.status === "MISSING_COST"
                  ? "Sin costo configurado"
                  : inventoryCost.status === "INVALID_STOCK"
                    ? "Stock inválido"
                    : "No aplica"
            }
          />
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

            {opFailed && (
              <p className="text-vimdy-danger text-sm">
                {saveError ?? "No se pudo registrar el movimiento. Intenta de nuevo."}
              </p>
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
                  setOpFailed(false);
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