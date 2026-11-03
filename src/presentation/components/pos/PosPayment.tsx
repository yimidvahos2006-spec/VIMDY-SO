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
import { getPaymentAccountDisplayName } from "../../../infrastructure/supabase/paymentAccountsRepository";
import { TransferAccountSelect } from "./TransferAccountSelect";

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

interface MixedAmountFieldProps {
  id: string;
  label: string;
  icon: React.ElementType;
  value: number;
  auto: boolean;
  autoLabel: string;
  onChange: (amount: number) => void;
}

/** Campo de monto del pago mixto. Vive fuera de PosPayment para que no se
 * vuelva a montar en cada tecla (si no, el cursor se pierde al escribir). */
function MixedAmountField({ id, label, icon: Icon, value, auto, autoLabel, onChange }: MixedAmountFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="text-vimdy-micro text-vimdy-text-secondary flex items-center gap-1.5">
        <Icon size={13} /> {label}
        {auto && (
          <span className="ml-auto rounded px-1.5 py-0.5 bg-vimdy-accent/15 text-vimdy-accent text-vimdy-micro font-semibold">
            {autoLabel}
          </span>
        )}
      </label>
      <input
        id={id}
        data-pos-enter-charge
        type="number"
        inputMode="decimal"
        min={0}
        autoComplete="off"
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value))}
        onFocus={(e) => e.currentTarget.select()}
        onWheel={(e) => e.currentTarget.blur()}
        placeholder="0"
        className={`mt-1 w-full h-11 rounded-vimdy-md bg-vimdy-surface border px-4 text-vimdy-text outline-none transition-colors ${
          auto ? "border-vimdy-accent/60 focus:border-vimdy-accent" : "border-vimdy-border focus:border-vimdy-accent"
        }`}
      />
    </div>
  );
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
    paymentAccountId,
    setPaymentAccount,
    clearPaymentAccount,
    mixedCash,
    mixedCard,
    mixedTransfer,
    mixedAutoEnabled,
    mixedBalanceKind,
    mixedSummary,
    setMixedAmount,
    fillMixedRemainder,
    useWompiCheckout,
    setUseWompiCheckout
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
                data-pos-enter-charge
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
                  data-pos-enter-charge
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
          <div className="flex items-center justify-between mb-2">
            <span className="text-vimdy-micro text-vimdy-text-secondary">
              {method === "card" ? t("pos.payment.cardReference") : t("pos.payment.method.transfer")}
            </span>
            <button
              type="button"
              onClick={() => setUseWompiCheckout(!useWompiCheckout)}
              aria-pressed={useWompiCheckout}
              className={`px-2 py-1 rounded text-vimdy-micro font-semibold transition ${
                useWompiCheckout
                  ? "bg-vimdy-accent text-vimdy-background"
                  : "bg-vimdy-surface text-vimdy-text-secondary border border-vimdy-border hover:border-vimdy-accent"
              }`}
            >
              Pagar con Wompi
            </button>
          </div>

          {!useWompiCheckout && method === "card" && (
            <>
              <input
                data-pos-enter-charge
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t("pos.payment.cardRefPlaceholder")}
                className="mt-1 w-full h-12 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border px-4 text-vimdy-text outline-none focus:border-vimdy-accent"
              />
            </>
          )}

          {!useWompiCheckout && method === "transfer" && (
            <TransferAccountSelect
              value={paymentAccountId}
              onChange={(account) =>
                account
                  ? setPaymentAccount(account.id, getPaymentAccountDisplayName(account))
                  : clearPaymentAccount()
              }
            />
          )}

          <p className="mt-2 text-vimdy-micro text-vimdy-text-tertiary">
            {t("pos.payment.amountToCharge")} <span className="text-vimdy-text font-semibold">{money(total)}</span>
          </p>
        </div>
      )}

      {method === "mixed" && (
        <div className="space-y-3">
          <MixedAmountField
            id="pos-mixed-cash"
            label={t("pos.payment.method.cash")}
            icon={Banknote}
            value={mixedCash}
            auto={mixedAutoEnabled && mixedBalanceKind === "cash"}
            autoLabel={t("pos.payment.mixed.auto")}
            onChange={(amount) => setMixedAmount("cash", amount)}
          />

          <MixedAmountField
            id="pos-mixed-transfer"
            label={t("pos.payment.method.transfer")}
            icon={Smartphone}
            value={mixedTransfer}
            auto={mixedAutoEnabled && mixedBalanceKind === "transfer"}
            autoLabel={t("pos.payment.mixed.auto")}
            onChange={(amount) => setMixedAmount("transfer", amount)}
          />

          <MixedAmountField
            id="pos-mixed-card"
            label={t("pos.payment.method.card")}
            icon={CreditCard}
            value={mixedCard}
            auto={false}
            autoLabel={t("pos.payment.mixed.auto")}
            onChange={(amount) => setMixedAmount("card", amount)}
          />

          {mixedSummary.missing > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["cash", Banknote, t("pos.payment.method.cash")],
                  ["transfer", Smartphone, t("pos.payment.method.transfer")],
                  ["card", CreditCard, t("pos.payment.method.card")]
                ] as const
              ).map(([kind, Icon, label]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => fillMixedRemainder(kind)}
                  className="h-11 rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface text-vimdy-text hover:border-vimdy-accent transition-all text-vimdy-micro font-semibold flex flex-col items-center justify-center leading-tight"
                >
                  <span className="flex items-center gap-1">
                    <Icon size={12} />
                    {t("pos.payment.mixed.fillWith", { method: label })}
                  </span>
                </button>
              ))}
            </div>
          )}

          {(mixedCard > 0 || mixedTransfer > 0) && (
            <>
              {!useWompiCheckout && (
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  autoComplete="off"
                  placeholder={t("pos.payment.mixedRefPlaceholder")}
                  className="w-full h-11 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border px-4 text-vimdy-text text-vimdy-small outline-none focus:border-vimdy-accent"
                />
              )}

              <div className="flex items-center justify-between">
                <span className="text-vimdy-micro text-vimdy-text-tertiary">Pagar parte digital con Wompi</span>
                <button
                  type="button"
                  onClick={() => setUseWompiCheckout(!useWompiCheckout)}
                  aria-pressed={useWompiCheckout}
                  className={`px-2 py-1 rounded text-vimdy-micro font-semibold transition ${
                    useWompiCheckout
                      ? "bg-vimdy-accent text-vimdy-background"
                      : "bg-vimdy-surface text-vimdy-text-secondary border border-vimdy-border hover:border-vimdy-accent"
                  }`}
                >
                  {useWompiCheckout ? "Activado" : "Activar"}
                </button>
              </div>
            </>
          )}

          {mixedSummary.externalExceeds && (
            <p role="alert" className="text-vimdy-micro text-vimdy-danger">
              {t("pos.payment.mixed.externalExceeds")}
            </p>
          )}

          <div
            aria-live="polite"
            className={`rounded-vimdy-md border p-3 flex justify-between ${
              mixedSummary.valid
                ? "bg-vimdy-success-bg border-vimdy-success/40"
                : "bg-vimdy-danger-bg border-vimdy-danger/40"
            }`}
          >
            <span className="text-vimdy-text-secondary text-vimdy-small">
              {mixedSummary.missing > 0 ? t("pos.payment.missingAmount") : t("common.change")}
            </span>
            <span className={`font-bold ${mixedSummary.valid ? "text-vimdy-success" : "text-vimdy-danger"}`}>
              {money(mixedSummary.missing > 0 ? mixedSummary.missing : mixedSummary.change)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}