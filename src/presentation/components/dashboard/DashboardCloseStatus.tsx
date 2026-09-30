import { CheckCircle2, CircleDashed, Clock3, WalletCards } from "lucide-react";

import { useTranslation } from "../../../core/i18n/useTranslation";
import type { DashboardExecutiveClosing, DashboardExecutiveModel } from "../../../core/dashboard/executive/DashboardExecutiveTypes";

interface Props { model: DashboardExecutiveModel; }

function statusLabel(status: DashboardExecutiveClosing["status"], language: string): string {
  if (status === "CLOSED") return language === "en" ? "Confirmed close" : language === "pt" ? "Fechamento confirmado" : "Cierre confirmado";
  if (status === "OPEN") return language === "en" ? "Shift open" : language === "pt" ? "Turno aberto" : "Turno abierto";
  return language === "en" ? "No shift" : language === "pt" ? "Sem turno" : "Sin turno";
}

export function DashboardCloseStatus({ model }: Props) {
  const { language, money } = useTranslation();
  if (!model.capabilities.cash) return null;

  const closing = model.closing;
  const statusText = statusLabel(closing.status, language);
  const copy = language === "en"
    ? "The physical close is shown only from a real closed shift."
    : language === "pt"
      ? "O fechamento físico só é mostrado a partir de um turno realmente fechado."
      : "El cierre físico solo se muestra a partir de un turno realmente cerrado.";

  return (
    <section aria-labelledby="dashboard-close" className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-6 shadow-vimdy-xs">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <WalletCards size={20} className="text-vimdy-text-tertiary mt-0.5" aria-hidden="true" />
          <div>
            <h2 id="dashboard-close" className="text-xl font-bold text-vimdy-text">{language === "en" ? "Cash close" : language === "pt" ? "Fechamento de caixa" : "Cierre de caja"}</h2>
            <p className="mt-1 text-sm text-vimdy-text-secondary">{copy}</p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-vimdy-text-secondary">
          {closing.status === "CLOSED" ? <CheckCircle2 size={17} className={closing.dataComplete ? "text-vimdy-success" : "text-vimdy-warning"} aria-hidden="true" /> : closing.status === "OPEN" ? <Clock3 size={17} className="text-vimdy-warning" aria-hidden="true" /> : <CircleDashed size={17} aria-hidden="true" />}
          <span>{closing.status === "CLOSED" && !closing.dataComplete ? (language === "en" ? "Incomplete close" : language === "pt" ? "Fechamento incompleto" : "Cierre incompleto") : statusText}</span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface-hover p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-vimdy-text-secondary">{language === "en" ? "Expected" : language === "pt" ? "Esperado" : "Esperado"}</p>
          <p className="mt-2 text-lg font-bold text-vimdy-text">{closing.expected === null ? "—" : money(closing.expected)}</p>
        </div>
        <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface-hover p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-vimdy-text-secondary">{language === "en" ? "Counted" : language === "pt" ? "Contado" : "Contado"}</p>
          <p className="mt-2 text-lg font-bold text-vimdy-text">{closing.counted === null ? "—" : money(closing.counted)}</p>
        </div>
        <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface-hover p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-vimdy-text-secondary">{language === "en" ? "Difference" : language === "pt" ? "Diferença" : "Diferencia"}</p>
          <p className={`mt-2 text-lg font-bold ${closing.difference === null ? "text-vimdy-text" : closing.difference === 0 ? "text-vimdy-success" : "text-vimdy-warning"}`}>
            {closing.difference === null ? "—" : money(closing.difference)}
          </p>
        </div>
      </div>

      {closing.closedAt ? (
        <p className="mt-4 text-xs text-vimdy-text-tertiary">
          {language === "en" ? "Closed at" : language === "pt" ? "Fechado às" : "Cerrado a las"}{" "}
          {new Date(closing.closedAt).toLocaleString(language === "en" ? "en-US" : language === "pt" ? "pt-BR" : "es-CO", { hour: "2-digit", minute: "2-digit", timeZone: model.timezone })}
        </p>
      ) : null}
    </section>
  );
}
