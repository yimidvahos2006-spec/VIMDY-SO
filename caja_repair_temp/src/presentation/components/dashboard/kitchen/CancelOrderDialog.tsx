import React, { useState } from "react";
import { X, TriangleAlert } from "lucide-react";

import { KITCHEN_CANCEL_REASONS } from "../../../../core/engines/KitchenEngine";
import { KitchenOrderView } from "../../../../hooks/useKitchenOrders";
import { translateBusinessError } from "../../../../core/errors/translateBusinessError";
import { VimdyButton } from "../../ui/VimdyButton";

interface Props {
  order: KitchenOrderView;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

export function CancelOrderDialog({ order, onConfirm, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [customReason, setCustomReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOtro = selected === "Otro";
  const finalReason = isOtro ? customReason.trim() : selected;
  const canConfirm = !!finalReason && !busy;

  async function handleConfirm() {
    if (!finalReason) return;

    setBusy(true);
    setError(null);
    try {
      await onConfirm(finalReason);
    } catch (err) {
      setError(translateBusinessError(err, "No se pudo cancelar la comanda."));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-vimdy-surface border border-vimdy-border rounded-3xl p-6 w-full max-w-md">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <div className="bg-vimdy-danger/10 border border-vimdy-danger/30 rounded-2xl p-2.5">
              <TriangleAlert size={22} className="text-vimdy-danger" />
            </div>
            <div>
              <h2 className="text-vimdy-text font-bold text-lg">Cancelar comanda</h2>
              <p className="text-vimdy-text-secondary text-xs">
                {order.origin ?? "Pedido"} · Pedido #{order.orderNumber ?? order.id.slice(0, 8)}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-vimdy-text-tertiary hover:text-vimdy-text">
            <X size={20} />
          </button>
        </div>

        <p className="text-vimdy-text-secondary text-sm mb-3">¿Cuál es el motivo?</p>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {KITCHEN_CANCEL_REASONS.map(reason => (
            <button
              key={reason}
              onClick={() => setSelected(reason)}
              aria-pressed={selected === reason}
              className={`rounded-xl py-3 px-3 text-sm font-semibold border transition-colors ${
                selected === reason
                  ? "bg-vimdy-danger border-vimdy-danger text-white"
                  : "bg-vimdy-surface border-vimdy-border text-vimdy-text-secondary hover:border-vimdy-text-tertiary"
              }`}
            >
              {reason}
            </button>
          ))}
        </div>

        {isOtro && (
          <textarea
            value={customReason}
            onChange={e => setCustomReason(e.target.value)}
            placeholder="Describe el motivo..."
            rows={2}
            className="w-full bg-vimdy-surface border border-vimdy-border rounded-xl p-3 text-vimdy-text text-sm mb-4 resize-none focus:outline-none focus:border-vimdy-danger"
          />
        )}

        {error && <p className="text-vimdy-danger text-sm mb-4">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <VimdyButton
            onClick={onClose}
            disabled={busy}
            variant="secondary"
          >
            Volver
          </VimdyButton>
          <VimdyButton
            onClick={handleConfirm}
            disabled={!canConfirm}
            loading={busy}
            variant="danger"
          >
            Confirmar cancelación
          </VimdyButton>
        </div>
      </div>
    </div>
  );
}