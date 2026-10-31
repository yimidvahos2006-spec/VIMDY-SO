import React, { useMemo, useState } from "react";
import {
  Bell,
  Boxes,
  Clock,
  Wallet,
  Target,
  Sparkles,
  StickyNote,
  CheckCheck,
  Trash2,
  X,
  Plus,
  Inbox,
  CreditCard
} from "lucide-react";

import { useNotifications, NOTIFICATION_CATEGORIES } from "../../../core/store/useNotifications";
import type { Notification, NotificationCategory } from "../../../core/store/notificationStore";

/**
 * NotificationCenter
 * ---------------------------------------------------------------------------
 * PASO 5 — Centro de notificaciones.
 *
 * Vista completa (no el desplegable de la campana) que agrupa TODAS las
 * notificaciones del negocio por categoría:
 *
 *   📦 Stock bajo             → notificationStore.addStockAlert (useAutoAlerts)
 *   ⏱️ Pedido retrasado        → notificationStore.addOrderDelay (useAutoAlerts)
 *   💰 Caja abierta            → notificationStore.addCashOpen (ShiftPanel)
 *   🎯 Meta cumplida           → notificationStore.addGoalReached (useAutoAlerts)
 *   ✨ IA recomienda comprar   → notificationStore.addPurchaseRecommendation (useAutoAlerts)
 *   📝 Recordatorios           → notificationStore.addReminder (manual, desde aquí)
 *
 * Reutiliza notificationStore/useNotifications — mismo dato que alimenta a
 * NotificationBell, así que marcar como leída aquí también limpia el punto
 * rojo de la campana y viceversa.
 */

const CATEGORY_META: Record<
  NotificationCategory,
  { label: string; icon: React.ElementType; accent: string; badge: string }
> = {
  STOCK_BAJO: {
    label: "Stock bajo",
    icon: Boxes,
    accent: "text-orange-400",
    badge: "bg-orange-500/15 text-orange-300 border-orange-500/30"
  },
  PEDIDO_RETRASADO: {
    label: "Pedido retrasado",
    icon: Clock,
    accent: "text-red-400",
    badge: "bg-red-500/15 text-red-300 border-red-500/30"
  },
  CAJA_ABIERTA: {
    label: "Caja abierta",
    icon: Wallet,
    accent: "text-emerald-400",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
  },
  META_CUMPLIDA: {
    label: "Meta cumplida",
    icon: Target,
    accent: "text-cyan-400",
    badge: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
  },
  IA_COMPRA: {
    label: "IA recomienda comprar",
    icon: Sparkles,
    accent: "text-violet-400",
    badge: "bg-violet-500/15 text-violet-300 border-violet-500/30"
  },
  RECORDATORIO: {
    label: "Recordatorios",
    icon: StickyNote,
    accent: "text-yellow-400",
    badge: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"
  },
  SUSCRIPCION: {
    label: "Suscripción",
    icon: CreditCard,
    accent: "text-vimdy-accent",
    badge: "bg-vimdy-accent/15 text-vimdy-accent border-vimdy-accent/30"
  },
  GENERAL: {
    label: "General",
    icon: Bell,
    accent: "text-slate-400",
    badge: "bg-slate-500/15 text-slate-300 border-slate-500/30"
  }
};

/** Categorías visibles como pestañas (GENERAL solo aparece si trae datos). */
const VISIBLE_CATEGORIES = NOTIFICATION_CATEGORIES.filter((c) => c !== "GENERAL");

