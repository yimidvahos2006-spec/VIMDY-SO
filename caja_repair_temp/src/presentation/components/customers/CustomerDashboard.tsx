import React, { useEffect, useMemo, useState } from "react";
import { useCommandIntent } from "../../../hooks/useCommandIntent";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton, SkeletonCards, SkeletonRows } from "../ui/Skeleton";
import {
  Search,
  Users,
  Sparkles,
  Wallet,
  Crown,
  Award,
  Medal,
  Star,
  UserPlus,
  X,
  Pencil,
  Trash2,
  Receipt,
  Phone,
  Mail,
  Calendar,
  Loader2
} from "lucide-react";

import {
  useCustomers,
  getLoyaltyInfo,
  CustomerWithStats
} from "../../../core/store/useCustomers";
import { Customer, Sale } from "../../../core/entities/Entities";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { OfflineStatusBadge } from "../ui/OfflineStatusBadge";
import { usePendingCustomerOperationsQueue } from "../../../core/offline/usePendingCustomerOperationsQueue";

const LEVEL_ICON: Record<string, React.ElementType> = {
  oro: Crown,
  plata: Award,
  bronce: Medal
};

const LEVEL_CLASS: Record<string, string> = {
  oro: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  plata: "text-slate-300 bg-slate-400/10 border-slate-400/30",
  bronce: "text-orange-400 bg-orange-500/10 border-orange-500/30"
};

