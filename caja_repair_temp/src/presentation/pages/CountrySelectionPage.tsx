import { useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, ArrowRight, Check } from "lucide-react";

import { VimdyBackground } from "../components/ui/VimdyBackground";
import { VimdyLogo } from "../components/ui/VimdyLogo";
import { VimdyCard } from "../components/ui/VimdyCard";
import { VimdyButton } from "../components/ui/VimdyButton";
import { VimdyInput } from "../components/ui/VimdyInput";
import { useTranslation } from "../../core/i18n/useTranslation";
import { companyConfigStore } from "../../core/store/companyConfigStore";
import {
  AVAILABLE_COUNTRIES,
  CountryCode,
  getCountryDefaults,
  getCountryName,
  getCurrencyName,
  detectCountryFromBrowser
} from "../../core/config/globalization";

/**
 * CountrySelectionPage
 * ---------------------------------------------------------------------------
 * Primera pantalla que ve cualquier visitante nuevo, antes de /login o
 * /registro (ver RequireCountry). Elegir un país aquí autocompleta idioma +
 * moneda + zona horario de TODA la app de inmediato — companyConfigStore.
 * markCountrySelected() los persiste en localStorage para que sobrevivan
 * antes de tener cuenta, y el idioma cambia en vivo (useTranslation está
 * suscrito al store) sin recargar la página.
 *
 * Lógica funcional INTACTA: detección automática (detectCountryFromBrowser),
 * persistencia (markCountrySelected) y navegación (navigate) son idénticas
 * al flujo anterior — el país sigue preseleccionándose por detección cuando
 * el navegador lo permite. Solo se reemplazó la presentación:
 * - Se unió en una sola pantalla los dos estados anteriores (vista de
 *   "detectado" auto-redirect y vista con lista), de modo que siempre se
 *   muestra el selector de países con el país detectado preresaltado y el
 *   botón "Continuar" visible SIN hacer scroll.
 * - El redirect implícito por useEffect fue eliminado: el usuario confirma
 *   su país explícitamente pulsando "Continuar" (más predecible y accesible).
 */

/** Bandera emoji a partir del código ISO 3166-1 alpha-2 (p.ej. "CO" -> "🇨🇴"). */
function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/[A-Z]/g, (ch) => String.fromCodePoint(ch.charCodeAt(0) + 127397));
}

export function CountrySelectionPage() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [query, setQuery] = useState("");

  const detected = useMemo<CountryCode | null>(() => {
    const d = detectCountryFromBrowser();
    return d && AVAILABLE_COUNTRIES.some((c) => c.code === d) ? (d as CountryCode) : null;
  }, []);

  const [selected, setSelected] = useState<CountryCode | null>(detected);

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

  const detectedName = selected === detected && detected ? getCountryName(detected, language) : null;
  const detectedDefaults = detected && selected === detected ? getCountryDefaults(detected) : null;

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

    const redirectTo = (location.state as { from?: string } | null)?.from ?? "/login";
    navigate(redirectTo, { replace: true });
  }

  return (
    <VimdyBackground>
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-6">
        <VimdyCard
          className="w-full max-w-md flex flex-col max-h-[90vh] overflow-hidden animate-vimdy-fade-in"
          padding="lg"
        >
          {/* Marca + encabezado */}
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex items-center gap-2.5">
              <VimdyLogo size={44} />
              <span className="text-2xl font-bold text-white tracking-tight">VIMDY</span>
            </div>

            <h1 className="vimdy-h2 text-white">{t("country.title")}</h1>

            <p className="vimdy-small text-vimdy-text-secondary max-w-xs">
              {t("country.subtitle")}
            </p>
          </div>

          {/* Detección automática: destacada con aire y jerarquía clara, pero
              sin parecer una alerta/error — acento azul de marca, no warning. */}
          {detected && detectedName && (
            <div
              className="flex flex-col gap-1.5 rounded-xl border border-vimdy-accent/30 bg-vimdy-accent/5 px-4 py-3"
              role="status"
              aria-label={`${t("country.detected")} ${detectedName}`}
            >
              <span className="vimdy-small text-vimdy-text-tertiary">
                {t("country.detected")}
              </span>

              <div className="flex items-center gap-2.5">
                <span className="text-2xl" aria-hidden="true">
                  {flagEmoji(detected)}
                </span>
                <span className="vimdy-h3 font-semibold text-white">
                  {detectedName}
                </span>
              </div>

              {detectedDefaults && (
                <span className="inline-flex items-center self-start rounded-md px-2 py-0.5 vimdy-micro font-medium text-vimdy-accent bg-vimdy-accent/10 border border-vimdy-accent/20">
                  {detectedDefaults.currency} ·{" "}
                  {getCurrencyName(detectedDefaults.currency, language).replace(/^./, (c) => c.toUpperCase())}
                </span>
              )}
            </div>
          )}

          {/* Búsqueda */}
          <VimdyInput
            icon={<Search className="w-4 h-4" />}
            placeholder={t("country.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />

          {/* Lista de países: scroll interno. El botón Continuar, que está
              fuera de este contenedor (flex-1), siempre queda visible y
              pegado al fondo de la tarjeta sin necesidad de hacer scroll. */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {results.length === 0 && (
              <p className="vimdy-small text-vimdy-text-tertiary text-center py-6">
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
                  aria-pressed={isSelected}
                  className={`
                    flex items-center gap-3 w-full text-left px-3 py-2.5
                    rounded-lg transition-colors duration-vimdy-fast
                    ${
                      isSelected
                        ? "bg-vimdy-accent/5 border-l-2 border-vimdy-accent text-vimdy-text"
                        : "border border-transparent text-vimdy-text-secondary hover:bg-vimdy-surface-hover hover:text-vimdy-text"
                    }
                  `}
                >
                  <span className="text-xl leading-none" aria-hidden="true">
                    {flagEmoji(c.code)}
                  </span>
                  <span className="flex-1 min-w-0">{c.name}</span>
                  <span className="vimdy-micro text-vimdy-text-tertiary w-10 text-right">
                    {c.currency}
                  </span>
                  {isSelected && (
                    <Check className="w-4 h-4 text-vimdy-accent shrink-0" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Acción principal: siempre visible, única primary por pantalla */}
          <VimdyButton
            onClick={handleContinue}
            disabled={!selected}
            fullWidth
            icon={<ArrowRight className="w-4 h-4" />}
          >
            {t("country.continue")}
          </VimdyButton>

          <p className="vimdy-micro text-center text-vimdy-text-tertiary">
            {t("country.change")}
          </p>
        </VimdyCard>
      </div>
    </VimdyBackground>
  );
}
