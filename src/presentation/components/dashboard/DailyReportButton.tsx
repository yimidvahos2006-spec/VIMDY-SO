import { MessageCircle, RefreshCw } from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { useDailyBusinessReport } from "../../../hooks/useDailyBusinessReport";
import { businessStore } from "../../../core/store/businessStore";

export function DailyReportButton() {
  const { language } = useTranslation();
  const { report, loading, error, load } = useDailyBusinessReport();

  function handleSend() {
    if (!report) return;
    const rawNumber = businessStore.get().phone?.trim() || "";
    const digits = rawNumber.replace(/\D/g, "");
    if (!digits) {
      alert(
        language === "en"
          ? "Configure the business phone in Settings before sending the manual WhatsApp preview."
          : language === "pt"
            ? "Configure o telefone do negócio em Configurações antes de enviar a prévia manual pelo WhatsApp."
            : "Configura el teléfono del negocio en Ajustes antes de enviar la vista previa manual por WhatsApp.",
      );
      return;
    }

    const encoded = encodeURIComponent(report.text);
    window.open(`https://wa.me/${digits}?text=${encoded}`, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface shadow-vimdy-xs p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="min-w-0">
          <p className="text-vimdy-text font-semibold text-vimdy-body">
            {language === "en" ? "Daily report" : language === "pt" ? "Relatório diário" : "Reporte diario"}
          </p>
          <p className="text-vimdy-text-secondary text-sm mt-1">
            {report
              ? `${report.salesCount} ${language === "en" ? "transactions" : language === "pt" ? "transações" : "transacciones"} · ${report.totalSales.toLocaleString(language === "en" ? "en-US" : language === "pt" ? "pt-BR" : "es-CO")} ${report.cashStatus === "CLOSED" ? "· cierre confirmado" : "· cierre pendiente"}`
              : language === "en"
                ? "Preview the report using the same reconciled data as the Dashboard."
                : language === "pt"
                  ? "Visualize o relatório usando os mesmos dados reconciliados do Dashboard."
                  : "Visualiza el reporte usando los mismos datos reconciliados del Dashboard."}
          </p>
          {error ? <p className="text-vimdy-danger text-sm mt-2">{error}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <VimdyButton onClick={load} loading={loading} disabled={loading} variant="secondary" icon={<RefreshCw size={17} />}>
            {report ? (language === "en" ? "Refresh" : language === "pt" ? "Atualizar" : "Actualizar") : (language === "en" ? "Generate report" : language === "pt" ? "Gerar relatório" : "Generar reporte")}
          </VimdyButton>
          {report ? (
            <VimdyButton onClick={handleSend} variant="primary" icon={<MessageCircle size={17} />}>
              {language === "en" ? "Open WhatsApp" : language === "pt" ? "Abrir WhatsApp" : "Abrir WhatsApp"}
            </VimdyButton>
          ) : null}
        </div>
      </div>
    </section>
  );
}
