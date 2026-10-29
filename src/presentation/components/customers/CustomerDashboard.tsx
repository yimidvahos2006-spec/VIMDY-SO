import React, { useDeferredValue, useMemo, useState } from "react";
import { Users, UserPlus } from "lucide-react";
import { confirmDialog } from "../../../core/store/confirmStore";

import { useCommandIntent } from "../../../hooks/useCommandIntent";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton, SkeletonCards, SkeletonRows } from "../ui/Skeleton";
import { OfflineStatusBadge } from "../ui/OfflineStatusBadge";
import { useCustomers, CustomerWithStats } from "../../../core/store/useCustomers";
import { usePendingCustomerOperationsQueue } from "../../../core/offline/usePendingCustomerOperationsQueue";
import { CustomerKpiGrid } from "./CustomerKpiGrid";
import { NeverPurchasedBanner } from "./NeverPurchasedBanner";
import { CustomerTable } from "./CustomerTable";
import { CustomerDetailModal } from "./CustomerDetailModal";
import { CustomerFormModal } from "./CustomerFormModal";
import { normalizeCustomerFields } from "../../../core/domain/customers/quickCreate";
import {
  DEFAULT_SORT,
  SortKey,
  SortState,
  buildCustomerSearchIndex,
  filterAndSortWithIndex,
  getNeverPurchased,
  nextSortState
} from "./customerListing";

/**
 * CustomerDashboard
 * ---------------------------------------------------------------------------
 * Pantalla de Clientes. Solo coordina: carga los datos (useCustomers) y
 * decide qué modal está abierto. Cada pieza visual vive en su propio archivo:
 * CustomerKpiGrid, NeverPurchasedBanner, CustomerTable, CustomerDetailModal
 * y CustomerFormModal; buscar/ordenar está en customerListing.ts.
 */
export function CustomerDashboard() {
  const {
    customers,
    kpis,
    loading,
    error,
    getSalesFor,
    getProductName,
    createCustomer,
    updateCustomer,
    deleteCustomer
  } = useCustomers();

  // PASO 1.10 (offline elegante en Clientes) — cuántos clientes creados sin
  // conexión siguen esperando sincronizarse, para el badge del encabezado.
  const { count: pendingCustomersCount } = usePendingCustomerOperationsQueue();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [selected, setSelected] = useState<CustomerWithStats | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CustomerWithStats | null>(null);

  // PASO 6 — Comandos Inteligentes: si el Copiloto pidió "buscar cliente X",
  // el buscador se prellena solo al llegar (o si ya estábamos en esta página).
  useCommandIntent("SEARCH_CUSTOMER", (intent) => {
    setSearch(intent.params?.query ?? "");
  });

  const neverPurchased = useMemo(() => getNeverPurchased(customers), [customers]);

  // Buscador instantáneo: el texto de cada cliente se prepara UNA vez por lista
  // (índice) y cada tecla solo compara contra eso. El campo de texto se
  // actualiza al instante; el filtrado usa el valor "diferido", así que con
  // miles de clientes escribir nunca se siente trabado.
  const searchIndex = useMemo(() => buildCustomerSearchIndex(customers), [customers]);
  const deferredSearch = useDeferredValue(search);

  const filtered = useMemo(
    () => filterAndSortWithIndex(searchIndex, deferredSearch, sort),
    [searchIndex, deferredSearch, sort]
  );

  function handleSort(key: SortKey) {
    setSort((current) => nextSortState(current, key));
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-11 w-36 rounded-xl" />
        </div>
        <SkeletonCards count={4} />
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <SkeletonRows rows={6} columns={6} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold text-white">Clientes</h1>
            <OfflineStatusBadge
              pendingCount={pendingCustomersCount}
              pendingLabelSingular="1 cliente pendiente"
              pendingLabelPlural="{count} clientes pendientes"
            />
          </div>
          <p className="text-slate-400 text-sm mt-1">
            Base de clientes, historial de compras y fidelización.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 bg-vimdy-accent hover:bg-vimdy-accent-hover transition px-4 py-2.5 rounded-vimdy-md text-white font-semibold self-start sm:self-auto mt-14 sm:mt-16 focus-visible:outline-none focus-visible:shadow-vimdy-accent"
        >
          <UserPlus size={18} />
          Nuevo cliente
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-sm px-4 py-3">
          {error}
        </div>
      )}

      {customers.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="Todavía no tienes clientes."
          description="Registra tu primer cliente para empezar a construir su historial de compras y fidelización."
          action={{ label: "Crear mi primer cliente", onClick: () => setCreating(true), icon: <UserPlus size={18} /> }}
        />
      ) : (
        <>
          <CustomerKpiGrid kpis={kpis} />

          <NeverPurchasedBanner customers={neverPurchased} onSelect={setSelected} />

          <CustomerTable
            customers={filtered}
            totalCount={customers.length}
            search={search}
            sortKey={sort.key}
            sortDir={sort.dir}
            onSearchChange={setSearch}
            onSort={handleSort}
            onSelect={setSelected}
            onEdit={setEditing}
          />
        </>
      )}

      {selected && (
        <CustomerDetailModal
          customer={selected}
          fetchSales={getSalesFor}
          getProductName={getProductName}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected);
            setSelected(null);
          }}
          onDelete={async () => {
            const target = selected;
            const accepted = await confirmDialog({
              title: "Eliminar cliente",
              message: `¿Eliminar a ${target.name}? Esta acción no se puede deshacer.`,
              confirmLabel: "Eliminar",
              danger: true
            });
            if (!accepted) return;
            const ok = await deleteCustomer(target.id);
            if (ok) setSelected(null);
          }}
        />
      )}

      {(creating || editing) && (
        <CustomerFormModal
          customer={editing}
          existingCustomers={customers}
          error={error}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={async (values) => {
            const ok = editing
              ? await updateCustomer({ ...editing, ...normalizeCustomerFields(values) })
              : await createCustomer(values);
            if (ok) {
              setCreating(false);
              setEditing(null);
            }
          }}
        />
      )}
    </div>
  );
}