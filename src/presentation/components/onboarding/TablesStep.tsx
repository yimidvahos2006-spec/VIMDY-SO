import { useState } from "react";
import { Loader2, CheckCircle2, Utensils } from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
import { VimdyButton } from "../ui/VimdyButton";
import { container } from "../../../infrastructure/di/CompositionRoot";

interface TablesStepProps {
  preselectedCount?: number;
  onSaved: (tableCount: number) => void;
}

const TABLE_COUNT_OPTIONS = [5, 10, 20, 30, 40];

const DEFAULT_TABLE_CAPACITY = 4;

export function TablesStep({ preselectedCount, onSaved }: TablesStepProps) {
  const [selected, setSelected] = useState<number | null>(preselectedCount ?? null);
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
        await container.tableEngine.get().createTable({
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

  const isReady = selected !== null;

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 4 de 7</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">Confirma las mesas de tu negocio</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Puedes ajustar la cantidad o confirmar el número que ingresaste en el paso anterior.
        </p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
        {TABLE_COUNT_OPTIONS.map((count) => {
          const isSelected = selected === count;
          const isLocked = saving && !isSelected;

          return (
            <button
              key={count}
              type="button"
              onClick={() => handleSelect(count)}
              disabled={saving || !isReady}
              className={`
                group relative flex flex-col items-center justify-center gap-2 rounded-vimdy-lg border-2 px-4 py-6
                transition-all duration-200
                disabled:cursor-not-allowed
                ${
                  isSelected
                    ? "border-vimdy-accent bg-vimdy-accent/10 shadow-vimdy-accent scale-[1.02]"
                    : "border-vimdy-border bg-vimdy-surface hover:border-vimdy-accent/60 hover:bg-vimdy-surface-hover"
                }
                ${isLocked ? "opacity-40" : ""}
              `}
            >
              {isSelected && (
                <span className="absolute top-2.5 right-2.5 text-vimdy-accent">
                  <CheckCircle2 size={18} />
                </span>
              )}

              <div className={`
                w-12 h-12 rounded-vimdy-md flex items-center justify-center transition-colors
                ${isSelected ? "bg-vimdy-accent/15 text-vimdy-accent" : "bg-vimdy-background text-vimdy-text-secondary group-hover:text-vimdy-text"}
              `}>
                <Utensils size={26} strokeWidth={1.8} />
              </div>

              <span className={`text-lg font-bold ${isSelected ? "text-vimdy-text" : "text-vimdy-text-secondary group-hover:text-vimdy-text"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {saving && selected !== null && (
        <div className="mt-6 text-center">
          <p className="text-sm text-vimdy-text-secondary flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Creando mesas... {createdCount}/{selected}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-6 flex items-start gap-2 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger">
          <span className="mt-0.5 shrink-0">⚠</span>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}