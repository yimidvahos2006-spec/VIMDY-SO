import React from "react";

export function CustomerKpiCard({
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