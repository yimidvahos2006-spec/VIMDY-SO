import React from "react";
import { Check } from "lucide-react";

/**
 * Piezas visuales compartidas por las tarjetas de Configuración.
 * Viven aquí (y no dentro de SettingsDashboard) para que cada tarjeta pueda
 * ser su propio componente sin importar el Dashboard (evita importaciones
 * circulares).
 */

export function SectionCard({
  icon,
  title,
  description,
  children
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-vimdy-surface flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div>
          <h3 className="text-white font-bold">{title}</h3>
          {description && <p className="text-slate-400 text-xs">{description}</p>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  children
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-xs text-slate-400">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export const inputClass =
  "w-full h-10 rounded-xl bg-vimdy-surface border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500";

export const inputErrorClass =
  "w-full h-10 rounded-xl bg-vimdy-surface border border-red-500/70 px-3 text-white text-sm outline-none focus:border-red-400";

export function SavedToast({ show, label = "Guardado" }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-400">
      <Check size={13} />
      {label}
    </span>
  );
}