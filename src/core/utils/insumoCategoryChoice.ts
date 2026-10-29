// src/core/utils/insumoCategoryChoice.ts
//
// Qué categoría lleva un insumo NUEVO: la que el dueño eligió a mano o, si no
// eligió, la que sugiere insumoCategoryGuess según el nombre. Lo comparten el
// modal "Nuevo insumo" y la tarjeta "Crear ingrediente" de las recetas.
// Sin React.

import type { Category } from "../entities/Entities";
import {
  findExistingCategoryForRule,
  guessInsumoCategory,
  INSUMO_CATEGORY_RULES,
  normalizeInsumoText
} from "./insumoCategoryGuess";

/** Valor del selector para una categoría sugerida que el negocio aún no tiene ("new:Carnes"). */
export const NEW_CATEGORY_PREFIX = "new:";

/** Categoría de último recurso cuando el nombre no dice nada. */
export const FALLBACK_CATEGORY_NAME = "Otros";
const FALLBACK_ALIASES = ["otros", "otros insumos", "insumos", "varios"];

type NamedCategory = Pick<Category, "id" | "name">;

export function findFallbackCategory<T extends NamedCategory>(categories: readonly T[]): T | undefined {
  const wanted = new Set(FALLBACK_ALIASES);
  return categories.find((c) => wanted.has(normalizeInsumoText(c.name)));
}

/** Nombre de la categoría que se va a usar, para mostrarla antes de guardar. */
export function describeCategoryTarget(
  name: string,
  manualChoice: string | null,
  categories: readonly NamedCategory[]
): string {
  if (manualChoice) {
    if (manualChoice.startsWith(NEW_CATEGORY_PREFIX)) return manualChoice.slice(NEW_CATEGORY_PREFIX.length);
    const chosen = categories.find((c) => c.id === manualChoice);
    if (chosen) return chosen.name;
  }
  const rule = guessInsumoCategory(name);
  if (rule) return findExistingCategoryForRule(rule, categories)?.name ?? rule.name;
  return findFallbackCategory(categories)?.name ?? FALLBACK_CATEGORY_NAME;
}

/**
 * Valor del selector que corresponde a la sugerencia automática para `name`
 * (id de una categoría existente, o "new:<Nombre>" si habría que crearla).
 */
export function autoCategoryValue(name: string, categories: readonly NamedCategory[]): string {
  const rule = guessInsumoCategory(name);
  if (rule) {
    const existing = findExistingCategoryForRule(rule, categories);
    return existing ? existing.id : `${NEW_CATEGORY_PREFIX}${rule.name}`;
  }
  const fallback = findFallbackCategory(categories);
  return fallback ? fallback.id : `${NEW_CATEGORY_PREFIX}${FALLBACK_CATEGORY_NAME}`;
}

/**
 * Opciones del selector: las categorías que el negocio ya tiene más las
 * sugeridas que todavía no (se crean solo si se elige y se guarda).
 */
export function buildCategoryPickerOptions(
  categories: readonly NamedCategory[]
): Array<{ value: string; label: string }> {
  const existing = categories.map((c) => ({ value: c.id, label: c.name }));
  const suggested = INSUMO_CATEGORY_RULES.filter((r) => !findExistingCategoryForRule(r, categories)).map((r) => ({
    value: `${NEW_CATEGORY_PREFIX}${r.name}`,
    label: `${r.name} (nueva)`
  }));
  const fallback = findFallbackCategory(categories)
    ? []
    : [{ value: `${NEW_CATEGORY_PREFIX}${FALLBACK_CATEGORY_NAME}`, label: `${FALLBACK_CATEGORY_NAME} (nueva)` }];
  return [...existing, ...suggested, ...fallback].sort((a, b) => a.label.localeCompare(b.label));
}

export type ResolvedInsumoCategory =
  | { ok: true; categoryId: string; created?: Category }
  | { ok: false; reason: string };

/**
 * Devuelve el id de la categoría final, creándola solo si hace falta.
 * `createCategory` devuelve null si no pudo crearla (p. ej. nombre repetido).
 *
 * Los nombres de categoría son únicos en todo el negocio: si ya existe una de
 * PRODUCTOS llamada igual (ej. "Bebidas" que se vende en Caja), la de insumos
 * se crea como "Bebidas (insumos)" en vez de fallar.
 */
export async function resolveInsumoCategory(args: {
  name: string;
  manualChoice: string | null;
  categories: readonly Category[];
  createCategory: (name: string) => Promise<Category | null>;
}): Promise<ResolvedInsumoCategory> {
  const { name, manualChoice, categories, createCategory } = args;

  if (manualChoice && !manualChoice.startsWith(NEW_CATEGORY_PREFIX)) {
    if (categories.some((c) => c.id === manualChoice)) return { ok: true, categoryId: manualChoice };
  }

  const wantedName = manualChoice?.startsWith(NEW_CATEGORY_PREFIX)
    ? manualChoice.slice(NEW_CATEGORY_PREFIX.length)
    : (guessInsumoCategory(name)?.name ?? null);

  const target = wantedName ?? FALLBACK_CATEGORY_NAME;

  // ¿Ya la tiene el negocio (por nombre o alias)?
  const wantedRule = INSUMO_CATEGORY_RULES.find((r) => r.name === wantedName);
  const existing = wantedName
    ? wantedRule
      ? findExistingCategoryForRule(wantedRule, categories)
      : categories.find((c) => normalizeInsumoText(c.name) === normalizeInsumoText(wantedName))
    : findFallbackCategory(categories);
  if (existing) return { ok: true, categoryId: existing.id };

  for (const candidate of [target, `${target} (insumos)`]) {
    const created = await createCategory(candidate);
    if (created) return { ok: true, categoryId: created.id, created };
  }
  return { ok: false, reason: `No se pudo crear la categoría "${target}". Elige otra en el selector de categoría.` };
}