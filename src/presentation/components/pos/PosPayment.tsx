import React from "react";
import {
  Banknote,
  CreditCard,
  Smartphone,
  Landmark,
  CheckCircle2,
  AlertCircle
} from "lucide-react";

import { usePayment } from "../../../core/store/usePayment";
import { PaymentMethod } from "../../../core/store/paymentStore";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { formatMoney } from "../../../core/utils/formatMoney";
import { companyConfigStore } from "../../../core/store/companyConfigStore";

// Billetes reales en circulación en Colombia (COP). Antes las opciones
// rápidas se calculaban redondeando a múltiplos de $10.000 a ciegas, lo
// que a veces sugería montos como "$47.000" que ningún billete real forma.
// Ahora se sugieren solo billetes que existen de verdad.
const REAL_BILLS = [2000, 5000, 10000, 20000, 50000, 100000];

/** Hasta 3 montos rápidos: el total exacto + los billetes reales más
 * cercanos que alcanzan a cubrirlo, para que pagar en efectivo sea
 * 1 toque en el caso normal. */
function suggestedCashAmounts(total: number): number[] {
  if (total <= 0) return [];

  const amounts = new Set<number>([total]);

  const coveringBill = REAL_BILLS.find((bill) => bill >= total);

  if (coveringBill) {
    amounts.add(coveringBill);
    const nextIndex = REAL_BILLS.indexOf(coveringBill) + 1;
    if (REAL_BILLS[nextIndex]) amounts.add(REAL_BILLS[nextIndex]);
  } else {
    // Total mayor al billete más grande: se sugiere en múltiplos de
    // $50.000, que es como de verdad se arman las vueltas grandes.
    const rounded = Math.ceil(total / 50000) * 50000;
    amounts.add(rounded);
    amounts.add(rounded + 50000);
  }

  return Array.from(amounts)
    .sort((a, b) => a - b)
    .slice(0, 3);
}

