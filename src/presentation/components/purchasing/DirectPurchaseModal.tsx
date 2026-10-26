import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Info } from "lucide-react";

import { VimdyModal } from "../ui/VimdyModal";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";
import { VimdySelect } from "../ui/VimdySelect";

import { Product, PurchaseOrderItem, Supplier } from "../../../core/entities/Entities";
import { parseMoneyInput } from "../../../core/utils/parseMoneyInput";
import { parseDecimalInput } from "../inventory/importHelpers";

interface DirectPurchaseModalProps {
  open: boolean;
  onClose: () => void;
  suppliers: Supplier[];
  products: Product[];
  onConfirm: (input: {
    supplierId: string;
    items: PurchaseOrderItem[];
    invoiceNumber?: string;
    note?: string;
  }) => Promise<boolean>;
}

interface Line {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
}

let lineCounter = 0;
function newLine(): Line {
  lineCounter += 1;
  return { key: lineCounter, productId: "", quantity: "", unitPrice: "" };
}

/**
 * DirectPurchaseModal — Compras, FLUJO B (compra directa).
 * ---------------------------------------------------------------------------
 * Para cuando la mercancía llega con una factura o nota de entrega y NO hubo
 * una orden previa. Se captura proveedor, número de documento y cada línea
 * (producto, cantidad, precio unitario). Al confirmar, el servidor la
 * registra con el MISMO motor que recibir una orden: sube el stock, escribe
 * el kardex, actualiza el precio de compra y queda en el historial.
 */
export function DirectPurchaseModal({ open, onClose, suppliers, products, onConfirm }: DirectPurchaseModalProps) {
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSupplierId("");
    setInvoiceNumber("");
    setNote("");
    setLines([newLine()]);
    setFormError(null);
    setSubmitting(false);
  }, [open]);

  const activeSuppliers = useMemo(() => suppliers.filter((s) => s.active !== false), [suppliers]);

  // Solo se compra lo que maneja inventario (no servicios ni productos que se preparan al momento).
  const purchasable = useMemo(
    () =>
      products
        .filter((p) => p.active !== false && p.trackStock !== false)
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    [products]
  );
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function selectProduct(key: number, productId: string) {
    const product = productById.get(productId);
    updateLine(key, {
      productId,
      // Sugiere el último costo conocido; se puede cambiar por el de la factura.
      unitPrice: product?.purchasePrice ? String(product.purchasePrice) : ""
    });
  }

  const total = lines.reduce((sum, line) => {
    const quantity = parseDecimalInput(line.quantity);
    const price = parseMoneyInput(line.unitPrice);
    return Number.isFinite(quantity) && Number.isFinite(price) ? sum + quantity * price : sum;
  }, 0);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    if (!supplierId) {
      setFormError("Elige el proveedor de la factura.");
      return;
    }

    const items: PurchaseOrderItem[] = [];
    for (const line of lines) {
      if (!line.productId && !line.quantity.trim() && !line.unitPrice.trim()) continue; // fila vacía
      const name = productById.get(line.productId)?.name ?? "Producto";
      if (!line.productId) {
        setFormError("Elige el producto en cada línea o quita las que no uses.");
        return;
      }
      const quantity = parseDecimalInput(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setFormError(`La cantidad de "${name}" no es válida.`);
        return;
      }
      const unitPrice = parseMoneyInput(line.unitPrice);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        setFormError(`Escribe el precio unitario de "${name}" (mayor a 0).`);
        return;
      }
      items.push({ productId: line.productId, quantity, unitPrice });
    }

    if (items.length === 0) {
      setFormError("Agrega al menos un producto de la factura.");
      return;
    }

    setFormError(null);
    setSubmitting(true);
    const ok = await onConfirm({
      supplierId,
      items,
      invoiceNumber: invoiceNumber.trim() || undefined,
      note: note.trim() || undefined
    });
    setSubmitting(false);
    if (ok) onClose();
  }

  return (
    <VimdyModal open={open} onClose={onClose} title="Registrar compra directa" size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex items-start gap-2 rounded-vimdy-md border border-vimdy-border bg-vimdy-background/60 text-vimdy-text-secondary text-xs px-3 py-3">
          <Info size={15} className="mt-0.5 shrink-0" />
          <span>
            Úsalo cuando llegó mercancía con factura o nota de entrega y no hiciste una orden antes. Al guardar,
            el inventario y el costo de compra se actualizan solos.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <VimdySelect label="Proveedor" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Elige un proveedor…</option>
            {activeSuppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </VimdySelect>
          <VimdyInput
            label="N.º de factura o nota (opcional)"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="Ej. FE-10452"
            maxLength={60}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs text-vimdy-text-secondary">Productos de la factura</p>
          {lines.map((line) => {
            const product = productById.get(line.productId);
            const usedElsewhere = new Set(lines.filter((l) => l.key !== line.key).map((l) => l.productId));
            return (
              <div key={line.key} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-12 sm:col-span-6">
                  <VimdySelect
                    aria-label="Producto"
                    value={line.productId}
                    onChange={(e) => selectProduct(line.key, e.target.value)}
                  >
                    <option value="">Producto…</option>
                    {purchasable
                      .filter((p) => !usedElsewhere.has(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </VimdySelect>
                </div>
                <div className="col-span-5 sm:col-span-2">
                  <VimdyInput
                    aria-label={`Cantidad${product?.unit ? ` (${product.unit})` : ""}`}
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                    placeholder={product?.unit ? `Cant. (${product.unit})` : "Cantidad"}
                  />
                </div>
                <div className="col-span-5 sm:col-span-3">
                  <VimdyInput
                    aria-label="Precio unitario"
                    inputMode="decimal"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                    placeholder="Precio unitario"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1 flex justify-end pb-1">
                  <button
                    type="button"
                    aria-label="Quitar línea"
                    disabled={lines.length === 1}
                    onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                    className="p-2 rounded-vimdy-sm text-vimdy-text-tertiary hover:text-vimdy-danger disabled:opacity-30 disabled:hover:text-vimdy-text-tertiary"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
          <VimdyButton
            type="button"
            variant="ghost"
            icon={<Plus size={15} />}
            onClick={() => setLines((current) => [...current, newLine()])}
          >
            Agregar producto
          </VimdyButton>
        </div>

        <VimdyInput
          label="Nota (opcional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ej. Llegó completo, recibió Camila"
          maxLength={200}
        />

        {formError && (
          <div className="rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-3 py-2">
            {formError}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-sm text-vimdy-text-secondary">
            Total de la factura: <span className="text-vimdy-text font-semibold">${Math.round(total).toLocaleString("es-CO")}</span>
          </p>
          <div className="flex gap-3">
            <VimdyButton type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </VimdyButton>
            <VimdyButton type="submit" disabled={submitting} loading={submitting}>
              {submitting ? "Registrando..." : "Registrar compra"}
            </VimdyButton>
          </div>
        </div>
      </form>
    </VimdyModal>
  );
}