import React, { useEffect, useState, useSyncExternalStore } from "react";
import { X, Check } from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { variantSelectorStore } from "../../../core/store/variantSelectorStore";
import { useCart } from "../../../core/store/useCart";
import { useTranslation } from "../../../core/i18n/useTranslation";

export function PosVariantSelectorModal() {
  const { t, money } = useTranslation();
  const { add } = useCart();

  const { product } = useSyncExternalStore(
    variantSelectorStore.subscribe,
    variantSelectorStore.getSnapshot
  );

  const [sizeId, setSizeId] = useState<string | null>(null);
  const [extraIds, setExtraIds] = useState<string[]>([]);

  useEffect(() => {
    if (product) {
      setSizeId(null);
      setExtraIds([]);
    }
  }, [product]);

  if (!product) return null;

  const sizes = product.sizes ?? [];
  const extras = product.extras ?? [];

  const selectedSize = sizes.find((size) => size.id === sizeId) ?? null;
  const selectedExtras = extras.filter((extra) => extraIds.includes(extra.id));

  const finalPrice =
    product.price +
    (selectedSize?.priceDelta ?? 0) +
    selectedExtras.reduce((sum, extra) => sum + extra.priceDelta, 0);

  function toggleExtra(id: string) {
    setExtraIds((current) =>
      current.includes(id) ? current.filter((extraId) => extraId !== id) : [...current, id]
    );
  }

  function close() {
    variantSelectorStore.close();
  }

  function confirm() {
    if (!product) return;

    const parts: string[] = [];
    if (selectedSize) parts.push(selectedSize.name);
    if (selectedExtras.length > 0) {
      parts.push(`+ ${selectedExtras.map((extra) => extra.name).join(", ")}`);
    }
    const note = parts.length > 0 ? parts.join(" ") : undefined;

    add({
      id: product.id,
      name: product.name,
      price: finalPrice,
      requiresKitchen: product.requiresKitchen ?? false,
      ...(note ? { note } : {})
    });

    close();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-sm max-h-[85vh] flex flex-col rounded-vimdy-lg bg-vimdy-surface border border-vimdy-border p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-vimdy-text font-bold text-vimdy-body leading-tight">
              {product.name}
            </h3>
            <p className="text-vimdy-text-secondary text-vimdy-micro mt-0.5">
              {t("pos.variants.subtitle")}
            </p>
          </div>
          <button
            onClick={close}
            aria-label={t("pos.variants.closeAria")}
            className="w-8 h-8 flex items-center justify-center text-vimdy-text-tertiary hover:text-vimdy-text flex-shrink-0 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          {sizes.length > 0 && (
            <div className="mb-4">
              <p className="text-vimdy-text-secondary text-vimdy-micro font-semibold mb-1.5">
                {t("pos.variants.sizeLabel")}
              </p>
              <div className="flex flex-col gap-1.5">
                {sizes.map((size) => (
                  <button
                    key={size.id}
                    type="button"
                    onClick={() => setSizeId((current) => (current === size.id ? null : size.id))}
                    className={`flex items-center justify-between h-11 px-3 rounded-vimdy-md border text-vimdy-small font-semibold transition-colors ${
                      sizeId === size.id
                        ? "border-vimdy-accent bg-vimdy-accent/10 text-vimdy-accent"
                        : "border-vimdy-border text-vimdy-text hover:border-vimdy-accent/50"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          sizeId === size.id ? "border-vimdy-accent" : "border-vimdy-border"
                        }`}
                      >
                        {sizeId === size.id && <span className="w-2 h-2 rounded-full bg-vimdy-accent" />}
                      </span>
                      {size.name}
                    </span>
                    {size.priceDelta !== 0 && (
                      <span className="tabular-nums text-vimdy-text-tertiary">
                        {size.priceDelta > 0 ? "+" : ""}
                        {money(size.priceDelta)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {extras.length > 0 && (
            <div>
              <p className="text-vimdy-text-secondary text-vimdy-micro font-semibold mb-1.5">
                {t("pos.variants.extrasLabel")}
              </p>
              <div className="flex flex-col gap-1.5">
                {extras.map((extra) => {
                  const checked = extraIds.includes(extra.id);
                  return (
                    <button
                      key={extra.id}
                      type="button"
                      onClick={() => toggleExtra(extra.id)}
                      className={`flex items-center justify-between h-11 px-3 rounded-vimdy-md border text-vimdy-small font-semibold transition-colors ${
                        checked
                          ? "border-vimdy-accent bg-vimdy-accent/10 text-vimdy-accent"
                          : "border-vimdy-border text-vimdy-text hover:border-vimdy-accent/50"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`w-4 h-4 rounded-vimdy-sm border-2 flex items-center justify-center flex-shrink-0 ${
                            checked ? "border-vimdy-accent bg-vimdy-accent" : "border-vimdy-border"
                          }`}
                        >
                          {checked && <Check size={11} className="text-white" />}
                        </span>
                        {extra.name}
                      </span>
                      {extra.priceDelta !== 0 && (
                        <span className="tabular-nums text-vimdy-text-tertiary">
                          {extra.priceDelta > 0 ? "+" : ""}
                          {money(extra.priceDelta)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-vimdy-md bg-vimdy-surface-active border border-vimdy-border px-4 py-3 flex items-center justify-between flex-shrink-0">
          <span className="text-vimdy-text-secondary text-vimdy-small">{t("pos.variants.total")}</span>
          <span className="text-vimdy-accent font-black text-xl tabular-nums">{money(finalPrice)}</span>
        </div>

        <div className="flex gap-2 mt-4 flex-shrink-0">
          <div className="flex-1">
            <VimdyButton onClick={close} variant="secondary" fullWidth>
              {t("pos.variants.cancel")}
            </VimdyButton>
          </div>
          <div className="flex-1">
            <VimdyButton onClick={confirm} variant="primary" fullWidth>
              {t("pos.variants.confirm")}
            </VimdyButton>
          </div>
        </div>
      </div>
    </div>
  );
}