export function PosPayment() {
  const { t, language } = useTranslation();

  const {
    method,
    received,
    change,
    total,
    setMethod,
    receive,
    calculateChange,
    reference,
    setReference,
    mixedCash,
    mixedCard,
    mixedTransfer,
    setMixedAmount,
    mixedReceived
  } = usePayment();

  const money = (value: number) => formatMoney(value, companyConfigStore.get().currency, language);

  const methods: {
    id: PaymentMethod;
    title: string;
    icon: React.ElementType;
  }[] = [
    { id: "cash", title: t("pos.payment.method.cash"), icon: Banknote },
    { id: "card", title: t("pos.payment.method.card"), icon: CreditCard },
    { id: "transfer", title: t("pos.payment.method.transfer"), icon: Smartphone },
    { id: "mixed", title: t("pos.payment.method.mixed"), icon: Landmark }
  ];

  const mixedMissing = Math.max(0, total - mixedReceived);
  const needsReference =
    method === "card" ||
    method === "transfer" ||
    (method === "mixed" && (mixedCard > 0 || mixedTransfer > 0));
  const referenceMissing = needsReference && !reference.trim();

  return (
    <div className="space-y-4">
      <h3 className="text-vimdy-h3 text-vimdy-text">{t("pos.payment.title")}</h3>

      <div className="grid grid-cols-2 gap-2">
        {methods.map((payment) => {
          const Icon = payment.icon;
          const active = method === payment.id;

          return (
            <button
              key={payment.id}
              onClick={() => setMethod(payment.id)}
              aria-pressed={active}
              className={`
                h-14 rounded-vimdy-md border-2 flex items-center justify-center gap-2 transition-all duration-vimdy-normal
                ${
                  active
                    ? "bg-vimdy-accent text-vimdy-background border-vimdy-accent-hover shadow-vimdy-accent ring-2 ring-vimdy-accent/40"
                    : "bg-vimdy-surface text-vimdy-text border-vimdy-border hover:border-vimdy-accent"
                }
              `}
            >
              <Icon size={18} />
              <span className="text-vimdy-small font-semibold">{payment.title}</span>
            </button>
          );
        })}
      </div>

      {method === "cash" && (
        <>
          <div>
            <label className="text-vimdy-micro text-vimdy-text-secondary">{t("pos.payment.cashReceived")}</label>
            <div className="relative mt-1">
              <input
                id="pos-cash-received"
                type="number"
                value={received || ""}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  receive(value);
                  calculateChange(total);
                }}
                className={`
                  w-full h-12 rounded-vimdy-md bg-vimdy-surface border px-4 pr-11 text-vimdy-text outline-none transition-colors
                  ${
                    received > 0 && received < total
                      ? "border-vimdy-danger/60 focus:border-vimdy-danger"
                      : received >= total && total > 0
                      ? "border-vimdy-success/60 focus:border-vimdy-success"
                      : "border-vimdy-border focus:border-vimdy-accent"
                  }
                `}
                placeholder="0"
              />
              {received > 0 && total > 0 && (
                received >= total ? (
                  <CheckCircle2 size={20} className="absolute right-3 top-1/2 -translate-y-1/2 text-vimdy-success" />
                ) : (
                  <AlertCircle size={20} className="absolute right-3 top-1/2 -translate-y-1/2 text-vimdy-danger" />
                )
              )}
            </div>
          </div>

          {total > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {suggestedCashAmounts(total).map((amount) => (
                <button
                  key={amount}
                  onClick={() => {
                    receive(amount);
                    calculateChange(total);
                  }}
                  aria-pressed={received === amount}
                  className={`
                    h-11 rounded-vimdy-sm text-vimdy-micro font-semibold border transition-all
                    ${
                      received === amount
                        ? "bg-vimdy-accent text-vimdy-background border-vimdy-accent-hover"
                        : "bg-vimdy-surface text-vimdy-text border-vimdy-border hover:border-vimdy-accent"
                    }
                  `}
                >
                  {amount === total ? (
                    <span className="flex flex-col leading-tight">
                      <span>{t("pos.payment.exact")}</span>
                      <span className="opacity-80">{money(amount)}</span>
                    </span>
                  ) : (
                    money(amount)
                  )}
                </button>
              ))}

              <button
                onClick={() => document.getElementById("pos-cash-received")?.focus()}
                className="h-11 rounded-vimdy-sm text-vimdy-micro font-semibold border border-vimdy-border bg-vimdy-surface text-vimdy-text hover:border-vimdy-accent transition-all"
              >
                {t("common.other")}
              </button>
            </div>
          )}

          <div className="rounded-vimdy-md bg-vimdy-surface border border-vimdy-border p-3">
            <div className="flex justify-between">
              <span className="text-vimdy-text-secondary">{t("common.change")}</span>
              <span className="text-vimdy-success font-bold">{money(change)}</span>
            </div>
          </div>
        </>
      )}

      {(method === "card" || method === "transfer") && (
        <div>
          <label className="text-vimdy-micro text-vimdy-text-secondary">
            {method === "card" ? t("pos.payment.cardReference") : t("pos.payment.transferReference")}
          </label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={method === "card" ? t("pos.payment.cardRefPlaceholder") : t("pos.payment.transferRefPlaceholder")}
            className="mt-1 w-full h-12 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border px-4 text-vimdy-text outline-none focus:border-vimdy-accent"
          />
          {referenceMissing && (
            <p className="mt-2 text-vimdy-danger text-vimdy-small">
              {t("pos.payment.referenceRequired")}
            </p>
          )}
          <p className="mt-2 text-vimdy-micro text-vimdy-text-tertiary">
            {t("pos.payment.amountToCharge")} <span className="text-vimdy-text font-semibold">{money(total)}</span>
          </p>
        </div>
      )}

      {method === "mixed" && (
        <div className="space-y-3">
          <div>
            <label className="text-vimdy-micro text-vimdy-text-secondary flex items-center gap-1.5">
              <Banknote size={13} /> {t("pos.payment.method.cash")}
            </label>
            <input
              type="number"
              value={mixedCash || ""}
              onChange={(e) => setMixedAmount("cash", Number(e.target.value))}
              placeholder="0"
              className="mt-1 w-full h-11 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border px-4 text-vimdy-text outline-none focus:border-vimdy-accent"
            />
          </div>

          <div>
            <label className="text-vimdy-micro text-vimdy-text-secondary flex items-center gap-1.5">
              <CreditCard size={13} /> {t("pos.payment.method.card")}
            </label>
            <input
              type="number"
              value={mixedCard || ""}
              onChange={(e) => setMixedAmount("card", Number(e.target.value))}
              placeholder="0"
              className="mt-1 w-full h-11 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border px-4 text-vimdy-text outline-none focus:border-vimdy-accent"
            />
          </div>

          <div>
            <label className="text-vimdy-micro text-vimdy-text-secondary flex items-center gap-1.5">
              <Smartphone size={13} /> {t("pos.payment.method.transfer")}
            </label>
            <input
              type="number"
              value={mixedTransfer || ""}
              onChange={(e) => setMixedAmount("transfer", Number(e.target.value))}
              placeholder="0"
              className="mt-1 w-full h-11 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border px-4 text-vimdy-text outline-none focus:border-vimdy-accent"
            />
          </div>

          {(mixedCard > 0 || mixedTransfer > 0) && (
            <>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t("pos.payment.mixedRefPlaceholder")}
                className="w-full h-11 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border px-4 text-vimdy-text text-vimdy-small outline-none focus:border-vimdy-accent"
              />
              {referenceMissing && (
                <p className="mt-2 text-vimdy-danger text-vimdy-small">
                  {t("pos.payment.referenceRequired")}
                </p>
              )}
            </>
          )}
          <div
            className={`rounded-vimdy-md border p-3 flex justify-between ${
              mixedMissing > 0
                ? "bg-vimdy-danger-bg border-vimdy-danger/40"
                : "bg-vimdy-success-bg border-vimdy-success/40"
            }`}
          >
            <span className="text-vimdy-text-secondary text-vimdy-small">
              {mixedMissing > 0 ? t("pos.payment.missingAmount") : t("common.change")}
            </span>
            <span className={`font-bold ${mixedMissing > 0 ? "text-vimdy-danger" : "text-vimdy-success"}`}>
              {money(mixedMissing > 0 ? mixedMissing : mixedReceived - total)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}