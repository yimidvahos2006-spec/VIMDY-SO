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
  Inbox
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
    <div className="min-h-screen px-6 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-vimdy-surface border border-slate-800 flex items-center justify-center">
              <Bell className="text-cyan-400" size={20} />
            </div>
            <div>
              <h1 className="text-slate-100 text-xl font-bold">Centro de notificaciones</h1>
              <p className="text-slate-500 text-sm">
                {unreadCount > 0 ? `${unreadCount} sin leer` : "Todo al día"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-800 bg-vimdy-surface text-slate-300 hover:text-cyan-400 hover:border-cyan-500/40 text-sm font-medium transition"
              >
                <CheckCheck size={15} />
                Marcar todas
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={clear}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-800 bg-vimdy-surface text-slate-400 hover:text-red-400 hover:border-red-500/40 text-sm font-medium transition"
              >
                <Trash2 size={15} />
                Vaciar
              </button>
            )}
          </div>
        </div>

        {/* Nuevo recordatorio */}
        <form
          onSubmit={handleAddReminder}
          className="mb-6 flex items-center gap-2 bg-slate-900/70 border border-slate-800 rounded-2xl p-2 pl-4"
        >
          <StickyNote size={16} className="text-yellow-400 shrink-0" />
          <input
            value={reminderText}
            onChange={(e) => setReminderText(e.target.value)}
            placeholder="Agregar un recordatorio (ej. Llamar al proveedor de gaseosas)"
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 outline-none"
          />
          <button
            type="submit"
            disabled={!reminderText.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={15} />
            Agregar
          </button>
        </form>

        {/* Tabs por categoría */}
        <div className="flex flex-wrap gap-2 mb-5">
          <TabButton
            active={tab === "TODAS"}
            label="Todas"
            count={notifications.length}
            unread={unreadCount}
            icon={Inbox}
            accent="text-slate-200"
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

        {/* Lista */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
          {visible.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Inbox className="mx-auto mb-3 text-slate-700" size={32} />
              <p className="text-slate-400 text-sm font-medium">Sin notificaciones aquí</p>
              <p className="text-slate-600 text-xs mt-1">
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
                  className={`group flex items-start gap-3 px-5 py-4 border-b border-slate-800/70 last:border-b-0 cursor-pointer hover:bg-slate-800/40 transition ${
                    n.read ? "opacity-55" : ""
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${meta.badge}`}
                  >
                    <Icon size={16} className={meta.accent} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${meta.badge}`}
                      >
                        {meta.label}
                      </span>
                      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />}
                    </div>
                    <p className="text-slate-100 text-sm font-semibold mt-1">{n.title}</p>
                    <p className="text-slate-300 text-sm">{n.message}</p>
                    <p className="text-slate-500 text-xs mt-1">{timeAgo(n.date)}</p>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(n.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-300 transition shrink-0"
                    aria-label="Descartar"
                  >
                    <X size={15} />
                  </button>
                </div>
              );
            })
          )}
        </div>
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
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition ${
        active
          ? "bg-slate-800 border-slate-700 text-slate-100"
          : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
      }`}
    >
      <Icon size={15} className={active ? accent : "text-slate-500"} />
      {label}
      <span className="text-xs text-slate-500">{count}</span>
      {unread > 0 && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />}
    </button>
  );
}

export default NotificationCenter;