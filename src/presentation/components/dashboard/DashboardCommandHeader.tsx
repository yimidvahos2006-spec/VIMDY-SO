import { Clock3, ShieldCheck } from "lucide-react";

import { useTranslation } from "../../../core/i18n/useTranslation";
import type { DashboardExecutiveModel } from "../../../core/dashboard/executive/DashboardExecutiveTypes";

interface Props {
  model: DashboardExecutiveModel;
}

export function DashboardCommandHeader({ model }: Props) {
  const { language } = useTranslation();
  const now = new Date();
  const locale = language === "en" ? "en-US" : language === "pt" ? "pt-BR" : "es-CO";
  const dateLabel = now.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: model.timezone,
  });
  const timeLabel = now.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: model.timezone,
  });

  const labels = language === "en"
    ? { live: "Business data", verified: "Controlled by real data", updated: "Updated", today: "Today" }
    : language === "pt"
      ? { live: "Dados do negócio", verified: "Controlado por dados reais", updated: "Atualizado", today: "Hoje" }
      : { live: "Datos del negocio", verified: "Controlado por datos reales", updated: "Actualizado", today: "Hoy" };

  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-vimdy-text-secondary text-sm font-medium uppercase tracking-[0.14em]">
          {labels.today}
        </p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-vimdy-text">
          {model.businessName}
        </h1>
        <p className="mt-2 text-vimdy-text-secondary capitalize">{dateLabel}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="inline-flex items-center gap-2 rounded-full border border-vimdy-border bg-vimdy-surface px-4 py-2 text-vimdy-text-secondary">
          <Clock3 size={16} aria-hidden="true" />
          <span>{timeLabel}</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-vimdy-border bg-vimdy-surface px-4 py-2 text-vimdy-text-secondary">
          <ShieldCheck size={16} className="text-vimdy-success" aria-hidden="true" />
          <span>{labels.verified}</span>
        </div>
        {model.dataFreshAt ? (
          <div className="text-xs text-vimdy-text-tertiary">
            {labels.updated}{" "}
            {new Date(model.dataFreshAt).toLocaleTimeString(locale, {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: model.timezone,
            })}
          </div>
        ) : null}
        <span className="sr-only">{labels.live}</span>
      </div>
    </header>
  );
}
