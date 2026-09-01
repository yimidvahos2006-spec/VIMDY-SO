import React, { useCallback, useEffect, useState } from "react";

import { Table, Product, Waiter } from "../../core/entities/Entities";
import {
  container,
  tablesReady,
  productsReady
} from "../../infrastructure/di/CompositionRoot";
import { useVimdyEvent } from "../../hooks/useVimdyCore";
import { useEnabledModules } from "../../core/store/useEnabledModules";

import { WaiterSelect } from "../components/waiter/WaiterSelect";
import { TableGrid } from "../components/waiter/TableGrid";
import { OpenTableDialog } from "../components/waiter/OpenTableDialog";
import { TableDetailPanel } from "../components/waiter/TableDetailPanel";
import { OfflineStatusBadge } from "../components/ui/OfflineStatusBadge";
import { EmptyState } from "../components/ui/EmptyState";
import { HelpModal, HelpButton, useHelp } from "../components/help/HelpModal";
import { HELP_CONTENT } from "../components/help/helpContent";
import { usePendingTableOperationsQueue } from "../../core/offline/usePendingTableOperationsQueue";
import { RequirePermission } from "../navigation/RequirePermission";

/**
 * PersonalPage — Pantalla dedicada a la gestión de personal/meseros.
 * Independiente del módulo de Mesas.
 * Un negocio puede tener personal sin mesas (mostrador, domicilios, etc.).
 */
function PersonalContent() {
  const enabledModules = useEnabledModules();
  const hasWaitersModule = enabledModules?.includes("mesas") ?? false;
  const { isHelpOpen, openHelp, closeHelp } = useHelp();

  const [ready, setReady] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);

  const { count: pendingTableOperationsCount } = usePendingTableOperationsQueue();

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

  useVimdyEvent("table", () => {
    reloadTables();
  });

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

  function returnToWaiterSelect() {
    closeDialogs();
    setActiveWaiter(null);
  }

  if (!ready) {
    return (
      <div className="p-8">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-12 text-center text-slate-400">
          Cargando…
        </div>
      </div>
    );
  }

  // Si no hay mesas ni personal, mostrar estado vacío
  if (tables.length === 0 && waiters.length === 0) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-5xl font-black text-white">Personal</h1>
            <p className="text-slate-400 mt-3 text-xl">
              Gestiona tu equipo de trabajo.
            </p>
          </div>
        </div>
        <EmptyState
          icon={<span className="text-3xl">👥</span>}
          title="No tienes personal registrado"
          description="Agrega personas a tu equipo para que puedan tomar pedidos. Puedes hacerlo con o sin mesas."
          action={{
            label: "Configuración",
            onClick: () => window.location.href = "/configuracion"
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-5xl font-black text-white">Personal</h1>
            <OfflineStatusBadge
              pendingCount={pendingTableOperationsCount}
              pendingLabelSingular="1 operación pendiente"
              pendingLabelPlural="{count} operaciones pendientes"
            />
          </div>
          <p className="text-slate-400 mt-3 text-xl">
            {activeWaiter
              ? `${activeWaiter.name} — elige una mesa.`
              : "Toca tu nombre para empezar."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeWaiter && (
            <button
              onClick={returnToWaiterSelect}
              className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold transition"
            >
              Cambiar de personal
            </button>
          )}
          <HelpButton onClick={openHelp} />
        </div>
      </div>

      {!activeWaiter && (
        <WaiterSelect waiters={waiters} onSelect={setActiveWaiter} />
      )}

      {activeWaiter && tables.length > 0 && (
        <TableGrid tables={tables} onSelect={handleSelectTable} />
      )}

      {dialog === "open" && selectedTable && (
        <OpenTableDialog
          table={selectedTable}
          waiterId={activeWaiter?.id ?? null}
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
            returnToWaiterSelect();
            reloadTables();
          }}
        />
      )}

      <HelpModal
        isOpen={isHelpOpen}
        onClose={closeHelp}
        content={HELP_CONTENT.meseros}
      />
    </div>
  );
}

export function PersonalPage() {
  return (
    <RequirePermission requires="staff.view">
      <PersonalContent />
    </RequirePermission>
  );
}
