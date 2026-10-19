import { useMemo, useRef, useState } from "react";
import { Plus, X, Loader2, CheckCircle2 } from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { getDefaultCategoriesForBusinessType } from "../../../core/config/onboardingCategories";
import type { BusinessTypeId } from "../../../core/config/businessTypes";
import type { Category } from "../../../core/entities/Entities";
import { useStepDraft } from "./useStepDraft";

/**
 * Compara nombres sin importar mayúsculas, tildes ni espacios de más
 * ("Café", "cafe" y "  CAFÉ " cuentan como la misma categoría).
 */
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

interface CategoriesStepProps {
  businessType: BusinessTypeId;
  onSaved: (categories: Category[]) => void;
}

interface CategoriesDraft {
  selected: string[];
  custom: string[];
  input: string;
}

function sanitizeCategoriesDraft(raw: unknown, suggestedNames: readonly string[]): CategoriesDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    // Solo se recuperan sugeridas que todavía existan para este tipo de negocio.
    selected: strings(r.selected).filter((name) => suggestedNames.includes(name)),
    custom: strings(r.custom).map((name) => name.slice(0, 80)).slice(0, 50),
    input: typeof r.input === "string" ? r.input.slice(0, 80) : "",
  };
}

export function CategoriesStep({ businessType, onSaved }: CategoriesStepProps) {
  const suggestedNames = getDefaultCategoriesForBusinessType(businessType);

  // Lo marcado y lo escrito se guarda al instante y se recupera si el usuario
  // sale de la página, vuelve con "Atrás" o recarga.
  const [draft, setDraft] = useStepDraft<CategoriesDraft>(
    "categories",
    { selected: [], custom: [], input: "" },
    (raw) => sanitizeCategoriesDraft(raw, suggestedNames)
  );
  const selectedSuggestions = useMemo(() => new Set(draft.selected), [draft.selected]);
  const customNames = draft.custom;
  const customInput = draft.input;
  const setSelectedSuggestions = (next: Set<string>) => setDraft((current) => ({ ...current, selected: Array.from(next) }));
  const setCustomNames = (next: string[]) => setDraft((current) => ({ ...current, custom: next }));
  const setCustomInput = (next: string) => setDraft((current) => ({ ...current, input: next }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<Category[]>([]);
  const actionInFlight = useRef(false);

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
    const trimmed = customInput.trim().replace(/\s+/g, " ");
    if (!trimmed) return;
    const key = normalizeName(trimmed);

    // Si es igual a una sugerida, no se crea otra: se marca la sugerida.
    const matchingSuggestion = suggestedNames.find((name) => normalizeName(name) === key);
    if (matchingSuggestion) {
      if (selectedSuggestions.has(matchingSuggestion)) {
        setNotice("Esa categoría ya está en tu lista.");
      } else {
        setSelectedSuggestions(new Set(selectedSuggestions).add(matchingSuggestion));
        setNotice("Esa categoría ya estaba entre las sugeridas, la marcamos por ti.");
      }
      setCustomInput("");
      return;
    }

    if (customNames.some((name) => normalizeName(name) === key)) {
      setNotice("Esa categoría ya está en tu lista.");
      return;
    }

    setCustomNames([...customNames, trimmed]);
    setCustomInput("");
    setNotice(null);
  }

  async function handleSave() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setSaving(true);
    setError(null);

    try {
      // Sin repetidas: gana la primera escrita (las sugeridas van primero).
      const seenKeys = new Set<string>();
      const allNames: string[] = [];
      for (const rawName of [...selectedSuggestions, ...customNames]) {
        const name = rawName.trim().replace(/\s+/g, " ");
        const key = normalizeName(name);
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        allNames.push(name);
      }

      if (allNames.length === 0) {
        onSaved([]);
        return;
      }

      const existing = await container.categoryEngine.get().listAll();
      const existingByName = new Map(existing.map((category) => [
        normalizeName(category.name),
        category
      ]));
      const result: Category[] = [];
      const requiresKitchen = false;

      for (const name of allNames) {
        const normalizedName = normalizeName(name);
        const existingCategory = existingByName.get(normalizedName);
        if (existingCategory) {
          result.push(existingCategory);
          continue;
        }
        const category = await container.categoryEngine.get().create({
          name,
          requiresKitchenByDefault: requiresKitchen
        });
        result.push(category);
        existingByName.set(normalizedName, category);
      }

      setCreated(result);
      onSaved(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudieron crear las categorías.";
      setError(message);
    } finally {
      actionInFlight.current = false;
      setSaving(false);
    }
  }

  async function handleSkip() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setSaving(true);
    try {
      await container.categoryEngine.get().listAll();
      onSaved([]);
    } catch {
      onSaved([]);
    } finally {
      actionInFlight.current = false;
      setSaving(false);
    }
  }

  const allNames = [...Array.from(selectedSuggestions), ...customNames];

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 5 de 7</p>
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
            onChange={(e) => {
              setCustomInput(e.target.value);
              setNotice(null);
            }}
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

        {notice && (
          <p role="status" className="text-center text-sm text-vimdy-text-secondary mb-4">
            {notice}
          </p>
        )}

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