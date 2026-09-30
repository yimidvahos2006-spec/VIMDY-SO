import React from "react";
import { MessageCircle } from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { useDailyBusinessReport } from "../../../hooks/useDailyBusinessReport";
import { businessStore } from "../../../core/store/businessStore";

export function DailyReportButton() {
  const { t } = useTranslation();
  const { report, loading, error, load } = useDailyBusinessReport();

  function handleSend() {
    if (!report) return;
    const rawNumber = businessStore.get().phone?.trim() || "";
    const digits = rawNumber.replace(/\D/g, "");
    if (!digits) {
      alert("Configura el teléfono del negocio en Ajustes para enviar el reporte por WhatsApp.");
      return;
    }

    const encoded = encodeURIComponent(report.text);
    const url = `https://wa.me/${digits}?text=${encoded}`;
    window.open(url, "_blank");
  }

  return (
    <div className="col-span-12 rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface shadow-vimdy-md p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-vimdy-text font-semibold text-vimdy-body">Reporte diario del negocio</p>
          <p className="text-vimdy-text-secondary text-vimdy-small mt-1">
            {report
              ? `Listo para enviar: ${report.salesCount} órdenes, ${report.topProduct ? `top: ${report.topProduct}` : "sin productos"}`
              : "Genera el resumen de ventas del día y envíalo por WhatsApp."}
          </p>
          {error && <p className="text-vimdy-danger text-vimdy-small mt-1">{error}</p>}
        </div>

        <div className="flex items-center gap-3">
          <VimdyButton
            onClick={load}
            loading={loading}
            disabled={loading}
            variant="secondary"
          >
            {report ? "Actualizar reporte" : "Generar reporte del día"}
          </VimdyButton>

          {report && (
            <VimdyButton
              onClick={handleSend}
              variant="primary"
              icon={<MessageCircle size={18} />}
            >
              Enviar por WhatsApp
            </VimdyButton>
          )}
        </div>
      </div>
    </div>
  );
}
