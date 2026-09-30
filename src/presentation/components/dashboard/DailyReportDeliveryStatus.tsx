import { CheckCircle2, Clock3, Mail, MessageCircle, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { useAuth } from "../../context/AuthContext";
import { useDailyReportDelivery } from "../../../hooks/useDailyReportDelivery";
import type { DailyReportDeliveryRecord } from "../../../core/dashboard/reports/DailyReportTypes";

function channelLabel(channel: DailyReportDeliveryRecord["channel"], language: string) {
  if (channel === "WHATSAPP") return "WhatsApp";
  return language === "en" ? "Email" : language === "pt" ? "E-mail" : "Correo";
}

function statusLabel(status: DailyReportDeliveryRecord["status"], language: string) {
  if (status === "READ") return language === "en" ? "Read" : language === "pt" ? "Lido" : "Leído";
  if (status === "DELIVERED") return language === "en" ? "Delivered" : language === "pt" ? "Entregue" : "Entregado";
  if (status === "SENT") return language === "en" ? "Sent" : language === "pt" ? "Enviado" : "Enviado";
  if (status === "RETRY") return language === "en" ? "Retrying" : language === "pt" ? "Tentando novamente" : "Reintentando";
  if (status === "WAITING_CONFIGURATION") return language === "en" ? "Waiting for configuration" : language === "pt" ? "Aguardando configuração" : "Esperando configuración";
  if (status === "FAILED") return language === "en" ? "Failed" : language === "pt" ? "Falhou" : "Falló";
  return language === "en" ? "Pending" : language === "pt" ? "Pendente" : "Pendiente";
}

export function DailyReportDeliveryStatus() {
  const { language } = useTranslation();
  const { role } = useAuth();
  const { job, loading, error, refresh } = useDailyReportDelivery();
  const canView = ["ADMIN", "GERENTE", "CONTADOR"].includes(role?.id ?? "");
  if (!canView) return null;

  const title = language === "en" ? "Daily close report" : language === "pt" ? "Relatório de fechamento diário" : "Reporte del cierre diario";
  const noReport = language === "en" ? "A report will appear here after a real cash close." : language === "pt" ? "O relatório aparecerá aqui após um fechamento real de caixa." : "Aquí aparecerá el reporte después de un cierre real de caja.";

  if (loading) {
    return <section className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-6"><p className="text-sm text-vimdy-text-secondary">Cargando estado del reporte…</p></section>;
  }

  if (!job) {
    return <section className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-6"><h2 className="text-lg font-bold text-vimdy-text">{title}</h2><p className="mt-2 text-sm text-vimdy-text-secondary">{noReport}</p>{error ? <p className="mt-3 text-xs text-vimdy-danger">{error}</p> : null}</section>;
  }

  const isHealthy = job.status === "COMPLETED";
  const Icon = isHealthy ? CheckCircle2 : job.status === "FAILED" ? AlertTriangle : Clock3;

  return (
    <section aria-labelledby="daily-report-status" className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-6 shadow-vimdy-xs">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <Icon size={20} className={isHealthy ? "text-vimdy-success" : job.status === "FAILED" ? "text-vimdy-danger" : "text-vimdy-warning"} aria-hidden="true" />
          <div>
            <h2 id="daily-report-status" className="text-xl font-bold text-vimdy-text">{title}</h2>
            <p className="mt-1 text-sm text-vimdy-text-secondary">
              {job.businessDate} · {new Date(job.closedAt).toLocaleTimeString(language === "en" ? "en-US" : language === "pt" ? "pt-BR" : "es-CO", { hour: "2-digit", minute: "2-digit", timeZone: job.snapshot?.timezone ?? "UTC" })}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => { void refresh(); }} className="inline-flex items-center gap-2 text-xs font-semibold text-vimdy-text-secondary hover:text-vimdy-text">
          <RefreshCw size={14} aria-hidden="true" /> Actualizar
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {job.deliveries.map((delivery) => (
          <span key={delivery.id} className="inline-flex items-center gap-2 rounded-full border border-vimdy-border bg-vimdy-surface-hover px-3 py-1.5 text-xs text-vimdy-text-secondary">
            {delivery.channel === "WHATSAPP" ? <MessageCircle size={13} aria-hidden="true" /> : <Mail size={13} aria-hidden="true" />}
            {channelLabel(delivery.channel, language)}: {statusLabel(delivery.status, language)}
          </span>
        ))}
        {job.deliveries.length === 0 ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-vimdy-border px-3 py-1.5 text-xs text-vimdy-text-secondary">
            <ShieldCheck size={13} aria-hidden="true" /> {job.status === "SKIPPED" ? "Automatización desactivada" : "Procesando configuración"}
          </span>
        ) : null}
      </div>

      {job.lastError ? <p className="mt-4 text-xs text-vimdy-danger">{job.lastError}</p> : null}

      {job.reportText ? (
        <details className="mt-5 rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface-hover">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-vimdy-text">Ver reporte generado</summary>
          <pre className="whitespace-pre-wrap px-4 pb-4 text-sm leading-6 text-vimdy-text-secondary font-sans">{job.reportText}</pre>
        </details>
      ) : null}
    </section>
  );
}