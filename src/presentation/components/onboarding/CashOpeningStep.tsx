import { useState, type FormEvent } from "react";

import { GlassCard } from "../ui/GlassCard";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";

interface CashOpeningStepProps {
  onSaved: () => void;
}

/**
 * PASO 9 del asistente de onboarding (FASE 3).
 *
 * Abre el turno de caja real del negocio con container.shiftEngine.openShift
 * — el mismo motor real que usa el módulo de Caja (ver ShiftPanel.tsx).
 * Si ya hay un turno abierto (por ejemplo, un reintento del asistente),
 * lo detecta y deja continuar sin volver a abrir otro.
 */
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
      await container.shiftEngine.openShift(user.id, amountValue, "Apertura inicial (onboarding)");
      onSaved();
    } catch (err) {
      // Si el asistente se reintenta y la caja ya quedó abierta, no es un
      // error real — el negocio ya puede vender, así que se avanza igual.
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
    <GlassCard className="w-full max-w-sm px-6 py-10 sm:px-10 hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <div className="flex flex-col items-center gap-2 text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
          Abramos tu caja
        </h2>
        <p className="text-slate-400 text-sm max-w-sm">¿Cuánto dinero hay en caja?</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <VimdyInput
          type="number"
          min={0}
          step="0.01"
          placeholder="Ej. 100000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={saving}
          autoFocus
        />

        {error && <p className="text-center text-sm text-red-400">{error}</p>}

        <VimdyButton type="submit" disabled={saving} className="mt-2">
          {saving ? "Abriendo caja..." : "Abrir caja"}
        </VimdyButton>
      </form>
    </GlassCard>
  );
}