function LevelBadge({ points }: { points: number }) {
  const level = getLoyaltyInfo(points);
  const Icon = LEVEL_ICON[level.level];
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${LEVEL_CLASS[level.level]}`}
    >
      <Icon size={11} />
      {level.label}
    </span>
  );
}

type SortKey = "name" | "ltv" | "points" | "purchases";

export function CustomerDashboard() {
  const { money } = useTranslation();

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
  // conexión siguen esperando sincronizarse, para el badge del encabezado
  // (ver OfflineStatusBadge más abajo).
  const { count: pendingCustomersCount } = usePendingCustomerOperationsQueue();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("ltv");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<CustomerWithStats | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CustomerWithStats | null>(null);

  // PASO 6 — Comandos Inteligentes: si el Copiloto pidió "buscar cliente X",
  // el buscador se prellena solo al llegar (o si ya estábamos en esta página).
  useCommandIntent("SEARCH_CUSTOMER", (intent) => {
    setSearch(intent.params?.query ?? "");
  });

  // Clientes que ya están registrados en la base pero todavía no han hecho
  // ninguna compra pagada. purchaseCount ya lo calcula useCustomers (LTV +
  // conteo de ventas por cliente) — acá solo se lee, no se inventa un
  // cálculo nuevo. Es la misma noción de "cliente inactivo" que ya existe
  // en CustomerAI.getInactiveCustomers, aplicada directo a los datos que
  // esta pantalla ya tiene en memoria.
  const neverPurchased = useMemo(
    () => customers.filter((c) => c.purchaseCount === 0),
    [customers]
  );

  const filtered = useMemo(() => {
    let list = customers;

    if (search.trim() !== "") {
      const value = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(value) ||
          (c.phone ?? "").includes(value) ||
          (c.email ?? "").toLowerCase().includes(value)
      );
    }

    const sorted = [...list].sort((a, b) => {
      let diff = 0;
      if (sortKey === "name") diff = a.name.localeCompare(b.name);
      if (sortKey === "ltv") diff = a.ltv - b.ltv;
      if (sortKey === "points") diff = (a.points ?? 0) - (b.points ?? 0);
      if (sortKey === "purchases") diff = a.purchaseCount - b.purchaseCount;
      return sortDir === "asc" ? diff : -diff;
    });

    return sorted;
  }, [customers, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
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
          className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 transition px-4 py-2.5 rounded-xl text-slate-950 font-semibold self-start sm:self-auto mt-14 sm:mt-16"
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
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Users size={20} className="text-cyan-400" />}
          label="Total de clientes"
          value={kpis.totalCustomers.toString()}
        />
        <KpiCard
          icon={<Wallet size={20} className="text-green-400" />}
          label="Valor generado (LTV)"
          value={money(kpis.totalLtv)}
        />
        <KpiCard
          icon={<Sparkles size={20} className="text-yellow-400" />}
          label="Puntos acumulados"
          value={kpis.totalPoints.toLocaleString("es-CO")}
        />
        <KpiCard
          icon={<Crown size={20} className="text-orange-400" />}
          label="Mejor cliente"
          value={kpis.topCustomer ? kpis.topCustomer.name : "—"}
        />
      </div>

      {neverPurchased.length > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-amber-300 text-sm font-semibold">
                {neverPurchased.length === 1
                  ? "1 cliente registrado todavía no ha comprado"
                  : `${neverPurchased.length} clientes registrados todavía no han comprado`}
              </p>
              <p className="text-slate-400 text-xs mt-1">
                Buena oportunidad para una primera compra con un incentivo o recordatorio.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 max-w-full">
              {neverPurchased.slice(0, 6).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="text-xs bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 text-amber-200 rounded-full px-3 py-1.5 transition"
                >
                  {c.name}
                </button>
              ))}
              {neverPurchased.length > 6 && (
                <span className="text-xs text-slate-500 self-center">
                  +{neverPurchased.length - 6} más
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-700 bg-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-700">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, teléfono o correo..."
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-vimdy-surface border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-700">
                <SortableHeader label="Cliente" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                <th className="px-4 py-3 font-medium">Contacto</th>
                <th className="px-4 py-3 font-medium">Nivel</th>
                <SortableHeader label="Puntos" active={sortKey === "points"} dir={sortDir} onClick={() => toggleSort("points")} />
                <SortableHeader label="Compras" active={sortKey === "purchases"} dir={sortDir} onClick={() => toggleSort("purchases")} />
                <SortableHeader label="Valor generado" active={sortKey === "ltv"} dir={sortDir} onClick={() => toggleSort("ltv")} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No se encontraron clientes.
                  </td>
                </tr>
              )}
              {filtered.map((customer) => (
                <tr
                  key={customer.id}
                  onClick={() => setSelected(customer)}
                  className="border-b border-slate-800 hover:bg-slate-700/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-white font-medium">{customer.name}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {customer.phone || customer.email || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <LevelBadge points={customer.points ?? 0} />
                  </td>
                  <td className="px-4 py-3 text-white">{(customer.points ?? 0).toLocaleString("es-CO")}</td>
                  <td className="px-4 py-3 text-slate-300">{customer.purchaseCount}</td>
                  <td className="px-4 py-3 text-cyan-400 font-semibold">{money(customer.ltv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
            if (confirm(`¿Eliminar a ${selected.name}? Esta acción no se puede deshacer.`)) {
              const ok = await deleteCustomer(selected.id);
              if (ok) setSelected(null);
            }
          }}
        />
      )}

      {(creating || editing) && (
        <CustomerFormModal
          customer={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={async (values) => {
            const ok = editing
              ? await updateCustomer({ ...editing, ...values })
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

function KpiCard({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4 flex items-center gap-3">
      <div className="w-11 h-11 rounded-xl bg-vimdy-surface flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-slate-400 text-xs">{label}</p>
        <p className="text-white text-xl font-bold truncate">{value}</p>
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  active,
  dir,
  onClick
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-4 py-3 font-medium cursor-pointer select-none hover:text-white transition-colors ${
        active ? "text-cyan-400" : ""
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <span className="text-xs">{dir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}

function CustomerDetailModal({
  customer,
  fetchSales,
  getProductName,
  onClose,
  onEdit,
  onDelete
}: {
  customer: CustomerWithStats;
  fetchSales: (customerId: string) => Promise<Sale[]>;
  getProductName: (id: string) => string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { money } = useTranslation();
  const level = getLoyaltyInfo(customer.points ?? 0);
  const Icon = LEVEL_ICON[level.level];

  // FASE 3 (Optimización): el historial de compras de este cliente ya no
  // viene precargado desde afuera — se pide justo al abrir la ficha, y
  // mientras tanto se muestra un estado de carga real (spinner), no un
  // "Cargando..." mudo ni, peor, una lista vacía que parece decir "sin
  // compras" cuando en realidad todavía no llegó la respuesta.
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [salesError, setSalesError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSales(null);
    setSalesError(false);

    fetchSales(customer.id)
      .then((result) => {
        if (!cancelled) setSales(result);
      })
      .catch(() => {
        if (!cancelled) setSalesError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [customer.id, fetchSales]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-vimdy-surface border border-slate-700 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-14 h-14 rounded-full bg-cyan-500 flex items-center justify-center flex-shrink-0 text-slate-950 font-bold text-xl">
              {customer.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h3 className="text-white font-bold text-lg truncate">{customer.name}</h3>
              <div className="flex items-center gap-1.5 mt-1">
                <Icon size={13} className="text-yellow-400" />
                <span className="text-slate-300 text-xs font-semibold">Cliente {level.label}</span>
                <div className="flex items-center gap-0.5 ml-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      size={11}
                      className={i < level.stars ? "text-yellow-400 fill-yellow-400" : "text-slate-600"}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white flex-shrink-0">
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <MiniStat label="Puntos" value={(customer.points ?? 0).toLocaleString("es-CO")} />
          <MiniStat label="Compras" value={customer.purchaseCount.toString()} />
          <MiniStat label="Valor total" value={money(customer.ltv)} />
        </div>

        <div className="space-y-2 mb-4 text-sm">
          {customer.phone && (
            <div className="flex items-center gap-2 text-slate-300">
              <Phone size={14} className="text-slate-500" />
              {customer.phone}
            </div>
          )}
          {customer.email && (
            <div className="flex items-center gap-2 text-slate-300">
              <Mail size={14} className="text-slate-500" />
              {customer.email}
            </div>
          )}
          {customer.lastPurchaseAt && (
            <div className="flex items-center gap-2 text-slate-300">
              <Calendar size={14} className="text-slate-500" />
              Última compra: {customer.lastPurchaseAt.toLocaleDateString("es-CO")}
            </div>
          )}
        </div>

        <div className="flex gap-2 mb-4">
          <button
            onClick={onEdit}
            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-slate-800 border border-slate-700 hover:border-cyan-500 text-white text-sm font-semibold transition"
          >
            <Pencil size={14} />
            Editar
          </button>
          <button
            onClick={onDelete}
            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-300 text-sm font-semibold transition"
          >
            <Trash2 size={14} />
            Eliminar
          </button>
        </div>

        <div>
          <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wide mb-2">
            <Receipt size={13} />
            Historial de compras
          </div>
          {sales === null ? (
            <div className="flex items-center justify-center gap-2 py-6 text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin" />
              Cargando historial...
            </div>
          ) : salesError ? (
            <p className="text-red-300 text-sm py-4 text-center">
              No se pudo cargar el historial. Intenta de nuevo.
            </p>
          ) : sales.length === 0 ? (
            <p className="text-slate-500 text-sm py-4 text-center">
              Este cliente aún no tiene compras registradas.
            </p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {sales.map((sale) => (
                <div
                  key={sale.id}
                  className="rounded-xl border border-slate-800 bg-slate-800/60 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-white text-sm font-semibold">
                      {sale.code ?? sale.id.slice(0, 8)}
                    </span>
                    <span className="text-cyan-400 text-sm font-bold">{money(sale.total)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-slate-500 text-xs">
                      {new Date(sale.createdAt).toLocaleString("es-CO")}
                    </span>
                    <span className="text-slate-500 text-xs">
                      {sale.items.length} {sale.items.length === 1 ? "producto" : "productos"}
                    </span>
                  </div>
                  <p className="text-slate-400 text-xs mt-1 truncate">
                    {sale.items.map((item) => getProductName(item.productId)).join(", ")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-center">
      <p className="text-white font-bold text-sm truncate">{value}</p>
      <p className="text-slate-500 text-xs mt-0.5">{label}</p>
    </div>
  );
}

function CustomerFormModal({
  customer,
  onClose,
  onSubmit
}: {
  customer: Customer | null;
  onClose: () => void;
  onSubmit: (values: { name: string; email?: string; phone?: string }) => Promise<void>;
}) {
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({ name, email, phone });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-vimdy-surface border border-slate-700 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-bold">
            {customer ? "Editar cliente" : "Nuevo cliente"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400">Nombre</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del cliente"
              className="mt-1 w-full h-11 rounded-xl bg-slate-800 border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Teléfono (opcional)</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="300 000 0000"
              className="mt-1 w-full h-11 rounded-xl bg-slate-800 border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Correo (opcional)</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@correo.com"
              className="mt-1 w-full h-11 rounded-xl bg-slate-800 border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 h-11 rounded-xl bg-slate-800 border border-slate-700 text-white font-semibold text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={!name.trim() || saving}
              className="flex-1 h-11 rounded-xl bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-slate-950 font-bold text-sm"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}