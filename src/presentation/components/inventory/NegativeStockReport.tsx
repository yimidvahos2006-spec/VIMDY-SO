import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Info } from "lucide-react";
import { EmptyState } from "../ui/EmptyState";
import { SkeletonRows } from "../ui/Skeleton";
import { container } from "../../../infrastructure/di/CompositionRoot";
import type { InventoryMovement } from "../../../core/entities/Entities";
import { buildNegativeStockReport } from "../../../core/utils/negativeStockReport";
import { useAuth } from "../../context/AuthContext";
import { money, type InventoryState } from "./inventoryShared";

type KindFilter = "todos" | "insumo" | "producto";

const formatQty = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 3 });
const formatDate = (d: Date | null) =>
  d ? d.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }) : "—";

const cardClass = "rounded-vimdy-md border border-vimdy-border bg-vimdy-surface px-4 py-3";
const labelClass = "text-xs text-vimdy-text-secondary";

/**
 * Reporte de stock en negativo (Opción B). Las ventas nunca se bloquean por falta
 * de stock, así que aquí se ve qué insumos y productos quedaron en números rojos,
 * cuánto falta y desde cuándo, para regularizarlos con un conteo o una compra.
 *
 * Toda la lógica vive en core/utils/negativeStockReport.ts; este componente solo
 * pinta. Durante un conteo a ciegas el servidor enmascara el stock, así que esos
 * productos no se pueden evaluar y se avisa en pantalla.
 */
