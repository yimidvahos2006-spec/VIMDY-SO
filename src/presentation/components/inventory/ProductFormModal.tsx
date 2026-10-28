// src/presentation/components/inventory/ProductFormModal.tsx
//
// Formulario de producto (filosofía cero-complejidad): UNA sola vista vertical.
//   0. ¿Qué vas a vender? -> Preparado (receta) · Reventa (costo y código de barras) · Servicio (sin stock)
//   1. Lo básico          -> foto (opcional), nombre, categoría, precio de venta y costo (opcional)
//   2. ¿Qué lleva?        -> constructor de receta (solo Preparado; crea ingredientes al vuelo)
//   3. ¿A qué área va?    -> área de la comanda (solo Preparado)
//   4. Guardar
//
// Mantiene la misma API pública que el modal anterior (product, aiDraft,
// onSave, saveError...) para que InventoryDashboard no cambie. La lógica vive
// en ./product-form/*; este archivo solo arma la pantalla.

import React, { useEffect, useRef, useState } from "react";
import { ScanBarcode, Sparkles, X } from "lucide-react";
import type { Product } from "../../../core/entities/Entities";
import type { ProductInput } from "../../../core/engines/InventoryEngine";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";
import { MoneyInput } from "../ui/MoneyInput";
import { useAuth } from "../../context/AuthContext";
import { toMoneyInputValue } from "../../../core/utils/formatMoneyInput";
import type { DishDraft } from "./dishDraft";
import { CategoryField } from "./product-form/CategoryField";
import { KitchenStationPicker } from "./product-form/KitchenStationPicker";
import { ProductKindPicker } from "./product-form/ProductKindPicker";
import { ProductPhotoPicker } from "./product-form/ProductPhotoPicker";
import { RecipeBuilder } from "./product-form/RecipeBuilder";
import { useProductForm } from "./product-form/useProductForm";

export interface ProductFormModalProps {
  /** Si viene, el formulario edita ese producto; si no, crea uno nuevo. */
  product?: Product;
  /** VIMDY IA: borrador interpretado desde texto/voz. Solo se usa al CREAR; nada se guarda hasta pulsar Guardar. */
  aiDraft?: DishDraft;
  onClose: () => void;
  onSave: (input: ProductInput) => Promise<boolean>;
  /** Último error del inventario (ej. nombre duplicado): se muestra dentro del formulario. */
  saveError?: string | null;
  /**
   * Compatibilidad: el modal anterior los usaba para "Producción Inteligente"
   * (comprar el insumo limitante / abrir Kardex). Este formulario simple ya no
   * muestra ese panel; se aceptan para no romper a quien los pasa.
   */
  onBuyIngredient?: (ingredientId: string) => void;
  onViewKardex?: (product: Product) => void;
}

