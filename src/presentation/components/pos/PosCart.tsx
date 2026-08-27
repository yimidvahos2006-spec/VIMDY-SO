import React, { useEffect, useState } from "react";
import { Minus, Plus, Trash2, ShoppingCart, Percent, Tag, HandCoins, X, ChevronDown, ChevronUp } from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { useCart } from "../../../core/store/useCart";
import { usePayment } from "../../../core/store/usePayment";
import { useProductCatalog } from "../../../core/store/useProductCatalog";
import { paymentStore, DiscountType, TipType } from "../../../core/store/paymentStore";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { formatMoney } from "../../../core/utils/formatMoney";
import { companyConfigStore } from "../../../core/store/companyConfigStore";

/**
 * Convierte la nota libre de un ítem en una lista de "frases" separadas
 * por coma, y prende/apaga una de ellas. Así los chips de "Quitar
 * ingredientes" y "Agregar extras" pueden marcar/desmarcar su propia
 * frase sin pisar lo que el cajero ya haya escrito a mano.
 */
function toggleNotePhrase(note: string, phrase: string): string {
  const parts = note.split(",").map((part) => part.trim()).filter(Boolean);
  const exists = parts.includes(phrase);
  const next = exists ? parts.filter((part) => part !== phrase) : [...parts, phrase];
  return next.join(", ");
}

/**
 * Input de cantidad editable a mano.
 * Mantiene un valor de texto local mientras el cajero escribe, y solo
 * confirma contra el cartStore (fuente real de verdad) al perder foco
 * o al presionar Enter. Si el carrito cambia por otra vía (+/-), el
 * input se resincroniza automáticamente vía la prop `quantity`.
 */
function CartQuantityInput({
  quantity,
  soldByWeight,
  onCommit
}: {
  quantity: number;
  /**
   * BLOQUEANTE (auditoría Fase 2 — Supermercado): un producto pesado
   * necesita step decimal (0.001) e inputMode decimal para poder escribir
   * "0.750" a mano; el resto del catálogo sigue siendo entero, igual que
   * siempre.
   */
  soldByWeight?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(quantity));

  useEffect(() => {
    setDraft(String(quantity));
  }, [quantity]);

  function commit() {
    const parsed = Number(draft.replace(",", "."));
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(String(quantity));
      return;
    }
    onCommit(parsed);
  }

  return (
    <input
      type="number"
      min={0}
      step={soldByWeight ? "0.001" : "1"}
      inputMode={soldByWeight ? "decimal" : "numeric"}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
      onFocus={(event) => event.currentTarget.select()}
      className={`h-8 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-center text-vimdy-text font-bold text-vimdy-small outline-none focus:border-vimdy-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
        soldByWeight ? "w-16" : "w-12"
      }`}
    />
  );
}

/**
 * Campo libre para "Agregar extras". No existe un catálogo de extras con
 * precio en el sistema, así que esto no inventa cargos ni productos: solo
 * agrega la frase escrita a la nota real del ítem (item.note), que es la
 * que ya viaja en la comanda a Cocina.
 */
