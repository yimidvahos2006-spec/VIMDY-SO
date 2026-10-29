import { ShoppingCart, TrendingDown, TrendingUp } from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import type {
  PurchaseAnalysisSummary,
  PurchaseRecommendation,
  PurchaseUrgency
} from "../../../core/engines/PurchaseIntelligenceEngine";

interface PurchaseRecommendationsPanelProps {
  recommendations: readonly PurchaseRecommendation[];
  summary: PurchaseAnalysisSummary | null;
  /** "Crear orden": abre el flujo de PASO 2.7 con la recomendación elegida. */
  onCreateOrder: (recommendation: PurchaseRecommendation) => void;
}

const URGENCY_LABEL: Record<PurchaseUrgency, string> = {
  ALTA: "Urgente",
  MEDIA: "Pronto",
  BAJA: "Puede esperar"
};

const URGENCY_CLASS: Record<PurchaseUrgency, string> = {
  ALTA: "border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger",
  MEDIA: "border-vimdy-warning/40 bg-vimdy-warning/10 text-vimdy-warning",
  BAJA: "border-vimdy-border bg-vimdy-surface text-vimdy-text-secondary"
};

function formatMoneyCOP(value: number): string {
  return `$${Math.round(value).toLocaleString("es-CO")}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

/**
 * PurchaseRecommendationsPanel — PASO 2.6 (Compras Inteligentes, análisis).
 * ---------------------------------------------------------------------------
 * Solo presenta lo que calculó PurchaseIntelligenceEngine: qué comprar, cuánto,
 * con qué urgencia y por qué. No calcula nada ni crea órdenes por su cuenta:
 * "Crear orden" delega en `onCreateOrder`.
 */
export function PurchaseRecommendationsPanel({
  recommendations,
  summary,
  onCreateOrder
}: PurchaseRecommendationsPanelProps) {
  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Urgentes" value={String(summary.urgent)} tone="text-vimdy-danger" />
          <SummaryCard label="Pronto" value={String(summary.warning)} tone="text-vimdy-warning" />
          <SummaryCard label="Pueden esperar" value={String(summary.low)} tone="text-vimdy-text" />
          <SummaryCard
            label="Costo estimado"
            value={formatMoneyCOP(summary.estimatedTotalCost)}
            tone="text-vimdy-text"
          />
        </div>
      )}

      <div className="space-y-3">
        {recommendations.map((rec) => (
          <div
            key={rec.productId}
            className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4"
          >
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-vimdy-text font-semibold">{rec.productName}</h3>
                <span className={`text-xs px-2 py-1 rounded-vimdy-sm border ${URGENCY_CLASS[rec.urgency]}`}>
                  {URGENCY_LABEL[rec.urgency]}
                </span>
                {rec.trendPercent !== null && rec.trendPercent !== 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-vimdy-text-secondary">
                    {rec.trendPercent > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    {rec.trendPercent > 0 ? "+" : ""}
                    {Math.round(rec.trendPercent)}% vs. periodo anterior
                  </span>
                )}
              </div>

              <p className="text-sm text-vimdy-text-secondary">{rec.reason}</p>

              {rec.reasonDetails.length > 0 && (
                <ul className="text-xs text-vimdy-text-tertiary space-y-0.5 list-disc pl-4">
                  {rec.reasonDetails.map((detail, index) => (
                    <li key={index}>{detail}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="shrink-0 sm:text-right space-y-2">
              <div>
                <p className="text-xs text-vimdy-text-tertiary">Comprar</p>
                <p className="text-vimdy-text text-lg font-semibold">
                  {formatNumber(rec.recommendedQuantity)} {rec.unit ?? ""}
                </p>
                {rec.estimatedCost !== null && (
                  <p className="text-xs text-vimdy-text-secondary">≈ {formatMoneyCOP(rec.estimatedCost)}</p>
                )}
              </div>
              <VimdyButton
                variant="secondary"
                size="sm"
                icon={<ShoppingCart size={14} />}
                onClick={() => onCreateOrder(rec)}
              >
                Crear orden
              </VimdyButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-vimdy-md border border-vimdy-border bg-vimdy-surface px-4 py-3">
      <p className="text-xs text-vimdy-text-tertiary">{label}</p>
      <p className={`text-xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}