export function ProductFormModal({ product, aiDraft, onClose, onSave, saveError }: ProductFormModalProps) {
  const { can } = useAuth();
  const form = useProductForm({ product, aiDraft, saveError, onSave, onClose, canViewCosts: can("inventory.viewCosts") });
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Con ingredientes (solo Preparado), el costo lo calcula la receta: el campo se muestra bloqueado con ese valor.
  const costFromRecipe = form.recipeActive;
  const title = form.isEditing ? "Editar producto" : "Nuevo producto";
  const isPrepared = form.kind === "preparado";
  const nameLabel = isPrepared ? "Nombre del plato" : "Nombre del producto";
  const namePlaceholder = form.kind === "reventa" ? "Ej. Gaseosa 400 ml" : form.kind === "servicio" ? "Ej. Domicilio" : "Ej. Hamburguesa clásica";
  const dialogRef = useRef<HTMLDivElement>(null);

  // Garantiza que Escape funcione desde el primer momento (aunque el foco no esté en un campo).
  useEffect(() => {
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-vimdy-md"
      onMouseDown={(e) => e.target === e.currentTarget && form.cancel()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          // Los hijos (lista de ingredientes, tarjeta, nueva estación) cierran lo suyo primero con stopPropagation.
          if (e.key === "Escape") form.cancel();
        }}
        className="flex max-h-[94vh] w-full flex-col overflow-hidden outline-none rounded-t-vimdy-xl border border-vimdy-border bg-vimdy-background-secondary shadow-vimdy-lg animate-vimdy-slide-up motion-reduce:animate-none sm:max-w-2xl sm:rounded-vimdy-xl"
      >
        {/* Encabezado */}
        <header className="flex items-start justify-between gap-vimdy-md px-vimdy-lg pb-vimdy-sm pt-vimdy-lg">
          <div>
            <h2 className="text-vimdy-h3 text-vimdy-text">{title}</h2>
            <p className="text-vimdy-small text-vimdy-text-secondary">Elige qué vendes, ponle nombre y precio. Nada más.</p>
          </div>
          <button
            type="button"
            onClick={form.cancel}
            aria-label="Cerrar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-vimdy-sm text-vimdy-text-secondary transition-colors duration-vimdy-fast hover:bg-vimdy-surface-hover hover:text-vimdy-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vimdy-accent/40"
          >
            <X size={20} />
          </button>
        </header>

        {/* Contenido: una sola columna que scrollea */}
        <div className="flex-1 space-y-vimdy-lg overflow-y-auto px-vimdy-lg py-vimdy-md">
          {aiDraft && !form.isEditing && (
            <div role="status" className="rounded-vimdy-md border border-vimdy-ai/30 bg-vimdy-ai/10 px-vimdy-md py-vimdy-sm">
              <div className="flex items-start justify-between gap-vimdy-sm">
                <p className="flex items-center gap-vimdy-sm text-vimdy-small font-semibold text-vimdy-ai">
                  <Sparkles size={16} aria-hidden="true" />
                  {form.loading ? "VIMDY IA está llenando el formulario…" : "VIMDY IA llenó el formulario. Revísalo y guarda."}
                </p>
                {form.aiNotice.length > 0 && (
                  <button
                    type="button"
                    onClick={form.dismissAiNotice}
                    aria-label="Ocultar avisos"
                    className="shrink-0 text-vimdy-text-tertiary hover:text-vimdy-text"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              {form.aiNotice.length > 0 && (
                <ul className="mt-vimdy-sm list-disc space-y-vimdy-xs pl-5 text-vimdy-micro font-normal text-vimdy-text-secondary">
                  {form.aiNotice.map((notice, i) => (
                    <li key={i}>{notice}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 0 · ¿Qué vas a vender? (un insumo que se edita aquí conserva su tipo y no lo muestra) */}
          {form.kind !== "ingrediente" && <ProductKindPicker value={form.kind} onChange={form.setKind} disabled={form.saving} />}

          {/* 1 · Lo básico */}
          <section className="space-y-vimdy-md">
            <div>
              <div className="flex items-end gap-vimdy-md">
                <div className="min-w-0 flex-1">
                  <VimdyInput
                    label={nameLabel}
                    value={form.name}
                    onChange={(e) => form.setName(e.target.value)}
                    placeholder={namePlaceholder}
                    autoFocus={!aiDraft}
                    maxLength={80}
                  />
                </div>
                <ProductPhotoPicker value={form.image} onChange={form.setImage} onError={setPhotoError} disabled={form.saving} />
              </div>
              {photoError && (
                <p role="alert" className="mt-vimdy-xs text-vimdy-micro text-vimdy-danger">
                  {photoError}
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-vimdy-md sm:grid-cols-[1fr_auto]">
              <CategoryField
                categories={form.categories}
                value={form.categoryId}
                onChange={form.setCategoryId}
                disabled={form.loading}
                newName={form.newCategoryName}
                onNewNameChange={form.setNewCategoryName}
                onCreate={() => void form.createCategory()}
                creating={form.creatingCategory}
                error={form.categoryError}
              />
              <div className={`grid gap-vimdy-md ${form.showCostField ? "grid-cols-2 sm:w-[23rem]" : "grid-cols-1 sm:w-[11rem]"}`}>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="product-form-price" className="text-vimdy-small text-vimdy-text-secondary">
                    Precio de venta
                  </label>
                  <div className="relative">
                    <span aria-hidden="true" className="pointer-events-none absolute left-vimdy-md top-1/2 -translate-y-1/2 text-vimdy-text-tertiary">
                      $
                    </span>
                    <MoneyInput
                      id="product-form-price"
                      value={form.price}
                      onValueChange={form.setPrice}
                      placeholder="0"
                      className="w-full rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface py-vimdy-sm pl-8 pr-vimdy-md text-vimdy-body tabular-nums text-vimdy-text outline-none transition-colors duration-vimdy-fast placeholder:text-vimdy-text-tertiary focus:border-vimdy-accent focus:ring-2 focus:ring-vimdy-accent/20"
                    />
                  </div>
                </div>
                {form.showCostField && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="product-form-cost" className="text-vimdy-small text-vimdy-text-secondary">
                      Costo de compra
                    </label>
                    <div className="relative">
                      <span aria-hidden="true" className="pointer-events-none absolute left-vimdy-md top-1/2 -translate-y-1/2 text-vimdy-text-tertiary">
                        $
                      </span>
                      <MoneyInput
                        id="product-form-cost"
                        value={costFromRecipe ? (form.summary ? toMoneyInputValue(Math.round(form.summary.cost)) : "") : form.cost}
                        onValueChange={form.setCost}
                        disabled={costFromRecipe}
                        aria-describedby={costFromRecipe ? "product-form-cost-hint" : undefined}
                        placeholder="Opcional"
                        className="w-full rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface py-vimdy-sm pl-8 pr-vimdy-md text-vimdy-body tabular-nums text-vimdy-text outline-none transition-colors duration-vimdy-fast placeholder:text-vimdy-text-tertiary focus:border-vimdy-accent focus:ring-2 focus:ring-vimdy-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </div>
                    {costFromRecipe && (
                      <p id="product-form-cost-hint" className="text-vimdy-micro text-vimdy-text-tertiary">
                        Lo calcula la receta.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
            {form.showBarcodeField && (
              <VimdyInput
                label="Código de barras (opcional)"
                hint="Escanéalo con el lector o escríbelo; así lo encuentras rápido en caja."
                icon={<ScanBarcode size={16} aria-hidden="true" />}
                value={form.barcode}
                onChange={(e) => form.setBarcode(e.target.value)}
                // Los lectores terminan con Enter: no debe cerrar ni enviar nada.
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                autoComplete="off"
                maxLength={40}
                placeholder="Ej. 7702004003509"
              />
            )}
          </section>

          {/* 2 · ¿Qué lleva? y 3 · ¿A qué área va? (solo Preparado) */}
          {form.isKitchenProduct && (
            <>
              <div className="border-t border-vimdy-border-subtle pt-vimdy-lg">
                <RecipeBuilder
                  builder={form.builder}
                  allProducts={form.allProducts}
                  summary={form.summary}
                  loading={form.loading}
                />
              </div>
              <div className="border-t border-vimdy-border-subtle pt-vimdy-lg">
                <KitchenStationPicker
                  value={form.station}
                  onChange={form.setStation}
                  stations={form.knownStations}
                  autoLabel={form.autoStationLabel}
                />
              </div>
            </>
          )}
        </div>

        {/* 4 · Guardar (pegado abajo: siempre a la vista, con el error justo encima) */}
        <footer className="space-y-vimdy-sm border-t border-vimdy-border bg-vimdy-background-secondary px-vimdy-lg py-vimdy-md pb-[max(1rem,env(safe-area-inset-bottom))]">
          {form.error && (
            <div role="alert" className="rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-vimdy-md py-vimdy-sm text-vimdy-small text-vimdy-danger">
              {form.error}
            </div>
          )}
          <div className="flex items-center gap-vimdy-sm">
            <VimdyButton variant="ghost" onClick={form.cancel} disabled={form.saving}>
              Cancelar
            </VimdyButton>
            <VimdyButton variant="primary" size="lg" fullWidth onClick={() => void form.save()} loading={form.saving} disabled={form.loading}>
              {isPrepared ? "Guardar Plato / Receta" : "Guardar producto"}
            </VimdyButton>
          </div>
        </footer>
      </div>
    </div>
  );
}