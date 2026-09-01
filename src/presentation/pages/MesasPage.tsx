import React, { useCallback, useEffect, useState } from "react";

import { Table, Product } from "../../core/entities/Entities";
import {
  container,
  tablesReady,
  productsReady
} from "../../infrastructure/di/CompositionRoot";
import { useVimdyEvent } from "../../hooks/useVimdyCore";
import { useEnabledModules } from "../../core/store/useEnabledModules";

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
 * MesasPage — Pantalla dedicada a la gestión de mesas.
 * Independiente del módulo de Personal.
 * Un negocio puede tener mesas sin personal (autoservicio).
 */
function MesasContent() {
  const { isHelpOpen, openHelp, closeHelp } = useHelp();

  const [ready, setReady] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const { count: pendingTableOperationsCount } = usePendingTableOperationsQueue();

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"open" | "detail" | null>(null);

  const reloadTables = useCallback(async () => {
    const all = await container.tableEngine.get().getAllTables();
    setTables(all);
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([tablesReady, productsReady])
      .then(async () => {
        const [allTables, allProducts] = await Promise.all([
          container.tableEngine.get().getAllTables(),
          container.inventoryEngine.get().listAll()
        ]);

        if (cancelled) return;

        setTables(allTables);
        setProducts(allProducts);
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

  if (!ready) {
    return (
      <div className="p-8">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-12 text-center text-slate-400">
          Cargando…
        </div>
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<span className="text-3xl">🪑</span>}
          title="No hay mesas configuradas"
          description="Agrega mesas para poder atender a tus clientes en el local."
          action={{
            label: "Ir a Configuración",
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
            <h1 className="text-5xl font-black text-white">Mesas</h1>
            <OfflineStatusBadge
              pendingCount={pendingTableOperationsCount}
              pendingLabelSingular="1 operación de mesa pendiente"
              pendingLabelPlural="{count} operaciones de mesa pendientes"
            />
          </div>
          <p className="text-slate-400 mt-3 text-xl">
            Gestiona las mesas de tu negocio.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <HelpButton onClick={openHelp} />
        </div>
      </div>

      <TableGrid tables={tables} onSelect={handleSelectTable} />

      {dialog === "open" && selectedTable && (
        <OpenTableDialog
          table={selectedTable}
          waiterId={null}
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
            closeDialogs();
            reloadTables();
          }}
        />
      )}

      <HelpModal
        isOpen={isHelpOpen}
        onClose={closeHelp}
        content={HELP_CONTENT.mesas}
      />
    </div>
  );
}

export function MesasPage() {
  return (
    <RequirePermission requires="tables.view">
      <MesasContent />
    </RequirePermission>
  );
}
