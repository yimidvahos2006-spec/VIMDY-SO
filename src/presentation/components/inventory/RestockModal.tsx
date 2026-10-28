// src/presentation/components/inventory/RestockModal.tsx
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { X } from "lucide-react";
import { toast } from "../../../core/store/toastStore";
import type { Product } from "../../../core/entities/Entities";
import { isStockMasked, stockMaskBadge } from "../../../core/utils/stockMask";
import { VimdyButton } from "../ui/VimdyButton";
import {
  allowsDecimals,
  parseRestockQuantity,
  sanitizeQuantityInput
} from "./restockValidation";

const RESTOCK_REASON = "Reabastecimiento de proveedor";
const qtyFormatter = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 });

export interface RestockModalProps {
  /** Pasa la versión VIVA del producto (de la lista) para que el stock se refresque tras guardar. */
  product: Product;
  /** Compatible con `increaseStock` de useInventory. Devuelve false si falló. */
  onConfirm: (productId: string, quantity: number, reason: string) => Promise<boolean>;
  onClose: () => void;
}

function formatWithUnit(quantity: number, unit?: string): string {
  const base = qtyFormatter.format(quantity);
  return unit && unit !== "unidad" ? `${base} ${unit}` : base;
}

/**
 * Modal "Sumar stock": el usuario escribe SOLO las unidades que llegaron
 * del proveedor; el sistema calcula el nuevo total (nunca se escribe el total).
 *
 * A prueba de errores:
 *  · Solo números (sanitiza al escribir/pegar), enteros si la unidad es "unidad".
 *  · Mayor que 0 y con tope duro; cantidad inusual pide una segunda confirmación.
 *  · Vista previa "actual → nuevo" antes de guardar.
 *  · Anti doble-toque con ref (increaseStock genera un movimiento por llamada).
 *  · No se puede cerrar mientras guarda; si falla, conserva lo escrito.
 *  · Conteo a ciegas: nunca muestra cifras reales (usa el badge de estado).
 */
