import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "../../../core/store/toastStore";
import type { LossCategory, Product } from "../../../core/entities/Entities";
import { LOSS_CATEGORY_LABEL } from "../../../core/engines/lossCategoryLabels";

// Motivos cortos y neutrales: VIMDY muestra lo que pasó, no acusa a nadie.
const QUICK_REASONS: LossCategory[] = ["MERMA", "VENCIDO", "DAÑO", "CONSUMO_INTERNO", "OTRO"];

/**
 * Merma en 2 toques: botón de la fila → cantidad → tocar el motivo → listo.
 * Al tocar el motivo se registra de una vez (sin botón "Guardar").
 * Usa el mismo decreaseStock del inventario, así queda en el Kardex y en el
 * Centro de Pérdidas igual que una salida hecha desde el detalle.
 */
export function QuickWasteModal({
  product,
  decreaseStock,
  onClose,
}: {
  product: Product;
  decreaseStock: (id: string, qty: number, reason: string, lossCategory?: LossCategory) => Promise<boolean>;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [saving, setSaving] = useState(false);
  const unit = product.unit || "und";

  async function submit(category: LossCategory) {
    if (saving) return;
    const qty = Number(quantity.replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Escribe cuánto se perdió (mayor que 0).");
      return;
    }
    if (qty > product.stock) {
      toast.error(`Solo hay ${product.stock} ${unit} en el sistema.`);
      return;
    }
    setSaving(true);
    const label = LOSS_CATEGORY_LABEL[category];
    const ok = await decreaseStock(product.id, qty, `Salida rápida: ${label}`, category);
    setSaving(false);
    if (ok) {
      toast.success(`Registrado: ${qty} ${unit} de ${product.name} (${label}).`);
      onClose();
    } else {
      toast.error("No se pudo registrar. Intenta de nuevo.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div className="w-full max-w-sm rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-vimdy-text">Registrar merma</h3>
            <p className="text-sm text-vimdy-text-secondary truncate">
              {product.name} · hay {product.stock} {unit}
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-vimdy-text-secondary hover:text-vimdy-text">
            <X size={20} />
          </button>
        </div>

        <label className="block text-xs font-semibold text-vimdy-text-secondary">
          ¿Cuánto se perdió? ({unit})
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            autoFocus
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-base focus:outline-none focus:border-vimdy-accent"
          />
        </label>

        <div>
          <p className="text-xs font-semibold text-vimdy-text-secondary mb-2">¿Qué pasó? Toca una opción para guardar</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_REASONS.map((key) => (
              <button
                key={key}
                type="button"
                disabled={saving}
                onClick={() => submit(key)}
                className="h-10 px-4 rounded-vimdy-md border border-vimdy-border text-vimdy-text text-sm font-semibold hover:border-vimdy-accent hover:bg-vimdy-accent/10 transition disabled:opacity-50"
              >
                {LOSS_CATEGORY_LABEL[key]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}