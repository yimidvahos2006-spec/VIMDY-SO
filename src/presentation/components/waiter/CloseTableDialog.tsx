import React, { useCallback, useEffect, useRef, useState } from "react";
import { Banknote, CreditCard, Smartphone, Landmark, Loader2, ExternalLink, CheckCircle2, XCircle } from "lucide-react";

import { Table, Sale } from "../../../core/entities/Entities";
import { PaymentMethod } from "../../../core/engines/PaymentEngine";
import type { Receipt } from "../../../core/engines/ReceiptEngine";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { useAuth } from "../../context/AuthContext";
import {
  canChargeTables,
  TABLE_CHARGE_FORBIDDEN_MESSAGE
} from "../../../core/config/tableChargeRoles";
import { productCatalogStore } from "../../../core/store/productCatalogStore";
import {
  assertShiftOpen,
  assertSubscriptionActive,
  printReceiptIfEnabled,
  syncDashboardAfterSale
} from "../../../core/services/checkout";
import { connectionStore } from "../../../core/store/connectionStore";
import { isNetworkFailure } from "../../../core/services/offlineSale";
import { queueCloseTableOffline } from "../../../core/services/offlineTable";
import {
  getTableWompiState,
  isTerminalTableWompiState,
  startTableWompiCheckout,
  type TableDigitalMethod,
  type TableWompiCheckout,
  type TableWompiState
} from "../../../core/services/tableWompiCheckout";

interface Props {
  table: Table;
  onClose: () => void;
  onClosed: () => void;
}

const METHODS: { id: PaymentMethod; title: string; icon: React.ElementType }[] = [
  { id: "CASH", title: "Efectivo", icon: Banknote },
  { id: "CARD", title: "Tarjeta", icon: CreditCard },
  { id: "TRANSFER", title: "Transferencia", icon: Smartphone },
  { id: "QR", title: "QR", icon: Landmark }
];

const POLL_MS = 3000;
const CONFIRM_RETRIES = 6;
const CONFIRM_RETRY_MS = 1500;

/** Sesión de cobro digital en curso (ventana de espera de Wompi). */
interface DigitalAttempt {
  readonly sale: Sale;
  readonly checkout: TableWompiCheckout;
  readonly method: TableDigitalMethod;
  readonly state: TableWompiState;
}

function isDigitalMethod(method: PaymentMethod): method is TableDigitalMethod {
  return method === "CARD" || method === "TRANSFER" || method === "QR";
}

/**
 * Solo una caída real de internet manda el cobro a la cola offline. Cualquier
 * otro error (pago rechazado, rol sin permiso, referencia faltante...) debe
 * verse en pantalla: antes se confundía con "sin conexión", la mesa quedaba
 * liberada en este dispositivo y el cobro nunca se registraba.
 */
function isConnectivityFailure(err: unknown): boolean {
  if (!connectionStore.isOnline()) return true;
  if (!isNetworkFailure(err)) return false;

  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out|econn|enotfound|err_internet|err_network/i.test(text);
}

function money(value: number): string {
  return `$${value.toLocaleString("es-CO")}`;
}