export function RestockModal({ product, onConfirm, onClose }: RestockModalProps) {
  const [rawQuantity, setRawQuantity] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedLarge, setConfirmedLarge] = useState(false);
  const submittingRef = useRef(false);
  const titleId = useId();
  const hintId = useId();

  const masked = isStockMasked(product);
  const unit = product.unit;
  const decimals = allowsDecimals(unit);
  const currentStock = masked ? null : product.stock;

  const parsed = useMemo(
    () => parseRestockQuantity(rawQuantity, currentStock),
    [rawQuantity, currentStock]
  );

  const quantity = parsed.status === "valid" ? parsed.quantity : null;
  const needsLargeConfirm = parsed.status === "valid" && parsed.unusuallyLarge && !confirmedLarge;
  const newStock =
    quantity !== null && currentStock !== null
      ? Math.round((currentStock + quantity) * 1000) / 1000
      : null;

  // Escape cierra (salvo guardando).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !submittingRef.current) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function handleChange(value: string) {
    setRawQuantity(sanitizeQuantityInput(value, decimals));
    setConfirmedLarge(false); // cambiar el número invalida la confirmación previa
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submittingRef.current || parsed.status !== "valid") return;

    // Cantidad inusual: el primer toque solo pide confirmar.
    if (parsed.unusuallyLarge && !confirmedLarge) {
      setConfirmedLarge(true);
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const ok = await onConfirm(product.id, parsed.quantity, RESTOCK_REASON);
      if (ok) {
        toast.success(`+${formatWithUnit(parsed.quantity, unit)} de ${product.name}.`);
        onClose();
        return;
      }
      setError("No se pudo actualizar el stock. Revisa e intenta de nuevo.");
    } catch {
      setError("Error inesperado al actualizar el stock. Intenta de nuevo.");
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  const buttonLabel = needsLargeConfirm
    ? "Verificar cantidad"
    : confirmedLarge && quantity !== null
      ? `Sí, sumar ${formatWithUnit(quantity, unit)}`
      : "Actualizar Stock";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        className="w-full max-w-sm rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-vimdy-lg shadow-vimdy-lg animate-vimdy-scale-in"
      >
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-vimdy-micro uppercase text-vimdy-text-tertiary">Sumar stock</p>
            <h2 id={titleId} className="mt-1 text-vimdy-h3 text-vimdy-text truncate" title={product.name}>
              {product.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar"
            className="rounded-vimdy-sm p-1 text-vimdy-text-secondary transition-colors duration-vimdy-fast hover:bg-vimdy-surface-hover hover:text-vimdy-text disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Stock actual */}
        <div className="mt-vimdy-md flex items-center justify-between rounded-vimdy-md border border-vimdy-border-subtle bg-vimdy-background px-vimdy-md py-3">
          <span className="text-vimdy-small text-vimdy-text-secondary">Stock actual</span>
          <span className="text-vimdy-body font-semibold text-vimdy-text tabular-nums">
            {masked ? stockMaskBadge(product).text : formatWithUnit(product.stock, unit)}
          </span>
        </div>

        {/* Campo grande */}
        <div className="mt-vimdy-lg">
          <label htmlFor="restock-qty" className="block text-vimdy-small text-vimdy-text-secondary">
            Unidades nuevas que llegaron
            {unit && unit !== "unidad" ? ` (${unit})` : ""}
          </label>
          <input
            id="restock-qty"
            type="text"
            inputMode={decimals ? "decimal" : "numeric"}
            autoComplete="off"
            autoFocus
            placeholder="0"
            value={rawQuantity}
            disabled={saving}
            onChange={(e) => handleChange(e.target.value)}
            aria-invalid={parsed.status === "invalid"}
            aria-describedby={hintId}
            className={`mt-2 w-full h-20 rounded-vimdy-md border bg-vimdy-background text-center text-vimdy-h1 text-vimdy-text tabular-nums placeholder:text-vimdy-text-tertiary focus:outline-none focus:shadow-vimdy-accent disabled:opacity-60 transition-colors duration-vimdy-fast ${
              parsed.status === "invalid"
                ? "border-vimdy-danger"
                : "border-vimdy-border focus:border-vimdy-accent"
            }`}
          />

          {/* Estado: error / aviso / vista previa (zona fija para que no salte el layout) */}
          <div id={hintId} role="status" aria-live="polite" className="mt-3 min-h-[44px] text-vimdy-small">
            {parsed.status === "invalid" && <p className="text-vimdy-danger-hover">{parsed.message}</p>}

            {parsed.status === "valid" && newStock !== null && (
              <p className="text-vimdy-text-secondary">
                Nuevo stock:{" "}
                <span className="font-semibold text-vimdy-success tabular-nums">
                  {formatWithUnit(newStock, unit)}
                </span>
              </p>
            )}
            {parsed.status === "valid" && masked && (
              <p className="text-vimdy-text-secondary">
                Se sumarán {formatWithUnit(parsed.quantity, unit)} (conteo a ciegas activo).
              </p>
            )}

            {parsed.status === "valid" && parsed.unusuallyLarge && (
              <p className="mt-1 rounded-vimdy-sm border border-vimdy-warning/30 bg-vimdy-warning-bg px-3 py-1.5 text-vimdy-warning-hover">
                Es una cantidad muy alta para este producto. Confirma que es correcta.
              </p>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-2 rounded-vimdy-sm border border-vimdy-danger/30 bg-vimdy-danger-bg px-3 py-2 text-vimdy-small text-vimdy-danger-hover">
            {error}
          </p>
        )}

        <div className="mt-vimdy-md flex flex-col gap-2">
          <VimdyButton
            type="submit"
            size="lg"
            fullWidth
            loading={saving}
            disabled={parsed.status !== "valid"}
          >
            {buttonLabel}
          </VimdyButton>
          <VimdyButton variant="ghost" size="sm" fullWidth disabled={saving} onClick={onClose}>
            Cancelar
          </VimdyButton>
        </div>
      </form>
    </div>
  );
}