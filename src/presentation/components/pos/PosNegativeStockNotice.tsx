import { AlertTriangle } from "lucide-react";
import { useCart } from "../../../core/store/useCart";
import { useSaleNegativeStock } from "../../../hooks/useSaleNegativeStock";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { useAuth } from "../../context/AuthContext";

const MAX_DETAIL_ROWS = 3;
const formatQty = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 3 });

/**
 * Aviso en Caja cuando la venta actual deja insumos o productos en negativo
 * (Opción B). No bloquea nada: el botón Cobrar sigue igual. Todos los cajeros ven
 * el mensaje general; el detalle (qué artículo y cuánto queda) solo lo ve quien
 * tiene permiso de ver inventario.
 */
export function PosNegativeStockNotice() {
  const { t } = useTranslation();
  const { items } = useCart();
  const { can } = useAuth();
  const rows = useSaleNegativeStock(items);

  if (rows.length === 0) return null;

  const title =
    rows.length === 1
      ? t("pos.negativeStock.titleOne")
      : t("pos.negativeStock.titleMany", { count: rows.length });
  const showDetail = can("inventory.view");
  const shown = rows.slice(0, MAX_DETAIL_ROWS);
  const hidden = rows.length - shown.length;

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-vimdy-md border border-vimdy-warning/40 bg-vimdy-warning/10 px-4 py-2.5 text-vimdy-small text-vimdy-warning"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold">{title}</p>
        {showDetail && (
          <ul className="text-vimdy-text-secondary">
            {shown.map((row) => (
              <li key={row.productId} className="truncate">
                {row.name}: {formatQty(row.stockAfter)} {row.unit || "und"}
              </li>
            ))}
            {hidden > 0 && <li>{t("pos.negativeStock.more", { count: hidden })}</li>}
          </ul>
        )}
        <p className="text-vimdy-text-secondary">{t("pos.negativeStock.hint")}</p>
      </div>
    </div>
  );
}