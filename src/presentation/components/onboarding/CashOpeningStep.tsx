import { useState, type FormEvent } from "react";
import { Wallet, Loader2 } from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";

interface CashOpeningStepProps {
  onSaved: () => void;
}

export function CashOpeningStep({ onSaved }: CashOpeningStepProps) {
  const { user } = useAuth();

  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    if (!user) {
      setError("No hay una sesión activa.");
      return;
    }

    const amountValue = Number(amount);
    if (Number.isNaN(amountValue) || amountValue < 0) {
      setError("El monto debe ser un número válido.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await container.shiftEngine.get().openShift(user.id, amountValue, "Apertura inicial (onboarding)");
      onSaved();
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("SHIFT_ALREADY_OPEN")) {
        onSaved();
        return;
      }
      const message = err instanceof Error ? err.message : "No se pudo abrir la caja.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 8 de 7</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">Abramos tu caja</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          ¿Cuánto dinero hay en caja?
        </p>
      </div>

      <VimdyCard padding="lg" className="w-full max-w-xl mx-auto">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex items-center gap-3 rounded-vimdy-md border-2 border-vimdy-border bg-vimdy-surface p-4">
            <div className="w-10 h-10 rounded-vimdy-md bg-vimdy-background text-vimdy-text-secondary flex items-center justify-center shrink-0">
              <Wallet size={20} strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-vimdy-text">Apertura de caja</p>
              <p className="text-xs text-vimdy-text-muted mt-0.5">Ingresa el monto inicial para comenzar a operar</p>
            </div>
          </div>

          <VimdyInput
            type="number"
            min={0}
            step="0.01"
            label="Monto inicial"
            placeholder="Ej. 100000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={saving}
            autoFocus
          />

          {error && (
            <div className="flex items-start gap-2 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger">
              <span className="mt-0.5 shrink-0">⚠</span>
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-center pt-2">
            <VimdyButton type="submit" disabled={saving} className="min-w-[200px]">
              {saving ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={18} className="animate-spin" />
                  Abriendo caja...
                </span>
              ) : (
                "Abrir caja"
              )}
            </VimdyButton>
          </div>
        </form>
      </VimdyCard>
    </div>
  );
}