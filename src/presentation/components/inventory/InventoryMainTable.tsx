import { memo } from "react";
import type { StockStatus } from "../../../core/store/useInventory";
import { money } from "./inventoryShared";
import type { CostCell, InventoryTableRow, StockCell } from "./inventoryTableRows";

/**
 * Tabla Principal de Inventario (rediseño ultrarrápido y simple).
 * Producto · Categoría · Stock · Costo · Precio · [➕ Sumar] [✏️ Editar]
 *
 * Solo pinta: recibe filas ya calculadas (ver inventoryTableRows.ts) y avisa
 * con dos callbacks. No abre modales ni conoce stores.
 */

export interface InventoryMainTableProps {
  readonly rows: readonly InventoryTableRow[];
  readonly onAddStock: (productId: string) => void;
  readonly onEdit: (productId: string) => void;
  readonly emptyMessage?: string;
}

/* ───────────────────────── Paleta (tema oscuro VIMDY) ─────────────────────
   Fondo de página  #090B0E   · tarjeta  #0F1217   · borde  #1E232B
   Texto  #F5F5F4 / #A1A1AA / #5C5C64
   Stock bajo  fila ámbar 7%  · pill #F59E0B (texto #FBBF24)
   Agotado     fila rojo 8%   · pill #EF4444 (texto #F87171)
   Disponible  punto #22C55E
────────────────────────────────────────────────────────────────────────── */

const ROW_TONE: Record<StockStatus, string> = {
  normal: "bg-transparent hover:bg-white/[0.03]",
  bajo: "bg-[#F59E0B]/[0.07] hover:bg-[#F59E0B]/[0.10]",
  agotado: "bg-[#EF4444]/[0.08] hover:bg-[#EF4444]/[0.11]"
};

const quantityFormatter = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

function formatQuantity(quantity: number, unit?: string): string {
  const base = quantityFormatter.format(quantity);
  // "unidad" se sobreentiende; solo se muestra la unidad cuando aporta (kg, litro, ml...).
  return unit && unit !== "unidad" ? `${base} ${unit}` : base;
}

function StatusPill({ status }: { status: Exclude<StockStatus, "normal"> }) {
  const isOut = status === "agotado";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
        isOut ? "border border-[#EF4444]/30 bg-[#EF4444]/15 text-[#F87171]" : "border border-[#F59E0B]/30 bg-[#F59E0B]/15 text-[#FBBF24]"
      }`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${isOut ? "bg-[#EF4444]" : "bg-[#F59E0B]"}`} />
      {isOut ? "Agotado" : "Stock bajo"}
    </span>
  );
}

function StockContent({ stock }: { stock: StockCell }) {
  if (stock.kind === "none") return <span className="text-[#5C5C64]">—</span>;

  if (stock.kind === "status") {
    if (stock.status === "normal") {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#A1A1AA]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[#22C55E]" />
          Disponible
        </span>
      );
    }
    return <StatusPill status={stock.status} />;
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`font-semibold tabular-nums ${stock.status === "agotado" ? "text-[#F87171]" : "text-[#F5F5F4]"}`}>
        {formatQuantity(stock.quantity, stock.unit)}
      </span>
      {stock.status !== "normal" && <StatusPill status={stock.status} />}
    </div>
  );
}

function CostContent({ cost }: { cost: CostCell }) {
  if (cost.kind === "none") return <span className="text-[#5C5C64]">—</span>;
  if (cost.kind === "missing") {
    return (
      <span
        className="whitespace-nowrap text-xs font-medium text-[#FBBF24]"
        title="Agrega el costo (del producto o de sus insumos) para saber cuánto ganas."
      >
        Falta el costo
      </span>
    );
  }
  return <span className="tabular-nums text-[#A1A1AA]">{money(cost.amount)}</span>;
}

const HEAD_CELL = "px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#5C5C64]";

const BUTTON_BASE =
  "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-sm font-semibold transition " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

function InventoryMainTableBase({
  rows,
  onAddStock,
  onEdit,
  emptyMessage = "No hay productos para mostrar."
}: InventoryMainTableProps) {
  return (
    <section className="rounded-2xl bg-[#090B0E] p-3 sm:p-6">
      <div className="overflow-hidden rounded-2xl border border-[#1E232B] bg-[#0F1217] shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <caption className="sr-only">Inventario de productos</caption>
            <thead>
              <tr className="border-b border-[#1E232B] text-left">
                <th scope="col" className={HEAD_CELL}>Producto</th>
                <th scope="col" className={HEAD_CELL}>Categoría</th>
                <th scope="col" className={HEAD_CELL}>Stock</th>
                <th scope="col" className={`${HEAD_CELL} text-right`}>Costo</th>
                <th scope="col" className={`${HEAD_CELL} text-right`}>Precio</th>
                <th scope="col" className={`${HEAD_CELL} text-right`}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-[#5C5C64]">
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className={`border-b border-[#171B21] last:border-b-0 transition-colors ${ROW_TONE[rowStatus(row)]}`}>
                  <td className="px-5 py-4 font-semibold text-[#F5F5F4]">{row.name}</td>
                  <td className="px-5 py-4 text-[#A1A1AA]">{row.categoryName}</td>
                  <td className="px-5 py-4">
                    <StockContent stock={row.stock} />
                  </td>
                  <td className="px-5 py-4 text-right">
                    <CostContent cost={row.cost} />
                  </td>
                  <td className="px-5 py-4 text-right font-semibold tabular-nums text-[#F5F5F4]">{money(row.price)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={!row.canAddStock}
                        onClick={() => onAddStock(row.id)}
                        aria-label={`Sumar stock a ${row.name}`}
                        className={`${BUTTON_BASE} border border-[#2A2F38] bg-[#14181E] text-[#F5F5F4] hover:bg-[#1B2028] active:scale-[0.97] disabled:hover:bg-[#14181E]`}
                      >
                        <span aria-hidden>➕</span>
                        Sumar
                      </button>
                      <button
                        type="button"
                        disabled={!row.canEdit}
                        onClick={() => onEdit(row.id)}
                        aria-label={`Editar ${row.name}`}
                        className={`${BUTTON_BASE} text-[#A1A1AA] hover:bg-white/[0.06] hover:text-[#F5F5F4] active:scale-[0.97] disabled:hover:bg-transparent`}
                      >
                        <span aria-hidden>✏️</span>
                        Editar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** El tono de la fila lo decide el estado del stock (amarillo = bajo, rojo = agotado). */
function rowStatus(row: InventoryTableRow): StockStatus {
  return row.stock.kind === "none" ? "normal" : row.stock.status;
}

export const InventoryMainTable = memo(InventoryMainTableBase);