import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Product } from "../../../core/entities/Entities";
import { getStockStatus } from "../../../core/store/useInventory";
import { calculateInventoryCostValuation, type InventoryCostValuation } from "../../../core/utils/inventoryValuation";
import { money } from "./inventoryShared";
import { hasMaskedStock } from "../../../core/utils/stockMask";
import { useAuth } from "../../context/AuthContext";

type Side = "insumos" | "productos";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Resumen de una sola mirada para todo Inventario: cuántos se están acabando,
 * cuántos están agotados y cuánto vale lo que hay guardado. Cuenta insumos y
 * productos juntos, con las mismas reglas que ya usan las tablas
 * (getStockStatus y calculateInventoryCostValuation), así los números nunca
 * contradicen lo que se ve abajo.
 */
export function InventorySummaryBar({
  products,
  loading,
  onGoTo
}: {
  products: Product[];
  loading: boolean;
  onGoTo: (side: Side, status?: "bajo" | "agotado") => void;
}) {
  // Valor del inventario: solo quien tenga inventory.viewCosts (ADMIN).
  const { can } = useAuth();
  const canViewCosts = can("inventory.viewCosts");

  const summary = useMemo(() => {
    const active = products.filter((p) => p.active !== false);
    const count = (ingredient: boolean, status: "bajo" | "agotado") =>
      active.filter((p) => (p.isIngredient === true) === ingredient && getStockStatus(p) === status).length;

    const valuation = calculateInventoryCostValuation(products);
    const valuationIns = calculateInventoryCostValuation(products.filter((p) => p.isIngredient === true));
    const valuationProd = calculateInventoryCostValuation(products.filter((p) => p.isIngredient !== true));
    return {
      total: active.length,
      lowIns: count(true, "bajo"),
      outIns: count(true, "agotado"),
      lowProd: count(false, "bajo"),
      outProd: count(false, "agotado"),
      valuation,
      valuationIns,
      valuationProd
    };
  }, [products]);

  if (!loading && products.length === 0) return null;

  const { lowIns, outIns, lowProd, outProd, valuation, valuationIns, valuationProd } = summary;
  const low = lowIns + lowProd;
  const out = outIns + outProd;
  const insTotal = lowIns + outIns;
  const prodTotal = lowProd + outProd;

  // Conteo a ciegas activo: el costo no llega del servidor, así que el valor del
  // inventario no se puede calcular (ni debe mostrarse como "incompleto").
  const costsHidden = hasMaskedStock(products);

  const formatValue = (v: InventoryCostValuation) =>
    loading
      ? "—"
      : costsHidden
        ? "Oculto durante el conteo"
        : v.valuationStatus === "COMPLETE"
        ? money(v.stockCostValue ?? 0)
        : v.valuationStatus === "INCOMPLETE"
          ? `Costo incompleto (${v.unvaluedProductCount})`
          : "Sin stock controlado";

  const valueText = formatValue(valuation);
  const valueInsText = formatValue(valuationIns);
  const valueProdText = formatValue(valuationProd);

  const cardClass = "rounded-vimdy-md border border-vimdy-border bg-vimdy-surface px-4 py-3";
  const labelClass = "text-xs text-vimdy-text-secondary";

  const parts: string[] = [];
  if (insTotal > 0) parts.push(plural(insTotal, "insumo", "insumos"));
  if (prodTotal > 0) parts.push(plural(prodTotal, "producto", "productos"));
  const verb = insTotal + prodTotal === 1 ? "está" : "están";
  const hasOut = out > 0;

  return (
    <div className="space-y-3" aria-label="Resumen del inventario">
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${canViewCosts ? "lg:grid-cols-5" : ""}`}>
        <div className={cardClass}>
          <p className={labelClass}>Por acabarse</p>
          <p className={`text-2xl font-bold ${!loading && low > 0 ? "text-vimdy-warning" : "text-vimdy-text"}`}>
            {loading ? "—" : low}
          </p>
        </div>
        <div className={cardClass}>
          <p className={labelClass}>Agotados</p>
          <p className={`text-2xl font-bold ${!loading && out > 0 ? "text-vimdy-danger" : "text-vimdy-text"}`}>
            {loading ? "—" : out}
          </p>
        </div>
        {canViewCosts && (<>
        <div className={cardClass}>
          <p className={labelClass}>Valor del inventario</p>
          <p className="text-2xl font-bold text-vimdy-text">{valueText}</p>
        </div>
        <div className={cardClass}>
          <p className={labelClass}>Valor en insumos</p>
          <p className="text-2xl font-bold text-vimdy-text">{valueInsText}</p>
        </div>
        <div className={cardClass}>
          <p className={labelClass}>Valor en productos</p>
          <p className="text-2xl font-bold text-vimdy-text">{valueProdText}</p>
        </div>
        </>)}
      </div>

      {!loading && parts.length > 0 && (
        <div
          role="status"
          className={`flex flex-wrap items-center justify-between gap-3 rounded-vimdy-md border px-4 py-3 text-sm ${
            hasOut
              ? "border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger"
              : "border-vimdy-warning/40 bg-vimdy-warning/10 text-vimdy-warning"
          }`}
        >
          <span className="flex items-center gap-2 font-medium">
            <AlertTriangle size={16} />
            {parts.join(" y ")} {verb} por acabarse o agotado{insTotal + prodTotal === 1 ? "" : "s"}
          </span>
          <span className="flex gap-2">
            {insTotal > 0 && (
              <button
                type="button"
                onClick={() => onGoTo("insumos", outIns > 0 ? "agotado" : "bajo")}
                className="h-9 px-3 rounded-vimdy-md border border-current font-semibold hover:bg-vimdy-surface/40"
              >
                Ver insumos
              </button>
            )}
            {prodTotal > 0 && (
              <button
                type="button"
                onClick={() => onGoTo("productos", outProd > 0 ? "agotado" : "bajo")}
                className="h-9 px-3 rounded-vimdy-md border border-current font-semibold hover:bg-vimdy-surface/40"
              >
                Ver productos
              </button>
            )}
          </span>
        </div>
      )}

      {!loading && parts.length === 0 && summary.total > 0 && (
        <p className="flex items-center gap-2 text-sm text-vimdy-success">
          <CheckCircle2 size={16} /> Todo en orden: nada se está acabando.
        </p>
      )}
    </div>
  );
}