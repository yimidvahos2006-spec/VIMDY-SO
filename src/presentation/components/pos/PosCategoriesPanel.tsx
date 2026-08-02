import React from "react";
import {
  ShoppingBasket,
  UtensilsCrossed,
  Pizza,
  Coffee,
  Beef,
  IceCream2,
  Tag,
  Star
} from "lucide-react";

import { useCategory } from "../../../core/store/useCategory";
import { useProductCatalog } from "../../../core/store/useProductCatalog";
import { useCategories } from "../../../hooks/useCategories";
import { useTranslation } from "../../../core/i18n/useTranslation";

/**
 * Antes esta lista era texto hardcodeado ("Hamburguesas", "Pizzas"...)
 * comparado contra product.categoryId, que en la base real es un UUID
 * (viene de Supabase). Nunca iba a matchear -> todas las categorías
 * mostraban "0" aunque sí hubiera productos. Ahora se lee la categoría
 * real desde useCategories() (mismo hook que usa el módulo de Productos)
 * y se compara id contra id.
 *
 * El ícono no existe en la entidad Category (solo id/name/description),
 * así que se asigna por palabra clave del nombre — es solo decoración,
 * nunca se usa para filtrar.
 */
function iconFor(name: string): React.ElementType {
  const normalized = name.toLowerCase();
  if (normalized.includes("hamburg")) return UtensilsCrossed;
  if (normalized.includes("pizza")) return Pizza;
  if (normalized.includes("bebida") || normalized.includes("gaseosa") || normalized.includes("jugo")) return Coffee;
  if (normalized.includes("carne") || normalized.includes("res") || normalized.includes("pollo")) return Beef;
  if (normalized.includes("postre") || normalized.includes("dulce")) return IceCream2;
  return Tag;
}

/**
 * "Caja fácil para cualquier persona": antes había DOS listas — un
 * "acceso rápido" con las categorías más usadas arriba, y la lista
 * completa otra vez abajo — repitiendo la misma categoría dos veces en
 * pantalla. Eso confunde más de lo que ayuda a alguien que nunca ha visto
 * un POS. Ahora es UNA sola lista: Favoritas primero (si hay), luego
 * Todas, luego el resto — cada categoría aparece una sola vez.
 */
export function PosCategoriesPanel() {

  const { selected, select } = useCategory();
  const { products } = useProductCatalog();
  const { categories, loading } = useCategories();
  const { t } = useTranslation();

  function countFor(categoryId: string) {
    if (categoryId === "Favoritos") return products.filter((product) => product.favorite).length;
    if (categoryId === "Todos") return products.length;
    return products.filter((product) => product.categoryId === categoryId).length;
  }

  function renderButton(category: { id: string; name: string; icon: React.ElementType }) {

    const Icon = category.icon;
    const active = selected === category.id;
    const count = countFor(category.id);

    return (

      <button
        key={category.id}
        onClick={() => select(category.id)}
        aria-pressed={active}
        className={`
          w-full
          flex
          items-center
          gap-3
          px-4
          py-3.5
          min-h-[3.5rem]
          rounded-vimdy-md
          border-2
          transition-all
          duration-vimdy-normal
          text-left

          ${
            active
              ? "border-vimdy-accent bg-vimdy-accent text-white shadow-vimdy-blue"
              : "border-vimdy-border bg-vimdy-surface text-vimdy-text hover:border-vimdy-accent/60 hover:bg-vimdy-surface-hover"
          }
        `}
      >

        <Icon size={20} className="flex-shrink-0" />

        <span className="font-semibold text-vimdy-body leading-tight flex-1 min-w-0" title={category.name}>
          {category.name}
        </span>

        <span
          className={`
            text-vimdy-small font-bold px-2 py-0.5 rounded-vimdy-xs flex-shrink-0
            ${active ? "bg-white/20 text-white" : "bg-vimdy-background text-vimdy-text-secondary"}
          `}
        >
          {count}
        </span>

      </button>

    );

  }

  const realCategories = categories.map((category) => ({
    id: category.id,
    name: category.name,
    icon: iconFor(category.name)
  }));

  const allCategories = [{ id: "Todos", name: t("pos.categories.all"), icon: ShoppingBasket }, ...realCategories];

  const favoriteCount = countFor("Favoritos");

  return (

    <div className="h-full flex flex-col p-4">

      <h2 className="text-vimdy-text text-vimdy-h3 mb-1">
        {t("pos.categories.title")}
      </h2>

      <p className="text-vimdy-text-secondary text-vimdy-micro mb-4">
        {t("pos.categories.subtitle")}
      </p>

      {loading ? (
        <p className="text-vimdy-text-tertiary text-vimdy-small">{t("common.loading")}</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">

          {favoriteCount > 0 && renderButton({ id: "Favoritos", name: t("pos.categories.favorites"), icon: Star })}

          {allCategories.map(renderButton)}

        </div>
      )}

    </div>

  );

}