function ItemExtraInput({ onAdd }: { onAdd: (extra: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  function submit() {
    const value = draft.trim();
    if (!value) return;
    onAdd(t("pos.cart.extraPrefix", { value }));
    setDraft("");
  }

  return (
    <div>
      <p className="text-vimdy-micro text-vimdy-text-secondary font-semibold mb-1.5">{t("pos.cart.addExtras")}</p>
      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder={t("pos.cart.extraPlaceholder")}
          className="flex-1 min-w-0 h-9 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border px-2.5 text-vimdy-micro text-vimdy-text outline-none focus:border-vimdy-accent"
        />
        <VimdyButton onClick={submit} variant="secondary" size="sm">
          {t("common.add")}
        </VimdyButton>
      </div>
    </div>
  );
}

export function PosCart() {
  const { t, language } = useTranslation();
  const { items, total, increase, decrease, setQuantity, remove, updateNote, clear } = useCart();
  const { discountType, discountValue, discountAmount, tipType, tipValue, tipAmount, notes, setDiscount, setTip, setNotes } = usePayment();
  const { getById } = useProductCatalog();

  const money = (value: number) => formatMoney(value, companyConfigStore.get().currency, language);

  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [discountKind, setDiscountKind] = useState<DiscountType>("PERCENT");

  // BLOQUEANTE (auditoría Fase 2 — rama Bar): mismo patrón que discount*
  // arriba, para la propina voluntaria.
  const [tipOpen, setTipOpen] = useState(false);
  const [tipInput, setTipInput] = useState("");
  const [tipKind, setTipKind] = useState<TipType>("PERCENT");

  // El carrito solo suma precio x cantidad (subtotal). El monto real que
  // hay que cobrar lo calcula SalesEngine (IVA + descuento real), y lo
  // guardamos en paymentStore para que Pago (PosPayment / PosCheckoutPanel)
  // siempre valide y muestre el mismo total que después va a crear la venta.
  const subtotal = total;
  const tax = container.salesEngine.get().calculateTax(subtotal);

  const realDiscountAmount = discountType
    ? container.salesEngine.get().calculateDiscount(subtotal, { type: discountType, value: discountValue })
    : 0;

  // BLOQUEANTE (auditoría Fase 2 — rama Bar): la propina se calcula sobre
  // el subtotal (igual que el descuento) pero SUMA en vez de restar, y se
  // agrega al total DESPUÉS del IVA (ver SalesEngine.calculateTotal) — no
  // se cobra IVA sobre la propina.
  const realTipAmount = tipType
    ? container.salesEngine.get().calculateTip(subtotal, { type: tipType, value: tipValue })
    : 0;

  const totalConImpuesto = container.salesEngine.get().calculateTotal(
    subtotal,
    tax,
    realDiscountAmount,
    0,
    realTipAmount
  );

  useEffect(() => {
    paymentStore.setTotal(totalConImpuesto);
  }, [totalConImpuesto]);

  // Si el descuento calculado cambia (por ejemplo, porque el carrito
  // cambió y un descuento FIJO ahora supera el subtotal), mantenemos
  // discountAmount sincronizado con lo que realmente va a facturar
  // SalesEngine.
  useEffect(() => {
    if (discountType && realDiscountAmount !== discountAmount) {
      paymentStore.setDiscount(discountType, discountValue, realDiscountAmount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realDiscountAmount, discountType]);

  // Mismo motivo que el efecto de arriba, pero para la propina en PORCENTAJE:
  // si el subtotal cambia, un 10% ya calculado antes queda desactualizado.
  useEffect(() => {
    if (tipType && realTipAmount !== tipAmount) {
      paymentStore.setTip(tipType, tipValue, realTipAmount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realTipAmount, tipType]);

  function applyDiscount() {
    const value = Number(discountInput);

    if (!value || value <= 0) {
      paymentStore.setDiscount(null, 0, 0);
      setDiscountOpen(false);
      setDiscountInput("");
      return;
    }

    const clampedValue = discountKind === "PERCENT" ? Math.min(value, 100) : Math.min(value, subtotal);
    const amount = container.salesEngine.get().calculateDiscount(subtotal, {
      type: discountKind,
      value: clampedValue
    });

    paymentStore.setDiscount(discountKind, clampedValue, amount);
    setDiscountOpen(false);
    setDiscountInput("");
  }

  function removeDiscount() {
    paymentStore.setDiscount(null, 0, 0);
  }

  // BLOQUEANTE (auditoría Fase 2 — rama Bar): mismo patrón que
  // applyDiscount/removeDiscount, sin el tope al subtotal en modo FIJO
  // (ver SalesEngine.calculateTip — la propina no está limitada al
  // subtotal, un cliente puede dar más de lo que topa un descuento).
  function applyTip() {
    const value = Number(tipInput);

    if (!value || value <= 0) {
      paymentStore.setTip(null, 0, 0);
      setTipOpen(false);
      setTipInput("");
      return;
    }

    const clampedValue = tipKind === "PERCENT" ? Math.min(value, 100) : value;
    const amount = container.salesEngine.get().calculateTip(subtotal, {
      type: tipKind,
      value: clampedValue
    });

    paymentStore.setTip(tipKind, clampedValue, amount);
    setTipOpen(false);
    setTipInput("");
  }

  function removeTip() {
    paymentStore.setTip(null, 0, 0);
  }

  return (
    <div className="flex flex-col">
      {/* Encabezado */}
      {items.length > 0 && (
        <div className="px-4 pt-3 flex-shrink-0 flex items-center justify-end">
          <VimdyButton onClick={clear} variant="danger" size="sm" icon={<Trash2 size={14} />}>
            {t("pos.cart.clear")}
          </VimdyButton>
        </div>
      )}

      {/* Lista de productos */}
      <div className="px-4 py-3 space-y-3">
        {items.length === 0 ? (
          <div className="py-10 flex flex-col justify-center items-center text-center px-6">
            <div className="w-16 h-16 rounded-vimdy-lg bg-vimdy-surface border border-vimdy-border flex items-center justify-center">
              <ShoppingCart size={28} className="text-vimdy-text-tertiary" />
            </div>
            <p className="mt-4 text-vimdy-text font-semibold text-vimdy-small">{t("pos.cart.emptyTitle")}</p>
            <p className="mt-1 text-vimdy-text-tertiary text-vimdy-micro">{t("pos.cart.emptySubtitle")}</p>
          </div>
        ) : (
          items.map((item) => {
            const expanded = expandedItemId === item.id;
            const product = getById(item.id);
            const recipeIngredients = (product?.recipe ?? [])
              .map((recipeItem) => getById(recipeItem.productId)?.name)
              .filter((ingredientName): ingredientName is string => Boolean(ingredientName));

            return (
              <div key={item.id} className="rounded-vimdy-md bg-vimdy-surface border border-vimdy-border overflow-hidden">

                {/* Fila tipo ticket: tocar el producto abre/cierra sus notas */}
                <button
                  type="button"
                  onClick={() => setExpandedItemId(expanded ? null : item.id)}
                  aria-expanded={expanded}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                >
                  <span className="text-lg flex-shrink-0">🍽️</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-vimdy-text font-semibold text-vimdy-small truncate">{item.name}</span>
                    {item.note && (
                      <span className="block text-vimdy-accent-hover text-vimdy-micro truncate">{item.note}</span>
                    )}
                  </span>
                  <span className="text-vimdy-text-secondary text-vimdy-micro flex-shrink-0">
                    x{item.soldByWeight ? item.quantity.toFixed(3) : item.quantity}
                    {item.soldByWeight && item.unit ? ` ${item.unit}` : ""}
                  </span>
                  <span className="text-vimdy-text font-bold text-vimdy-small flex-shrink-0">
                    {money(item.quantity * item.price)}
                  </span>
                  {expanded ? (
                    <ChevronUp size={16} className="text-vimdy-text-tertiary flex-shrink-0" />
                  ) : (
                    <ChevronDown size={16} className="text-vimdy-text-tertiary flex-shrink-0" />
                  )}
                </button>

                {/* Controles de cantidad + eliminar */}
                <div className="flex items-center justify-between px-3 pb-2.5">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => decrease(item.id)}
                      aria-label={t("pos.cart.decreaseAria", { name: item.name })}
                      className="w-8 h-8 rounded-vimdy-sm bg-vimdy-surface-active"
                    >
                      <Minus size={15} className="mx-auto" />
                    </button>
                    <CartQuantityInput
                      quantity={item.quantity}
                      soldByWeight={item.soldByWeight}
                      onCommit={(value) => setQuantity(item.id, value)}
                    />
                    <button
                      onClick={() => increase(item.id)}
                      aria-label={t("pos.cart.increaseAria", { name: item.name })}
                      className="w-8 h-8 rounded-vimdy-sm bg-vimdy-accent text-vimdy-background"
                    >
                      <Plus size={15} className="mx-auto" />
                    </button>
                  </div>
                  <button
                    onClick={() => remove(item.id)}
                    aria-label={t("pos.cart.removeItemAria", { name: item.name })}
                    className="w-8 h-8 flex items-center justify-center text-vimdy-danger hover:text-vimdy-danger/80"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* Panel de notas del producto: se abre al tocar la fila de arriba */}
                {expanded && (
                  <div className="border-t border-vimdy-border bg-vimdy-background/50 p-3 space-y-3">

                    {recipeIngredients.length > 0 && (
                      <div>
                        <p className="text-vimdy-micro text-vimdy-text-secondary font-semibold mb-1.5">{t("pos.cart.removeIngredients")}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {recipeIngredients.map((ingredientName) => {
                            const phrase = t("pos.cart.withoutIngredient", { ingredient: ingredientName });
                            const active = (item.note ?? "")
                              .split(",")
                              .map((part) => part.trim())
                              .includes(phrase);
                            return (
                              <button
                                key={ingredientName}
                                onClick={() => updateNote(item.id, toggleNotePhrase(item.note ?? "", phrase))}
                                aria-pressed={active}
                                className={`text-vimdy-micro px-2.5 py-1 rounded-vimdy-xs border transition ${
                                  active
                                    ? "bg-vimdy-danger-bg border-vimdy-danger/50 text-vimdy-danger"
                                    : "bg-vimdy-surface border-vimdy-border text-vimdy-text-secondary hover:border-vimdy-danger/40"
                                }`}
                              >
                                {phrase}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <ItemExtraInput
                      onAdd={(extra) => updateNote(item.id, toggleNotePhrase(item.note ?? "", extra))}
                    />

                    <div>
                      <label className="text-vimdy-micro text-vimdy-text-secondary font-semibold">{t("pos.cart.kitchenNotes")}</label>
                      <textarea
                        value={item.note ?? ""}
                        onChange={(event) => updateNote(item.id, event.target.value)}
                        placeholder={t("pos.cart.kitchenNotesPlaceholder")}
                        className="mt-1 w-full h-14 resize-none rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border px-2.5 py-2 text-vimdy-micro text-vimdy-text outline-none focus:border-vimdy-accent"
                      />
                    </div>

                  </div>
                )}

              </div>
            );
          })
        )}
      </div>

      {/* Bloque inferior: observaciones -> descuento (el orden real de
          cobro es Cliente -> Descuento -> Método -> Recibido -> Cambio ->
          Total -> Cobrar; el cliente ya NO va acá — la tarjeta completa
          ocupaba espacio vertical que le hacía falta a la lista de
          productos en carritos largos. Ahora vive como botón compacto en
          la barra de pestañas de Caja (ver PosCustomer compact en
          CashOperationsPage.tsx), pero sigue siendo el mismo cliente de
          siempre: usePayment().customerId/customerName no cambió, así que
          processSale() sigue facturando al cliente que se haya elegido
          ahí, exactamente igual que antes. */}
      <div className="px-4 pb-4 space-y-4">
        <div>
          <label className="text-vimdy-micro text-vimdy-text-secondary">{t("pos.cart.observations")}</label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t("pos.cart.observationsPlaceholder")}
            className="mt-1 w-full h-16 resize-none rounded-vimdy-md bg-vimdy-surface border border-vimdy-border px-3 py-2 text-vimdy-small text-vimdy-text outline-none focus:border-vimdy-accent"
          />
        </div>

        <div className="rounded-vimdy-md bg-vimdy-surface border border-vimdy-border p-3 space-y-2">
          <div className="flex justify-between text-vimdy-small">
            <span className="text-vimdy-text-secondary">{t("pos.cart.subtotal")}</span>
            <span className="text-vimdy-text">{money(subtotal)}</span>
          </div>
          <div className="flex justify-between text-vimdy-small">
            <span className="text-vimdy-text-secondary">{t("pos.cart.tax")}</span>
            <span className="text-vimdy-text">{money(tax)}</span>
          </div>

          <div className="flex justify-between text-vimdy-small items-center">
            <button
              onClick={() => setDiscountOpen(true)}
              className="text-vimdy-text-secondary flex items-center gap-1 hover:text-vimdy-accent-hover transition"
            >
              <Tag size={13} />
              {t("pos.cart.discount")}
              {discountType && (
                <span className="text-vimdy-accent-hover font-semibold">
                  ({discountType === "PERCENT" ? `${discountValue}%` : money(discountValue)})
                </span>
              )}
            </button>
            <div className="flex items-center gap-2">
              <span className={realDiscountAmount > 0 ? "text-vimdy-success" : "text-vimdy-text"}>
                {realDiscountAmount > 0 ? `-${money(realDiscountAmount)}` : money(0)}
              </span>
              {discountType && (
                <button
                  onClick={removeDiscount}
                  aria-label={t("pos.cart.removeDiscountAria")}
                  className="w-8 h-8 flex items-center justify-center text-vimdy-text-tertiary hover:text-vimdy-danger"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* BLOQUEANTE (auditoría Fase 2 — rama Bar): propina voluntaria,
              mismo patrón visual que el descuento de arriba. */}
          <div className="flex justify-between text-vimdy-small items-center">
            <button
              onClick={() => setTipOpen(true)}
              className="text-vimdy-text-secondary flex items-center gap-1 hover:text-vimdy-accent-hover transition"
            >
              <HandCoins size={13} />
              {t("pos.cart.tip")}
              {tipType && (
                <span className="text-vimdy-accent-hover font-semibold">
                  ({tipType === "PERCENT" ? `${tipValue}%` : money(tipValue)})
                </span>
              )}
            </button>
            <div className="flex items-center gap-2">
              <span className={realTipAmount > 0 ? "text-vimdy-success" : "text-vimdy-text"}>
                {realTipAmount > 0 ? `+${money(realTipAmount)}` : money(0)}
              </span>
              {tipType && (
                <button
                  onClick={removeTip}
                  aria-label={t("pos.cart.removeTipAria")}
                  className="w-8 h-8 flex items-center justify-center text-vimdy-text-tertiary hover:text-vimdy-danger"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

        </div>

        {discountOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setDiscountOpen(false)}
          >
            <div
              className="w-full max-w-xs rounded-vimdy-xl bg-vimdy-surface border border-vimdy-border p-4"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 className="text-vimdy-text font-bold mb-3">{t("pos.cart.applyDiscount")}</h3>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <button
                  onClick={() => setDiscountKind("PERCENT")}
                  className={`h-10 rounded-vimdy-md border-2 flex items-center justify-center gap-1.5 text-vimdy-small font-semibold transition ${
                    discountKind === "PERCENT"
                      ? "bg-vimdy-accent text-vimdy-background border-vimdy-accent-hover"
                      : "bg-vimdy-surface-active text-vimdy-text border-vimdy-border"
                  }`}
                >
                  <Percent size={14} />
                  {t("pos.cart.percent")}
                </button>
                <button
                  onClick={() => setDiscountKind("FIXED")}
                  className={`h-10 rounded-vimdy-md border-2 flex items-center justify-center gap-1.5 text-vimdy-small font-semibold transition ${
                    discountKind === "FIXED"
                      ? "bg-vimdy-accent text-vimdy-background border-vimdy-accent-hover"
                      : "bg-vimdy-surface-active text-vimdy-text border-vimdy-border"
                  }`}
                >
                  {t("pos.cart.fixed")}
                </button>
              </div>

              <input
                autoFocus
                type="number"
                value={discountInput}
                onChange={(event) => setDiscountInput(event.target.value)}
                placeholder={discountKind === "PERCENT" ? t("pos.cart.percentPlaceholder") : t("pos.cart.fixedPlaceholder")}
                className="w-full h-11 rounded-vimdy-md bg-vimdy-surface-active border border-vimdy-border px-3 text-vimdy-text text-vimdy-small outline-none focus:border-vimdy-accent mb-3"
              />

              <div className="flex gap-2">
                <div className="flex-1">
                  <VimdyButton onClick={() => setDiscountOpen(false)} variant="secondary" fullWidth>
                    {t("common.cancel")}
                  </VimdyButton>
                </div>
                <div className="flex-1">
                  <VimdyButton onClick={applyDiscount} variant="primary" fullWidth>
                    {t("common.apply")}
                  </VimdyButton>
                </div>
              </div>
            </div>
          </div>
        )}

        {tipOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setTipOpen(false)}
          >
            <div
              className="w-full max-w-xs rounded-vimdy-xl bg-vimdy-surface border border-vimdy-border p-4"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 className="text-vimdy-text font-bold mb-3">{t("pos.cart.applyTip")}</h3>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <button
                  onClick={() => setTipKind("PERCENT")}
                  className={`h-10 rounded-vimdy-md border-2 flex items-center justify-center gap-1.5 text-vimdy-small font-semibold transition ${
                    tipKind === "PERCENT"
                      ? "bg-vimdy-accent text-vimdy-background border-vimdy-accent-hover"
                      : "bg-vimdy-surface-active text-vimdy-text border-vimdy-border"
                  }`}
                >
                  <Percent size={14} />
                  {t("pos.cart.percent")}
                </button>
                <button
                  onClick={() => setTipKind("FIXED")}
                  className={`h-10 rounded-vimdy-md border-2 flex items-center justify-center gap-1.5 text-vimdy-small font-semibold transition ${
                    tipKind === "FIXED"
                      ? "bg-vimdy-accent text-vimdy-background border-vimdy-accent-hover"
                      : "bg-vimdy-surface-active text-vimdy-text border-vimdy-border"
                  }`}
                >
                  {t("pos.cart.fixed")}
                </button>
              </div>

              {/* Atajos rápidos de propina (10/15/20%), lo más común en un
                  bar/restaurante colombiano — evita que el mesero tenga
                  que escribir a mano en el caso más frecuente. */}
              {tipKind === "PERCENT" && (
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[10, 15, 20].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setTipInput(String(preset))}
                      className={`h-9 rounded-vimdy-sm border text-vimdy-small font-semibold transition ${
                        tipInput === String(preset)
                          ? "bg-vimdy-accent/15 border-vimdy-accent text-vimdy-accent-hover"
                          : "bg-vimdy-surface-active border-vimdy-border text-vimdy-text-secondary hover:border-vimdy-accent/40"
                      }`}
                    >
                      {preset}%
                    </button>
                  ))}
                </div>
              )}

              <input
                autoFocus
                type="number"
                value={tipInput}
                onChange={(event) => setTipInput(event.target.value)}
                placeholder={tipKind === "PERCENT" ? t("pos.cart.percentPlaceholder") : t("pos.cart.fixedPlaceholder")}
                className="w-full h-11 rounded-vimdy-md bg-vimdy-surface-active border border-vimdy-border px-3 text-vimdy-text text-vimdy-small outline-none focus:border-vimdy-accent mb-3"
              />

              <div className="flex gap-2">
                <div className="flex-1">
                  <VimdyButton onClick={() => setTipOpen(false)} variant="secondary" fullWidth>
                    {t("common.cancel")}
                  </VimdyButton>
                </div>
                <div className="flex-1">
                  <VimdyButton onClick={applyTip} variant="primary" fullWidth>
                    {t("common.apply")}
                  </VimdyButton>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}