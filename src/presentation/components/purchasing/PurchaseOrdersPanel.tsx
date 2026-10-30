import { useId, useMemo, useState } from 'react';
import type { IsoDateString } from '../../../core/entities/Entities';
import { checkExpiryInput, getBusinessTodayIsoDate } from '../../../core/utils/isoDate';
import {
  PurchaseOrderError,
  applyOrderToInventory,
  getActiveOrders,
  receiveOrderById,
  type InventoryStock,
  type PurchaseOrder,
} from '../../../core/domain/purchasing/orders';

export interface PurchaseOrdersPanelProps {
  /** Todas las órdenes; el panel muestra solo las activas. */
  orders: readonly PurchaseOrder[];
  /** Existencias actuales, usadas para mostrar el efecto de la recepción. */
  inventory: InventoryStock;
  /** Se llama una vez confirmada la recepción, con el estado ya actualizado. */
  onReceived: (next: {
    orderId: string;
    orders: PurchaseOrder[];
    inventory: InventoryStock;
    /**
     * Vencimiento del lote que llegó, por itemId (YYYY-MM-DD). Solo trae los ítems
     * para los que la persona escribió una fecha; sin fechas es `undefined`.
     */
    expiryByItem?: Readonly<Record<string, IsoDateString>>;
  }) => void;
  /** Nombres legibles por itemId. Si falta, se muestra el itemId. */
  itemLabels?: Readonly<Record<string, string>>;
  /** Locale para fechas y números. Por defecto 'es-CO'. */
  locale?: string;
}

type Feedback = { kind: 'ok' | 'error'; text: string };

interface ItemLine {
  itemId: string;
  quantity: number;
  before: number;
  after: number;
}

const STYLES = `
.po-panel{
  --po-bg:#f6f7f9;--po-surface:#ffffff;--po-ink:#1c2430;--po-muted:#5b6675;
  --po-line:#dde2e8;--po-accent:#0f6e8c;--po-accent-ink:#ffffff;
  --po-ok:#1f7a4d;--po-ok-bg:#e4f4ea;--po-warn:#8a5a00;--po-warn-bg:#fbefd5;
  --po-info:#0f5d78;--po-info-bg:#dff0f6;--po-err:#a3261f;--po-err-bg:#fbe6e4;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  color:var(--po-ink);background:var(--po-bg);border:1px solid var(--po-line);
  border-radius:12px;padding:20px;max-width:880px;box-sizing:border-box;
}
@media (prefers-color-scheme:dark){
  .po-panel{
    --po-bg:#12171d;--po-surface:#1a212a;--po-ink:#e8edf2;--po-muted:#9aa6b4;
    --po-line:#2b3541;--po-accent:#5cc0e0;--po-accent-ink:#0b1a21;
    --po-ok:#7fd6a4;--po-ok-bg:#16301f;--po-warn:#f0c46a;--po-warn-bg:#3a2d0f;
    --po-info:#8fd3ea;--po-info-bg:#12303b;--po-err:#ff9b94;--po-err-bg:#3d1816;
  }
}
.po-panel *,.po-panel *::before,.po-panel *::after{box-sizing:border-box}
.po-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 14px}
.po-title{font-size:1.25rem;line-height:1.2;font-weight:650;margin:0;letter-spacing:-0.01em}
.po-count{font-size:.875rem;color:var(--po-muted);font-variant-numeric:tabular-nums}
.po-feedback{margin:0 0 12px;padding:10px 12px;border-radius:8px;font-size:.9rem;line-height:1.4}
.po-feedback[data-kind="ok"]{background:var(--po-ok-bg);color:var(--po-ok)}
.po-feedback[data-kind="error"]{background:var(--po-err-bg);color:var(--po-err)}
.po-list{list-style:none;margin:0;padding:0;background:var(--po-surface);border:1px solid var(--po-line);border-radius:10px;overflow:hidden}
.po-item+.po-item{border-top:1px solid var(--po-line)}
.po-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px;padding:12px 14px}
.po-toggle{all:unset;box-sizing:border-box;display:block;min-width:0;cursor:pointer;border-radius:6px;padding:2px 4px;margin:-2px -4px}
.po-toggle:focus-visible,.po-btn:focus-visible{outline:2px solid var(--po-accent);outline-offset:2px}
.po-order-id{display:block;font-weight:600;font-size:1rem;overflow-wrap:anywhere}
.po-meta{display:block;margin-top:2px;font-size:.85rem;color:var(--po-muted);font-variant-numeric:tabular-nums}
.po-badge{font-size:.8rem;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap}
.po-badge[data-status="Pendiente"]{background:var(--po-warn-bg);color:var(--po-warn)}
.po-badge[data-status="Enviada"]{background:var(--po-info-bg);color:var(--po-info)}
.po-btn{font:inherit;font-size:.9rem;font-weight:600;padding:8px 14px;border-radius:8px;cursor:pointer;
  border:1px solid var(--po-accent);background:var(--po-accent);color:var(--po-accent-ink);min-height:40px}
.po-btn:hover{filter:brightness(1.07)}
.po-btn[data-variant="ghost"]{background:transparent;color:var(--po-accent)}
.po-detail{padding:0 14px 14px}
.po-lines{width:100%;border-collapse:collapse;font-size:.9rem;font-variant-numeric:tabular-nums}
.po-lines caption{text-align:left;color:var(--po-muted);font-size:.85rem;padding:0 0 6px}
.po-lines th,.po-lines td{text-align:right;padding:6px 8px;border-top:1px solid var(--po-line)}
.po-lines th:first-child,.po-lines td:first-child{text-align:left;padding-left:0}
.po-lines thead th{font-weight:600;color:var(--po-muted);border-top:0}
.po-confirm{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;
  margin:0 14px 14px;padding:10px 12px;border:1px solid var(--po-accent);border-radius:8px;background:var(--po-info-bg)}
.po-confirm p{margin:0;font-size:.9rem;line-height:1.4}
.po-expiry{flex:1 1 100%;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.po-expiry-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.po-expiry-field label{font-size:.85rem;font-weight:600;overflow-wrap:anywhere}
.po-expiry-field input{font:inherit;font-size:.9rem;min-height:40px;padding:6px 10px;border-radius:8px;
  border:1px solid var(--po-line);background:var(--po-surface);color:var(--po-ink)}
.po-expiry-field input:focus-visible{outline:2px solid var(--po-accent);outline-offset:2px}
.po-confirm-actions{display:flex;gap:8px}
.po-empty{background:var(--po-surface);border:1px dashed var(--po-line);border-radius:10px;padding:28px 16px;text-align:center;color:var(--po-muted)}
.po-empty strong{display:block;color:var(--po-ink);margin-bottom:4px}
@media (max-width:560px){
  .po-row{grid-template-columns:minmax(0,1fr) auto}
  .po-row .po-btn{grid-column:1 / -1;width:100%}
}
@media (prefers-reduced-motion:no-preference){
  .po-btn{transition:filter .12s ease}
}
`;

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

