import React, { useState } from "react";

import { VimdyModal } from "../ui/VimdyModal";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";

interface PostponeOrderModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (newExpectedDate: Date, note?: string) => Promise<boolean>;
}

/** "Posponer" — PASO 2.7: nunca borra la orden, solo cambia su fecha y estado a POSPUESTO. */
export function PostponeOrderModal({ open, onClose, onConfirm }: PostponeOrderModalProps) {
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!date || submitting) return;
    setSubmitting(true);
    const ok = await onConfirm(new Date(date), note.trim() || undefined);
    setSubmitting(false);
    if (ok) {
      setDate("");
      setNote("");
      onClose();
    }
  }

  return (
    <VimdyModal open={open} onClose={onClose} title="Posponer orden" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs text-vimdy-text-secondary mb-1 block">Nueva fecha estimada</label>
          <VimdyInput type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <label className="text-xs text-vimdy-text-secondary mb-1 block">Motivo (opcional)</label>
          <VimdyInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej. el proveedor pidió moverla dos días"
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <VimdyButton type="button" variant="ghost" onClick={onClose}>
            Cerrar
          </VimdyButton>
          <VimdyButton type="submit" disabled={!date || submitting}>
            {submitting ? "Guardando..." : "Posponer"}
          </VimdyButton>
        </div>
      </form>
    </VimdyModal>
  );
}