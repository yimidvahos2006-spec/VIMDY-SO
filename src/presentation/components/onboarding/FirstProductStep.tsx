import { useState, type FormEvent } from "react";

import { GlassCard } from "../ui/GlassCard";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import type { Category } from "../../../core/entities/Entities";

interface FirstProductStepProps {
  /** Categorías reales creadas en el PASO 7. */
  categories: Category[];
  onSaved: () => void;
}

/**
 * PASO 8 del asistente de onboarding (FASE 3).
 *
 * Crea el primer producto real del negocio con los campos que pide el
 * documento de producto (Nombre, Precio, Costo, Stock, Categoría), a
 * través de container.inventoryEngine.get().createProduct — el mismo motor real
 * que usa el módulo de Productos. El stock mínimo (para alertas de
 * inventario) no lo pide el asistente; se guarda en 0 (sin alerta) y
 * queda editable después desde Inventario.
 */
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
    <GlassCard className="w-full max-w-md px-6 py-10 sm:px-10 hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <div className="flex flex-col items-center gap-2 text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
          Crea tu primer producto
        </h2>
        <p className="text-slate-400 text-sm max-w-sm">
          Así ya tienes algo real para vender apenas termines.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <VimdyInput
          placeholder="Nombre del producto"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={saving}
        />

        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          disabled={saving || categories.length === 0}
          className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white outline-none transition-colors duration-300 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
        >
          {categories.length === 0 && <option value="">Sin categorías</option>}
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-3">
          <VimdyInput
            type="number"
            min={0}
            step="0.01"
            placeholder="Precio"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            disabled={saving}
          />
          <VimdyInput
            type="number"
            min={0}
            step="0.01"
            placeholder="Costo (opcional)"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            disabled={saving}
          />
        </div>

        <VimdyInput
          type="number"
          min={0}
          placeholder="Stock inicial (unidades que tienes ahora)"
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          disabled={saving}
        />
        {!stock.trim() && (
          <p className="text-center text-xs text-amber-400 -mt-2">
            Si lo dejas vacío, el producto se crea con 0 unidades y se verá como "Agotado".
          </p>
        )}

        {error && <p className="text-center text-sm text-red-400">{error}</p>}

        <VimdyButton type="submit" disabled={saving} className="mt-2">
          {saving ? "Guardando..." : "Continuar"}
        </VimdyButton>

        <button
          type="button"
          onClick={onSaved}
          disabled={saving}
          className="text-center text-sm text-slate-400 hover:text-cyan-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Omitir (puedes agregar productos después desde Inventario)
        </button>
      </form>
    </GlassCard>
  );
}