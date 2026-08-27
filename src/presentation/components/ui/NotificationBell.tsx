import React, { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, AlertTriangle, AlertCircle, CheckCircle2, Info, X } from "lucide-react";

import { useNotifications } from "../../../core/store/useNotifications";
import type { Notification } from "../../../core/store/notificationStore";

const TYPE_ICON: Record<Notification["type"], React.ElementType> = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info
};

const TYPE_COLOR: Record<Notification["type"], string> = {
  error: "text-red-400",
  warning: "text-orange-400",
  success: "text-emerald-400",
  info: "text-cyan-400"
};

function timeAgo(date: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "ahora mismo";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

/**
 * NotificationBell
 * ---------------------------------------------------------------------------
 * PASO 4 — Alertas automáticas.
 *
 * Antes: el botón de campana existía solo como decoración en un layout que
 * ni siquiera se usaba (VimdyHeader/VimdyLayout, huérfanos) — un punto rojo
 * fijo, sin datos reales ni panel.
 *
 * Ahora: se monta una sola vez en VimdyAppLayout (visible en toda la app),
 * consume notificationStore en vivo, y notificationStore se llena solo con
 * useAutoAlerts a partir de los smartAlerts reales de BusinessAnalyzer.
 */
export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead, remove } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={panelRef} className="fixed top-4 right-80 z-[60]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-3 rounded-2xl bg-slate-900/90 border border-slate-700 backdrop-blur-xl hover:border-cyan-500 transition shadow-xl"
        aria-label="Notificaciones"
      >
        <Bell size={22} className="text-slate-200" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-3 w-96 max-h-[70vh] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur-xl shadow-2xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <div>
              <h3 className="text-slate-100 font-bold">Alertas del negocio</h3>
              <p className="text-slate-400 text-xs">Generadas automáticamente por VIMDY IA</p>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-xs font-semibold"
              >
                <CheckCheck size={14} />
                Marcar todas
              </button>
            )}
          </div>

          <div className="overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-slate-500 text-sm">
                Sin alertas por ahora. Aquí verás stock bajo, ventas cayendo, pedidos retrasados o metas alcanzadas.
              </div>
            ) : (
              notifications.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Info;
                return (
                  <div
                    key={n.id}
                    onClick={() => markAsRead(n.id)}
                    className={`group flex items-start gap-3 px-4 py-3 border-b border-slate-800/70 cursor-pointer hover:bg-slate-800/50 transition ${
                      n.read ? "opacity-60" : ""
                    }`}
                  >
                    <Icon size={18} className={`mt-0.5 shrink-0 ${TYPE_COLOR[n.type]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-slate-100 text-sm font-semibold truncate">{n.title}</p>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />}
                      </div>
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
                      <X size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}