function timeAgo(date: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "ahora mismo";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

type FilterTab = "TODAS" | NotificationCategory;

export function NotificationCenter() {
  const {
    notifications,
    unreadCount,
    byCategory,
    unreadByCategory,
    markAsRead,
    markAllAsRead,
    remove,
    clear,
    addReminder
  } = useNotifications();

  const [tab, setTab] = useState<FilterTab>("TODAS");
  const [reminderText, setReminderText] = useState("");

  const visible: Notification[] = useMemo(() => {
    if (tab === "TODAS") return notifications;
    return byCategory[tab];
  }, [tab, notifications, byCategory]);

  const categoriesToShow =
    byCategory.GENERAL.length > 0 ? [...VISIBLE_CATEGORIES, "GENERAL" as NotificationCategory] : VISIBLE_CATEGORIES;

  function handleAddReminder(event: React.FormEvent) {
    event.preventDefault();
    const text = reminderText.trim();
    if (!text) return;
    addReminder(text);
    setReminderText("");
    setTab("RECORDATORIO");
  }

  return (
    <div className="min-h-full w-full bg-black">
      <div className="mx-auto w-full max-w-[1800px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        {/* Cabecera: título a la izquierda, acciones a la derecha */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-vimdy-border bg-vimdy-surface">
              <Bell className="text-cyan-400" size={22} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold leading-tight tracking-tight text-zinc-50">
                Centro de notificaciones
              </h1>
              <p className="text-sm text-zinc-500">
                {unreadCount > 0 ? `${unreadCount} sin leer` : "Todo al día"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex h-10 items-center gap-2 rounded-xl border border-vimdy-border bg-vimdy-surface px-4 text-sm font-medium text-zinc-300 transition hover:border-cyan-500/40 hover:text-cyan-400"
              >
                <CheckCheck size={16} />
                Marcar todas
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={clear}
                className="flex h-10 items-center gap-2 rounded-xl border border-vimdy-border bg-vimdy-surface px-4 text-sm font-medium text-zinc-400 transition hover:border-red-500/40 hover:text-red-400"
              >
                <Trash2 size={16} />
                Vaciar
              </button>
            )}
          </div>
        </header>

        {/* Nuevo recordatorio: una sola pieza (caja + botón) con bordes y fondo del sistema */}
        <form
          onSubmit={handleAddReminder}
          className="mb-5 flex h-14 items-center gap-2 rounded-2xl border border-vimdy-border bg-vimdy-surface p-1.5 pl-4 transition focus-within:border-zinc-600"
        >
          <StickyNote size={17} className="shrink-0 text-zinc-500" aria-hidden="true" />
          {/* Los `!` anulan el borde/fondo global que el CSS base le pone a todo <input> */}
          <input
            value={reminderText}
            onChange={(e) => setReminderText(e.target.value)}
            placeholder="Agregar un recordatorio (ej. Llamar al proveedor de gaseosas)"
            aria-label="Nuevo recordatorio"
            className="h-full min-w-0 flex-1 !rounded-none !border-0 !bg-transparent px-1 text-sm !text-zinc-100 shadow-none placeholder:text-zinc-600 focus-visible:!outline-none"
          />
          <button
            type="submit"
            disabled={!reminderText.trim()}
            className="flex h-full shrink-0 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-900 disabled:text-zinc-600 disabled:hover:bg-zinc-900"
          >
            <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
            Agregar
          </button>
        </form>

        {/* Filtros por categoría: una fila con scroll en móvil, envuelve en escritorio */}
        <div
          role="tablist"
          aria-label="Filtrar por categoría"
          className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden"
        >
          <TabButton
            active={tab === "TODAS"}
            label="Todas"
            count={notifications.length}
            unread={unreadCount}
            icon={Inbox}
            accent="text-zinc-200"
            onClick={() => setTab("TODAS")}
          />
          {categoriesToShow.map((cat) => {
            const meta = CATEGORY_META[cat];
            return (
              <TabButton
                key={cat}
                active={tab === cat}
                label={meta.label}
                count={byCategory[cat].length}
                unread={unreadByCategory[cat]}
                icon={meta.icon}
                accent={meta.accent}
                onClick={() => setTab(cat)}
              />
            );
          })}
        </div>

        {/* Lista de alertas */}
        <section className="overflow-hidden rounded-2xl border border-vimdy-border bg-vimdy-surface">
          {visible.length === 0 ? (
            <div className="px-6 py-20 text-center">
              <Inbox className="mx-auto mb-3 text-zinc-700" size={34} />
              <p className="text-sm font-medium text-zinc-300">Sin notificaciones aquí</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-600">
                {tab === "TODAS"
                  ? "Cuando haya stock bajo, pedidos retrasados, metas cumplidas o recomendaciones de la IA, aparecerán aquí."
                  : "Esta categoría está vacía por ahora."}
              </p>
            </div>
          ) : (
            visible.map((n) => {
              const meta = CATEGORY_META[n.category];
              const Icon = meta.icon;
              return (
                <div
                  key={n.id}
                  onClick={() => markAsRead(n.id)}
                  className={`group flex cursor-pointer items-start gap-4 border-b border-vimdy-border px-5 py-4 transition last:border-b-0 hover:bg-white/[0.03] sm:px-6 ${
                    n.read ? "opacity-55" : ""
                  }`}
                >
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${meta.badge}`}
                  >
                    <Icon size={17} className={meta.accent} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${meta.badge}`}
                      >
                        {meta.label}
                      </span>
                      {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />}
                      <span className="ml-auto shrink-0 text-xs text-zinc-600">{timeAgo(n.date)}</span>
                    </div>
                    <p className="mt-1.5 text-sm font-semibold text-zinc-100">{n.title}</p>
                    <p className="text-sm leading-relaxed text-zinc-400">{n.message}</p>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(n.id);
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-200 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label="Descartar"
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}

function TabButton(props: {
  active: boolean;
  label: string;
  count: number;
  unread: number;
  icon: React.ElementType;
  accent: string;
  onClick: () => void;
}) {
  const { active, label, count, unread, icon: Icon, accent, onClick } = props;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 ${
        active
          ? "border-zinc-600 bg-zinc-900 text-zinc-50"
          : "border-vimdy-border bg-vimdy-surface text-zinc-400 hover:border-zinc-700 hover:bg-zinc-950 hover:text-zinc-200"
      }`}
    >
      <Icon size={15} className={active ? accent : "text-zinc-500"} aria-hidden="true" />
      {label}
      <span className={`text-xs tabular-nums ${active ? "text-zinc-400" : "text-zinc-600"}`}>{count}</span>
      {unread > 0 && <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" aria-label="Sin leer" />}
    </button>
  );
}

export default NotificationCenter;