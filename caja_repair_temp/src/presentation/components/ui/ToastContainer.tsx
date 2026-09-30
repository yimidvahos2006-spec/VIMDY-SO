import React, { useSyncExternalStore } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";

import { toastStore, toast, type ToastItem, type ToastType } from "../../../core/store/toastStore";

const STYLE_BY_TYPE: Record<ToastType, { icon: React.ReactNode; border: string; iconColor: string }> = {
  success: {
    icon: <CheckCircle2 size={18} />,
    border: "border-emerald-500/30 bg-emerald-500/10",
    iconColor: "text-emerald-400"
  },
  error: {
    icon: <XCircle size={18} />,
    border: "border-red-500/30 bg-red-500/10",
    iconColor: "text-red-400"
  },
  warning: {
    icon: <AlertTriangle size={18} />,
    border: "border-amber-500/30 bg-amber-500/10",
    iconColor: "text-amber-400"
  },
  info: {
    icon: <Info size={18} />,
    border: "border-cyan-500/30 bg-cyan-500/10",
    iconColor: "text-cyan-400"
  }
};

function ToastRow({ item }: { item: ToastItem }) {
  const style = STYLE_BY_TYPE[item.type];

  return (
    <div
      role="status"
      aria-live={item.type === "error" ? "assertive" : "polite"}
      className={`
        pointer-events-auto flex items-start gap-3 w-80 max-w-[calc(100vw-2rem)]
        rounded-2xl border ${style.border} bg-slate-900/95 backdrop-blur-md
        px-4 py-3 shadow-lg shadow-black/30
      `}
    >
      <div className={`mt-0.5 shrink-0 ${style.iconColor}`}>{style.icon}</div>
      <p className="flex-1 text-sm text-slate-100 leading-snug">{item.message}</p>
      <button
        type="button"
        onClick={() => toastStore.dismiss(item.id)}
        aria-label="Cerrar notificación"
        className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * ToastContainer
 * ---------------------------------------------------------------------------
 * Se monta UNA vez, en main.tsx (fuera de <App />, para que funcione en
 * /login y /registro igual que en el resto de la app). Se suscribe a
 * toastStore igual que el resto de los stores del proyecto
 * (useSyncExternalStore, sin polling).
 */
export function ToastContainer() {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
      {toasts.map((item) => (
        <ToastRow key={item.id} item={item} />
      ))}
    </div>
  );
}

export { toast };