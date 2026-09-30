import { useState, type FormEvent } from "react";
import { Plus, X, Loader2, CheckCircle2 } from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
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
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 6 de 7</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">Organiza tus categorías</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Selecciona las categorías sugeridas para tu negocio o escribe las tuyas propias.
        </p>
      </div>

      <VimdyCard padding="lg" className="w-full">
        {created.length > 0 && (
          <div className="flex flex-col gap-2 mb-6">
            {created.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center gap-3 rounded-vimdy-md border border-vimdy-border-subtle bg-vimdy-surface-hover/60 px-4 py-2.5"
              >
                <span className="text-vimdy-success shrink-0">
                  <CheckCircle2 size={18} />
                </span>
                <span className="flex-1 text-sm font-medium text-vimdy-text">{cat.name}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-6">
          {suggestedNames.map((name) => {
            const isSelected = selectedSuggestions.has(name);

            return (
              <button
                key={name}
                type="button"
                onClick={() => toggleSuggestion(name)}
                disabled={saving}
                className={`
                  inline-flex items-center gap-2 rounded-vimdy-md border-2 px-4 py-2.5
                  transition-all duration-200 text-sm font-medium
                  disabled:cursor-not-allowed
                  ${
                    isSelected
                      ? "border-vimdy-accent bg-vimdy-accent/10 text-vimdy-accent"
                      : "border-vimdy-border bg-vimdy-surface text-vimdy-text-secondary hover:border-vimdy-accent/60 hover:text-vimdy-text"
                  }
                `}
              >
                {isSelected && <CheckCircle2 size={16} />}
                {name}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 mb-6">
          {customNames.map((name, index) => (
            <div
              key={index}
              className="flex items-center gap-3 rounded-vimdy-md border border-vimdy-border-subtle bg-vimdy-surface-hover/60 px-4 py-2.5"
            >
              <span className="flex-1 text-sm font-medium text-vimdy-text">{name}</span>
              <button
                type="button"
                onClick={() => removeCustom(index)}
                disabled={saving}
                className="text-vimdy-text-tertiary hover:text-vimdy-danger transition-colors disabled:cursor-not-allowed p-1 rounded-md hover:bg-vimdy-danger/10"
              >
                <X size={16} strokeWidth={2} />
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
            className="px-4 py-2 rounded-vimdy-md border-2 border-vimdy-border bg-vimdy-surface text-vimdy-blue hover:border-vimdy-accent hover:text-vimdy-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <Plus size={16} strokeWidth={2} />
            Agregar
          </button>
        </div>

        {saving && (
          <p className="text-center text-sm text-vimdy-text-secondary mb-4 flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Guardando categorías...
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger mb-4">
            <span className="mt-0.5 shrink-0">⚠</span>
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-center gap-3">
          <VimdyButton
            onClick={handleSave}
            disabled={saving}
            className="min-w-[200px]"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 size={18} className="animate-spin" />
                Guardando...
              </span>
            ) : (
              "Continuar"
            )}
          </VimdyButton>
          <VimdyButton variant="ghost" onClick={handleSkip} disabled={saving}>
            Omitir
          </VimdyButton>
        </div>
      </VimdyCard>
    </div>
  );
}