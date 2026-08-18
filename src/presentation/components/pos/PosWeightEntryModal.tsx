import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Scale, X } from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { weightEntryStore } from "../../../core/store/weightEntryStore";
import { useCart } from "../../../core/store/useCart";
import { toastStore } from "../../../core/store/toastStore";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { roundWeight } from "../../../core/utils/weightUnits";

/**
 * PosWeightEntryModal
 * ---------------------------------------------------------------------------
 * BLOQUEANTE (auditoría Fase 2 — rama Supermercado): "no hay UI de
 * báscula". Se abre cuando PosTopBar (escaneo de código de barras) o
 * PosProducts (clic en la tarjeta) detectan que el producto tiene una
 * unidad de medida variable (Product.unit ∈ kg/g/libra/litro/ml, ver
 * core/utils/weightUnits.ts) en vez de agregarlo directo con cantidad 1.
 *
 * El cajero escribe el peso que marca la báscula; el subtotal (precio por
 * unidad × peso) se recalcula en vivo para que pueda confirmar el cobro
 * ANTES de agregarlo al carrito — así se cierra el hueco real de la
 * auditoría: el precio por peso ahora sí llega a Caja.
 *
 * Se monta una sola vez en PosPage.tsx y se controla 100% desde
 * weightEntryStore (abierto si product !== null), igual que
 * PosTableSearchModal se controla desde su propio estado local en
 * PosTopBar — la diferencia es que este necesita abrirse desde DOS lugares
 * distintos (topbar y grilla de productos), por eso vive en un store
 * compartido en vez de un useState local de un solo componente.
 */
export function PosWeightEntryModal() {
  const { t, money } = useTranslation();
  const { add } = useCart();

  const { product, presetWeight } = useSyncExternalStore(
    weightEntryStore.subscribe,
    weightEntryStore.getSnapshot
  );

  const [weightInput, setWeightInput] = useState("");

  // Se resincroniza cada vez que se abre para un producto nuevo (o con un
  // peso precargado, ver nota de hardware en weightEntryStore.ts).
  useEffect(() => {
    if (product) {
      setWeightInput(presetWeight !== null ? String(presetWeight) : "");
    }
  }, [product, presetWeight]);

  if (!product) return null;

  const parsedWeight = Number(weightInput.replace(",", "."));
  const validWeight = Number.isFinite(parsedWeight) && parsedWeight > 0;
  const subtotal = validWeight ? parsedWeight * product.price : 0;

  function close() {
    weightEntryStore.close();
  }

  function confirm() {
    if (!product) return;

    if (!validWeight) {
      toastStore.warning(t("pos.weight.invalidWeight"));
      return;
    }

    add({
      id: product.id,
      name: product.name,
      price: product.price,
      requiresKitchen: product.requiresKitchen ?? true,
      unit: product.unit,
      soldByWeight: true,
      quantity: roundWeight(parsedWeight)
    });

    close();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-sm rounded-vimdy-lg bg-vimdy-surface border border-vimdy-border p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-vimdy-md bg-vimdy-accent/10 border border-vimdy-accent/30 flex items-center justify-center flex-shrink-0">
              <Scale size={20} className="text-vimdy-accent" />
            </div>
            <div>
              <h3 className="text-vimdy-text font-bold text-vimdy-body leading-tight">{t("pos.weight.title")}</h3>
              <p className="text-vimdy-text-secondary text-vimdy-micro mt-0.5">{product.name}</p>
            </div>
          </div>
          <button
            onClick={close}
            aria-label={t("pos.weight.closeAria")}
            className="w-8 h-8 flex items-center justify-center text-vimdy-text-tertiary hover:text-vimdy-text flex-shrink-0 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-vimdy-text-secondary text-vimdy-micro mb-3">
          {t("pos.weight.pricePerUnit", { unit: product.unit })}: {money(product.price)}
        </p>

        <label className="block text-vimdy-text-secondary text-vimdy-small font-medium mb-1">
          {t("pos.weight.weightLabel", { unit: product.unit })}
        </label>
        <input
          autoFocus
          type="number"
          min={0}
          step="0.001"
          inputMode="decimal"
          value={weightInput}
          onChange={(event) => setWeightInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") confirm();
          }}
          placeholder={t("pos.weight.weightPlaceholder")}
          className="w-full h-12 px-4 rounded-vimdy-md bg-vimdy-surface-active border border-vimdy-border text-vimdy-text text-lg font-bold outline-none focus:border-vimdy-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />

        <p className="text-vimdy-text-tertiary text-vimdy-micro mt-1.5">{t("pos.weight.scaleHint")}</p>

        <div className="mt-4 rounded-vimdy-md bg-vimdy-surface-active border border-vimdy-border px-4 py-3 flex items-center justify-between">
          <span className="text-vimdy-text-secondary text-vimdy-small">{t("pos.weight.subtotal")}</span>
          <span className="text-vimdy-accent font-black text-xl tabular-nums">{money(subtotal)}</span>
        </div>

        <div className="flex gap-2 mt-4">
          <div className="flex-1">
            <VimdyButton onClick={close} variant="secondary" fullWidth>
              {t("pos.weight.cancel")}
            </VimdyButton>
          </div>
          <div className="flex-1">
            <VimdyButton onClick={confirm} disabled={!validWeight} variant="primary" fullWidth>
              {t("pos.weight.confirm")}
            </VimdyButton>
          </div>
        </div>
      </div>
    </div>
  );
}