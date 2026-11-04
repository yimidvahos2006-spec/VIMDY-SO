import { useState } from "react";

import type { Waiter } from "../../../core/entities/Entities";

interface Props {
  waiter: Waiter;
  showPhoto: boolean;
  onSelect: (waiter: Waiter) => void;
}

/** "juan pérez" → "JP" · "Mesero" → "M". */
export function waiterInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const second = parts.length > 1 ? parts[1].charAt(0) : "";
  return `${first}${second}`.toUpperCase();
}

/** Solo muestra la primera letra en mayúscula ("mesero 2" → "Mesero 2"); el nombre guardado no cambia. */
function displayName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : name;
}

/**
 * Tarjeta de un mesero: pensada para un dedo en una tablet (≥ 160 px de alto,
 * avatar de 96 px, sin texto pequeño). Si la foto falta o no carga, se muestran
 * las iniciales en lugar de una imagen rota.
 */
export function WaiterCard({ waiter, showPhoto, onSelect }: Props) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const name = displayName(waiter.name);
  const photo = showPhoto && waiter.photoUrl && !photoFailed ? waiter.photoUrl : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(waiter)}
      aria-label={`Atender como ${name}`}
      className="group flex min-h-[168px] touch-manipulation select-none flex-col items-center justify-center gap-4 rounded-2xl border border-vimdy-border bg-vimdy-surface p-5 transition active:scale-[0.97] hover:border-vimdy-accent hover:bg-vimdy-surface-hover focus-visible:outline-none focus-visible:border-vimdy-accent focus-visible:shadow-vimdy-accent"
    >
      {photo ? (
        <img
          src={photo}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setPhotoFailed(true)}
          className="h-24 w-24 rounded-full border-2 border-vimdy-border object-cover shadow-vimdy-sm"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-24 w-24 items-center justify-center rounded-full border border-vimdy-border bg-vimdy-surface-active text-3xl font-black tracking-wide text-vimdy-accent-hover transition group-hover:border-vimdy-accent"
        >
          {waiterInitials(waiter.name)}
        </span>
      )}

      <span className="w-full break-words text-center text-xl font-bold leading-tight text-vimdy-text line-clamp-2">
        {name}
      </span>
    </button>
  );
}