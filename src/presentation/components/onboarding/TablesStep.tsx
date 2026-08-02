import { useState } from "react";

import { GlassCard } from "../ui/GlassCard";
import { VimdyButton } from "../ui/VimdyButton";
import { container } from "../../../infrastructure/di/CompositionRoot";

interface TablesStepProps {
  onSaved: (tableCount: number) => void;
}

const TABLE_COUNT_OPTIONS = [5, 10, 20, 30, 40];

/** Capacidad por defecto de cada mesa creada desde el onboarding — el
 * documento de producto solo pide la cantidad, no la capacidad por mesa,
 * así que se deja editable después desde Meseros/Configuración. */
const DEFAULT_TABLE_CAPACITY = 4;

/**
 * PASO 5 del asistente de onboarding (FASE 3).
 *
 * Solo se muestra si el negocio usa el módulo "mesas" (ver PASO 4). Al
 * elegir una cantidad, crea esa cantidad real de mesas ("Mesa 1"..."Mesa N")
 * a través de container.tableEngine.createTable — el mismo motor real que
 * usa Meseros/Configuración, así cada mesa nace con su ciclo de vida
 * completo (evento "table.created", estado FREE, etc). No hay simulación:
 * si falla la creación de alguna mesa, se muestra el error real.
 */
export function TablesStep({ onSaved }: TablesStepProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(count: number) {
    if (saving) return;

    setSelected(count);
    setSaving(true);
    setCreatedCount(0);
    setError(null);

    try {
      for (let i = 1; i <= count; i++) {
        await container.tableEngine.createTable({
          name: `Mesa ${i}`,
          capacity: DEFAULT_TABLE_CAPACITY
        });
        setCreatedCount(i);
      }
      onSaved(count);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudieron crear las mesas.";
      setError(message);
      setSelected(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard className="w-full max-w-lg px-6 py-10 sm:px-10 hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <div className="flex flex-col items-center gap-2 text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
          ¿Cuántas mesas tiene tu negocio?
        </h2>
        <p className="text-slate-400 text-sm max-w-sm">
          Creamos tus mesas reales para que puedas empezar a atender de inmediato.
        </p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-6">
        {TABLE_COUNT_OPTIONS.map((count) => {
          const isSelected = selected === count;
          const isLocked = saving && !isSelected;

          return (
            <button
              key={count}
              type="button"
              onClick={() => handleSelect(count)}
              disabled={saving}
              className={`
                flex flex-col items-center justify-center gap-1 rounded-2xl border px-3 py-5
                transition-all duration-300
                disabled:cursor-not-allowed
                ${
                  isSelected
                    ? "border-cyan-400 bg-cyan-400/10 shadow-[0_0_30px_rgba(143,215,255,.25)] scale-[1.03]"
                    : "border-slate-700 bg-slate-900/60 hover:border-cyan-500/60 hover:bg-slate-800/60"
                }
                ${isLocked ? "opacity-40" : ""}
              `}
            >
              <span className="text-2xl">🪑</span>
              <span className="text-sm font-semibold text-white">{count}</span>
            </button>
          );
        })}
      </div>

      {saving && (
        <p className="text-center text-sm text-slate-400">
          Creando mesas... {createdCount}/{selected}
        </p>
      )}

      {error && (
        <p className="mt-2 text-center text-sm text-red-400">{error}</p>
      )}
    </GlassCard>
  );
}