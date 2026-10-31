import React from "react";
import { Globe2, RotateCcw } from "lucide-react";

import {
  AVAILABLE_COUNTRIES,
  CURRENCIES,
  LANGUAGES,
  getCountryName,
  getCurrencyName,
  type CurrencyCode,
  type LanguageCode
} from "../../../core/config/globalization";
import {
  differsFromCountryDefaults,
  getTimezoneOptions,
  type RegionalFields
} from "../../../core/settings/regionalSettings";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { VimdyButton } from "../ui/VimdyButton";
import { Field, SectionCard, inputClass } from "./settingsPrimitives";

interface RegionalSettingsCardProps {
  draft: RegionalFields;
  saving: boolean;
  /** Al elegir un país: el padre autocompleta moneda, idioma, zona horaria (y el país del negocio). */
  onCountryChange: (countryCode: string) => void;
  /** Ajuste manual de un solo campo (moneda, idioma o zona horaria). */
  onFieldChange: (patch: Partial<RegionalFields>) => void;
  onSave: () => void;
}

/**
 * Tarjeta "País, idioma y hora".
 *
 * - Elegir un país autocompleta moneda, idioma y zona horaria al instante.
 * - Cada uno se puede cambiar a mano después; si el dueño se aparta de lo
 *   sugerido aparece el botón para volver a los valores del país.
 * - "Guardar" escribe en Supabase y avisa con un toast (lo hace el padre).
 */
export function RegionalSettingsCard({
  draft,
  saving,
  onCountryChange,
  onFieldChange,
  onSave
}: RegionalSettingsCardProps) {
  const { t, language } = useTranslation();
  const timezones = getTimezoneOptions(draft.timezone);
  const customized = differsFromCountryDefaults(draft);

  return (
    <SectionCard
      icon={<Globe2 size={18} className="text-cyan-400" />}
      title={t("settings.globalization.title")}
      description={t("settings.globalization.description")}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("settings.field.country")} htmlFor="settings-country">
          <select
            id="settings-country"
            className={inputClass}
            value={draft.country}
            onChange={(event) => onCountryChange(event.target.value)}
          >
            {AVAILABLE_COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {getCountryName(country.code, language)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("settings.field.language")} htmlFor="settings-language">
          <select
            id="settings-language"
            className={inputClass}
            value={draft.language}
            onChange={(event) => onFieldChange({ language: event.target.value as LanguageCode })}
          >
            {LANGUAGES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.nativeName}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("settings.field.currency")} htmlFor="settings-currency">
          <select
            id="settings-currency"
            className={inputClass}
            value={draft.currency}
            onChange={(event) => onFieldChange({ currency: event.target.value as CurrencyCode })}
          >
            {CURRENCIES.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} — {getCurrencyName(currency.code, language)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("settings.field.timezone")} htmlFor="settings-timezone">
          <select
            id="settings-timezone"
            className={inputClass}
            value={draft.timezone}
            onChange={(event) => onFieldChange({ timezone: event.target.value })}
          >
            {timezones.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <p className="text-slate-500 text-xs mt-3">
        Al cambiar el país se autocompletan moneda, idioma y zona horaria — puedes ajustarlos
        después a mano si tu negocio es una excepción.
      </p>

      <div className="flex items-center justify-between gap-3 mt-4">
        {customized ? (
          <VimdyButton
            onClick={() => onCountryChange(draft.country)}
            variant="ghost"
            size="sm"
            icon={<RotateCcw size={14} />}
          >
            Volver a los valores del país
          </VimdyButton>
        ) : (
          <span />
        )}
        <VimdyButton onClick={onSave} loading={saving} variant="primary" size="sm" className="ml-auto">
          {t("settings.save.globalization")}
        </VimdyButton>
      </div>
    </SectionCard>
  );
}