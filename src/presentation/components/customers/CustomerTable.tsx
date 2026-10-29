import React, { useEffect, useRef, useState } from "react";
import { Eye, Pencil, Phone, Search, SearchX, X } from "lucide-react";

import { CustomerWithStats } from "../../../core/store/useCustomers";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { LevelBadge } from "./LevelBadge";
import { CustomerSortableHeader } from "./CustomerSortableHeader";
import { SortDir, SortKey } from "./customerListing";

/** Cuántos clientes se pintan de una vez; el resto sale con "Mostrar más". */
const PAGE_SIZE = 50;

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "ltv", label: "Valor generado" },
  { key: "name", label: "Nombre" },
  { key: "points", label: "Puntos" },
  { key: "purchases", label: "Compras" }
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const second = parts.length > 1 ? parts[1].charAt(0) : "";
  return (first + second).toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="w-9 h-9 rounded-full bg-vimdy-accent/15 text-vimdy-accent-hover text-xs font-bold flex items-center justify-center flex-shrink-0"
    >
      {initialsOf(name)}
    </span>
  );
}

/** Los dos accesos directos de cada cliente: ver su perfil y editarlo. */
function RowActions({
  customer,
  onSelect,
  onEdit,
  fullWidth = false
}: {
  customer: CustomerWithStats;
  onSelect: (customer: CustomerWithStats) => void;
  onEdit: (customer: CustomerWithStats) => void;
  fullWidth?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 h-9 rounded-vimdy-sm border text-xs font-semibold transition focus-visible:outline-none focus-visible:shadow-vimdy-accent";
  const width = fullWidth ? "flex-1 px-3" : "w-9";

  return (
    <div className={`flex items-center gap-2 ${fullWidth ? "w-full" : "justify-end"}`}>
      <button
        type="button"
        title="Ver perfil"
        aria-label={`Ver perfil de ${customer.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(customer);
        }}
        className={`${base} ${width} border-vimdy-border bg-vimdy-background/40 text-vimdy-text-secondary hover:border-vimdy-accent hover:text-vimdy-text`}
      >
        <Eye size={15} aria-hidden="true" />
        {fullWidth && "Ver perfil"}
      </button>
      <button
        type="button"
        title="Editar"
        aria-label={`Editar a ${customer.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onEdit(customer);
        }}
        className={`${base} ${width} border-vimdy-border bg-vimdy-background/40 text-vimdy-text-secondary hover:border-vimdy-accent hover:text-vimdy-text`}
      >
        <Pencil size={14} aria-hidden="true" />
        {fullWidth && "Editar"}
      </button>
    </div>
  );
}

export function CustomerTable({
  customers,
  totalCount,
  search,
  sortKey,
  sortDir,
  onSearchChange,
  onSort,
  onSelect,
  onEdit
}: {
  customers: CustomerWithStats[];
  /** Total de clientes del negocio, sin filtrar (para "12 de 340"). */
  totalCount: number;
  search: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSearchChange: (value: string) => void;
  onSort: (key: SortKey) => void;
  onSelect: (customer: CustomerWithStats) => void;
  onEdit: (customer: CustomerWithStats) => void;
}) {
  const { money } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Al buscar u ordenar de nuevo, se vuelve a la primera página.
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [search, sortKey, sortDir]);

  // Atajo: "/" lleva el cursor al buscador desde cualquier parte de la pantalla.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const visible = customers.length > limit ? customers.slice(0, limit) : customers;
  const remaining = customers.length - visible.length;
  const hasSearch = search.trim() !== "";

  return (
    <section
      aria-label="Lista de clientes"
      className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface overflow-hidden"
    >
      {/* Barra de búsqueda */}
      <div className="p-4 border-b border-vimdy-border flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={16}
            aria-hidden="true"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-vimdy-text-tertiary pointer-events-none"
          />
          <input
            ref={searchRef}
            type="text"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && search !== "") {
                e.preventDefault();
                onSearchChange("");
              }
            }}
            aria-label="Buscar cliente por nombre o teléfono"
            placeholder="Buscar por nombre o teléfono…"
            className="w-full h-11 pl-10 pr-12 rounded-vimdy-md bg-vimdy-background/60 border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary outline-none transition focus:border-vimdy-accent focus:shadow-vimdy-accent"
          />
          {!hasSearch && (
            <kbd
              aria-hidden="true"
              className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 h-6 w-6 items-center justify-center rounded-vimdy-xs border border-vimdy-border text-[11px] text-vimdy-text-tertiary font-sans"
            >
              /
            </kbd>
          )}
          {hasSearch && (
            <button
              type="button"
              onClick={() => {
                onSearchChange("");
                searchRef.current?.focus();
              }}
              aria-label="Borrar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-vimdy-sm flex items-center justify-center text-vimdy-text-tertiary hover:text-vimdy-text hover:bg-vimdy-surface-hover transition"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <p role="status" aria-live="polite" className="text-xs text-vimdy-text-secondary whitespace-nowrap">
            {hasSearch
              ? `${customers.length} de ${totalCount} ${totalCount === 1 ? "cliente" : "clientes"}`
              : `${totalCount} ${totalCount === 1 ? "cliente" : "clientes"}`}
          </p>

          {/* En celular no hay encabezados de columna: el orden se elige aquí. */}
          <label className="xl:hidden flex items-center gap-2 text-xs text-vimdy-text-secondary">
            <span className="hidden sm:inline">Ordenar</span>
            <select
              value={sortKey}
              onChange={(e) => onSort(e.target.value as SortKey)}
              aria-label="Ordenar clientes por"
              className="h-9 min-w-0 max-w-[10.5rem] rounded-vimdy-sm bg-vimdy-background/60 border border-vimdy-border text-vimdy-text text-xs px-2 outline-none focus:border-vimdy-accent"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="px-6 py-14 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-vimdy-md bg-vimdy-background/60 border border-vimdy-border flex items-center justify-center text-vimdy-text-tertiary mb-3">
            <SearchX size={22} aria-hidden="true" />
          </div>
          <p className="text-vimdy-text font-semibold">
            {hasSearch ? `No encontramos clientes para «${search.trim()}»` : "No se encontraron clientes."}
          </p>
          {hasSearch && (
            <>
              <p className="text-vimdy-text-secondary text-sm mt-1">
                Revisa el nombre o prueba con otros números del teléfono.
              </p>
              <button
                type="button"
                onClick={() => {
                  onSearchChange("");
                  searchRef.current?.focus();
                }}
                className="mt-4 h-9 px-4 rounded-vimdy-sm border border-vimdy-border text-vimdy-text text-sm font-semibold hover:border-vimdy-accent transition"
              >
                Limpiar búsqueda
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Escritorio / tablet: tabla */}
          <div className="hidden xl:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-vimdy-text-secondary text-xs uppercase tracking-wide border-b border-vimdy-border bg-vimdy-background/30">
                  <CustomerSortableHeader label="Cliente" active={sortKey === "name"} dir={sortDir} onClick={() => onSort("name")} />
                  <th scope="col" className="px-3 py-3 font-medium text-left">Teléfono</th>
                  <th scope="col" className="px-3 py-3 font-medium text-left">Nivel</th>
                  <CustomerSortableHeader label="Puntos" align="right" active={sortKey === "points"} dir={sortDir} onClick={() => onSort("points")} />
                  <CustomerSortableHeader label="Compras" align="right" active={sortKey === "purchases"} dir={sortDir} onClick={() => onSort("purchases")} />
                  <CustomerSortableHeader label="Valor generado" align="right" active={sortKey === "ltv"} dir={sortDir} onClick={() => onSort("ltv")} />
                  <th scope="col" className="px-3 py-3 font-medium text-right">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vimdy-border">
                {visible.map((customer) => (
                  <tr
                    key={customer.id}
                    onClick={() => onSelect(customer)}
                    className="group hover:bg-vimdy-surface-hover cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={customer.name} />
                        <div className="min-w-0">
                          <p className="text-vimdy-text font-semibold truncate max-w-[14rem]">{customer.name}</p>
                          {customer.email && (
                            <p className="text-vimdy-text-tertiary text-xs truncate max-w-[14rem]">{customer.email}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {customer.phone ? (
                        <span className="inline-flex items-center gap-1.5 text-vimdy-text-secondary tabular-nums">
                          <Phone size={13} aria-hidden="true" className="text-vimdy-text-tertiary" />
                          {customer.phone}
                        </span>
                      ) : (
                        <span className="text-vimdy-text-tertiary">Sin teléfono</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <LevelBadge points={customer.points ?? 0} />
                    </td>
                    <td className="px-3 py-3 text-right text-vimdy-text tabular-nums">
                      {(customer.points ?? 0).toLocaleString("es-CO")}
                    </td>
                    <td className="px-3 py-3 text-right text-vimdy-text-secondary tabular-nums">
                      {customer.purchaseCount}
                    </td>
                    <td className="px-3 py-3 text-right text-vimdy-text font-semibold tabular-nums whitespace-nowrap">
                      {money(customer.ltv)}
                    </td>
                    <td className="px-3 py-3">
                      <RowActions customer={customer} onSelect={onSelect} onEdit={onEdit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Celular: tarjetas */}
          <ul className="xl:hidden grid gap-3 p-4 lg:grid-cols-2">
            {visible.map((customer) => (
              <li
                key={customer.id}
                className="rounded-vimdy-md border border-vimdy-border bg-vimdy-background/30 p-4 hover:border-vimdy-accent/50 transition cursor-pointer"
                onClick={() => onSelect(customer)}
              >
                <div className="flex items-start gap-3">
                  <Avatar name={customer.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-vimdy-text font-semibold truncate">{customer.name}</p>
                      <LevelBadge points={customer.points ?? 0} />
                    </div>
                    <p className="text-vimdy-text-secondary text-sm mt-0.5 tabular-nums">
                      {customer.phone || customer.email || "Sin datos de contacto"}
                    </p>
                  </div>
                </div>
                <dl className="grid grid-cols-[1fr_1fr_1.7fr] gap-2 mt-3 text-center">
                  <div className="rounded-vimdy-sm bg-vimdy-surface py-2">
                    <dt className="text-vimdy-text-tertiary text-[11px]">Puntos</dt>
                    <dd className="text-vimdy-text text-sm font-semibold tabular-nums">
                      {(customer.points ?? 0).toLocaleString("es-CO")}
                    </dd>
                  </div>
                  <div className="rounded-vimdy-sm bg-vimdy-surface py-2">
                    <dt className="text-vimdy-text-tertiary text-[11px]">Compras</dt>
                    <dd className="text-vimdy-text text-sm font-semibold tabular-nums">{customer.purchaseCount}</dd>
                  </div>
                  <div className="rounded-vimdy-sm bg-vimdy-surface py-2 min-w-0">
                    <dt className="text-vimdy-text-tertiary text-[11px]">Valor</dt>
                    <dd className="text-vimdy-text text-sm font-semibold tabular-nums truncate px-1">
                      {money(customer.ltv)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3">
                  <RowActions customer={customer} onSelect={onSelect} onEdit={onEdit} fullWidth />
                </div>
              </li>
            ))}
          </ul>

          {remaining > 0 && (
            <div className="p-4 border-t border-vimdy-border flex justify-center">
              <button
                type="button"
                onClick={() => setLimit((current) => current + PAGE_SIZE)}
                className="h-9 px-4 rounded-vimdy-sm border border-vimdy-border text-vimdy-text text-sm font-semibold hover:border-vimdy-accent transition"
              >
                Mostrar más ({remaining} restantes)
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}