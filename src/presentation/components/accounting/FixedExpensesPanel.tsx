import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Receipt, ShieldAlert, Trash2, TriangleAlert } from "lucide-react";

import {
  filterByBranchScope,
  formatMonthLabel,
  formatShortDate,
  monthKeyOfDate,
  shiftMonth,
  summarizeFixedExpenses,
  type BranchScope,
  type MonthKey
} from "../../../core/domain/accounting/fixedExpenseSummary";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { confirmDialog } from "../../../core/store/confirmStore";
import { toast } from "../../../core/store/toastStore";
import {
  FIXED_EXPENSE_CATEGORIES,
  FIXED_EXPENSE_CATEGORY_LABELS,
  type FixedExpense,
  type FixedExpenseCategory
} from "../../../core/types/fixedExpense";
import { getBusinessTodayIsoDate } from "../../../core/utils/isoDate";
import { deleteFixedExpense } from "../../../infrastructure/supabase/fixedExpenseService";
import { getBranches } from "../../../infrastructure/supabase/supabaseClient";
import { useAuth } from "../../context/AuthContext";
import { useFixedExpenses } from "../../hooks/useFixedExpenses";
import { EmptyState } from "../ui/EmptyState";
import { SkeletonCards, SkeletonRows } from "../ui/Skeleton";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdySelect } from "../ui/VimdySelect";
import { FixedExpenseFormModal, type ExpenseBranchOption } from "./FixedExpenseFormModal";
import { CATEGORY_STYLE, EXPENSE_VIEW_ROLES, EXPENSE_WRITE_ROLES, roleIn } from "./fixedExpenseStyles";

type CategoryFilter = FixedExpenseCategory | "all";
/** "all" = todo el negocio · "global" = solo gastos sin sucursal · otro valor = id de sucursal. */
type BranchFilter = string;

function toBranchScope(filter: BranchFilter): BranchScope {
  if (filter === "all") return undefined;
  if (filter === "global") return null;
  return filter;
}

/**
 * VIMDY Contable — Gastos fijos.
 * Vista de un mes: totales en vivo, filtros por categoría/sucursal y tabla.
 * Los filtros se aplican en pantalla sobre el mes ya cargado (sin esperas).
 */
