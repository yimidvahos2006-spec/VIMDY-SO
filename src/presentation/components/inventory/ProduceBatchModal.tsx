import { useMemo, useState } from "react";
import { VimdyButton } from "../ui/VimdyButton";
import { AlertTriangle, X, Flame } from "lucide-react";
import { Product } from "../../../core/entities/Entities";

/**
 * BLOQUEANTE (auditoría Fase 2 — Panadería): pantalla de "Producir tanda".
 * Registra UNA tanda real (InventoryEngine.produceBatch): elige un producto
 * elaborado en modo 'BATCH' (ej. Pan), cuántas unidades se van a producir, y
 * muestra en vivo qué ingredientes se van a descontar y con qué stock
 * quedan — antes de confirmar, para que el negocio nunca reciba la sorpresa
 * de un ingrediente insuficiente después de intentarlo.
 */
export function ProduceBatchModal({
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