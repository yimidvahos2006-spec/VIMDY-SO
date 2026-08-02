import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { VimdyButton } from "../ui/VimdyButton";
import { useAuth } from "../../context/AuthContext";
import { useBusinessSnapshot } from "../../../hooks/useBusinessSnapshot";
import { useTranslation } from "../../../core/i18n/useTranslation";
import {
  buildGreeting,
  buildManagerPriorities,
  healthColorClass,
  healthPhrase,
  PRIORITY_COLOR_CLASS
} from "./managerPriorities";

function money(value: number, currency: string): string {
  return `${Math.round(value).toLocaleString("es-CO")} ${currency}`;
}

/**
 * DashboardWelcome — Bloque 1 (VIMDY Experience 1.0, Dashboard V3, Paso 1.2)
 * ---------------------------------------------------------------------------
 * Centro de comando del Dashboard. Único bloque de ancho completo arriba de
 * todo, no se puede ocultar ni mover, y lee del mismo BusinessSnapshot real
 * que usan los demás bloques (vía useBusinessSnapshot) — nunca inventa ni
 * recalcula un número aparte.
 *
 * Estética deliberadamente plana: fondo oscuro uniforme, una sola línea de
 * acento, tipografía grande y mucho espacio en blanco. Sin gradientes, sin
 * glow ni decoración — la jerarquía la da el diseño, no los efectos.
 *
 * Contiene únicamente las 5 piezas que pide el documento de producto:
 *   1. Saludo dinámico (según la hora) + nombre del usuario.
 *   2. Estado general del negocio en UNA sola frase (no un puntaje).
 *   3. Una única prioridad principal (la más importante, no una lista).
 *   4. Pronóstico del día en texto simple (sin gráficas) — solo lo que el
 *      ForecastEngine calcula hoy: ventas estimadas y producto de mayor
 *      demanda. Nada de "hora pico": eso queda para un ForecastEngine V2
 *      aparte, cuando exista el dato real detrás.
 *   5. Un único botón de acción, que lleva al módulo de la prioridad.
 */
export function DashboardWelcome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { snapshot, hasEnoughData } = useBusinessSnapshot();
  const { t, language } = useTranslation();

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const greeting = buildGreeting(user?.name, now, t);
  const priorities = snapshot ? buildManagerPriorities(snapshot, t) : [];
  const [topPriority] = priorities;

  const locale = language === "en" ? "en-US" : language === "pt" ? "pt-BR" : "es-CO";
  const time = now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });

  const forecast = snapshot?.forecastSummary;
  const hasForecast = !!forecast?.hasEnoughData && !!forecast.tomorrow;

  return (
    <div className="col-span-12 relative overflow-hidden rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface shadow-vimdy-md">
      {/* Única decoración del bloque: una línea de acento sólida, sin
          gradiente ni blur, que lo distingue de una tarjeta común. */}
      <div className="absolute inset-y-0 left-0 w-1 bg-vimdy-accent" />

      <div className="pl-7 pr-6 py-9 sm:pl-11 sm:pr-10 sm:py-11">

        {/* 1. Saludo dinámico + 2. Estado general del negocio (una sola frase) */}
        <div className="mb-9">
          <p className="text-3xl sm:text-4xl font-bold text-vimdy-text tracking-tight">{greeting.title}</p>
          <p className="mt-2 text-sm text-vimdy-text-tertiary capitalize">{date} · {time}</p>
          <p className={`mt-4 text-base font-medium ${snapshot ? healthColorClass(snapshot.healthScore) : "text-vimdy-text-tertiary"}`}>
            {snapshot ? healthPhrase(snapshot.healthScore, t) : t("dashboard.gerente.analyzing")}
          </p>
        </div>

        {/* 3. Prioridad principal (una sola) + 5. Botón de acción (único) */}
        <div className="mb-8">
          <p className="text-xs font-semibold tracking-widest text-vimdy-text-tertiary uppercase mb-3">
            {t("dashboard.welcome.todayPriority")}
          </p>

          {!snapshot ? (
            <p className="text-sm text-vimdy-text-tertiary">{t("dashboard.gerente.analyzing")}</p>
          ) : !hasEnoughData ? (
            <div className="text-sm text-vimdy-text-secondary">
              <p>{t("dashboard.gerente.notEnoughData1")}</p>
              <p className="mt-1">{t("dashboard.gerente.notEnoughData2")}</p>
            </div>
          ) : topPriority ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <p className={`flex-1 text-lg sm:text-xl font-semibold leading-snug ${PRIORITY_COLOR_CLASS[topPriority.color].text}`}>
                {topPriority.message}
              </p>
              <VimdyButton
                onClick={() => navigate(topPriority.route)}
                variant="primary"
                className="shrink-0 self-start sm:self-auto"
              >
                {topPriority.actionLabel} →
              </VimdyButton>
            </div>
          ) : (
            <p className="text-lg sm:text-xl font-semibold text-vimdy-success">
              {t("dashboard.welcome.allGood")}
            </p>
          )}
        </div>

        {/* 4. Pronóstico del día — texto simple, sin gráficas ni botón propio */}
        {hasForecast && forecast!.tomorrow && (
          <div>
            <p className="text-xs font-semibold tracking-widest text-vimdy-text-tertiary uppercase mb-2">
              {t("dashboard.welcome.forecastTomorrow", { weekday: forecast!.tomorrow.weekday })}
            </p>
            <p className="text-sm text-vimdy-text-secondary">
              <span className="font-semibold text-vimdy-text">
                {t("dashboard.welcome.salesForecast", { amount: money(forecast!.tomorrow.expectedTotal, snapshot!.currency) })}
              </span>
              {forecast!.topDemandProduct && (
                <>
                  {t("dashboard.welcome.topDemand")}
                  <span className="font-semibold text-vimdy-text">
                    {Math.round(forecast!.topDemandProduct.expectedQuantity)} {forecast!.topDemandProduct.productName}
                  </span>
                </>
              )}
            </p>
          </div>
        )}

      </div>
    </div>
  );
}