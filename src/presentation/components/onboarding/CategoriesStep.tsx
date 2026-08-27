import { useEffect, useState } from "react";

import { GlassCard } from "../ui/GlassCard";
import { VimdyButton } from "../ui/VimdyButton";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { getDefaultCategoriesForBusinessType } from "../../../core/config/onboardingCategories";
import { requiresKitchenByDefaultForBusinessType } from "../../../core/config/businessTypes";
import type { BusinessTypeId } from "../../../core/config/businessTypes";
import type { Category } from "../../../core/entities/Entities";

interface CategoriesStepProps {
  businessType: BusinessTypeId;
  /** Se entrega al PASO 8 para que el primer producto pueda elegir categoría real. */
  onSaved: (categories: Category[]) => void;
}

/**
 * PASO 7 del asistente de onboarding (FASE 3).
 *
 * A partir del tipo de negocio del PASO 3, crea automáticamente las
 * categorías reales del negocio (ver src/core/config/onboardingCategories.ts)
 * a través de container.categoryEngine.get().create — el mismo motor real que
 * usa el módulo de Productos. Si el negocio ya tiene categorías (por
 * ejemplo, un reintento del asistente), no las duplica.
 */
export function CategoriesStep({ businessType, onSaved }: CategoriesStepProps) {
  const [saving, setSaving] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Category[]>([]);

  const names = getDefaultCategoriesForBusinessType(businessType);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setSaving(true);
      setError(null);

      try {
        const existing = await container.categoryEngine.get().listAll();
        const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));

        const result: Category[] = [...existing];

        for (const name of names) {
          if (existingNames.has(name.toLowerCase())) continue;
          const category = await container.categoryEngine.get().create({
            name,
            requiresKitchenByDefault: requiresKitchenByDefaultForBusinessType(businessType)
          });
          if (cancelled) return;
          result.push(category);
        }

        if (cancelled) return;
        setCreated(result.filter((c) => names.some((n) => n.toLowerCase() === c.name.toLowerCase())));
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "No se pudieron crear las categorías.";
        setError(message);
      } finally {
        if (!cancelled) setSaving(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessType]);

  return (
    <GlassCard className="w-full max-w-lg px-6 py-10 sm:px-10 hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <div className="flex flex-col items-center gap-2 text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
          Creando tus categorías
        </h2>
        <p className="text-slate-400 text-sm max-w-sm">
          Según tu tipo de negocio, organizamos tu catálogo automáticamente.
        </p>
      </div>

      <div className="flex flex-col gap-2 mb-8">
        {names.map((name) => {
          const isDone = created.some((c) => c.name.toLowerCase() === name.toLowerCase());

          return (
            <div
              key={name}
              className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3"
            >
              <span className="flex-1 text-sm font-medium text-white">{name}</span>
              <span className={isDone ? "text-emerald-400" : "text-slate-600"}>
                {isDone ? "✓" : "..."}
              </span>
            </div>
          );
        })}
      </div>

      {saving && (
        <p className="text-center text-sm text-slate-400">Guardando categorías...</p>
      )}

      {error && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-center text-sm text-red-400">{error}</p>
          <VimdyButton
            variant="secondary"
            onClick={() => {
              // Reintento simple: recarga el efecto forzando un nuevo montaje lógico.
              setSaving(true);
              setError(null);
              container.categoryEngine.get()
                .listAll()
                .then(async (existing) => {
                  const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));
                  const result: Category[] = [...existing];
                  for (const name of names) {
                    if (existingNames.has(name.toLowerCase())) continue;
                    result.push(await container.categoryEngine.get().create({ name }));
                  }
                  setCreated(result.filter((c) => names.some((n) => n.toLowerCase() === c.name.toLowerCase())));
                })
                .catch((err: unknown) => {
                  const message = err instanceof Error ? err.message : "No se pudieron crear las categorías.";
                  setError(message);
                })
                .finally(() => setSaving(false));
            }}
          >
            Reintentar
          </VimdyButton>
        </div>
      )}

      {!saving && !error && (
        <div className="flex justify-center">
          <VimdyButton onClick={() => onSaved(created)} className="min-w-[200px]">
            Continuar
          </VimdyButton>
        </div>
      )}
    </GlassCard>
  );
}