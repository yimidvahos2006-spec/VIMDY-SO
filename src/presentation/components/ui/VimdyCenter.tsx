import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, User, Sparkles, Settings, LogOut, ChevronDown, X, CheckCheck } from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../../core/store/useNotifications";
import { useCopilot } from "../../../core/store/useCopilot";
import { copilotStore } from "../../../core/store/copilotStore";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { getCurrentBranchId, setCurrentBranchId, getBranches } from "../../../infrastructure/supabase/supabaseClient";
import { useCashierShiftStatus } from "../../../hooks/useCashierShiftStatus";

function timeAgo(date: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "ahora mismo";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

const TYPE_ICON: Record<string, React.ElementType> = {
  error: X,
  warning: () => null,
  success: CheckCheck,
  info: Bell
};

const TYPE_COLOR: Record<string, string> = {
  error: "text-red-400",
  warning: "text-orange-400",
  success: "text-emerald-400",
  info: "text-cyan-400"
};

export function VimdyCenter() {
  const { user, role, logout, businessId } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead, remove } = useNotifications();
  const { isOpen: copilotOpen, isLoading: copilotLoading } = useCopilot();
  const shiftOpen = useCashierShiftStatus();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const currentBranchId = getCurrentBranchId();
  const currentBranch = branches.find((b) => b.id === currentBranchId);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!businessId) return;
      setLoadingBranches(true);
      try {
        const all = await getBranches(businessId);
        if (!cancelled) setBranches(all);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoadingBranches(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
        setNotifOpen(false);
      }
    }
    if (open || notifOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, notifOpen]);

  if (!user) return null;

  const hasMultiple = branches.length > 1;

  return (
    <div ref={panelRef} className="relative flex items-center gap-2">
      {/* Botón principal: Perfil + Campana + IA */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-10 px-3 rounded-xl bg-slate-900/90 border border-slate-700 hover:border-cyan-500 transition shadow-lg"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300">
          <User size={14} />
        </div>
        <div className="hidden md:flex flex-col items-start leading-tight">
          <span className="text-xs font-semibold text-white max-w-[100px] truncate">{user.name}</span>
          <span className="text-[10px] text-slate-400">{role?.name}</span>
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Botón de notificaciones */}
      <div className="relative" ref={notifRef}>
        <button
          onClick={() => setNotifOpen((v) => !v)}
          className="relative p-2.5 rounded-xl bg-slate-900/90 border border-slate-700 hover:border-cyan-500 transition shadow-lg"
          aria-label="Notificaciones"
        >
          <Bell size={18} className="text-slate-200" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {notifOpen && (
          <div className="absolute right-0 mt-3 w-80 max-h-[60vh] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur-xl shadow-2xl flex flex-col z-50">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div>
                <h3 className="text-slate-100 font-bold text-sm">Alertas del negocio</h3>
                <p className="text-slate-400 text-xs">Generadas automáticamente por VIMDY IA</p>
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-[11px] font-semibold"
                >
                  <CheckCheck size={12} />
                  Marcar todas
                </button>
              )}
            </div>

            <div className="overflow-y-auto max-h-[40vh]">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-slate-500 text-xs">
                  Sin alertas por ahora.
                </div>
              ) : (
                notifications.map((n) => {
                  const Icon = TYPE_ICON[n.type] ?? Bell;
                  return (
                    <div
                      key={n.id}
                      onClick={() => markAsRead(n.id)}
                      className={`group flex items-start gap-2.5 px-4 py-3 border-b border-slate-800/70 cursor-pointer hover:bg-slate-800/50 transition ${
                        n.read ? "opacity-60" : ""
                      }`}
                    >
                      <Icon size={16} className={`mt-0.5 shrink-0 ${TYPE_COLOR[n.type]}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-slate-100 text-xs font-semibold truncate">{n.title}</p>
                          {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />}
                        </div>
                        <p className="text-slate-300 text-xs mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-slate-500 text-[10px] mt-1">{timeAgo(n.date)}</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(n.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-300 transition shrink-0"
                        aria-label="Descartar"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Botón flotante IA */}
      <button
        onClick={() => {
          setOpen(false);
          copilotStore.toggle();
        }}
        className={`p-2.5 rounded-xl transition shadow-lg ${
          copilotOpen
            ? "bg-slate-800 border border-slate-600 text-white"
            : "bg-gradient-to-br from-cyan-500 to-cyan-600 hover:scale-105 text-white"
        }`}
        aria-label="Copiloto VIMDY"
      >
        {copilotOpen ? <X size={18} /> : <Sparkles size={18} />}
        {copilotLoading && !copilotOpen && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
        )}
      </button>

      {/* Dropdown principal */}
      {open && (
        <div className="absolute right-0 top-full mt-3 w-72 rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur-xl shadow-2xl z-50 overflow-hidden">
          {/* Perfil */}
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300">
                <User size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{user.name}</p>
                <p className="text-xs text-slate-400">{role?.name}</p>
                {currentBranch && (
                  <p className="text-[11px] text-slate-500">
                    Sucursal: {currentBranch.name}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Sucursal selector */}
          {hasMultiple && !loadingBranches && (
            <div className="px-4 py-2 border-b border-slate-800">
              <select
                value={currentBranchId ?? ""}
                onChange={(e) => setCurrentBranchId(e.target.value || null)}
                className="w-full h-8 rounded-lg bg-slate-800 border border-slate-700 px-2 text-xs text-white outline-none focus:border-cyan-500"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Accesos rápidos */}
          <div className="p-2 space-y-1">
            <button
              onClick={() => {
                setOpen(false);
                navigate("/notificaciones");
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition"
            >
              <Bell size={16} />
              Notificaciones
              {unreadCount > 0 && (
                <span className="ml-auto text-[10px] font-bold bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded-full">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                copilotStore.toggle();
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition"
            >
              <Sparkles size={16} />
              VIMDY IA
              {copilotLoading && (
                <span className="ml-auto text-[10px] font-bold bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-full">
                  Cargando...
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                navigate("/configuracion");
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition"
            >
              <Settings size={16} />
              Configuración
            </button>
          </div>

          {/* Estado del turno */}
          <div className="px-4 py-2 border-t border-slate-800">
            <div className="flex items-center gap-1.5 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full ${shiftOpen ? "bg-emerald-400" : "bg-red-400"}`} />
              <span className={shiftOpen ? "text-emerald-300" : "text-red-300"}>
                {shiftOpen === null ? "Cargando..." : shiftOpen ? "Turno abierto" : "Turno cerrado"}
              </span>
            </div>
          </div>

          {/* Cerrar sesión */}
          <div className="p-2 border-t border-slate-800">
            <button
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition"
            >
              <LogOut size={16} />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default VimdyCenter;
