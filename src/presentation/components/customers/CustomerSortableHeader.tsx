import React from "react";

import { SortDir } from "./customerListing";

export function CustomerSortableHeader({
  label,
  active,
  dir,
  onClick
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-4 py-3 font-medium cursor-pointer select-none hover:text-white transition-colors ${
        active ? "text-cyan-400" : ""
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <span className="text-xs">{dir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}