// src/presentation/components/waiter/TableManageSheet.tsx
/* ===========================================================================
   Gestión y cierre de mesa (Parte 4)
   ---------------------------------------------------------------------------
   Se abre al tocar una mesa con cuenta abierta ("Gestionar"). Es el punto de
   partida rápido del mesero, con las tres cosas que necesita al volver a una
   mesa activa:

     1. Ver el detalle de la cuenta completa (solo lectura, sin salir).
     2. Pre-cuenta: imprimirla o verla en pantalla para mostrarla al cliente.
     3. Seguir atendiendo: agregar más productos, o cobrar (al pagar, la mesa
        queda libre).

   Reglas de seguridad:
     - Nada de dinero aquí: cobrar abre el MISMO CloseTableDialog de siempre
       (turno de caja, roles, cobro digital, modo sin conexión). Este archivo
       no duplica ninguna regla de cobro.
     - La pre-cuenta se arma con la mesa RECIÉN leída del servidor, no con lo
       que se veía en pantalla: si otro dispositivo agregó o cobró algo,
       el cliente no recibe una cuenta vieja.
     - Pedir la pre-cuenta pasa la mesa a "Por cobrar" (igual que "Solicitar
       cuenta" del panel completo). Si ya está por cobrar o cobrándose, no se
       vuelve a escribir. Si esa marca falla, la pre-cuenta igual sale: el
       cliente no debe esperar por un error de sincronización.
     - Liberar solo existe para mesas SIN consumo; con consumo la mesa se
       libera al cobrar (o cancelando el pedido en el panel completo, que
       pide motivo y avisa a cocina). Nunca se borra una cuenta en silencio.
     - Los permisos de pantalla solo evitan ofrecer lo que el servidor va a
       rechazar; el servidor sigue siendo la autoridad.
   =========================================================================== */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  DoorOpen,
  Eye,
  ListChecks,
  Loader2,
  Plus,
  Printer,
  Receipt,
  Users,
  Wallet,
  X
} from "lucide-react";

import type { Product, Table } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { isOptimisticLockError } from "../../../core/errors/OptimisticLockError";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { canChargeTables } from "../../../core/config/tableChargeRoles";
import {
  buildPreBill,
  getManageActions,
  isBillRequested,
  isTableOpen,
  shouldMarkBillRequested,
  type ManageActionState
} from "../../../core/services/tableBill";
import { businessStore } from "../../../core/store/businessStore";
import { printSettingsStore } from "../../../core/store/printSettingsStore";
import { toast } from "../../../core/store/toastStore";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { useAuth } from "../../context/AuthContext";
import {
  openPreBillWindow,
  renderPreBillDocument,
  writePreBillDocument,
  type PreBillMode
} from "../../utils/printPreBillDocument";
import { STATUS_STYLES } from "./TableGrid";

interface Props {
  table: Table;
  products: Product[];
  /** Nombre del mesero que atiende la mesa (sale impreso en la pre-cuenta). */
  waiterName?: string;
  onClose: () => void;
  /** Pide a la pantalla de mesas que vuelva a leer las mesas. */
  onChanged: () => void;
  /** Abre la toma de pedido rápida para agregar más productos. */
  onAddProducts: () => void;
  /** Abre el panel completo (editar líneas, unir, transferir, dividir, cancelar…). */
  onOpenFullPanel: () => void;
  /** Abre el panel completo directo en el cobro. */
  onCharge: () => void;
  /** La mesa quedó libre desde aquí (estaba sin consumo). */
  onReleased: () => void;
}