export function FixedExpensesPanel() {
  const { businessId, role } = useAuth();
  const { money } = useTranslation();

  const canView = roleIn(role?.name, EXPENSE_VIEW_ROLES);
  const canWrite = roleIn(role?.name, EXPENSE_WRITE_ROLES);

  const currentMonth = useMemo<MonthKey>(() => monthKeyOfDate(getBusinessTodayIsoDate()), []);
  const [month, setMonth] = useState<MonthKey>(currentMonth);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [branchFilter, setBranchFilter] = useState<BranchFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [branches, setBranches] = useState<ExpenseBranchOption[]>([]);

  const { expenses, loading, error, reload, addLocal, removeLocal } = useFixedExpenses(
    canView ? businessId : null,
    month
  );

  // Sucursales activas (solo para el filtro y el nombre en la tabla; si falla, la vista sigue sin ellas).
  useEffect(() => {
    if (!businessId || !canView) return;
    let cancelled = false;
    getBranches(businessId)
      .then((rows) => {
        if (!cancelled) setBranches(rows.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name })));
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, canView]);

  const branchNames = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

  // Totales: respetan la sucursal elegida; las "chips" muestran cada categoría aunque haya un filtro activo.
  const scoped = useMemo(() => filterByBranchScope(expenses, toBranchScope(branchFilter)), [expenses, branchFilter]);
  const summary = useMemo(() => summarizeFixedExpenses(scoped), [scoped]);
  const visible = useMemo(
    () => (category === "all" ? scoped : scoped.filter((e) => e.category === category)),
    [scoped, category]
  );
  const visibleTotal = category === "all" ? summary.total : summary.byCategory[category].total;

  async function handleDelete(expense: FixedExpense) {
    const label = expense.description || FIXED_EXPENSE_CATEGORY_LABELS[expense.category];
    const ok = await confirmDialog({
      title: "Eliminar gasto",
      message: `¿Eliminar «${label}» por ${money(expense.amount)}? Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar",
      danger: true
    });
    if (!ok || !businessId) return;

    setDeletingId(expense.id);
    try {
      await deleteFixedExpense(businessId, expense.id);
      removeLocal(expense.id);
      toast.success("Gasto eliminado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo eliminar el gasto.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleSaved(expense: FixedExpense) {
    const savedMonth = monthKeyOfDate(expense.expenseDate);
    if (savedMonth === month) addLocal(expense);
    else setMonth(savedMonth); // el gasto es de otro mes: se muestra ese mes para que la persona lo vea
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20">
        <ShieldAlert className="w-10 h-10 text-vimdy-text-tertiary mb-3" aria-hidden="true" />
        <p className="text-lg font-semibold text-vimdy-text">Acceso restringido</p>
        <p className="text-sm text-vimdy-text-secondary mt-1 max-w-sm">
          Los gastos fijos los ven el administrador, el gerente y el contador.
        </p>
      </div>
    );
  }

  const monthLabel = formatMonthLabel(month);
  const monthTitle = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  const showBranchFilter = branches.length > 1;
  const isEmptyMonth = !loading && !error && expenses.length === 0;
  const total = summary.total;

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Gastos fijos</h1>
          <p className="text-vimdy-text-secondary text-sm mt-1">
            Arriendo, servicios, nómina y más: todo lo que sale cada mes.
          </p>
        </div>
        {canWrite && (
          <VimdyButton icon={<Plus size={18} aria-hidden="true" />} onClick={() => setModalOpen(true)}>
            Registrar gasto
          </VimdyButton>
        )}
      </div>

      {/* Filtros: mes + sucursal */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Mes"
          className="inline-flex items-center rounded-vimdy-md border border-vimdy-border bg-vimdy-surface"
        >
          <button
            type="button"
            aria-label="Mes anterior"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            className="h-11 w-11 flex items-center justify-center text-vimdy-text-secondary hover:text-vimdy-text transition rounded-l-vimdy-md focus-visible:outline-none focus-visible:shadow-vimdy-accent"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <span aria-live="polite" className="min-w-[10rem] px-2 text-center text-sm font-semibold text-vimdy-text">
            {monthTitle}
          </span>
          <button
            type="button"
            aria-label="Mes siguiente"
            disabled={month >= currentMonth}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            className="h-11 w-11 flex items-center justify-center text-vimdy-text-secondary hover:text-vimdy-text transition rounded-r-vimdy-md disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:shadow-vimdy-accent"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>

        {month !== currentMonth && (
          <button
            type="button"
            onClick={() => setMonth(currentMonth)}
            className="h-11 px-3 text-sm font-semibold text-vimdy-accent-hover hover:text-vimdy-text transition"
          >
            Ir al mes actual
          </button>
        )}

        {showBranchFilter && (
          <div className="w-full sm:w-56 sm:ml-auto">
            <VimdySelect
              aria-label="Filtrar por sucursal"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
            >
              <option value="all">Todo el negocio</option>
              <option value="global">Solo gastos generales</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </VimdySelect>
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-sm text-vimdy-danger"
        >
          <TriangleAlert size={18} aria-hidden="true" className="flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void reload()} className="font-semibold underline underline-offset-2">
            Reintentar
          </button>
        </div>
      )}

      {loading && expenses.length === 0 ? (
        <>
          <SkeletonCards count={3} />
          <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface py-4">
            <SkeletonRows rows={5} columns={4} />
          </div>
        </>
      ) : isEmptyMonth ? (
        <EmptyState
          icon={<Receipt size={28} aria-hidden="true" />}
          title={`Sin gastos en ${monthLabel}`}
          description={
            canWrite
              ? "Registra tu arriendo, servicios o nómina para ver cuánto te cuesta operar cada mes."
              : "Todavía no hay gastos registrados en este mes."
          }
        />
      ) : (
        <>
          {/* Totales en vivo */}
          <section aria-label="Totales del mes" className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <SummaryCard label={`Total de ${monthLabel}`} value={money(total)} detail={`${summary.count} ${summary.count === 1 ? "gasto" : "gastos"}`} emphasized className="col-span-2 sm:col-span-1" />
            <SummaryCard
              label="Categoría más alta"
              value={summary.topCategory ? FIXED_EXPENSE_CATEGORY_LABELS[summary.topCategory] : "—"}
              detail={summary.topCategory ? `${money(summary.byCategory[summary.topCategory].total)} · ${Math.round((summary.byCategory[summary.topCategory].total / total) * 100)}% del total` : "Sin gastos"}
            />
            <SummaryCard
              label={category === "all" ? "Promedio por gasto" : `Total de ${FIXED_EXPENSE_CATEGORY_LABELS[category]}`}
              value={category === "all" ? money(summary.count > 0 ? total / summary.count : 0) : money(visibleTotal)}
              detail={category === "all" ? "En el periodo mostrado" : `${summary.byCategory[category].count} ${summary.byCategory[category].count === 1 ? "gasto" : "gastos"}`}
            />
          </section>

          {/* Distribución + filtro por categoría */}
          <section aria-label="Filtrar por categoría" className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-4 space-y-4">
            {total > 0 && (
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-vimdy-surface-active" aria-hidden="true">
                {FIXED_EXPENSE_CATEGORIES.map((c) =>
                  summary.byCategory[c].total > 0 ? (
                    <div
                      key={c}
                      className={`${CATEGORY_STYLE[c].dot} transition-all duration-vimdy-fast`}
                      style={{ width: `${(summary.byCategory[c].total / total) * 100}%` }}
                    />
                  ) : null
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <CategoryChip active={category === "all"} onClick={() => setCategory("all")} label="Todas" amount={money(total)} />
              {FIXED_EXPENSE_CATEGORIES.map((c) => (
                <CategoryChip
                  key={c}
                  active={category === c}
                  onClick={() => setCategory(category === c ? "all" : c)}
                  label={FIXED_EXPENSE_CATEGORY_LABELS[c]}
                  amount={money(summary.byCategory[c].total)}
                  dotClass={CATEGORY_STYLE[c].dot}
                  muted={summary.byCategory[c].count === 0}
                />
              ))}
            </div>
          </section>

          {/* Tabla */}
          <section aria-label="Lista de gastos" className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface overflow-hidden">
            {visible.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-vimdy-text font-semibold">No hay gastos con estos filtros.</p>
                <button
                  type="button"
                  onClick={() => {
                    setCategory("all");
                    setBranchFilter("all");
                  }}
                  className="mt-4 h-9 px-4 rounded-vimdy-sm border border-vimdy-border text-vimdy-text text-sm font-semibold hover:border-vimdy-accent transition"
                >
                  Quitar filtros
                </button>
              </div>
            ) : (
              <>
                {/* Escritorio / tablet */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-vimdy-text-secondary text-xs uppercase tracking-wide border-b border-vimdy-border bg-vimdy-background/30">
                        <th scope="col" className="px-4 py-3 font-medium text-left">Fecha</th>
                        <th scope="col" className="px-3 py-3 font-medium text-left">Categoría</th>
                        <th scope="col" className="px-3 py-3 font-medium text-left">Descripción</th>
                        {showBranchFilter && <th scope="col" className="px-3 py-3 font-medium text-left">Sucursal</th>}
                        <th scope="col" className="px-3 py-3 font-medium text-right">Valor</th>
                        {canWrite && (
                          <th scope="col" className="px-3 py-3 font-medium text-right">
                            <span className="sr-only">Acciones</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-vimdy-border">
                      {visible.map((expense) => (
                        <tr key={expense.id} className="hover:bg-vimdy-surface-hover transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap text-vimdy-text-secondary">{formatShortDate(expense.expenseDate)}</td>
                          <td className="px-3 py-3"><CategoryBadge category={expense.category} /></td>
                          <td className="px-3 py-3 text-vimdy-text max-w-xs truncate" title={expense.description || undefined}>
                            {expense.description || <span className="text-vimdy-text-tertiary">—</span>}
                          </td>
                          {showBranchFilter && (
                            <td className="px-3 py-3 text-vimdy-text-secondary whitespace-nowrap">
                              {expense.branchId ? branchNames.get(expense.branchId) ?? "Sucursal" : "Todo el negocio"}
                            </td>
                          )}
                          <td className="px-3 py-3 text-right font-semibold tabular-nums text-vimdy-text whitespace-nowrap">{money(expense.amount)}</td>
                          {canWrite && (
                            <td className="px-3 py-3 text-right">
                              <DeleteButton expense={expense} busy={deletingId === expense.id} onDelete={handleDelete} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Celular */}
                <ul className="md:hidden divide-y divide-vimdy-border">
                  {visible.map((expense) => (
                    <li key={expense.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <CategoryBadge category={expense.category} />
                          <span className="text-xs text-vimdy-text-secondary">{formatShortDate(expense.expenseDate)}</span>
                        </div>
                        <p className="text-sm text-vimdy-text truncate">{expense.description || FIXED_EXPENSE_CATEGORY_LABELS[expense.category]}</p>
                        {showBranchFilter && (
                          <p className="text-xs text-vimdy-text-tertiary">
                            {expense.branchId ? branchNames.get(expense.branchId) ?? "Sucursal" : "Todo el negocio"}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums text-vimdy-text">{money(expense.amount)}</span>
                        {canWrite && <DeleteButton expense={expense} busy={deletingId === expense.id} onDelete={handleDelete} />}
                      </div>
                    </li>
                  ))}
                </ul>

                {/* Total de lo que se ve en la tabla */}
                <div className="flex items-center justify-between gap-4 border-t border-vimdy-border bg-vimdy-background/30 px-4 py-3">
                  <span role="status" aria-live="polite" className="text-xs text-vimdy-text-secondary">
                    {visible.length} {visible.length === 1 ? "gasto" : "gastos"}
                    {category !== "all" ? ` de ${FIXED_EXPENSE_CATEGORY_LABELS[category]}` : ""}
                  </span>
                  <span className="text-sm text-vimdy-text">
                    <span className="text-vimdy-text-secondary mr-2">Total mostrado</span>
                    <span className="font-bold tabular-nums">{money(visibleTotal)}</span>
                  </span>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {businessId && (
        <FixedExpenseFormModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          businessId={businessId}
          branches={branches}
          defaultCategory={category === "all" ? undefined : category}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

/* ----------------------------- Piezas pequeñas ----------------------------- */

function SummaryCard({ label, value, detail, emphasized = false, className = "" }: { label: string; value: string; detail: string; emphasized?: boolean; className?: string }) {
  return (
    <div className={`rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-4 min-w-0 ${className}`}>
      <p className="text-vimdy-text-secondary text-xs">{label}</p>
      <p title={value} className={`mt-1 font-bold truncate tabular-nums text-vimdy-text ${emphasized ? "text-2xl" : "text-xl"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-vimdy-text-tertiary truncate">{detail}</p>
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  label,
  amount,
  dotClass,
  muted = false
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  amount: string;
  dotClass?: string;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 h-10 px-3.5 rounded-vimdy-md border text-sm transition focus-visible:outline-none focus-visible:shadow-vimdy-accent ${
        active
          ? "border-vimdy-accent bg-vimdy-accent/10 text-vimdy-text"
          : "border-vimdy-border bg-vimdy-background/40 hover:border-vimdy-text-tertiary"
      } ${muted && !active ? "text-vimdy-text-tertiary" : active ? "" : "text-vimdy-text-secondary"}`}
    >
      {dotClass && <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotClass}`} />}
      <span className="font-semibold">{label}</span>
      <span className="tabular-nums text-xs opacity-80">{amount}</span>
    </button>
  );
}

function CategoryBadge({ category }: { category: FixedExpenseCategory }) {
  return (
    <span className={`inline-flex items-center rounded-vimdy-xs px-2 py-0.5 text-xs font-semibold ${CATEGORY_STYLE[category].badge}`}>
      {FIXED_EXPENSE_CATEGORY_LABELS[category]}
    </span>
  );
}

function DeleteButton({
  expense,
  busy,
  onDelete
}: {
  expense: FixedExpense;
  busy: boolean;
  onDelete: (expense: FixedExpense) => void;
}) {
  return (
    <button
      type="button"
      title="Eliminar"
      aria-label={`Eliminar gasto de ${FIXED_EXPENSE_CATEGORY_LABELS[expense.category]}`}
      disabled={busy}
      onClick={() => onDelete(expense)}
      className="inline-flex h-9 w-9 items-center justify-center rounded-vimdy-sm border border-vimdy-border bg-vimdy-background/40 text-vimdy-text-secondary transition hover:border-vimdy-danger hover:text-vimdy-danger disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-vimdy-accent"
    >
      <Trash2 size={15} aria-hidden="true" />
    </button>
  );
}