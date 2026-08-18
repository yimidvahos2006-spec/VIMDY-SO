import React, { useState } from "react";
import { Check } from "lucide-react";

import { useCart } from "../../../core/store/useCart";
import { useProductCatalog } from "../../../core/store/useProductCatalog";
import { useSearch } from "../../../core/store/useSearch";
import { useCategory } from "../../../core/store/useCategory";
import { useTopSellingProducts } from "../../../hooks/useTopSellingProducts";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { formatMoney } from "../../../core/utils/formatMoney";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { weightEntryStore } from "../../../core/store/weightEntryStore";
import { isVariableQuantityUnit } from "../../../core/utils/weightUnits";

export function PosProducts() {

  const { t } = useTranslation();

  const { add } = useCart();

  const { value: search } = useSearch();

  const { selected: category } = useCategory();

  const { products: catalog, search: searchProducts, getByCategory } = useProductCatalog();

  // "Solo disponibles": con catálogos donde buena parte del menú está
  // agotado (pasa seguido con inventario real), la grilla se llena de
  // tarjetas apagadas que solo estorban al cajero. Este switch las oculta
  // sin tocar el stock real ni el catálogo — es puramente visual, y se
  // recuerda por pestaña (no persiste entre sesiones a propósito: cada
  // turno de caja empieza mostrando todo).
  const [hideOutOfStock, setHideOutOfStock] = useState(false);

  // Se recalcula solo cuando cambia el tamaño del catálogo (eso pasa justo
  // después de cada venta, cuando processSale() refresca el stock real).
  const ranking = useTopSellingProducts(catalog.length);

  // El texto de búsqueda manda sobre el filtro de categoría, igual que en
  // cualquier POS: si el cajero está escribiendo, es porque ya sabe qué
  // busca sin importar en qué categoría esté parado.
  const filtered = search.trim() !== "" ? searchProducts(search) : getByCategory(category);

  // PASO 2 (formulario de producto — Estado): "Agotado" (active === false)
  // es una decisión manual del negocio, independiente del stock (ver
  // ProductFormModal). A diferencia de "sin stock" -- que solo se oculta si
  // el cajero prende "Solo disponibles" -- un producto marcado Agotado a
  // mano desaparece SIEMPRE de Caja, sin excepción: el negocio ya decidió
  // que no se puede vender.
  const sellable = filtered.filter((product) => product.active !== false && product.isIngredient !== true);

  // BLOQUEANTE (bug reportado en video 2026-07-31): igual que en
  // InventoryEngine/SalesEngine, un producto con trackStock === false
  // (Cocina sin receta, ej. Caldo de Costilla) nace con stock 0 a
  // propósito porque no maneja stock propio. "Solo disponibles" no debe
  // ocultarlo ni contarlo como agotado.
  const hiddenCount = hideOutOfStock
    ? sellable.filter((product) => product.trackStock !== false && product.stock <= 0).length
    : 0;
  const visible = hideOutOfStock
    ? sellable.filter((product) => product.trackStock === false || product.stock > 0)
    : sellable;

  // Más vendidos primero: el 80% de las ventas de cualquier negocio suelen
  // ser el mismo puñado de productos. Ponerlos arriba evita que el cajero
  // tenga que buscar lo de siempre entre todo el catálogo. Lo que no tiene
  // ventas recientes mantiene su orden normal, al final.
  const products = [...visible].sort((a, b) => {
    const rankA = ranking.get(a.id);
    const rankB = ranking.get(b.id);
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
    if (rankA !== undefined) return -1;
    if (rankB !== undefined) return 1;
    return 0;
  });

  return (

    <div>

      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setHideOutOfStock((current) => !current)}
          aria-pressed={hideOutOfStock}
          className={`flex items-center gap-2 h-9 pl-1 pr-3 rounded-full border-2 text-vimdy-small font-semibold transition-all ${
            hideOutOfStock
              ? "bg-vimdy-accent/15 border-vimdy-accent text-vimdy-accent"
              : "bg-vimdy-surface border-vimdy-border text-vimdy-text-secondary hover:border-vimdy-accent/50"
          }`}
        >
          <span
            className={`w-7 h-5 rounded-full relative transition-colors flex-shrink-0 ${
              hideOutOfStock ? "bg-vimdy-accent" : "bg-vimdy-border"
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                hideOutOfStock ? "translate-x-2.5" : "translate-x-0.5"
              }`}
            />
          </span>
          {t("pos.products.hideOutOfStock")}
        </button>

        {hiddenCount > 0 && (
          <span className="text-vimdy-micro text-vimdy-text-tertiary">
            {t("pos.products.hiddenCount", { count: hiddenCount })}
          </span>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3 auto-rows-fr">

      {
        products.length === 0 ? (

          <div className="col-span-full flex items-center justify-center h-60 rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface">

            <p className="text-vimdy-text-secondary text-vimdy-body">

              {hiddenCount > 0 && filtered.length > 0
                ? t("pos.products.hiddenCount", { count: hiddenCount })
                : t("pos.products.notFound")}

            </p>

          </div>

        ) : (

          products.map((product) => (

            <ProductCard
              key={product.id}
              name={product.name}
              price={product.price}
              stock={product.stock}
              trackStock={product.trackStock}
              image={product.image}
              unit={isVariableQuantityUnit(product.unit) ? product.unit : undefined}
              onAdd={() => {
                // BLOQUEANTE (auditoría Fase 2 — Supermercado): mismo
                // criterio que PosTopBar.tsx — un producto por peso/volumen
                // abre la báscula en vez de agregarse con cantidad 1.
                if (isVariableQuantityUnit(product.unit)) {
                  weightEntryStore.open({
                    id: product.id,
                    name: product.name,
                    price: product.price,
                    unit: product.unit as string,
                    requiresKitchen: product.requiresKitchen ?? true
                  });
                  return;
                }

                add({ id: product.id, name: product.name, price: product.price, requiresKitchen: product.requiresKitchen ?? true });
              }}
            />

          ))

        )

      }

      </div>

    </div>

  );

}

/**
 * Toda la tarjeta es el botón: en un POS de mostrador, apuntarle a un botón
 * chiquito abajo de la tarjeta cuesta precisión y un toque extra. Acá
 * cualquier parte de la tarjeta agrega el producto, con un flash visual
 * (borde + check) de medio segundo para confirmar que sí se agregó — así
 * el cajero no tiene que mirar el carrito para saber si funcionó.
 *
 * Tarjeta reducida a lo esencial para el cajero en el momento de vender:
 * foto, nombre, precio y si hay o no. Categoría, conteo exacto de stock y
 * badges (favorito / top ventas) se sacaron: son datos de gestión, no de
 * venta, y antes competían por atención con el precio.
 */
function ProductCard({
  name,
  price,
  stock,
  trackStock,
  image,
  unit,
  onAdd
}: {
  name: string;
  price: number;
  stock: number;
  trackStock?: boolean;
  image?: string;
  /**
   * BLOQUEANTE (auditoría Fase 2 — Supermercado): solo viene definido para
   * un producto por peso/volumen (ver isVariableQuantityUnit). Cambia el
   * precio mostrado ("$4.500/kg" en vez de "$4.500") y evita el flash de
   * "Agregado" al tocar la tarjeta — onAdd() en ese caso solo ABRE el
   * modal de báscula, todavía no agrega nada al carrito.
   */
  unit?: string;
  onAdd: () => void;
}) {
  const { t, language } = useTranslation();
  const [justAdded, setJustAdded] = useState(false);

  function handleAdd() {
    onAdd();
    if (unit) return;
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 500);
  }

  // BLOQUEANTE (bug reportado en video 2026-07-31): trackStock === false
  // (Cocina sin receta, ej. Caldo de Costilla) no maneja stock propio —
  // por eso nace en 0 — así que la tarjeta debe verse y comportarse como
  // "disponible" sin importar el número de stock. Mismo criterio que
  // InventoryEngine.buildConsumptionTargets / SalesEngine.validateSale.
  const available = trackStock === false || stock > 0;
  const formattedPrice = formatMoney(price, companyConfigStore.get().currency, language);

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={!available}
      aria-label={t("pos.products.addAria", { name, price: formattedPrice })}
      className={`
        group relative flex flex-col items-center text-center
        rounded-vimdy-md border bg-vimdy-surface p-2.5
        transition-all duration-vimdy-fast
        active:scale-[0.96]
        focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-vimdy-accent/40
        disabled:opacity-40 disabled:cursor-not-allowed
        ${justAdded ? "border-vimdy-success shadow-vimdy-md" : "border-vimdy-border hover:border-vimdy-accent"}
      `}
    >
      {justAdded && (
        <div className="absolute inset-0 flex items-center justify-center rounded-vimdy-md bg-vimdy-success-bg/90">
          <div className="flex items-center gap-1.5 text-vimdy-success font-semibold text-vimdy-small">
            <Check size={18} />
            {t("pos.products.added")}
          </div>
        </div>
      )}

      <div className="w-12 h-12 rounded-vimdy-sm bg-vimdy-background flex items-center justify-center text-xl mb-2 overflow-hidden group-hover:scale-105 transition-transform duration-vimdy-fast">
        {image ? (
          <img
            src={image}
            alt={name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          "🍽️"
        )}
      </div>

      {/* Nombre: una sola línea, truncado. */}
      <h3 className="w-full text-vimdy-text font-semibold text-vimdy-small leading-tight truncate">
        {name}
      </h3>

      <span className="mt-1 text-vimdy-accent-hover font-bold text-vimdy-body tabular-nums">
        {formattedPrice}
        {unit && <span className="text-vimdy-text-tertiary font-semibold">/{unit}</span>}
      </span>

      <div className="mt-1 flex items-center justify-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full ${available ? "bg-vimdy-success" : "bg-vimdy-danger"}`}
        />
        <span className={`text-vimdy-micro ${available ? "text-vimdy-text-tertiary" : "text-vimdy-danger"}`}>
          {available ? t("pos.products.available") : t("pos.products.outOfStock")}
        </span>
      </div>
    </button>
  );
}