export function TableManageSheet({
  table,
  products,
  waiterName,
  onClose,
  onChanged,
  onAddProducts,
  onOpenFullPanel,
  onCharge,
  onReleased
}: Props) {
  const { role } = useAuth();
  const { money, currency } = useTranslation();
  const canCharge = canChargeTables(role?.id);

  const [showDetail, setShowDetail] = useState(false);
  const [busy, setBusy] = useState<PreBillMode | "release" | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Para no avisar "ya no tiene cuenta" cuando la liberamos nosotros mismos.
  const releasedByUsRef = useRef(false);

  const actions = useMemo(() => getManageActions(table, { canCharge }), [table, canCharge]);

  const productNames = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((product) => map.set(product.id, product.name));
    return map;
  }, [products]);
  const nameOf = (productId: string) => productNames.get(productId);

  const statusStyle = STATUS_STYLES[table.status];
  const StatusIcon = statusStyle.icon;
  const units = table.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const minutesOpen = table.openedAt
    ? Math.max(0, Math.floor((Date.now() - table.openedAt.getTime()) / 60000))
    : null;

  /* Si otra persona cobró o liberó la mesa mientras esta hoja estaba abierta. */
  useEffect(() => {
    if (isTableOpen(table.status) || releasedByUsRef.current) return;
    toast.info(`${table.name} ya no tiene una cuenta abierta.`);
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.status]);

  /* Esc cierra la hoja. */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /* ------------------------------ pre-cuenta ------------------------------ */

  async function handlePreBill(mode: PreBillMode) {
    if (busy || !actions.preBill.enabled) return;

    // 1) La ventana se abre YA (dentro del toque): después de un `await` el navegador la bloquearía.
    const win = openPreBillWindow(mode);
    if (!win) {
      toast.error(
        "El navegador bloqueó la ventana de la pre-cuenta. Habilita las ventanas emergentes para este sitio e intenta de nuevo."
      );
      return;
    }

    setBusy(mode);
    setErrorMsg(null);

    try {
      const engine = container.tableEngine.get();

      // 2) Datos frescos: la cuenta que ve el cliente es la que está en el servidor ahora.
      let fresh: Table | null = null;
      try {
        fresh = await engine.getTable(table.id);
      } catch {
        // Sin conexión: lo último que sabemos de la mesa (se mantiene al día en vivo).
        fresh = table;
      }

      if (!fresh || !isTableOpen(fresh.status)) {
        throw new Error("TABLE_NOT_OPEN: la mesa ya no tiene una cuenta abierta (puede que otra persona la haya cobrado)");
      }
      if (fresh.items.length === 0) {
        throw new Error("La mesa no tiene productos todavía: no hay nada que mostrar en la pre-cuenta.");
      }

      // 3) Marcar "Por cobrar". Si falla, la pre-cuenta igual sale (se avisa al final).
      let marked = true;
      if (shouldMarkBillRequested(fresh.status)) {
        try {
          await engine.requestBill(fresh.id);
        } catch (err) {
          marked = false;
          if (isOptimisticLockError(err)) onChanged();
        }
      }

      // 4) Documento final.
      const preBill = buildPreBill(fresh, nameOf, { waiterName });
      const html = renderPreBillDocument(
        preBill,
        businessStore.get(),
        printSettingsStore.get(),
        currency,
        mode
      );
      writePreBillDocument(win, html);

      if (marked) {
        toast.success(mode === "print" ? "Pre-cuenta enviada a imprimir." : "Pre-cuenta lista para revisar.");
      } else {
        toast.warning(
          "La pre-cuenta salió, pero no se pudo marcar la mesa como «Por cobrar». Inténtalo de nuevo cuando haya conexión."
        );
      }
      onChanged();
    } catch (err) {
      win.close();
      setErrorMsg(translateBusinessError(err, "No se pudo generar la pre-cuenta."));
      if (isOptimisticLockError(err)) onChanged();
    } finally {
      setBusy(null);
    }
  }

  /* ----------------------------- liberar (vacía) -------------------------- */

  async function handleRelease() {
    if (busy || !actions.release.enabled) return;
    setBusy("release");
    setErrorMsg(null);
    try {
      releasedByUsRef.current = true;
      await container.tableEngine.get().releaseEmptyTable(table.id);
      toast.success(`${table.name} quedó libre.`);
      onChanged();
      onReleased();
    } catch (err) {
      releasedByUsRef.current = false;
      setConfirmRelease(false);
      setErrorMsg(translateBusinessError(err, "No se pudo liberar la mesa."));
      if (isOptimisticLockError(err)) onChanged();
    } finally {
      setBusy(null);
    }
  }

  /* --------------------------------- vistas -------------------------------- */

  function renderReason(state: ManageActionState, id: string) {
    if (state.enabled || !state.reason) return null;
    return (
      <p id={id} className="mt-1.5 text-vimdy-text-secondary text-vimdy-micro leading-snug">
        {state.reason}
      </p>
    );
  }

  const billAlreadyRequested = isBillRequested(table.status);

  return (
    <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-table-title"
        className="w-full sm:max-w-lg max-h-[96vh] sm:max-h-[92vh] rounded-t-3xl sm:rounded-vimdy-xl bg-vimdy-surface border border-vimdy-border shadow-vimdy-lg flex flex-col overflow-hidden"
      >
        {/* Encabezado */}
        <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-vimdy-border flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 id="manage-table-title" className="text-vimdy-text font-black text-2xl leading-tight whitespace-nowrap">
                {table.name}
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-vimdy-micro font-bold ${statusStyle.pill}`}
              >
                <StatusIcon size={13} aria-hidden="true" />
                {statusStyle.label}
              </span>
            </div>
            <p className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-vimdy-text-secondary text-vimdy-micro">
              <span className="inline-flex items-center gap-1.5">
                <Users size={13} aria-hidden="true" />
                {table.peopleCount} {table.peopleCount === 1 ? "persona" : "personas"}
              </span>
              {minutesOpen !== null && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={13} aria-hidden="true" />
                  {minutesOpen} min
                </span>
              )}
              {waiterName && <span>Atiende {waiterName}</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Volver a las mesas"
            className="w-11 h-11 shrink-0 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface text-vimdy-text-secondary hover:text-vimdy-text flex items-center justify-center transition-colors"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {errorMsg && (
            <div
              role="alert"
              className="rounded-vimdy-md bg-vimdy-danger-bg border border-vimdy-danger/40 text-vimdy-danger-hover px-4 py-3 text-vimdy-small"
            >
              {errorMsg}
            </div>
          )}

          {/* 1. Cuenta */}
          <section aria-label="Cuenta de la mesa" className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-background">
            <div className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-vimdy-text-secondary text-vimdy-micro">
                  {units} {units === 1 ? "producto" : "productos"}
                </p>
                <p className="text-vimdy-text font-black text-3xl tabular-nums leading-tight">{money(table.total)}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDetail((value) => !value)}
                aria-expanded={showDetail}
                aria-controls="manage-account-detail"
                className="h-11 px-4 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface text-vimdy-text text-vimdy-small font-semibold inline-flex items-center gap-2 hover:bg-vimdy-surface-hover transition-colors"
              >
                <ListChecks size={18} aria-hidden="true" />
                {showDetail ? "Ocultar cuenta" : "Ver cuenta"}
                {showDetail ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              </button>
            </div>

            {showDetail && (
              <div id="manage-account-detail" className="border-t border-vimdy-border p-4">
                {table.items.length === 0 ? (
                  <p className="text-vimdy-text-secondary text-vimdy-small text-center py-3">
                    Todavía no hay productos en esta cuenta.
                  </p>
                ) : (
                  <ul className="divide-y divide-vimdy-border">
                    {table.items.map((item, index) => (
                      <li key={`${item.productId}-${index}`} className="py-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-vimdy-text text-vimdy-small font-semibold leading-tight">
                            <span className="tabular-nums">{item.quantity}</span> × {nameOf(item.productId) ?? "Producto"}
                          </p>
                          {item.note && (
                            <p className="text-vimdy-warning-hover text-vimdy-micro mt-0.5 leading-snug break-words">
                              {item.note}
                            </p>
                          )}
                          <p className="text-vimdy-text-secondary text-vimdy-micro mt-0.5 tabular-nums">
                            {money(item.price)} c/u
                          </p>
                        </div>
                        <p className="text-vimdy-text text-vimdy-small font-bold tabular-nums shrink-0">
                          {money(item.price * item.quantity)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                <dl className="mt-3 pt-3 border-t border-vimdy-border space-y-1 text-vimdy-small">
                  <div className="flex justify-between text-vimdy-text-secondary">
                    <dt>Subtotal</dt>
                    <dd className="tabular-nums">{money(table.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between text-vimdy-text-secondary">
                    <dt>Impuestos</dt>
                    <dd className="tabular-nums">{money(table.tax)}</dd>
                  </div>
                  {table.discount > 0 && (
                    <div className="flex justify-between text-vimdy-text-secondary">
                      <dt>Descuento</dt>
                      <dd className="tabular-nums">-{money(table.discount)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between text-vimdy-text font-bold text-vimdy-body pt-1">
                    <dt>Total</dt>
                    <dd className="tabular-nums">{money(table.total)}</dd>
                  </div>
                </dl>

                <button
                  type="button"
                  onClick={onOpenFullPanel}
                  className="mt-3 w-full h-11 rounded-vimdy-md border border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text text-vimdy-small font-semibold transition-colors"
                >
                  Editar, dividir o unir en el panel completo
                </button>
              </div>
            )}
          </section>

          {/* 2. Pre-cuenta */}
          <section aria-label="Pre-cuenta" className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-background p-4">
            <div className="flex items-center gap-2">
              <Receipt size={18} className="text-vimdy-text-secondary" aria-hidden="true" />
              <h3 className="text-vimdy-text font-bold text-vimdy-body">Pre-cuenta</h3>
            </div>
            <p className="text-vimdy-text-secondary text-vimdy-micro mt-1 leading-snug">
              {billAlreadyRequested
                ? "Ya se pidió la cuenta: la mesa está en «Por cobrar». Puedes volver a imprimirla."
                : "Para mostrarle al cliente antes de cobrar. Al generarla, la mesa pasa a «Por cobrar»."}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={!actions.preBill.enabled || busy !== null}
                onClick={() => void handlePreBill("print")}
                aria-describedby={actions.preBill.enabled ? undefined : "manage-prebill-reason"}
                className="h-12 rounded-vimdy-md bg-vimdy-accent text-white text-vimdy-small font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98] transition"
              >
                {busy === "print" ? (
                  <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Printer size={18} aria-hidden="true" />
                )}
                Imprimir
              </button>
              <button
                type="button"
                disabled={!actions.preBill.enabled || busy !== null}
                onClick={() => void handlePreBill("preview")}
                aria-describedby={actions.preBill.enabled ? undefined : "manage-prebill-reason"}
                className="h-12 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface text-vimdy-text text-vimdy-small font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98] transition"
              >
                {busy === "preview" ? (
                  <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
                Vista previa
              </button>
            </div>
            {renderReason(actions.preBill, "manage-prebill-reason")}
          </section>

          {/* 3. Seguir atendiendo / cerrar */}
          <section aria-label="Seguir atendiendo o cerrar" className="space-y-2.5">
            <div>
              <button
                type="button"
                disabled={!actions.addProducts.enabled || busy !== null}
                onClick={onAddProducts}
                aria-describedby={actions.addProducts.enabled ? undefined : "manage-add-reason"}
                className="w-full h-14 rounded-vimdy-md border border-vimdy-border bg-vimdy-background text-vimdy-text text-vimdy-body font-bold inline-flex items-center justify-center gap-2 hover:border-vimdy-accent/60 disabled:opacity-40 active:scale-[0.98] transition"
              >
                <Plus size={20} aria-hidden="true" />
                Agregar más productos
              </button>
              {renderReason(actions.addProducts, "manage-add-reason")}
            </div>

            <div>
              <button
                type="button"
                disabled={!actions.charge.enabled || busy !== null}
                onClick={onCharge}
                aria-describedby={actions.charge.enabled ? undefined : "manage-charge-reason"}
                className="w-full h-14 rounded-vimdy-md bg-vimdy-accent text-white text-vimdy-body font-black inline-flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98] transition"
              >
                <Wallet size={20} aria-hidden="true" />
                Cobrar y liberar mesa
              </button>
              {actions.charge.enabled ? (
                <p className="mt-1.5 text-vimdy-text-secondary text-vimdy-micro leading-snug">
                  Al confirmar el pago, {table.name} queda libre para el siguiente cliente.
                </p>
              ) : (
                renderReason(actions.charge, "manage-charge-reason")
              )}
            </div>

            {/* Solo mesas sin consumo: con consumo se libera al cobrar. */}
            {actions.release.enabled && (
              <div className="pt-1">
                {!confirmRelease ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setConfirmRelease(true)}
                    className="w-full h-12 rounded-vimdy-md border-2 border-vimdy-danger/50 bg-vimdy-danger-bg text-vimdy-danger-hover text-vimdy-small font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40 transition"
                  >
                    <DoorOpen size={18} aria-hidden="true" />
                    Liberar mesa sin consumo
                  </button>
                ) : (
                  <div className="rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg p-3">
                    <p className="text-vimdy-text text-vimdy-small font-semibold">
                      ¿Liberar {table.name}? No tiene consumo y quedará disponible.
                    </p>
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => setConfirmRelease(false)}
                        className="h-11 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface text-vimdy-text text-vimdy-small font-semibold"
                      >
                        No, volver
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void handleRelease()}
                        className="h-11 rounded-vimdy-md bg-vimdy-danger text-white text-vimdy-small font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40"
                      >
                        {busy === "release" && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                        Sí, liberar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}