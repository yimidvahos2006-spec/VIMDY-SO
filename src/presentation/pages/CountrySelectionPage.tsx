import React, { useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, Globe2, ArrowRight } from "lucide-react";

import { VimdyBackground } from "../components/ui/VimdyBackground";
import { VimdyLogo } from "../components/ui/VimdyLogo";
import { GlassCard } from "../components/ui/GlassCard";
import { VimdyButton } from "../components/ui/VimdyButton";
import { VimdyInput } from "../components/ui/VimdyInput";
import { useTranslation } from "../../core/i18n/useTranslation";
import { companyConfigStore } from "../../core/store/companyConfigStore";
import {
  AVAILABLE_COUNTRIES,
  CountryCode,
  getCountryDefaults,
  getCountryName,
  detectCountryFromBrowser
} from "../../core/config/globalization";

/**
 * CountrySelectionPage
 * ---------------------------------------------------------------------------
 * Primera pantalla que ve cualquier visitante nuevo, antes de /login o
 * /registro (ver RequireCountry). Elegir un país aquí autocompleta idioma +
 * moneda + zona horaria de TODA la app de inmediato — companyConfigStore.
 * markCountrySelected() los persiste en localStorage para que sobrevivan
 * antes de tener cuenta, y el idioma cambia en vivo (useTranslation está
 * suscrito al store) sin recargar la página.
 */
export function CountrySelectionPage() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CountryCode | null>(() => {
    const detected = detectCountryFromBrowser();
    const isAvailable = detected && AVAILABLE_COUNTRIES.some((c) => c.code === detected);
    return isAvailable ? detected : null;
  });

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withNames = AVAILABLE_COUNTRIES.map((c) => ({
      ...c,
      name: getCountryName(c.code, language)
    }));
    const filtered = q
      ? withNames.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q)
      : withNames;
    return filtered.sort((a, b) => a.name.localeCompare(b.name, language));
  }, [query, language]);

  const detectedName = selected ? getCountryName(selected, language) : null;

  function handleContinue() {
    if (!selected) return;
    const defaults = getCountryDefaults(selected);
    if (!defaults) return;

    companyConfigStore.markCountrySelected({
      country: selected,
      currency: defaults.currency,
      language: defaults.language,
      timezone: defaults.timezone
    });

    // Si RequireCountry interceptó una ruta específica (ej. alguien con un
    // link directo a /registro), vuelve exactamente ahí; si no, va a login.
    const redirectTo = (location.state as { from?: string } | null)?.from ?? "/login";
    navigate(redirectTo, { replace: true });
  }

  return (
    <VimdyBackground>
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
        <div className="mb-8 flex flex-col items-center gap-4">
          <VimdyLogo size={80} />
          <h1 className="text-2xl font-bold text-white tracking-wide flex items-center gap-2">
            <Globe2 className="w-6 h-6 text-cyan-400" />
            {t("country.title")}
          </h1>
          <p className="text-sm text-slate-400 text-center max-w-sm">
            {t("country.subtitle")}
          </p>
          <p className="text-xs text-slate-500 text-center max-w-sm">
            Por ahora disponible en estos países. Iremos sumando más.
          </p>
        </div>

        <GlassCard className="w-full max-w-sm p-6 flex flex-col gap-4">
          <VimdyInput
            icon={<Search className="w-4 h-4" />}
            placeholder={t("country.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />

          {selected && detectedName && !query && (
            <p className="text-xs text-slate-500">
              {t("country.detected")}{" "}
              <span className="text-cyan-400 font-medium">{detectedName}</span>
            </p>
          )}

          <div className="max-h-64 overflow-y-auto flex flex-col gap-1 pr-1">
            {results.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-6">
                {t("country.noResults")}
              </p>
            )}

            {results.map((c) => {
              const isSelected = c.code === selected;
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => setSelected(c.code)}
                  className={`
                    w-full text-left px-4 py-2.5 rounded-xl border transition-colors
                    ${
                      isSelected
                        ? "border-cyan-400 bg-cyan-400/10 text-white"
                        : "border-transparent hover:border-slate-700 hover:bg-slate-800/40 text-slate-300"
                    }
                  `}
                >
                  {c.name}
                </button>
              );
            })}
          </div>

          <VimdyButton
            onClick={handleContinue}
            disabled={!selected}
            fullWidth
            icon={<ArrowRight className="w-4 h-4" />}
          >
            {t("country.continue")}
          </VimdyButton>

          <p className="text-center text-xs text-slate-500">{t("country.change")}</p>
        </GlassCard>
      </div>
    </VimdyBackground>
  );
}