import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, X, Users, Loader2 } from "lucide-react";

import { Table } from "../../../core/entities/Entities";
import { container, tablesReady } from "../../../infrastructure/di/CompositionRoot";
import { useVimdyEvent } from "../../../hooks/useVimdyCore";
import { useProductCatalog } from "../../../core/store/useProductCatalog";
import { useTranslation } from "../../../core/i18n/useTranslation";

import { TableGrid } from "../waiter/TableGrid";
import { TableDetailPanel } from "../waiter/TableDetailPanel";
import { EmptyState } from "../ui/EmptyState";

interface Props {
  onClose: () => void;
}

/**
 * "Cobrar por mesa" desde Caja/Mostrador.
 * ---------------------------------------------------------------------------
 * El hueco que cerraba esto: el dato de las mesas ya era compartido en
 * tiempo real (Table.items vive en Supabase, no en memoria — ver
 * TableEngine), pero desde la pantalla de Caja no había manera de
 * ENCONTRAR una mesa. Si el cliente de la Mesa 4 se paraba a pagar en el
 * mostrador, el cajero no tenía desde dónde buscar "Mesa 4".
 *
 * La solución NO es un flujo nuevo de cobro: es una segunda puerta de
 * entrada al mismo TableDetailPanel que ya usa Meseros. Mismo cobro,
 * mismo TableEngine, mismo Table.version — cero lógica de negocio
 * duplicada aquí. Este componente solo hace una cosa: buscar y
 * seleccionar la mesa.
 */
export function PosTableSearchModal({ onClose }: Props) {
  const { t } = useTranslation();
  const { products } = useProductCatalog();

  const [ready, setReady] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  const [search, setSearch] = useState("");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  const reloadTables = useCallback(async () => {
    const all = await container.tableEngine.get().getAllTables();
    setTables(all);
  }, []);

  useEffect(() => {
    let cancelled = false;

    tablesReady.then(async () => {
      const all = await container.tableEngine.get().getAllTables();
      if (cancelled) return;
      setTables(all);
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Igual que en Meseros: si otro dispositivo abre/cierra/cobra una mesa
  // mientras este modal está abierto, se refleja al instante.
  useVimdyEvent("table", () => {
    reloadTables();
  });

  // Solo mesas con algo pendiente de cobrar. Una mesa libre o reservada
  // no tiene cuenta que buscar aquí.
  const chargeableTables = useMemo(() => {
    return tables.filter(
      (table) => table.status !== "FREE" && table.status !== "RESERVED" && table.status !== "CLOSED"
    );
  }, [tables]);

  const visibleTables = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return chargeableTables;
    return chargeableTables.filter((table) => table.name.toLowerCase().includes(query));
  }, [chargeableTables, search]);

  const selectedTable = selectedTableId
    ? tables.find((table) => table.id === selectedTableId) ?? null
    : null;

  // Con una mesa elegida, esto SE CONVIERTE en TableDetailPanel — el mismo
  // panel de cobro que usa Meseros, sin reimplementar nada del cobro.
  if (selectedTable) {
    return (
      <TableDetailPanel
        table={selectedTable}
        products={products}
        onClose={() => setSelectedTableId(null)}
        onChanged={reloadTables}
        onClosedTable={() => {
          // Mesa cobrada: se cierra todo y Caja vuelve a su pantalla normal.
          setSelectedTableId(null);
          reloadTables();
          onClose();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-3xl max-h-[85vh] rounded-vimdy-xl bg-vimdy-surface border border-vimdy-border shadow-vimdy-lg flex flex-col overflow-hidden">

        <div className="flex items-center justify-between px-6 py-5 border-b border-vimdy-border flex-shrink-0">
          <div>
            <h2 className="text-vimdy-h2 font-bold text-vimdy-text">{t("pos.tableCharge.title")}</h2>
            <p className="text-vimdy-text-secondary text-vimdy-small mt-1">{t("pos.tableCharge.subtitle")}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("pos.tableCharge.closeAria")}
            className="w-9 h-9 flex items-center justify-center text-vimdy-text-secondary hover:text-vimdy-text transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 pt-5 flex-shrink-0">
          <div className="flex items-center h-11 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface-active px-4 transition-colors focus-within:border-vimdy-accent">
            <Search size={18} className="text-vimdy-text-secondary flex-shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("pos.tableCharge.searchPlaceholder")}
              className="flex-1 ml-3 bg-transparent outline-none text-vimdy-text text-vimdy-small placeholder:text-vimdy-text-tertiary"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label={t("pos.tableCharge.clearSearchAria")}
                className="w-8 h-8 flex items-center justify-center text-vimdy-text-secondary hover:text-vimdy-text flex-shrink-0 transition-colors"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {!ready ? (
            <div className="flex items-center justify-center gap-2 text-vimdy-text-secondary text-vimdy-small py-12">
              <Loader2 size={18} className="animate-vimdy-spin" />
              {t("pos.tableCharge.loading")}
            </div>
          ) : visibleTables.length === 0 ? (
            <EmptyState
              icon={<Users size={28} />}
              title={t("pos.tableCharge.emptyTitle")}
              description={t("pos.tableCharge.emptyDescription")}
            />
          ) : (
            <TableGrid
              tables={visibleTables}
              onSelect={(table) => setSelectedTableId(table.id)}
            />
          )}
        </div>

      </div>
    </div>
  );
}