import { useEffect, useId, useState, type FormEvent } from "react";
import { Loader2, Package } from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";
import { VimdySelect } from "../ui/VimdySelect";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { parseMoneyInput } from "../../../core/utils/parseMoneyInput";
import { formatMoneyInput } from "../../../core/utils/formatMoneyInput";
import { MoneyInput } from "../ui/MoneyInput";
import type { Category } from "../../../core/entities/Entities";
import { useStepDraft } from "./useStepDraft";
import { useCanUse } from "../../../hooks/useCanUse";
import { onboardingStepLabel } from "./onboardingSteps";

interface FirstProductStepProps {
  categories: Category[];
  onSaved: () => void;
}

/** Cómo se vende el producto: define si lleva stock y si pasa por cocina. */
type SaleMode = "stock" | "prepared" | "service";

const SALE_MODES: ReadonlyArray<{ id: SaleMode; title: string; detail: string }> = [
  { id: "stock", title: "Se vende de un stock", detail: "Gaseosa, snack, camiseta: se descuenta cada vez que vendes." },
  { id: "prepared", title: "Se prepara al pedirlo", detail: "Tamal, jugo, almuerzo: no lleva stock propio." },
  { id: "service", title: "Es un servicio", detail: "Domicilio, corte de cabello: sin stock ni preparación." },
];

function isSaleMode(value: unknown): value is SaleMode {
  return value === "stock" || value === "prepared" || value === "service";
}

interface FirstProductDraft {
  saleMode: SaleMode | "";
  name: string;
  price: string;
  cost: string;
  stock: string;
  categoryId: string;
}