function totalUnits(order: PurchaseOrder): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

/** Total en dinero solo si todos los ítems traen costo unitario. */
function totalCost(order: PurchaseOrder): number | undefined {
  let total = 0;
  for (const item of order.items) {
    if (item.unitCost === undefined) return undefined;
    total += item.quantity * item.unitCost;
  }
  return total;
}

function buildLines(order: PurchaseOrder, inventory: InventoryStock): ItemLine[] {
  const quantities = new Map<string, number>();
  for (const item of order.items) {
    quantities.set(item.itemId, (quantities.get(item.itemId) ?? 0) + item.quantity);
  }
  const after = applyOrderToInventory(inventory, order.items);
  return Array.from(quantities, ([itemId, quantity]) => ({
    itemId,
    quantity,
    before: inventory[itemId] ?? 0,
    after: after[itemId] ?? 0,
  }));
}

function pluralUnits(n: number, locale: string): string {
  const formatted = n.toLocaleString(locale);
  return n === 1 ? `${formatted} unidad` : `${formatted} unidades`;
}

export function PurchaseOrdersPanel({
  orders,
  inventory,
  onReceived,
  itemLabels,
  locale = 'es-CO',
}: PurchaseOrdersPanelProps) {
  const uid = useId();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  /** Vencimientos escritos para la orden que se está confirmando (itemId -> texto del input). */
  const [expiryDrafts, setExpiryDrafts] = useState<Readonly<Record<string, string>>>({});

  const activeOrders = useMemo(() => getActiveOrders(orders), [orders]);

  const labelFor = (itemId: string): string => itemLabels?.[itemId] ?? itemId;

  const toggleExpanded = (orderId: string) => {
    setExpandedId((current) => (current === orderId ? null : orderId));
  };

  const startReceive = (orderId: string) => {
    setFeedback(null);
    setExpandedId(orderId);
    setExpiryDrafts({});
    setConfirmingId(orderId);
  };

  const confirmReceive = (order: PurchaseOrder) => {
    const units = totalUnits(order);

    // Vencimientos (opcionales): se validan ANTES de recibir. Si alguno está mal,
    // la confirmación sigue abierta para corregirlo y no se mueve inventario.
    const today = getBusinessTodayIsoDate();
    const expiryByItem: Record<string, IsoDateString> = {};
    for (const itemId of new Set(order.items.map((item) => item.itemId))) {
      const check = checkExpiryInput(expiryDrafts[itemId] ?? '', { today });
      if (!check.ok) {
        setFeedback({ kind: 'error', text: `${labelFor(itemId)}: ${check.message}` });
        return;
      }
      if (check.value !== undefined) expiryByItem[itemId] = check.value;
    }

    try {
      const next = receiveOrderById(orders, order.id, inventory);
      onReceived({
        orderId: order.id,
        ...next,
        ...(Object.keys(expiryByItem).length > 0 ? { expiryByItem } : {}),
      });
      setConfirmingId(null);
      setExpiryDrafts({});
      setFeedback({
        kind: 'ok',
        text: `Orden ${order.id} recibida. Se sumaron ${pluralUnits(units, locale)} al inventario.`,
      });
    } catch (error) {
      setConfirmingId(null);
      setFeedback({
        kind: 'error',
        text:
          error instanceof PurchaseOrderError
            ? error.message
            : 'No se pudo registrar la recepción. Revisa la orden e inténtalo de nuevo.',
      });
    }
  };

  return (
    <section className="po-panel" aria-labelledby={`${uid}-title`}>
      <style>{STYLES}</style>

      <div className="po-head">
        <h2 className="po-title" id={`${uid}-title`}>
          Órdenes abiertas
        </h2>
        <span className="po-count">
          {activeOrders.length === 1 ? '1 por recibir' : `${activeOrders.length} por recibir`}
        </span>
      </div>

      <div role="status" aria-live="polite">
        {feedback ? (
          <p className="po-feedback" data-kind={feedback.kind}>
            {feedback.text}
          </p>
        ) : null}
      </div>

      {activeOrders.length === 0 ? (
        <div className="po-empty">
          <strong>No hay órdenes abiertas</strong>
          Las órdenes pendientes o enviadas aparecerán aquí hasta que las recibas.
        </div>
      ) : (
        <ul className="po-list">
          {activeOrders.map((order) => {
            const detailId = `${uid}-detail-${order.id}`;
            const expanded = expandedId === order.id;
            const confirming = confirmingId === order.id;
            const units = totalUnits(order);
            const cost = totalCost(order);
            const lines = expanded ? buildLines(order, inventory) : [];

            return (
              <li className="po-item" key={order.id}>
                <div className="po-row">
                  <button
                    type="button"
                    className="po-toggle"
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    onClick={() => toggleExpanded(order.id)}
                  >
                    <span className="po-order-id">Orden {order.id}</span>
                    <span className="po-meta">
                      {order.supplierId ? `Proveedor ${order.supplierId}, ` : ''}
                      creada el {formatDate(order.createdAt, locale)}, {pluralUnits(units, locale)}
                      {cost !== undefined
                        ? `, total ${cost.toLocaleString(locale, { maximumFractionDigits: 2 })}`
                        : ''}
                    </span>
                  </button>

                  <span className="po-badge" data-status={order.status}>
                    {order.status}
                  </span>

                  <button
                    type="button"
                    className="po-btn"
                    disabled={confirming}
                    onClick={() => startReceive(order.id)}
                  >
                    Marcar como recibida
                  </button>
                </div>

                {confirming ? (
                  <div className="po-confirm" role="group" aria-label={`Confirmar recepción de la orden ${order.id}`}>
                    <p>
                      Se sumarán {pluralUnits(units, locale)} al inventario. Esta acción no se puede repetir.
                    </p>
                    <div className="po-expiry">
                      {Array.from(new Set(order.items.map((item) => item.itemId))).map((itemId) => (
                        <div className="po-expiry-field" key={itemId}>
                          <label htmlFor={`${uid}-exp-${order.id}-${itemId}`}>
                            Vencimiento de {labelFor(itemId)} (opcional)
                          </label>
                          <input
                            id={`${uid}-exp-${order.id}-${itemId}`}
                            type="date"
                            min={getBusinessTodayIsoDate()}
                            value={expiryDrafts[itemId] ?? ''}
                            onChange={(event) => {
                              const value = event.target.value;
                              setExpiryDrafts((current) => ({ ...current, [itemId]: value }));
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="po-confirm-actions">
                      <button type="button" className="po-btn" onClick={() => confirmReceive(order)}>
                        Confirmar recepción
                      </button>
                      <button
                        type="button"
                        className="po-btn"
                        data-variant="ghost"
                        onClick={() => {
                          setConfirmingId(null);
                          setExpiryDrafts({});
                        }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="po-detail" id={detailId} hidden={!expanded}>
                  {expanded ? (
                    order.items.length === 0 ? (
                      <p className="po-meta">Esta orden no tiene ítems.</p>
                    ) : (
                      <table className="po-lines">
                        <caption>Efecto en el inventario al recibir</caption>
                        <thead>
                          <tr>
                            <th scope="col">Ítem</th>
                            <th scope="col">Pedido</th>
                            <th scope="col">Stock actual</th>
                            <th scope="col">Stock después</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((line) => (
                            <tr key={line.itemId}>
                              <th scope="row">{labelFor(line.itemId)}</th>
                              <td>{line.quantity.toLocaleString(locale)}</td>
                              <td>{line.before.toLocaleString(locale)}</td>
                              <td>{line.after.toLocaleString(locale)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default PurchaseOrdersPanel;