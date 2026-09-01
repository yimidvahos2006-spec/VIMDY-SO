import { useState, type FormEvent } from "react";

import { GlassCard } from "../ui/GlassCard";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { getDefaultCategoriesForBusinessType } from "../../../core/config/onboardingCategories";
import { requiresKitchenByDefaultForBusinessType } from "../../../core/config/businessTypes";
import type { BusinessTypeId } from "../../../core/config/businessTypes";
import type { Category } from "../../../core/entities/Entities";

interface CategoriesStepProps {
  businessType: BusinessTypeId;
  onSaved: (categories: Category[]) => void;
}

export function CategoriesStep({ businessType, onSaved }: CategoriesStepProps) {
  const suggestedNames = getDefaultCategoriesForBusinessType(businessType);

  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [customNames, setCustomNames] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Category[]>([]);

  function toggleSuggestion(name: string) {
    const newSet = new Set(selectedSuggestions);
    if (newSet.has(name)) {
      newSet.delete(name);
    } else {
      newSet.add(name);
    }
    setSelectedSuggestions(newSet);
  }

  function removeCustom(index: number) {
    setCustomNames(customNames.filter((_, i) => i !== index));
  }

  function addCustom() {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    if (customNames.includes(trimmed)) return;
    if (suggestedNames.includes(trimmed) && selectedSuggestions.has(trimmed)) return;
    setCustomNames([...customNames, trimmed]);
    setCustomInput("");
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const finalNames = Array.from(selectedSuggestions);
    const allNames = [...finalNames, ...customNames];

    if (allNames.length === 0) {
      onSaved([]);
      setSaving(false);
      return;
    }

    try {
      const existing = await container.categoryEngine.get().listAll();
      const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));
      const result: Category[] = [];
      const requiresKitchen = requiresKitchenByDefaultForBusinessType(businessType);

      for (const name of allNames) {
        if (existingNames.has(name.toLowerCase())) {
          const existingCat = existing.find((c) => c.name.toLowerCase() === name.toLowerCase());
          if (existingCat) result.push(existingCat);
          continue;
        }
        const category = await container.categoryEngine.get().create({
          name,
          requiresKitchenByDefault: requiresKitchen
        });
        result.push(category);
      }

      const toReturn = result.filter((c) =>
        allNames.some((n) => n.toLowerCase() === c.name.toLowerCase())
      );
      setCreated(toReturn);
      onSaved(toReturn);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudieron crear las categorías.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    try {
      await container.categoryEngine.get().listAll();
    } catch {
      // ignore
    }
    onSaved([]);
  }

  const allNames = [...Array.from(selectedSuggestions), ...customNames];

  return (
    <GlassCard className="w-full max-w-lg px-6 py-10 sm:px-10 hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <div className="flex flex-col items-center gap-2 text-center mb-6">
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
          Organiza tus categorías
        </h2>
        <p className="text-slate-400 text-sm max-w-sm">
          Selecciona las categorías sugeridas para tu negocio o escribe las tuyas propias.
        </p>
      </div>

      <div className="flex flex-col gap-2 mb-6">
        {suggestedNames.map((name) => {
          const isChecked = selectedSuggestions.has(name);

          return (
            <div
              key={name}
              className="flex items-center gap-3 rounded-xl border px-4 py-3"
            >
              <input
                id={`cat-${name}`}
                type="checkbox"
                checked={isChecked}
                onChange={() => toggleSuggestion(name)}
                disabled={saving}
                className="h-5 w-5 rounded border border-slate-600 text-cyan-400 focus:ring-cyan-400/50 bg-slate-950 cursor-pointer disabled:cursor-not-allowed"
              />
              <label htmlFor={`cat-${name}`} className="flex-1 text-sm font-medium text-white cursor-pointer">
                {name}
              </label>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 mb-6">
        {customNames.map((name, index) => (
          <div
            key={index}
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2"
          >
            <span className="flex-1 text-sm font-medium text-white">{name}</span>
            <button
              type="button"
              onClick={() => removeCustom(index)}
              disabled={saving}
              className="text-slate-500 hover:text-red-400 transition-colors disabled:cursor-not-allowed"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-6">
        <VimdyInput
          placeholder="Nombre de categoría personalizada"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          disabled={saving}
          className="flex-1"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={saving || !customInput.trim()}
          className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-900/60 text-cyan-400 hover:border-cyan-500/60 hover:bg-slate-800/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
        >
          + Agregar
        </button>
      </div>

      {saving && (
        <p className="text-center text-sm text-slate-400 mb-4">Guardando categorías...</p>
      )}

      {error && (
        <p className="text-center text-sm text-red-400 mb-4">{error}</p>
      )}

      <div className="flex justify-center gap-3">
        <VimdyButton
          onClick={handleSave}
          disabled={saving}
          className="min-w-[200px]"
        >
          {saving ? "Guardando..." : "Continuar"}
        </VimdyButton>
        <VimdyButton variant="ghost" onClick={handleSkip} disabled={saving}>
          Omitir
        </VimdyButton>
      </div>
    </GlassCard>
  );
}
