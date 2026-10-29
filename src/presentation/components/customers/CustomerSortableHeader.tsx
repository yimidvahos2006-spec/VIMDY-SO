import React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { SortDir } from "./customerListing";

/**
 * Encabezado de columna que ordena la tabla de Clientes. Es un <button> real
 * dentro del <th>, así se puede usar con teclado y los lectores de pantalla
 * anuncian la columna y su orden actual (aria-sort).
 */
export function CustomerSortableHeader({
  label,
  active,
  dir,
  onClick,
  align = "left"
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-3 py-3 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 rounded-vimdy-xs select-none transition-colors hover:text-vimdy-text focus-visible:outline-none focus-visible:shadow-vimdy-accent ${
          active ? "text-vimdy-accent-hover" : ""
        }`}
      >
        {label}
        <Icon size={12} aria-hidden="true" className={active ? "" : "opacity-50"} />
      </button>
    </th>
  );
}