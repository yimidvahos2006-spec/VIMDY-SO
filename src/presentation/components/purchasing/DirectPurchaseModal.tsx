import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { IsoDateString } from '../../../core/entities/Entities';
import { checkExpiryInput, getBusinessTodayIsoDate } from '../../../core/utils/isoDate';

/* ------------------------------------------------------------------ */
/* Tipos públicos                                                      */
/* ------------------------------------------------------------------ */

export interface DirectPurchaseSupplierOption {
  readonly id: string;
  readonly name: string;
}

export interface DirectPurchaseItemOption {
  readonly id: string;
  readonly name: string;
  /** Unidad de medida para mostrar junto a la cantidad (kg, L, und...). */
  readonly unit?: string;
  /** Último costo unitario conocido; se sugiere al elegir el ítem. */
  readonly lastUnitCost?: number;
  /**
   * Si es true, la fecha de vencimiento es OBLIGATORIA para este ítem (perecederos).
   * Por defecto es opcional: hoy el producto no trae una marca de "perecedero", así
   * que quien arme la lista decide cuáles la exigen.
   */
  readonly expiryRequired?: boolean;
}

export interface DirectPurchaseLine {
  readonly itemId: string;
  readonly itemName: string;
  readonly quantity: number;
  readonly unitCost: number;
  /** quantity * unitCost, redondeado a 2 decimales. */
  readonly lineTotal: number;
  /** Vencimiento del lote comprado (YYYY-MM-DD). Solo presente si se informó. */
  readonly expiresAt?: IsoDateString;
}

/**
 * Datos entregados al guardar. Están pensados para que quien los reciba
 * pueda, sin recalcular nada:
 *  - sumar `stockIncrements[itemId]` al stock de cada insumo, y
 *  - reemplazar el costo unitario de cada insumo por `unitCostUpdates[itemId]`
 *    (el costo pagado en esta compra).
 */
export interface DirectPurchasePayload {
  readonly supplierId: string;
  readonly supplierName: string;
  /** Solo presente si la persona escribió un número de factura. */
  readonly invoiceNumber?: string;
  /** Fecha y hora del guardado, en ISO 8601. */
  readonly purchasedAt: string;
  readonly lines: readonly DirectPurchaseLine[];
  readonly total: number;
  readonly stockIncrements: Readonly<Record<string, number>>;
  readonly unitCostUpdates: Readonly<Record<string, number>>;
}

export interface DirectPurchaseModalProps {
  readonly isOpen: boolean;
  /** Se llama al cancelar, al cerrar con Escape y tras guardar con éxito. */
  readonly onClose: () => void;
  /**
   * Recibe la compra validada. Puede ser asíncrona: mientras se resuelve, el
   * formulario queda bloqueado; si lanza un error, el modal sigue abierto y
   * muestra un aviso para reintentar.
   */
  readonly onSaveDirectPurchase: (payload: DirectPurchasePayload) => void | Promise<void>;
  readonly suppliers: readonly DirectPurchaseSupplierOption[];
  readonly items: readonly DirectPurchaseItemOption[];
  /** Locale para formatear números. Por defecto 'es-CO'. */
  readonly locale?: string;
  /** Código ISO 4217 de la moneda. Por defecto 'COP'. */
  readonly currency?: string;
}

/* ------------------------------------------------------------------ */
/* Tipos y utilidades internas                                         */
/* ------------------------------------------------------------------ */

interface LineDraft {
  readonly key: number;
  readonly itemId: string;
  /** Texto crudo del input, para permitir escritura parcial ("1."). */
  readonly quantity: string;
  readonly unitCost: string;
  /** Si la persona ya tocó el costo, no se vuelve a sugerir uno. */
  readonly costEdited: boolean;
  /** Valor crudo del input type="date" (YYYY-MM-DD o vacío). */
  readonly expiresAt: string;
}

interface LineErrors {
  item?: string;
  quantity?: string;
  unitCost?: string;
  expiresAt?: string;
}

interface Validation {
  supplier?: string;
  lines: ReadonlyMap<number, LineErrors>;
  hasErrors: boolean;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseAmount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function makeFormatter(locale: string, currency: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  } catch {
    // Locale o moneda inválidos: se cae a un formato numérico simple.
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  }
}

