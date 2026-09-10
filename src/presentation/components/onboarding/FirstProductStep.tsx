import { useState, type FormEvent } from "react";
import { Loader2, Package } from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";
import { VimdySelect } from "../ui/VimdySelect";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import type { Category } from "../../../core/entities/Entities";

interface FirstProductStepProps {
  categories: Category[];
  onSaved: () => void;
}

export function FirstProductStep({ categories, onSaved }: FirstProductStepProps) {
  const { user } = useAuth();

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const priceValue = Number(price);
    const stockValue = Number(stock);
    const costValue = cost.trim() ? Number(cost) : undefined;

    if (!name.trim()) {
      setError("El nombre del producto es obligatorio.");
      return;
    }
    if (!categoryId) {
      setError("Elige una categoría.");
      return;
    }
    if (Number.isNaN(priceValue) || priceValue < 0) {
      setError("El precio debe ser un número válido.");
      return;
    }
    if (Number.isNaN(stockValue) || stockValue < 0) {
      setError("El stock debe ser un número válido.");
      return;
    }
    if (costValue !== undefined && (Number.isNaN(costValue) || costValue < 0)) {
      setError("El costo debe ser un número válido.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await container.inventoryEngine.get().createProduct(
        {
          name: name.trim(),
          categoryId,
          price: priceValue,
          stock: stockValue,
          minStock: 0,
          purchasePrice: costValue
        },
        user?.id
      );
      onSaved();
    } catch (err) {
      const message = translateBusinessError(err, "No se pudo crear el producto.");
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 7 de 7</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">Crea tu primer producto</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Así ya tienes algo real para vender apenas termines.
        </p>
      </div>

      <VimdyCard padding="lg" className="w-full max-w-xl mx-auto">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex items-center gap-3 rounded-vimdy-md border-2 border-vimdy-border bg-vimdy-surface p-4">
            <div className="w-10 h-10 rounded-vimdy-md bg-vimdy-background text-vimdy-text-secondary flex items-center justify-center shrink-0">
              <Package size={20} strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-vimdy-text">Primer producto</p>
              <p className="text-xs text-vimdy-text-muted mt-0.5">Completa los datos básicos para comenzar a vender</p>
            </div>
          </div>

          <VimdyInput
            label="Nombre del producto *"
            placeholder="Ej: Café americano"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />

          <VimdySelect
            label="Categoría *"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={saving || categories.length === 0}
          >
            {categories.length === 0 && <option value="">Sin categorías</option>}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </VimdySelect>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <VimdyInput
              type="number"
              min={0}
              step="0.01"
              label="Precio de venta *"
              placeholder="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={saving}
            />
            <VimdyInput
              type="number"
              min={0}
              step="0.01"
              label="Costo (opcional)"
              placeholder="0"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              disabled={saving}
            />
          </div>

          <VimdyInput
            type="number"
            min={0}
            label="Stock inicial"
            placeholder="0"
            hint="Si lo dejas vacío, el producto se crea con 0 unidades y se verá como Agotado."
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            disabled={saving}
          />

          {error && (
            <div className="flex items-start gap-2 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger">
              <span className="mt-0.5 shrink-0">⚠</span>
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
            <VimdyButton type="submit" disabled={saving} className="min-w-[200px]">
              {saving ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={18} className="animate-spin" />
                  Guardando...
                </span>
              ) : (
                "Continuar"
              )}
            </VimdyButton>
            <VimdyButton variant="ghost" type="button" onClick={onSaved} disabled={saving}>
              Omitir
            </VimdyButton>
          </div>
        </form>
      </VimdyCard>
    </div>
  );
}