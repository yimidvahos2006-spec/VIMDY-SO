import React, { useEffect, useState } from "react";
import { Percent } from "lucide-react";

import type { CurrencyCode } from "../../../core/config/globalization";
import { getCurrency } from "../../../core/config/globalization";
import {
  DAILY_GOAL_ERROR_MESSAGE,
  TAX_ERROR_MESSAGE,
  formatDailyGoal,
  formatTaxPercent,
  parseDailyGoalInput,
  parseTaxPercentInput
} from "../../../core/settings/taxSettings";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { VimdyButton } from "../ui/VimdyButton";
import { Field, SectionCard, inputClass, inputErrorClass } from "./settingsPrimitives";

interface TaxCurrencySettingsCardProps {
  tax: number;
  dailySalesGoal: number;
  currency: CurrencyCode;
  saving: boolean;
  onChange: (patch: { tax?: number; dailySalesGoal?: number }) => void;
  onSave: () => void;
}

/**
 * Tarjeta "Impuestos y moneda": IVA (%) y Meta de ventas diaria.
 *
 * Cada campo guarda el TEXTO que escribe la persona. Solo cuando el texto es
 * un número válido se pasa al borrador; si no, se avisa debajo del campo, se
 * bloquea "Guardar impuestos" y, al salir del campo, vuelve al último valor
 * válido. Así nunca se guarda una cifra distinta a la que se ve.
 *
 * Lo que se guarda alimenta de inmediato:
 * - POS y mesas: el IVA se lee en vivo en cada cálculo de venta.
 * - Dashboard: la meta diaria se lee en vivo para la alerta "Meta alcanzada".
 */
export function TaxCurrencySettingsCard({
  tax,
  dailySalesGoal,
  currency,
  saving,
  onChange,
  onSave
}: TaxCurrencySettingsCardProps) {
  const { t, language } = useTranslation();
  const [taxText, setTaxText] = useState(() => formatTaxPercent(tax));
  const [goalText, setGoalText] = useState(() => formatDailyGoal(dailySalesGoal, language));

  // Si el valor cambia desde afuera (elegir otro país, descartar, guardar),
  // el campo lo refleja — pero sin pisar lo que se está escribiendo.
  useEffect(() => {
    setTaxText((current) => (parseTaxPercentInput(current) === tax ? current : formatTaxPercent(tax)));
  }, [tax]);

  useEffect(() => {
    setGoalText((current) =>
      parseDailyGoalInput(current) === dailySalesGoal ? current : formatDailyGoal(dailySalesGoal, language)
    );
  }, [dailySalesGoal, language]);

  const parsedTax = parseTaxPercentInput(taxText);
  const parsedGoal = parseDailyGoalInput(goalText);
  const taxInvalid = parsedTax === null;
  const goalInvalid = parsedGoal === null;
  const currencySymbol = getCurrency(currency)?.symbol ?? "";

  function handleTaxChange(value: string) {
    setTaxText(value);
    const parsed = parseTaxPercentInput(value);
    if (parsed !== null) onChange({ tax: parsed });
  }

  function handleGoalChange(value: string) {
    setGoalText(value);
    const parsed = parseDailyGoalInput(value);
    if (parsed !== null) onChange({ dailySalesGoal: parsed });
  }

  return (
    <SectionCard
      icon={<Percent size={18} className="text-yellow-400" />}
      title={t("settings.taxCurrency.title")}
      description={t("settings.taxCurrency.description")}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Field label={t("settings.field.tax")} htmlFor="settings-tax">
            <input
              id="settings-tax"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={taxInvalid}
              className={taxInvalid ? inputErrorClass : inputClass}
              value={taxText}
              onChange={(event) => handleTaxChange(event.target.value)}
              onBlur={() => setTaxText(formatTaxPercent(tax))}
            />
          </Field>
          {taxInvalid && <p className="text-red-400 text-xs mt-1">{TAX_ERROR_MESSAGE}</p>}
        </div>

        <div className="col-span-2">
          <Field label={`${t("settings.field.dailyGoal")} (${currency}${currencySymbol ? ` ${currencySymbol}` : ""})`} htmlFor="settings-daily-goal">
            <input
              id="settings-daily-goal"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={goalInvalid}
              className={goalInvalid ? inputErrorClass : inputClass}
              placeholder="0 = sin meta"
              value={goalText}
              onChange={(event) => handleGoalChange(event.target.value)}
              onBlur={() => setGoalText(formatDailyGoal(dailySalesGoal, language))}
            />
          </Field>
          {goalInvalid && <p className="text-red-400 text-xs mt-1">{DAILY_GOAL_ERROR_MESSAGE}</p>}
        </div>
      </div>

      <p className="text-slate-500 text-xs mt-3">
        El IVA se aplica desde la próxima venta a los productos que no tienen su propio IVA. La meta
        diaria alimenta la alerta «Meta alcanzada» del Dashboard.
      </p>

      <div className="flex items-center justify-end mt-4">
        <VimdyButton
          onClick={onSave}
          loading={saving}
          disabled={taxInvalid || goalInvalid}
          variant="primary"
          size="sm"
        >
          {t("settings.save.taxes")}
        </VimdyButton>
      </div>
    </SectionCard>
  );
}