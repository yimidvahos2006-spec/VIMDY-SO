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
    <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-4 flex items-center gap-3">
      <div className="w-11 h-11 rounded-vimdy-md bg-vimdy-background/60 border border-vimdy-border flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-vimdy-text-secondary text-xs">{label}</p>
        <p title={value} className="text-vimdy-text text-xl font-bold truncate">{value}</p>
      </div>
    </div>
  );
}