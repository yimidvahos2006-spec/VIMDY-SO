import React, { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { ReportsDashboard } from "../components/reports/ReportsDashboard";
import { MonthlyReportsSection } from "../components/reports/MonthlyReportsSection";
import { VimdyButton } from "../components/ui/VimdyButton";
import { RequirePermission } from "../navigation/RequirePermission";
import { useAuth } from "../context/AuthContext";
import { useMonthlyReports } from "../../hooks/useMonthlyReports";

type ReportsView = "resumen" | "meses";

const TABS: { id: ReportsView; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "meses", label: "Reportes por mes" }
];

function ReportsContent() {
  const { can } = useAuth();
  const canExport = can("reports.export");
  const [view, setView] = useState<ReportsView>("resumen");
  const [openMonthKey, setOpenMonthKey] = useState<string | null>(null);
  const monthly = useMonthlyReports();
  const { months, getMonthReport } = monthly;

  const openReport = useMemo(
    () => (openMonthKey ? getMonthReport(openMonthKey) : null),
    [openMonthKey, getMonthReport]
  );

  // El botón de arriba descarga: el mes abierto; si no hay, el mes actual;
  // y si el mes actual aún no tiene ventas, el mes más reciente que sí tenga.
  const topMonth = useMemo(() => {
    if (openMonthKey) return months.find((m) => m.monthKey === openMonthKey) ?? null;
    const current = months.find((m) => m.isCurrent);
    if (current && current.tickets > 0) return current;
    return months.find((m) => m.tickets > 0) ?? current ?? null;
  }, [openMonthKey, months]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setView(tab.id);
                setOpenMonthKey(null);
              }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition border ${
                view === tab.id
                  ? "bg-vimdy-accent text-white border-vimdy-accent"
                  : "bg-vimdy-surface-hover text-vimdy-text-secondary border-vimdy-border hover:border-vimdy-accent/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {canExport && (
          <div className="flex items-center gap-3 self-start sm:self-auto">
            {topMonth && <span className="text-xs text-vimdy-text-secondary">{topMonth.label}</span>}
            <VimdyButton
              variant="secondary"
              icon={<Download size={18} />}
              disabled={monthly.loading || !topMonth || topMonth.tickets === 0}
              onClick={() => topMonth && monthly.downloadMonth(topMonth.monthKey)}
            >
              Descargar reporte del mes
            </VimdyButton>
          </div>
        )}
      </div>

      {view === "resumen" ? (
        <ReportsDashboard />
      ) : (
        <MonthlyReportsSection
          loading={monthly.loading}
          error={monthly.error}
          downloadError={monthly.downloadError}
          months={months}
          openReport={openReport}
          canExport={canExport}
          onOpen={setOpenMonthKey}
          onBack={() => setOpenMonthKey(null)}
          onDownloadMonth={monthly.downloadMonth}
          onDownloadWeek={monthly.downloadWeek}
        />
      )}
    </div>
  );
}

export function ReportsPage() {
  return (
    <RequirePermission requires="reports.view">
      <div className="min-h-screen p-4 sm:p-8">
        <ReportsContent />
      </div>
    </RequirePermission>
  );
}
