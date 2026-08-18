import React, { useState } from "react";
import { Banknote, CreditCard, Smartphone, Landmark } from "lucide-react";

import { Table } from "../../../core/entities/Entities";
import { PaymentMethod } from "../../../core/engines/PaymentEngine";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { useAuth } from "../../context/AuthContext";
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

export function CloseTableDialog({ table, onClose, onClosed }: Props) {
  const { user } = useAuth();
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [received, setReceived] = useState<number>(table.total);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // IDEMPOTENCIA (checklist crítico #4): id del intento de cobro de esta
  // mesa, generado una sola vez con el primer "Confirmar cobro" y
  // reutilizado en cada reintento (ej. si el datáfono se cae a mitad de
  // camino y el cajero vuelve a confirmar). Vive en un ref (no en estado)
  // porque no necesita disparar un re-render — solo debe sobrevivir entre
  // llamadas a handleConfirm() mientras el diálogo siga abierto para ESTA
  // mesa.
  const saleAttemptIdRef = React.useRef<string | null>(null);

  const change = method === "CASH" ? Math.max(received - table.total, 0) : 0;

  async function handleConfirm() {
    setBusy(true);
    setErrorMsg(null);
    try {
      // La caja debe estar abierta (un turno en curso) para poder cobrar,
      // igual que en Caja mostrador. Antes esto no se validaba aquí, así
      // que se podía cobrar una mesa con la caja "cerrada".
      try {
        if (!(await assertShiftOpen())) {
          setBusy(false);
          return;
        }
      } catch (shiftError) {
        // PASO 1.8: sin internet no hay forma de confirmar el turno
        // contra el servidor (getCurrentShift() necesita Supabase, ver
        // mismo caso en sendOrderToKitchen/processSale.ts). Se asume
        // abierto para no bloquear el cierre offline de la mesa — si en
        // verdad no lo estaba, queda en evidencia al sincronizar.
        if (!isNetworkFailure(shiftError) || connectionStore.isOnline()) {
          throw shiftError;
        }
      }

      // VIMDY — FASE 7, PASO 5/9: misma regla que en mostrador — sin plan
      // activo no se puede cerrar una mesa cobrando una venta nueva.
      if (!(await assertSubscriptionActive())) {
        setBusy(false);
        return;
      }

      if (!saleAttemptIdRef.current) {
        saleAttemptIdRef.current = crypto.randomUUID();
      }

      const closeInput = {
        tableId: table.id,
        method,
        cashierId: user?.id,
        cashier: user?.name,
        received: method === "CASH" ? received : table.total,
        saleId: saleAttemptIdRef.current
      };

      // PASO 1.8 (Cola offline): sin conexión real no tiene sentido ni
      // intentar hablar con Supabase — se va directo al camino offline.
      if (!connectionStore.isOnline()) {
        await queueCloseTableOffline({ table, input: closeInput });
        saleAttemptIdRef.current = null;
        onClosed();
        return;
      }

      const { sale: paidSale, receipt } = await container.tableEngine.closeTable(closeInput);

      // Impresión real (window.print del sistema), igual que en Caja
      // mostrador, y respetando companyConfigStore.autoPrintReceipt
      // (antes esta pantalla imprimía siempre, sin consultar esa opción).
      await productCatalogStore.init();
      const printableItems = paidSale.items.map((item) => ({
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

      // Sincroniza el Dashboard con esta venta, con la misma lógica
      // compartida que usa Caja mostrador — ver checkout.ts.
      await syncDashboardAfterSale(paidSale);

      // Cobro exitoso: el intento terminó, se libera el id por si este
      // mismo componente se reutiliza para cobrar otra mesa.
      saleAttemptIdRef.current = null;

      onClosed();
    } catch (err) {
      if (isNetworkFailure(err)) {
        // La red se cayó a mitad del cobro (después de intentarlo online
        // arriba): no se le muestra un error al cajero, el cierre se
        // guarda en la cola local y se sincroniza solo cuando vuelva
        // internet (ver syncPendingTableOperations.ts). El mismo saleId
        // ya generado evita cobrar dos veces la misma mesa al sincronizar.
        const closeInput = {
          tableId: table.id,
          method,
          cashierId: user?.id,
          cashier: user?.name,
          received: method === "CASH" ? received : table.total,
          saleId: saleAttemptIdRef.current ?? crypto.randomUUID()
        };
        await queueCloseTableOffline({ table, input: closeInput });
        saleAttemptIdRef.current = null;
        onClosed();
      } else {
        setErrorMsg(translateBusinessError(err, "No se pudo cobrar la mesa."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm flex items-center justify-center">
      <div className="w-[520px] rounded-3xl bg-vimdy-surface border border-slate-700 shadow-2xl">
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
          {errorMsg && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 px-4 py-3 text-sm">
              {errorMsg}
            </div>
          )}

          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 flex justify-between items-center">
            <span className="text-slate-400">Total a pagar</span>
            <span className="text-white font-black text-2xl">
              ${table.total.toLocaleString("es-CO")}
            </span>
          </div>

          <div>
            <p className="text-slate-400 mb-3">Método de pago</p>
            <div className="grid grid-cols-4 gap-3">
              {METHODS.map(m => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
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
                  ${change.toLocaleString("es-CO")}
                </span>
              </div>
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
              disabled={busy || (method === "CASH" && received < table.total)}
              onClick={handleConfirm}
              className="h-12 px-8 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold"
            >
              {busy ? "Cobrando..." : "Confirmar cobro"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}