function validate(
  supplierId: string,
  lines: readonly LineDraft[],
  itemsById: ReadonlyMap<string, DirectPurchaseItemOption>,
  today: IsoDateString,
): Validation {
  const lineErrors = new Map<number, LineErrors>();
  let hasErrors = false;

  const supplier = supplierId === '' ? 'Selecciona un proveedor.' : undefined;
  if (supplier) hasErrors = true;

  for (const line of lines) {
    const errors: LineErrors = {};
    if (line.itemId === '' || !itemsById.has(line.itemId)) {
      errors.item = 'Selecciona un ítem.';
    }
    if (!isPositive(parseAmount(line.quantity))) {
      errors.quantity = 'Ingresa una cantidad mayor a 0.';
    }
    if (!isPositive(parseAmount(line.unitCost))) {
      errors.unitCost = 'Ingresa un costo mayor a 0.';
    }
    const expiry = checkExpiryInput(line.expiresAt, {
      required: itemsById.get(line.itemId)?.expiryRequired === true,
      today,
    });
    if (!expiry.ok) {
      errors.expiresAt = expiry.message;
    }
    if (errors.item || errors.quantity || errors.unitCost || errors.expiresAt) {
      hasErrors = true;
      lineErrors.set(line.key, errors);
    }
  }

  const result: Validation = { lines: lineErrors, hasErrors };
  if (supplier) result.supplier = supplier;
  return result;
}

/* ------------------------------------------------------------------ */
/* Estilos                                                             */
/* ------------------------------------------------------------------ */

const STYLES = `
.dp-overlay{
  --dp-surface:#ffffff;--dp-subtle:#f6f7f9;--dp-ink:#1c2430;--dp-muted:#5b6675;
  --dp-line:#dde2e8;--dp-accent:#0f6e8c;--dp-accent-ink:#ffffff;
  --dp-err:#a3261f;--dp-err-bg:#fbe6e4;--dp-scrim:rgba(14,20,28,.55);
  position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;
  padding:16px;background:var(--dp-scrim);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  color:var(--dp-ink);
}
@media (prefers-color-scheme:dark){
  .dp-overlay{
    --dp-surface:#1a212a;--dp-subtle:#12171d;--dp-ink:#e8edf2;--dp-muted:#9aa6b4;
    --dp-line:#2b3541;--dp-accent:#5cc0e0;--dp-accent-ink:#0b1a21;
    --dp-err:#ff9b94;--dp-err-bg:#3d1816;--dp-scrim:rgba(0,0,0,.65);
  }
}
.dp-overlay *,.dp-overlay *::before,.dp-overlay *::after{box-sizing:border-box}
.dp-dialog{width:100%;max-width:760px;max-height:100%;display:flex;flex-direction:column;
  background:var(--dp-surface);border:1px solid var(--dp-line);border-radius:14px;overflow:hidden}
.dp-form{display:flex;flex-direction:column;min-height:0;flex:1 1 auto}
.dp-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px 12px}
.dp-title{margin:0;font-size:1.25rem;line-height:1.2;font-weight:650;letter-spacing:-0.01em}
.dp-sub{margin:4px 0 0;font-size:.9rem;color:var(--dp-muted);line-height:1.4}
.dp-x{font:inherit;font-size:1.4rem;line-height:1;width:40px;height:40px;border-radius:8px;border:1px solid transparent;
  background:transparent;color:var(--dp-muted);cursor:pointer;flex:none}
.dp-x:hover{background:var(--dp-subtle);color:var(--dp-ink)}
.dp-body{padding:4px 20px 16px;overflow-y:auto;flex:1 1 auto;min-height:0}
.dp-top{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px}
.dp-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.dp-label{font-size:.85rem;font-weight:600}
.dp-hint{font-weight:400;color:var(--dp-muted)}
.dp-input,.dp-select{font:inherit;font-size:.95rem;width:100%;min-height:42px;padding:8px 10px;border-radius:8px;
  border:1px solid var(--dp-line);background:var(--dp-subtle);color:var(--dp-ink)}
.dp-input[aria-invalid="true"],.dp-select[aria-invalid="true"]{border-color:var(--dp-err)}
.dp-input:focus-visible,.dp-select:focus-visible,.dp-btn:focus-visible,.dp-x:focus-visible,.dp-link:focus-visible{
  outline:2px solid var(--dp-accent);outline-offset:2px}
.dp-input:disabled,.dp-select:disabled{opacity:.6}
.dp-error{margin:0;font-size:.82rem;color:var(--dp-err);line-height:1.3}
.dp-note{margin:0;font-size:.82rem;color:var(--dp-muted);line-height:1.3}
.dp-items-title{margin:0 0 8px;font-size:1rem;font-weight:650}
.dp-lines{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.dp-line{padding:12px;border:1px solid var(--dp-line);border-radius:10px;background:var(--dp-surface)}
.dp-line-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto;
  gap:10px;align-items:start}
.dp-line-expiry{margin-top:10px;max-width:260px}
.dp-line-total{display:flex;flex-direction:column;gap:4px}
.dp-line-total .dp-amount{min-height:42px;display:flex;align-items:center;font-weight:600;font-variant-numeric:tabular-nums}
.dp-remove{align-self:end}
.dp-line-errors{display:flex;flex-direction:column;gap:2px;margin-top:8px}
.dp-link{font:inherit;font-size:.9rem;font-weight:600;padding:8px 10px;margin:-8px -10px;border:0;border-radius:6px;
  background:transparent;color:var(--dp-accent);cursor:pointer}
.dp-link:disabled{opacity:.5;cursor:not-allowed}
.dp-add{margin-top:12px;display:inline-block}
.dp-alert{margin:14px 0 0;padding:10px 12px;border-radius:8px;background:var(--dp-err-bg);color:var(--dp-err);font-size:.9rem;line-height:1.4}
.dp-footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;
  padding:14px 20px;border-top:1px solid var(--dp-line);background:var(--dp-subtle)}
.dp-total-label{font-size:.85rem;color:var(--dp-muted)}
.dp-total{font-size:1.4rem;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-0.01em}
.dp-actions{display:flex;gap:8px}
.dp-btn{font:inherit;font-size:.95rem;font-weight:600;padding:9px 16px;min-height:42px;border-radius:8px;cursor:pointer;
  border:1px solid var(--dp-accent);background:var(--dp-accent);color:var(--dp-accent-ink)}
.dp-btn[data-variant="ghost"]{background:transparent;color:var(--dp-accent)}
.dp-btn:disabled{opacity:.6;cursor:not-allowed}
@media (max-width:640px){
  .dp-overlay{padding:0;align-items:stretch}
  .dp-dialog{max-width:none;border-radius:0;border-width:0}
  .dp-top{grid-template-columns:1fr}
  .dp-line-grid{grid-template-columns:1fr 1fr}
  .dp-line-grid>.dp-field-item{grid-column:1 / -1}
  .dp-remove{grid-column:1 / -1;justify-self:start}
  .dp-actions{width:100%}
  .dp-actions .dp-btn{flex:1}
}
`;