/** Campo de dinero con el mismo aspecto que VimdyInput: muestra 5000 como 5.000 mientras se escribe. */
function MoneyField({
  label,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  value: string;
  onValueChange: (formatted: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="vimdy-small text-vimdy-text-secondary">
        {label}
      </label>
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-vimdy-md text-vimdy-text-tertiary">$</span>
        <MoneyInput
          id={id}
          value={value}
          onValueChange={onValueChange}
          placeholder="0"
          disabled={disabled}
          className="w-full rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface pl-8 pr-vimdy-md py-vimdy-sm text-vimdy-body text-vimdy-text placeholder:text-vimdy-text-tertiary outline-none transition-colors duration-vimdy-fast focus:border-vimdy-accent focus:ring-2 focus:ring-vimdy-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}

function sanitizeFirstProductDraft(raw: unknown): FirstProductDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
  return {
    saleMode: isSaleMode(r.saleMode) ? r.saleMode : "",
    name: text(r.name, 120),
    price: formatMoneyInput(text(r.price, 20)),
    cost: formatMoneyInput(text(r.cost, 20)),
    stock: text(r.stock, 20),
    categoryId: text(r.categoryId, 80),
  };
}

export function FirstProductStep({ categories, onSaved }: FirstProductStepProps) {
  const { user } = useAuth();
  const kitchenEnabled = useCanUse("kitchen");

  // Lo escrito se guarda al instante y se recupera si el usuario sale o recarga.
  const defaultCategoryId = categories[0]?.id ?? (categories.length === 0 ? "uncategorized" : "");
  const [draft, setDraft] = useStepDraft<FirstProductDraft>(
    "first_product",
    { saleMode: "", name: "", price: "", cost: "", stock: "", categoryId: defaultCategoryId },
    sanitizeFirstProductDraft
  );
  const { name, price, cost, stock, saleMode } = draft;
  const categoryId =
    draft.categoryId === "uncategorized" || categories.some((category) => category.id === draft.categoryId)
      ? draft.categoryId
      : defaultCategoryId;
  const setSaleMode = (value: SaleMode) => setDraft((current) => ({ ...current, saleMode: value }));
  const setName = (value: string) => setDraft((current) => ({ ...current, name: value }));
  const setPrice = (value: string) => setDraft((current) => ({ ...current, price: value }));
  const setCost = (value: string) => setDraft((current) => ({ ...current, cost: value }));
  const setStock = (value: string) => setDraft((current) => ({ ...current, stock: value }));
  const setCategoryId = (value: string) => setDraft((current) => ({ ...current, categoryId: value }));
  const [saving, setSaving] = useState(false);
  const [checkingProducts, setCheckingProducts] = useState(true);
  const [hasActiveProduct, setHasActiveProduct] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    void container.inventoryEngine.get().listAll()
      .then((products) => {
        if (mounted) setHasActiveProduct(products.some((product) => product.active !== false));
      })
      .catch(() => {
        if (mounted) setError("No se pudo comprobar el inventario. Intenta de nuevo.");
      })
      .finally(() => {
        if (mounted) setCheckingProducts(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const priceValue = parseMoneyInput(price);
    const tracksStock = saleMode === "stock";
    const stockValue = tracksStock && stock.trim() ? Number(stock) : 0;
    const costValue = cost.trim() ? parseMoneyInput(cost) : undefined;

    if (!saleMode) {
      setError("Elige cómo se vende este producto.");
      return;
    }
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
      // Si no hay categorías (se omitió el paso 5) NO se guarda el id falso
      // "uncategorized": se usa (o se crea) una categoría real "General".
      let finalCategoryId = categoryId;
      if (finalCategoryId === "uncategorized") {
        const engine = container.categoryEngine.get();
        const all = await engine.listAll();
        const general =
          all.find((c) => c.name.trim().toLowerCase() === "general") ??
          (await engine.create({ name: "General" }));
        finalCategoryId = general.id;
      }

      await container.inventoryEngine.get().createProduct(
        {
          name: name.trim(),
          categoryId: finalCategoryId,
          price: priceValue,
          stock: stockValue,
          minStock: 0,
          purchasePrice: costValue,
          // Mismas reglas que Inventario (productType.ts): solo "stock" descuenta
          // unidades; lo que se prepara va a cocina únicamente si el negocio
          // activó el módulo Cocina.
          trackStock: tracksStock,
          requiresKitchen: saleMode === "prepared" && kitchenEnabled,
          isIngredient: false
        },
        user?.id
      );
      setHasActiveProduct(true);
      onSaved();
    } catch (err) {
      const message = translateBusinessError(err, "No se pudo crear el producto.");
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleContinue() {
    if (saving || checkingProducts) return;

    try {
      const products = await container.inventoryEngine.get().listAll();
      if (!products.some((product) => product.active !== false)) {
        setError("Crea al menos un producto activo antes de continuar.");
        return;
      }
      setHasActiveProduct(true);
      onSaved();
    } catch {
      setError("No se pudo comprobar el inventario. Intenta de nuevo.");
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">{onboardingStepLabel("first_product")}</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">Agrega tu primer producto o servicio</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Así podrás comenzar a registrar ventas apenas termines la configuración.
        </p>
      </div>

      <VimdyCard padding="lg" className="w-full max-w-xl mx-auto">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex items-center gap-3 rounded-vimdy-md border-2 border-vimdy-border bg-vimdy-surface p-4">
            <div className="w-10 h-10 rounded-vimdy-md bg-vimdy-background text-vimdy-text-secondary flex items-center justify-center shrink-0">
              <Package size={20} strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-vimdy-text">Producto o servicio</p>
              <p className="text-xs text-vimdy-text-muted mt-0.5">Completa los datos básicos para comenzar.</p>
            </div>
          </div>

          <fieldset className="flex flex-col gap-2" disabled={saving}>
            <legend className="mb-1 text-sm font-semibold text-vimdy-text-secondary">¿Cómo se vende? *</legend>
            {SALE_MODES.map((mode) => {
              const active = saleMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSaleMode(mode.id)}
                  className={`rounded-vimdy-md border-2 px-4 py-3 text-left transition-all duration-200 ${
                    active
                      ? "border-vimdy-accent bg-vimdy-accent/10"
                      : "border-vimdy-border bg-vimdy-surface hover:border-vimdy-accent/60"
                  }`}
                >
                  <span className="block text-sm font-semibold text-vimdy-text">{mode.title}</span>
                  <span className="block text-vimdy-micro text-vimdy-text-tertiary mt-0.5">{mode.detail}</span>
                </button>
              );
            })}
          </fieldset>

          <VimdyInput
            label="Nombre del producto o servicio *"
            placeholder="Ej. Hamburguesa Clásica, Café Americano, Camiseta, Corte de cabello..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />

          <VimdySelect
            label="Categoría *"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={saving}
          >
            {categories.length === 0 && <option value="uncategorized">Sin categoría</option>}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </VimdySelect>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <MoneyField label="Precio de venta *" value={price} onValueChange={setPrice} disabled={saving} />
            <MoneyField label="Costo (opcional)" value={cost} onValueChange={setCost} disabled={saving} />
          </div>

          {saleMode === "stock" && (
            <VimdyInput
              type="number"
              min={0}
              label="Stock inicial"
              placeholder="0"
              hint="Si no ingresas stock, comenzará con 0 unidades."
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              disabled={saving}
            />
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger">
              <span className="mt-0.5 shrink-0">⚠</span>
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
            <VimdyButton type="submit" disabled={saving || checkingProducts} className="min-w-[200px]">
              {saving ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={18} className="animate-spin" />
                  Guardando...
                </span>
              ) : (
                "Crear producto"
              )}
            </VimdyButton>
            {hasActiveProduct && (
              <VimdyButton
                variant="ghost"
                type="button"
                onClick={() => void handleContinue()}
                disabled={saving || checkingProducts}
              >
                Continuar
              </VimdyButton>
            )}
          </div>
          {!checkingProducts && !hasActiveProduct && (
            <p className="text-center text-vimdy-small text-vimdy-text-secondary">
              Este paso es obligatorio. Necesitas al menos un producto para empezar a vender.
            </p>
          )}
        </form>
      </VimdyCard>
    </div>
  );
}