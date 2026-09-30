import React, { useEffect, useMemo, useState } from "react";
import { Truck, Info } from "lucide-react";

import { VimdyModal } from "../ui/VimdyModal";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";

import { Product, Supplier } from "../../../core/entities/Entities";

interface CreatePurchaseOrderModalProps {
  open: boolean;
  onClose: () => void;
  /** Producto/insumo a comprar (viene de una recomendación de PASO 2.6 o del historial). */
  product: Product;
  /** Cantidad sugerida (de la recomendación); el dueño puede ajustarla. */
  suggestedQuantity?: number;
  suppliers: Supplier[];
  onConfirm: (input: { supplierId: string; quantity: number; unitPrice: number; expectedDeliveryDate?: Date }) => Promise<boolean>;
}

/**
 * CreatePurchaseOrderModal — PASO 2.7 (Compras Inteligentes, ejecución).
 * ---------------------------------------------------------------------------
 * "Crear orden": el dueño elige entre el proveedor principal y el
 * alternativo del producto (Product.supplierId / alternateSupplierId),
 * confirma cantidad y precio, y VIMDY calcula sola la fecha estimada de
 * entrega a partir de Supplier.avgDeliveryDays.
 */
export function CreatePurchaseOrderModal({
  open,
  onClose,
  product,
  suggestedQuantity,
  suppliers,
  onConfirm
}: CreatePurchaseOrderModalProps) {
  const principal = suppliers.find((s) => s.id === product.supplierId) ?? null;
  const alternate = suppliers.find((s) => s.id === product.alternateSupplierId) ?? null;

  const [supplierId, setSupplierId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [unitPrice, setUnitPrice] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSupplierId(principal?.id ?? alternate?.id ?? "");
    setQuantity(suggestedQuantity ? String(suggestedQuantity) : "");
    setUnitPrice(product.purchasePrice ? String(product.purchasePrice) : "");
  }, [open, product, suggestedQuantity, principal, alternate]);

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId) ?? null,
    [suppliers, supplierId]
  );

  const eligibleSuppliers = [principal, alternate].filter((s): s is Supplier => !!s);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(unitPrice);

    if (!supplierId || !parsedQuantity || parsedQuantity <= 0) return;

    setSubmitting(true);
    const expectedDeliveryDate = selectedSupplier?.avgDeliveryDays
      ? new Date(Date.now() + selectedSupplier.avgDeliveryDays * 24 * 60 * 60 * 1000)
      : undefined;

    const ok = await onConfirm({
      supplierId,
      quantity: parsedQuantity,
      unitPrice: Number.isFinite(parsedPrice) ? parsedPrice : 0,
      expectedDeliveryDate
    });
    setSubmitting(false);
    if (ok) onClose();
  }

  return (
    <VimdyModal open={open} onClose={onClose} title={`Crear orden — ${product.name}`} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        {eligibleSuppliers.length === 0 ? (
          <div className="flex items-start gap-2 rounded-vimdy-md border border-vimdy-warning/30 bg-vimdy-warning/10 text-vimdy-warning text-sm px-3 py-3">
            <Info size={16} className="mt-0.5 shrink-0" />
            <span>
              Este producto no tiene proveedor principal ni alternativo. Asígnale uno desde Productos antes de
              crear la orden.
            </span>
          </div>
        ) : (
          <div>
            <label className="text-xs text-vimdy-text-secondary mb-2 block">Proveedor</label>
            <div className="space-y-2">
              {principal && (
                <SupplierOption
                  supplier={principal}
                  label="Principal"
                  selected={supplierId === principal.id}
                  onSelect={() => setSupplierId(principal.id)}
                />
              )}
              {alternate && (
                <SupplierOption
                  supplier={alternate}
                  label="Alternativo"
                  selected={supplierId === alternate.id}
                  onSelect={() => setSupplierId(alternate.id)}
                />
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-vimdy-text-secondary mb-1 block">Cantidad {product.unit ? `(${product.unit})` : ""}</label>
            <VimdyInput
              type="number"
              min="0.01"
              step="0.01"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              required
            />
          </div>
          <div>
            <label className="text-xs text-vimdy-text-secondary mb-1 block">Precio unitario</label>
            <VimdyInput
              type="number"
              min="0"
              step="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        {selectedSupplier?.avgDeliveryDays !== undefined && (
          <p className="text-xs text-vimdy-text-tertiary flex items-center gap-1.5">
            <Truck size={13} />
            Entrega estimada en ~{selectedSupplier.avgDeliveryDays} día(s), según este proveedor.
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <VimdyButton type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </VimdyButton>
          <VimdyButton type="submit" disabled={submitting || eligibleSuppliers.length === 0}>
            {submitting ? "Creando..." : "Crear orden"}
          </VimdyButton>
        </div>
      </form>
    </VimdyModal>
  );
}

function SupplierOption({
  supplier,
  label,
  selected,
  onSelect
}: {
  supplier: Supplier;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-vimdy-md border px-4 py-3 transition-colors ${
        selected
          ? "border-vimdy-accent bg-vimdy-accent/10"
          : "border-vimdy-border bg-vimdy-background/60 hover:border-vimdy-border"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-vimdy-text font-medium text-sm">{supplier.name}</span>
        <span className="text-xs px-2 py-0.5 rounded-vimdy-xs bg-vimdy-surface text-vimdy-text-secondary border border-vimdy-border">
          {label}
        </span>
      </div>
      {(supplier.contactName || supplier.phone) && (
        <p className="text-xs text-vimdy-text-tertiary mt-1">
          {[supplier.contactName, supplier.phone].filter(Boolean).join(" · ")}
        </p>
      )}
    </button>
  );
}