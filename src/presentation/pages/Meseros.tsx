import React, { useCallback, useEffect, useState } from "react";

import { Table, Product, Waiter } from "../../core/entities/Entities";
import {
  container,
  tablesReady,
  productsReady
} from "../../infrastructure/di/CompositionRoot";
import { useVimdyEvent } from "../../hooks/useVimdyCore";

import { WaiterSelect } from "../components/waiter/WaiterSelect";
import { TableGrid } from "../components/waiter/TableGrid";
import { OpenTableDialog } from "../components/waiter/OpenTableDialog";
import { TableDetailPanel } from "../components/waiter/TableDetailPanel";
import { OfflineStatusBadge } from "../components/ui/OfflineStatusBadge";
import { usePendingTableOperationsQueue } from "../../core/offline/usePendingTableOperationsQueue";
import { RequirePermission } from "../navigation/RequirePermission";

function MeserosContent() {
  const [ready, setReady] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);

  // PASO 1.10 (offline elegante en Mesas) — cuántas aperturas/cierres de
  // mesa hechos sin conexión siguen esperando sincronizarse, para el badge
  // del encabezado (ver OfflineStatusBadge más abajo).
  const { count: pendingTableOperationsCount } = usePendingTableOperationsQueue();

  // null = todavía estamos en la pantalla de tarjetas de mesero.
  const [activeWaiter, setActiveWaiter] = useState<Waiter | null>(null);

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"open" | "detail" | null>(null);

  const reloadTables = useCallback(async () => {
    const all = await container.tableEngine.get().getAllTables();
    setTables(all);
  }, []);

  const reloadWaiters = useCallback(async () => {
    const all = await container.waiterEngine.get().listActive();
    setWaiters(all);
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([tablesReady, productsReady])
      .then(async () => {
        const [allTables, allProducts, allWaiters] = await Promise.all([
          container.tableEngine.get().getAllTables(),
          container.inventoryEngine.get().listAll(),
          container.waiterEngine.get().listActive()
        ]);

        if (cancelled) return;

        setTables(allTables);
        setProducts(allProducts);
        setWaiters(allWaiters);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Cualquier cambio de mesa en cualquier parte de la app (incluso desde
  // otro módulo) refresca el grid al instante.
  useVimdyEvent("table", () => {
    reloadTables();
  });

  // Si el dueño agrega/edita/quita un mesero desde Configuración mientras
  // esta pantalla está abierta en el tablet del restaurante, se refleja
  // de inmediato sin recargar la página.
  useVimdyEvent("waiter", () => {
    reloadWaiters();
  });

  const selectedTable = selectedTableId
    ? tables.find(t => t.id === selectedTableId) ?? null
    : null;

  function handleSelectTable(table: Table) {
    setSelectedTableId(table.id);
    if (table.status === "FREE" || table.status === "RESERVED") {
      setDialog("open");
    } else {
      setDialog("detail");
    }
  }

  function closeDialogs() {
    setDialog(null);
    setSelectedTableId(null);
  }

  /** Cierra todo y regresa a la pantalla de tarjetas para el siguiente mesero. */
  function returnToWaiterSelect() {
    closeDialogs();
    setActiveWaiter(null);
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-5xl font-black text-white">Meseros</h1>
            <OfflineStatusBadge
              pendingCount={pendingTableOperationsCount}
              pendingLabelSingular="1 operación de mesa pendiente"
              pendingLabelPlural="{count} operaciones de mesa pendientes"
            />
          </div>
          <p className="text-slate-400 mt-3 text-xl">
            {activeWaiter
              ? `${activeWaiter.name} — elige una mesa.`
              : "Administración de meseros y mesas."}
          </p>
        </div>

        {activeWaiter && (
          <button
            onClick={returnToWaiterSelect}
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold transition"
          >
            Cambiar de mesero
          </button>
        )}
      </div>

      {!ready && (
        <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-12 text-center text-slate-400">
          Cargando…
        </div>
      )}

      {/* Paso 1: tocar el nombre — sin login. */}
      {ready && !activeWaiter && (
        <WaiterSelect waiters={waiters} onSelect={setActiveWaiter} />
      )}

      {/* Paso 2: mesas, ya con el mesero identificado. */}
      {ready && activeWaiter && (
        <TableGrid tables={tables} onSelect={handleSelectTable} />
      )}

      {dialog === "open" && selectedTable && activeWaiter && (
        <OpenTableDialog
          table={selectedTable}
          waiterId={activeWaiter.id}
          onClose={closeDialogs}
          onOpened={() => {
            setDialog("detail");
            reloadTables();
          }}
        />
      )}

      {dialog === "detail" && selectedTable && (
        <TableDetailPanel
          table={selectedTable}
          products={products}
          onClose={closeDialogs}
          onChanged={reloadTables}
          onClosedTable={() => {
            closeDialogs();
            reloadTables();
          }}
          onOrderSent={() => {
            // Enviado el pedido: vuelve sola a las tarjetas de mesero,
            // lista para que la use la siguiente persona en el tablet.
            returnToWaiterSelect();
            reloadTables();
          }}
        />
      )}
    </div>
  );
}

export function Meseros() {
  return (
    <RequirePermission requires="tables.view">
      <MeserosContent />
    </RequirePermission>
  );
}