/* ------------------------------------------------------------------ */
/* Componente                                                          */
/* ------------------------------------------------------------------ */

export function DirectPurchaseModal(props: DirectPurchaseModalProps) {
  // El formulario vive en un componente interno que solo existe mientras el
  // modal está abierto: así cada apertura empieza con el estado limpio.
  if (!props.isOpen) return null;
  return <DirectPurchaseForm {...props} />;
}

function DirectPurchaseForm({
  onClose,
  onSaveDirectPurchase,
  suppliers,
  items,
  locale = 'es-CO',
  currency = 'COP',
}: DirectPurchaseModalProps) {
  const uid = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const supplierRef = useRef<HTMLSelectElement>(null);
  const nextKey = useRef(2);

  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [lines, setLines] = useState<readonly LineDraft[]>([
    { key: 1, itemId: '', quantity: '', unitCost: '', costEdited: false, expiresAt: '' },
  ]);
  const [attempts, setAttempts] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const formatter = useMemo(() => makeFormatter(locale, currency), [locale, currency]);
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const today = useMemo(() => getBusinessTodayIsoDate(), []);
  const validation = useMemo(
    () => validate(supplierId, lines, itemsById, today),
    [supplierId, lines, itemsById, today],
  );
  const showErrors = attempts > 0;

  const lineTotals = useMemo(
    () =>
      lines.map((line) => {
        const quantity = parseAmount(line.quantity);
        const cost = parseAmount(line.unitCost);
        return isPositive(quantity) && isPositive(cost) ? round2(quantity * cost) : 0;
      }),
    [lines],
  );
  const total = useMemo(() => round2(lineTotals.reduce((sum, value) => sum + value, 0)), [lineTotals]);

  // Foco inicial, bloqueo de scroll del fondo y restauración del foco al cerrar.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    supplierRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);

  // Tras un intento fallido de guardar, lleva el foco al primer campo inválido.
  useEffect(() => {
    if (attempts === 0) return;
    dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempts]);

  const updateLine = (key: number, change: (line: LineDraft) => LineDraft) => {
    setLines((current) => current.map((line) => (line.key === key ? change(line) : line)));
  };

  const handleItemChange = (key: number, itemId: string) => {
    updateLine(key, (line) => {
      const suggested = itemsById.get(itemId)?.lastUnitCost;
      const unitCost = line.costEdited ? line.unitCost : suggested !== undefined ? String(suggested) : '';
      return { ...line, itemId, unitCost };
    });
  };

  const addLine = () => {
    const key = nextKey.current;
    nextKey.current += 1;
    setLines((current) => [
      ...current,
      { key, itemId: '', quantity: '', unitCost: '', costEdited: false, expiresAt: '' },
    ]);
  };

  const removeLine = (key: number) => {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!saving) onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaveError(null);

    if (validation.hasErrors) {
      setAttempts((count) => count + 1);
      return;
    }

    const supplier = suppliers.find((option) => option.id === supplierId);
    if (!supplier) {
      setAttempts((count) => count + 1);
      return;
    }

    const purchaseLines: DirectPurchaseLine[] = [];
    const stockIncrements: Record<string, number> = {};
    const unitCostUpdates: Record<string, number> = {};
    for (const line of lines) {
      const item = itemsById.get(line.itemId);
      if (!item) continue;
      const quantity = parseAmount(line.quantity);
      const unitCost = parseAmount(line.unitCost);
      const expiry = checkExpiryInput(line.expiresAt, {
        required: item.expiryRequired === true,
        today,
      });
      purchaseLines.push({
        itemId: item.id,
        itemName: item.name,
        quantity,
        unitCost,
        lineTotal: round2(quantity * unitCost),
        ...(expiry.ok && expiry.value !== undefined ? { expiresAt: expiry.value } : {}),
      });
      stockIncrements[item.id] = (stockIncrements[item.id] ?? 0) + quantity;
      unitCostUpdates[item.id] = unitCost;
    }

    const trimmedInvoice = invoiceNumber.trim();
    const payload: DirectPurchasePayload = {
      supplierId: supplier.id,
      supplierName: supplier.name,
      ...(trimmedInvoice !== '' ? { invoiceNumber: trimmedInvoice } : {}),
      purchasedAt: new Date().toISOString(),
      lines: purchaseLines,
      total: round2(purchaseLines.reduce((sum, line) => sum + line.lineTotal, 0)),
      stockIncrements,
      unitCostUpdates,
    };

    setSaving(true);
    try {
      await onSaveDirectPurchase(payload);
    } catch {
      setSaving(false);
      setSaveError('No se pudo guardar la compra. Revisa los datos e inténtalo de nuevo.');
      return;
    }
    onClose();
  };

  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const usedItemIds = new Set(lines.map((line) => line.itemId).filter((id) => id !== ''));

  return (
    <div className="dp-overlay">
      <style>{STYLES}</style>
      <div
        className="dp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        ref={dialogRef}
        onKeyDown={handleKeyDown}
      >
        <form className="dp-form" noValidate onSubmit={handleSubmit}>
          <div className="dp-header">
            <div>
              <h2 className="dp-title" id={titleId}>
                Compra directa
              </h2>
              <p className="dp-sub" id={descId}>
                Al guardar, se suma el stock de cada ítem y se actualiza su costo unitario.
              </p>
            </div>
            <button type="button" className="dp-x" aria-label="Cerrar" onClick={onClose} disabled={saving}>
              ×
            </button>
          </div>

          <div className="dp-body">
            <div className="dp-top">
              <div className="dp-field">
                <label className="dp-label" htmlFor={`${uid}-supplier`}>
                  Proveedor
                </label>
                <select
                  id={`${uid}-supplier`}
                  ref={supplierRef}
                  className="dp-select"
                  value={supplierId}
                  disabled={saving}
                  aria-invalid={showErrors && validation.supplier ? true : undefined}
                  aria-describedby={showErrors && validation.supplier ? `${uid}-supplier-err` : undefined}
                  onChange={(event) => setSupplierId(event.target.value)}
                >
                  <option value="">Selecciona un proveedor</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                {showErrors && validation.supplier ? (
                  <p className="dp-error" id={`${uid}-supplier-err`}>
                    {validation.supplier}
                  </p>
                ) : suppliers.length === 0 ? (
                  <p className="dp-note">
                    No hay proveedores disponibles. Registra uno para poder guardar la compra.
                  </p>
                ) : null}
              </div>

              <div className="dp-field">
                <label className="dp-label" htmlFor={`${uid}-invoice`}>
                  Número de factura <span className="dp-hint">(opcional)</span>
                </label>
                <input
                  id={`${uid}-invoice`}
                  className="dp-input"
                  type="text"
                  autoComplete="off"
                  value={invoiceNumber}
                  disabled={saving}
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                />
              </div>
            </div>

            <h3 className="dp-items-title">Ítems comprados</h3>
            <ul className="dp-lines">
              {lines.map((line, index) => {
                const errors = showErrors ? validation.lines.get(line.key) : undefined;
                const item = itemsById.get(line.itemId);
                const base = `${uid}-l${line.key}`;
                const position = index + 1;
                return (
                  <li className="dp-line" key={line.key}>
                    <div className="dp-line-grid">
                      <div className="dp-field dp-field-item">
                        <label className="dp-label" htmlFor={`${base}-item`}>
                          Ítem {position}
                        </label>
                        <select
                          id={`${base}-item`}
                          className="dp-select"
                          value={line.itemId}
                          disabled={saving}
                          aria-invalid={errors?.item ? true : undefined}
                          aria-describedby={errors ? `${base}-err` : undefined}
                          onChange={(event) => handleItemChange(line.key, event.target.value)}
                        >
                          <option value="">Selecciona un ítem</option>
                          {items.map((option) => (
                            <option
                              key={option.id}
                              value={option.id}
                              disabled={option.id !== line.itemId && usedItemIds.has(option.id)}
                            >
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="dp-field">
                        <label className="dp-label" htmlFor={`${base}-qty`}>
                          Cantidad{item?.unit ? <span className="dp-hint"> ({item.unit})</span> : null}
                        </label>
                        <input
                          id={`${base}-qty`}
                          className="dp-input"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={line.quantity}
                          disabled={saving}
                          aria-invalid={errors?.quantity ? true : undefined}
                          aria-describedby={errors ? `${base}-err` : undefined}
                          onChange={(event) => {
                            const quantity = event.target.value;
                            updateLine(line.key, (current) => ({ ...current, quantity }));
                          }}
                        />
                      </div>

                      <div className="dp-field">
                        <label className="dp-label" htmlFor={`${base}-cost`}>
                          Costo unitario
                        </label>
                        <input
                          id={`${base}-cost`}
                          className="dp-input"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={line.unitCost}
                          disabled={saving}
                          aria-invalid={errors?.unitCost ? true : undefined}
                          aria-describedby={errors ? `${base}-err` : undefined}
                          onChange={(event) => {
                            const unitCost = event.target.value;
                            updateLine(line.key, (current) => ({ ...current, unitCost, costEdited: true }));
                          }}
                        />
                      </div>

                      <div className="dp-line-total">
                        <span className="dp-label">Subtotal</span>
                        <span className="dp-amount">{formatter.format(lineTotals[index] ?? 0)}</span>
                      </div>

                      <button
                        type="button"
                        className="dp-link dp-remove"
                        disabled={saving || lines.length === 1}
                        aria-label={`Quitar ítem ${position}`}
                        onClick={() => removeLine(line.key)}
                      >
                        Quitar
                      </button>
                    </div>

                    <div className="dp-field dp-line-expiry">
                      <label className="dp-label" htmlFor={`${base}-exp`}>
                        Fecha de vencimiento
                        {item?.expiryRequired ? null : <span className="dp-hint"> (opcional)</span>}
                      </label>
                      <input
                        id={`${base}-exp`}
                        className="dp-input"
                        type="date"
                        min={today}
                        value={line.expiresAt}
                        disabled={saving}
                        aria-invalid={errors?.expiresAt ? true : undefined}
                        aria-describedby={errors ? `${base}-err` : undefined}
                        onChange={(event) => {
                          const expiresAt = event.target.value;
                          updateLine(line.key, (current) => ({ ...current, expiresAt }));
                        }}
                      />
                    </div>

                    {errors ? (
                      <div className="dp-line-errors" id={`${base}-err`}>
                        {errors.item ? <p className="dp-error">{errors.item}</p> : null}
                        {errors.quantity ? <p className="dp-error">{errors.quantity}</p> : null}
                        {errors.unitCost ? <p className="dp-error">{errors.unitCost}</p> : null}
                        {errors.expiresAt ? <p className="dp-error">{errors.expiresAt}</p> : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <button type="button" className="dp-link dp-add" disabled={saving} onClick={addLine}>
              Agregar ítem
            </button>

            {saveError ? (
              <p className="dp-alert" role="alert">
                {saveError}
              </p>
            ) : null}
          </div>

          <div className="dp-footer">
            <div>
              <div className="dp-total-label">Total de la compra</div>
              <div className="dp-total">{formatter.format(total)}</div>
            </div>
            <div className="dp-actions">
              <button type="button" className="dp-btn" data-variant="ghost" onClick={onClose} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className="dp-btn" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar compra'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default DirectPurchaseModal;