export function CloseTableDialog({ table, onClose, onClosed }: Props) {
  const { user, role } = useAuth();
  // Solo ADMIN, GERENTE y CAJERO cobran (misma lista que exige la base de datos).
  const canCharge = canChargeTables(role?.id);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [received, setReceived] = useState<number>(table.total);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [digital, setDigital] = useState<DigitalAttempt | null>(null);
  const [online, setOnline] = useState<boolean>(connectionStore.isOnline());

  // IDEMPOTENCIA (checklist crítico #4): id del intento de cobro de esta
  // mesa, generado una sola vez con el primer "Confirmar cobro" y
  // reutilizado en cada reintento (ej. si el datáfono se cae a mitad de
  // camino y el cajero vuelve a confirmar). Vive en un ref (no en estado)
  // porque no necesita disparar un re-render — solo debe sobrevivir entre
  // llamadas a handleConfirm() mientras el diálogo siga abierto para ESTA
  // mesa.
  //
  // Solo se usa cuando la mesa todavía no tiene identidad de sesión
  // (openOperationId / orderId). Si la tiene, el motor deriva de ella un id
  // de venta estable: así cerrar y volver a abrir este diálogo (por ejemplo
  // tras abandonar un pago con Wompi) reutiliza la MISMA venta y nunca crea
  // una segunda venta pendiente para la misma cuenta.
  const saleAttemptIdRef = useRef<string | null>(null);
  const digitalAttemptRef = useRef<number>(0);
  const finishingRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);

  const change = method === "CASH" ? Math.max(received - table.total, 0) : 0;
  const digitalSelected = isDigitalMethod(method);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const sync = () => setOnline(connectionStore.isOnline());
    const unsubscribe = connectionStore.subscribe(sync);
    sync();
    return unsubscribe;
  }, []);

  function currentSaleId(): string | undefined {
    if (table.openOperationId || table.orderId) return undefined;
    if (!saleAttemptIdRef.current) {
      saleAttemptIdRef.current = crypto.randomUUID();
    }
    return saleAttemptIdRef.current;
  }

  /** Impresión + Dashboard después de un cobro confirmado (igual que mostrador). */
  async function afterPaid(paidSale: Sale, receipt: Receipt) {
    await productCatalogStore.init();
    const printableItems = paidSale.items.map((item: any) => ({
      name: productCatalogStore.getById(item.productId)?.name ?? item.productId,
      quantity: item.quantity,
      price: item.price,
      unit: item.unit,
      quantityRaw: item.quantityRaw,
      selectedSizeId: item.selectedSizeId,
      selectedExtraIds: item.selectedExtraIds,
      discount: item.discount,
      taxRate: item.taxRate
    }));
    printReceiptIfEnabled(receipt, printableItems);

    try {
      await syncDashboardAfterSale(paidSale);
    } catch {
      // El cobro ya está confirmado; el Dashboard se corrige solo en el próximo refresco.
    }
  }

  async function checkOpenShiftAndPlan(): Promise<boolean> {
    // La caja debe estar abierta (un turno en curso) para poder cobrar,
    // igual que en Caja mostrador.
    try {
      if (!(await assertShiftOpen())) return false;
    } catch (shiftError) {
      // PASO 1.8: sin internet no hay forma de confirmar el turno
      // contra el servidor. Se asume abierto para no bloquear el cierre
      // offline de la mesa — si en verdad no lo estaba, queda en evidencia
      // al sincronizar.
      if (!isNetworkFailure(shiftError) || connectionStore.isOnline()) {
        throw shiftError;
      }
    }

    // VIMDY — FASE 7, PASO 5/9: sin plan activo no se puede cerrar una mesa
    // cobrando una venta nueva.
    if (!(await assertSubscriptionActive())) return false;

    return true;
  }

  /* ----------------------------------------------------------------------
     COBRO EN EFECTIVO
  ---------------------------------------------------------------------- */
  async function handleCashConfirm() {
    setBusy(true);
    setErrorMsg(null);
    try {
      if (!canCharge) {
        setErrorMsg(TABLE_CHARGE_FORBIDDEN_MESSAGE);
        return;
      }

      if (!(await checkOpenShiftAndPlan())) {
        setBusy(false);
        return;
      }

      const closeInput = {
        tableId: table.id,
        method,
        cashierId: user?.id,
        cashier: user?.name,
        received: method === "CASH" ? received : table.total,
        saleId: currentSaleId()
      };

      // PASO 1.8 (Cola offline): sin conexión real no tiene sentido ni
      // intentar hablar con Supabase — se va directo al camino offline.
      if (!connectionStore.isOnline()) {
        await queueCloseTableOffline({
          table,
          input: { ...closeInput, saleId: closeInput.saleId ?? saleAttemptIdRef.current ?? crypto.randomUUID() }
        });
        saleAttemptIdRef.current = null;
        onClosed();
        return;
      }

      const { sale: paidSale, receipt } = await container.tableEngine.get().closeTable(closeInput);

      await afterPaid(paidSale, receipt);

      // Cobro exitoso: el intento terminó, se libera el id por si este
      // mismo componente se reutiliza para cobrar otra mesa.
      saleAttemptIdRef.current = null;

      onClosed();
    } catch (err) {
      if (isConnectivityFailure(err)) {
        // La red se cayó a mitad del cobro: no se le muestra un error al
        // cajero, el cierre se guarda en la cola local y se sincroniza solo
        // cuando vuelva internet (ver syncPendingTableOperations.ts). El
        // mismo saleId evita cobrar dos veces la misma mesa al sincronizar.
        await queueCloseTableOffline({
          table,
          input: {
            tableId: table.id,
            method,
            cashierId: user?.id,
            cashier: user?.name,
            received: method === "CASH" ? received : table.total,
            saleId: currentSaleId() ?? saleAttemptIdRef.current ?? crypto.randomUUID()
          }
        });
        saleAttemptIdRef.current = null;
        onClosed();
      } else {
        setErrorMsg(translateBusinessError(err, "No se pudo cobrar la mesa."));
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  /* ----------------------------------------------------------------------
     COBRO DIGITAL (WOMPI)
  ---------------------------------------------------------------------- */
  async function beginDigital(chosen: TableDigitalMethod, attempt: number) {
    setBusy(true);
    setErrorMsg(null);
    try {
      if (!canCharge) {
        setErrorMsg(TABLE_CHARGE_FORBIDDEN_MESSAGE);
        return;
      }

      if (!connectionStore.isOnline()) {
        setErrorMsg("Sin internet no se puede cobrar con tarjeta, transferencia o QR. Cobra en efectivo o espera a que vuelva la conexión.");
        return;
      }

      if (!(await checkOpenShiftAndPlan())) return;

      const engine = container.tableEngine.get();

      // 1) Venta creada y pendiente de pago (no se cobra todavía).
      const sale = await engine.prepareTableSaleForPayment({
        tableId: table.id,
        saleId: currentSaleId(),
        cashierId: user?.id
      });

      // Si por algún motivo ya estaba pagada (respuesta perdida), solo se cierra la mesa.
      const status = String(sale.status ?? "");
      if (status === "PAID" || status === "CLOSED") {
        await finishDigital(sale, chosen);
        return;
      }

      // 2) Sesión de pago de Wompi (monto = total oficial de la venta).
      const currentShift = await container.shiftEngine.get().getCurrentShift();
      const checkout = await startTableWompiCheckout({
        saleId: sale.id,
        method: chosen,
        amount: sale.total,
        shiftId: currentShift?.id,
        cashRegisterId: currentShift?.cashRegisterId,
        attempt
      });

      digitalAttemptRef.current = checkout.attempt;
      finishingRef.current = false;
      setDigital({ sale, checkout, method: chosen, state: "pending" });

      // 3) Abre el pago de Wompi. Si el navegador bloquea la ventana, queda
      //    visible el botón "Abrir pago en Wompi".
      try {
        window.open(checkout.checkoutUrl, "_blank");
      } catch {
        // Se usa el enlace visible.
      }
    } catch (err) {
      setErrorMsg(translateBusinessError(err, "No se pudo iniciar el pago con Wompi."));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  /** La venta ya figura pagada en la base de datos: cierra la mesa y termina. */
  async function finishDigital(sale: Sale, chosen: TableDigitalMethod) {
    if (finishingRef.current) return;
    finishingRef.current = true;

    try {
      let lastError: unknown = null;

      for (let attempt = 0; attempt < CONFIRM_RETRIES; attempt++) {
        try {
          const { sale: paidSale, receipt } = await container.tableEngine
            .get()
            .confirmTableExternalPayment({
              tableId: table.id,
              saleId: sale.id,
              method: chosen,
              cashier: user?.name
            });

          await afterPaid(paidSale, receipt);
          saleAttemptIdRef.current = null;
          onClosed();
          return;
        } catch (err) {
          lastError = err;
          // El webhook puede ir unos segundos por detrás de la aprobación.
          if (!String((err as Error)?.message ?? "").startsWith("TABLE_PAYMENT_PENDING_VERIFICATION")) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, CONFIRM_RETRY_MS));
        }
      }

      finishingRef.current = false;
      if (mountedRef.current) {
        setErrorMsg(
          lastError
            ? translateBusinessError(lastError, "El pago fue aprobado pero no se pudo cerrar la mesa. Revisa el Historial de ventas antes de volver a cobrar.")
            : "El pago fue aprobado pero no se pudo cerrar la mesa. Revisa el Historial de ventas antes de volver a cobrar."
        );
      }
    } catch (err) {
      finishingRef.current = false;
      if (mountedRef.current) {
        setErrorMsg(translateBusinessError(err, "No se pudo cerrar la mesa."));
      }
    }
  }

  const pollDigital = useCallback(async () => {
    if (!digital || finishingRef.current) return;
    if (isTerminalTableWompiState(digital.state)) return;

    try {
      const state = await getTableWompiState(digital.checkout.sessionId);
      if (!mountedRef.current) return;

      if (state === "approved") {
        setDigital((current) => (current ? { ...current, state } : current));
        await finishDigital(digital.sale, digital.method);
        return;
      }

      if (state !== "pending") {
        setDigital((current) => (current ? { ...current, state } : current));
      }
    } catch {
      // Un fallo puntual de red al consultar no cancela el pago: se reintenta en el siguiente ciclo.
    }
  // finishDigital solo usa refs y props estables del diálogo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digital]);

  useEffect(() => {
    if (!digital || isTerminalTableWompiState(digital.state)) return;

    const interval = setInterval(() => {
      void pollDigital();
    }, POLL_MS);

    // La ventana de pago avisa cuando termina; se consulta de inmediato.
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "POS_CHECKOUT_RESULT") {
        void pollDigital();
      }
    };
    window.addEventListener("message", onMessage);

    void pollDigital();

    return () => {
      clearInterval(interval);
      window.removeEventListener("message", onMessage);
    };
  }, [digital, pollDigital]);

  function handleConfirm() {
    if (isDigitalMethod(method)) {
      void beginDigital(method, digitalAttemptRef.current);
    } else {
      void handleCashConfirm();
    }
  }

  function retryDigital() {
    if (!digital) return;
    const chosen = digital.method;
    const nextAttempt = digital.checkout.attempt + 1;
    setDigital(null);
    void beginDigital(chosen, nextAttempt);
  }

  /* ----------------------------------------------------------------------
     PANTALLA DE ESPERA DE WOMPI
  ---------------------------------------------------------------------- */
  if (digital) {
    const failed = isTerminalTableWompiState(digital.state);
    const label =
      digital.state === "declined"
        ? "El pago fue rechazado."
        : digital.state === "cancelled"
          ? "El pago fue cancelado."
          : digital.state === "expired"
            ? "El tiempo para pagar venció."
            : "No se pudo confirmar el pago.";

    return (
      <div className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-[520px] rounded-3xl bg-vimdy-surface border border-slate-700 shadow-2xl">
          <div className="flex items-center justify-between px-6 py-5 border-b border-slate-700">
            <h2 className="text-2xl font-bold text-white">Pago con Wompi · {table.name}</h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white text-2xl"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>

          <div className="p-6 space-y-5">
            <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 flex justify-between items-center">
              <span className="text-slate-400">Total a pagar</span>
              <span className="text-white font-black text-2xl">{money(digital.checkout.amount)}</span>
            </div>

            {errorMsg && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 px-4 py-3 text-sm">
                {errorMsg}
              </div>
            )}

            {!failed && digital.state !== "approved" && (
              <div className="flex flex-col items-center gap-3 text-center py-2">
                <Loader2 className="h-10 w-10 animate-spin text-cyan-400" />
                <p className="text-white font-semibold">Esperando el pago del cliente…</p>
                <p className="text-slate-400 text-sm">
                  El cliente completa el pago en la ventana de Wompi. Esta pantalla se actualiza sola cuando Wompi lo confirme.
                </p>
                <a
                  href={digital.checkout.checkoutUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold"
                >
                  <ExternalLink size={16} />
                  Abrir pago en Wompi
                </a>
                <p className="text-slate-500 text-xs">
                  Si cierras esta ventana, el pago se registrará igual cuando Wompi lo confirme y la mesa se liberará sola.
                </p>
              </div>
            )}

            {digital.state === "approved" && (
              <div className="flex flex-col items-center gap-3 text-center py-2">
                <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                <p className="text-white font-semibold">Pago aprobado. Cerrando la mesa…</p>
              </div>
            )}

            {failed && (
              <div className="flex flex-col items-center gap-3 text-center py-2">
                <XCircle className="h-10 w-10 text-red-400" />
                <p className="text-white font-semibold">{label}</p>
                <p className="text-slate-400 text-sm">No se cobró nada. Puedes intentar de nuevo o cobrar en efectivo.</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setDigital(null);
                      setErrorMsg(null);
                    }}
                    className="h-11 px-5 rounded-xl bg-slate-700 text-white"
                  >
                    Cambiar método
                  </button>
                  <button
                    onClick={retryDigital}
                    disabled={busy}
                    className="h-11 px-5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold"
                  >
                    Intentar de nuevo
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------------------
     FORMULARIO DE COBRO
  ---------------------------------------------------------------------- */
  const confirmDisabled =
    busy ||
    !canCharge ||
    (method === "CASH" && received < table.total) ||
    (digitalSelected && !online);

  return (
    <div className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm flex items-center justify-center">
      <div className="w-[520px] max-w-full rounded-3xl bg-vimdy-surface border border-slate-700 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-700">
          <h2 className="text-2xl font-bold text-white">Cobrar {table.name}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-6">
          {!canCharge && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 px-4 py-3 text-sm">
              {TABLE_CHARGE_FORBIDDEN_MESSAGE}
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 px-4 py-3 text-sm">
              {errorMsg}
            </div>
          )}

          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 flex justify-between items-center">
            <span className="text-slate-400">Total a pagar</span>
            <span className="text-white font-black text-2xl">
              {money(table.total)}
            </span>
          </div>

          <div>
            <p className="text-slate-400 mb-3">Método de pago</p>
            <div className="grid grid-cols-4 gap-3">
              {METHODS.map(m => (
                <button
                  key={m.id}
                  onClick={() => {
                    setMethod(m.id);
                    setErrorMsg(null);
                  }}
                  className={`flex flex-col items-center gap-2 py-4 rounded-xl border transition ${
                    method === m.id
                      ? "bg-cyan-500 border-cyan-400 text-slate-950"
                      : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  <m.icon size={20} />
                  <span className="text-xs font-semibold">{m.title}</span>
                </button>
              ))}
            </div>
          </div>

          {method === "CASH" && (
            <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5">
              <p className="text-slate-400">Dinero recibido</p>
              <input
                type="number"
                min={0}
                value={received}
                onChange={e => setReceived(Number(e.target.value))}
                className="mt-3 w-full h-12 rounded-xl bg-vimdy-surface border border-slate-700 px-4 text-white outline-none"
              />
              <div className="flex justify-between mt-3 text-sm">
                <span className="text-slate-400">Cambio</span>
                <span className="text-cyan-400 font-bold">
                  {money(change)}
                </span>
              </div>
            </div>
          )}

          {digitalSelected && (
            <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 text-sm text-slate-300">
              {online ? (
                <>
                  Se abrirá el pago seguro de <strong className="text-white">Wompi</strong>. El cliente elige allí tarjeta, PSE, Nequi o QR. La mesa se cierra sola cuando Wompi confirma el pago.
                </>
              ) : (
                <span className="text-amber-300">
                  Sin internet no se puede cobrar con tarjeta, transferencia o QR. Cobra en efectivo o espera a que vuelva la conexión.
                </span>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="h-12 px-6 rounded-xl bg-slate-700 text-white"
            >
              Cancelar
            </button>
            <button
              disabled={confirmDisabled}
              onClick={handleConfirm}
              className="h-12 px-8 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold"
            >
              {busy
                ? (digitalSelected ? "Abriendo Wompi..." : "Cobrando...")
                : digitalSelected
                  ? "Pagar con Wompi"
                  : "Confirmar cobro"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}