export function NegativeStockReport({
  inventory,
  onRegularize
}: {
  inventory: InventoryState;
  /** Abre "Contar inventario" para corregir los faltantes. */
  onRegularize: () => void;
}) {
  const { can } = useAuth();
  const canViewCosts = can("inventory.viewCosts");
  const { products, loading } = inventory;
  const [kind, setKind] = useState<KindFilter>("todos");
  const [movements, setMovements] = useState<InventoryMovement[]>([]);

  // Cuántos hay en negativo sin mirar el Kardex: así solo se carga el historial si hace falta.
  const baseReport = useMemo(() => buildNegativeStockReport(products), [products]);
  const hasNegatives = baseReport.totalCount > 0;

  // El historial completo solo se pide cuando hay algo en negativo (para "desde cuándo").
  // Si falla (sin permiso o sin red) el reporte sigue funcionando, solo sin fechas.
  useEffect(() => {
    if (!hasNegatives) return;
    let cancelled = false;
    container.kardexEngine
      .get()
      .getAllMovements()
      .then((all) => {
        if (!cancelled) setMovements(all);
      })
      .catch(() => {
        if (!cancelled) setMovements([]);
      });
    return () => {
      cancelled = true;
    };
  }, [hasNegatives, products]);

  const report = useMemo(
    () => buildNegativeStockReport(products, { includeCosts: canViewCosts, movements }),
    [products, canViewCosts, movements]
  );
  const rows = useMemo(
    () => (kind === "todos" ? report.rows : report.rows.filter((r) => r.kind === kind)),
    [report.rows, kind]
  );

  if (loading) return <SkeletonRows rows={6} />;

  return (
    <div className="space-y-4" aria-label="Reporte de stock en negativo">
      <p className="text-sm text-vimdy-text-secondary">
        Las ventas nunca se bloquean por falta de stock. Aquí ves lo que quedó en negativo para que lo regularices con un
        conteo o una compra.
      </p>

      {report.maskedCount > 0 && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-vimdy-md border border-vimdy-warning/30 bg-vimdy-warning/10 px-4 py-3 text-sm text-vimdy-text-secondary"
        >
          <Info size={16} className="mt-0.5 shrink-0 text-vimdy-warning" />
          <span>
            Hay un conteo a ciegas abierto: {report.maskedCount === 1 ? "1 producto tiene" : `${report.maskedCount} productos tienen`} el
            stock oculto y no se puede revisar si está en negativo hasta que cierres el conteo.
          </span>
        </div>
      )}

      {!hasNegatives ? (
        <EmptyState
          icon={<CheckCircle2 size={48} />}
          title="Nada en negativo"
          description="Todo tu inventario tiene stock en cero o más. Si una venta deja algo en negativo, aparecerá aquí."
        />
      ) : (
        <>
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${canViewCosts ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            <div className={cardClass}>
              <p className={labelClass}>En negativo</p>
              <p className="text-2xl font-bold text-vimdy-danger">{report.totalCount}</p>
            </div>
            <div className={cardClass}>
              <p className={labelClass}>Insumos</p>
              <p className="text-2xl font-bold text-vimdy-text">{report.insumoCount}</p>
            </div>
            <div className={cardClass}>
              <p className={labelClass}>Productos</p>
              <p className="text-2xl font-bold text-vimdy-text">{report.productCount}</p>
            </div>
            {canViewCosts && (
              <div className={cardClass}>
                <p className={labelClass}>Costo del faltante</p>
                <p className="text-2xl font-bold text-vimdy-text">
                  {report.totalShortageCost !== null ? money(report.totalShortageCost) : "Costo incompleto"}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as KindFilter)}
              aria-label="Filtrar por tipo"
              className="h-10 px-3 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm outline-none focus:border-vimdy-accent"
            >
              <option value="todos">Insumos y productos</option>
              <option value="insumo">Solo insumos</option>
              <option value="producto">Solo productos</option>
            </select>
            <button
              type="button"
              onClick={onRegularize}
              className="h-10 px-4 rounded-vimdy-md border border-vimdy-border text-vimdy-text text-sm font-semibold flex items-center gap-2 hover:border-vimdy-accent hover:bg-vimdy-accent/10 transition"
            >
              <ClipboardCheck size={16} /> Contar para regularizar
            </button>
          </div>

          <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface overflow-hidden">
            <div className="px-4 py-2 bg-vimdy-background/50 border-b border-vimdy-border flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-vimdy-text-secondary flex items-center gap-2">
                <AlertTriangle size={14} className="text-vimdy-danger" /> Stock en negativo
              </h3>
              <span className="text-xs text-vimdy-text-tertiary">{rows.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-vimdy-text-tertiary">
                    <th className="px-4 py-2 font-medium">Nombre</th>
                    <th className="px-4 py-2 font-medium">Tipo</th>
                    <th className="px-4 py-2 font-medium">Stock actual</th>
                    <th className="px-4 py-2 font-medium">Falta</th>
                    {canViewCosts && <th className="px-4 py-2 font-medium">Costo del faltante</th>}
                    <th className="px-4 py-2 font-medium">En negativo desde</th>
                    <th className="px-4 py-2 font-medium">Último movimiento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vimdy-border">
                  {rows.map((row) => {
                    const unit = row.unit || "und";
                    return (
                      <tr key={row.productId} className="hover:bg-vimdy-background/30 transition">
                        <td className="px-4 py-3 text-vimdy-text font-semibold">{row.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-vimdy-sm border ${
                              row.kind === "insumo"
                                ? "bg-vimdy-warning/15 text-vimdy-warning border-vimdy-warning/30"
                                : "bg-vimdy-accent/15 text-vimdy-accent border-vimdy-accent/30"
                            }`}
                          >
                            {row.kind === "insumo" ? "Insumo" : "Producto"}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-2 font-medium text-vimdy-danger">
                            <span className="w-2 h-2 rounded-full bg-vimdy-danger" />
                            {formatQty(row.stock)} {unit}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-vimdy-text whitespace-nowrap">
                          {formatQty(row.shortage)} {unit}
                        </td>
                        {canViewCosts && (
                          <td className="px-4 py-3 text-vimdy-text whitespace-nowrap">
                            {row.shortageCost !== null ? (
                              money(row.shortageCost)
                            ) : (
                              <span className="text-vimdy-warning text-xs">Sin costo</span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 text-vimdy-text-secondary whitespace-nowrap">{formatDate(row.negativeSince)}</td>
                        <td className="px-4 py-3 text-vimdy-text-secondary whitespace-nowrap">{formatDate(row.lastMovementAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}