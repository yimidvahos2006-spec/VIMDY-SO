import React, { memo, useEffect, useRef, useState } from "react";
import { Clock, GripVertical, Users } from "lucide-react";

import { formatElapsed, type FloorTableView, type PlacedTable } from "../../../core/services/floorPlan";
import { formatMoney } from "../../../core/utils/formatMoney";
import { ALERT_ICONS, FLOOR_STYLES } from "./floorPlanStyles";

interface Props {
  view: FloorTableView;
  placed: Pick<PlacedTable, "x" | "y" | "w" | "h" | "shape">;
  currency: string;
  editing: boolean;
  selected: boolean;
  /** Se atenúa cuando hay un filtro de estado activo y esta mesa no coincide. */
  dimmed: boolean;
  dragging: boolean;
  /** La posición que se está arrastrando choca con otra mesa. */
  invalid: boolean;
  onActivate: (view: FloorTableView) => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>, id: string) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onNudge: (id: string, dx: number, dy: number) => void;
}

function ariaLabel(view: FloorTableView, currency: string): string {
  const parts = [view.name, view.label];
  if (view.elapsedMs !== null) parts.push(`abierta hace ${formatElapsed(view.elapsedMs)}`);
  if (view.state === "occupied" || view.state === "alert") parts.push(`consumo ${formatMoney(view.total, currency)}`);
  if (view.state === "free") parts.push(`capacidad ${view.capacity} personas`);
  return parts.join(", ");
}

function FloorTableNodeBase({
  view, placed, currency, editing, selected, dimmed, dragging, invalid,
  onActivate, onPointerDown, onPointerMove, onPointerUp, onNudge
}: Props) {
  const style = FLOOR_STYLES[view.state];
  const StateIcon = view.state === "alert" && view.alertReason ? ALERT_ICONS[view.alertReason] : style.icon;
  const open = view.state === "occupied" || view.state === "alert";
  const round = placed.shape === "round";

  // Destello breve cuando cambia el consumo o el estado (otro dispositivo agregó algo).
  const [flash, setFlash] = useState(false);
  const prev = useRef<{ total: number; state: string; label: string } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = { total: view.total, state: view.state, label: view.label };
    if (!before) return;
    if (before.total === view.total && before.state === view.state && before.label === view.label) return;
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 1400);
    return () => window.clearTimeout(id);
  }, [view.total, view.state, view.label]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!editing) return;
    const step = event.shiftKey ? 32 : 8;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    onNudge(view.id, move[0], move[1]);
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel(view, currency)}
      aria-pressed={editing ? selected : undefined}
      data-state={view.state}
      onClick={() => onActivate(view)}
      onPointerDown={(event) => onPointerDown(event, view.id)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={handleKeyDown}
      style={{ left: placed.x, top: placed.y, width: placed.w, height: placed.h }}
      className={[
        "absolute border-2 p-2 flex flex-col items-center justify-center text-center select-none outline-none",
        "transition-[background-color,opacity,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-vimdy-accent-hover",
        round ? "rounded-full" : "rounded-2xl",
        style.card,
        dimmed ? "opacity-30" : "opacity-100",
        editing ? "cursor-grab touch-none" : "cursor-pointer",
        dragging ? "z-20 cursor-grabbing shadow-2xl scale-[1.04] !transition-none" : "z-10",
        selected && editing ? "ring-2 ring-vimdy-accent-hover" : "",
        invalid ? "!border-vimdy-danger-hover ring-2 ring-vimdy-danger-hover opacity-70" : "",
        flash ? "ring-2 ring-white/70" : ""
      ].join(" ")}
    >
      {view.critical && (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 ring-2 ring-vimdy-warning animate-pulse motion-reduce:animate-none ${round ? "rounded-full" : "rounded-2xl"}`}
        />
      )}

      {editing && !round && <GripVertical size={14} aria-hidden className="absolute right-1 top-1 text-vimdy-text-tertiary" />}

      <span className="flex max-w-full items-center gap-1 text-[15px] font-extrabold leading-none text-white">
        <StateIcon size={14} aria-hidden className={`shrink-0 ${style.accent}`} />
        <span className="truncate">{view.name}</span>
      </span>

      {open ? (
        <>
          <span className={`mt-1.5 flex items-center gap-1 text-[17px] font-extrabold leading-none tabular-nums ${style.accent}`}>
            <Clock size={14} aria-hidden className="shrink-0" />
            {formatElapsed(view.elapsedMs)}
          </span>
          <span className="mt-1 text-[15px] font-bold leading-none tabular-nums text-white">
            {formatMoney(view.total, currency)}
          </span>
          <span className="mt-1.5 max-w-full truncate text-[11px] font-semibold uppercase leading-none tracking-wide text-vimdy-text-secondary" title={view.label}>
            {view.label}
          </span>
          {!round && (view.people > 0 || view.waiterName) && (
            <span className="mt-1 flex max-w-full items-center gap-1 text-[11px] leading-none text-vimdy-text-secondary">
              <Users size={11} aria-hidden className="shrink-0" />
              <span className="truncate">
                {view.people > 0 ? view.people : ""}
                {view.people > 0 && view.waiterName ? " · " : ""}
                {view.waiterName ?? ""}
              </span>
            </span>
          )}
        </>
      ) : (
        <>
          <span className={`mt-2 text-[12px] font-bold uppercase leading-none tracking-wide ${style.accent}`}>{view.label}</span>
          {view.state === "merged" && view.mergedIntoName ? (
            <span className="mt-1.5 max-w-full truncate text-[11px] leading-none text-vimdy-text-secondary">→ {view.mergedIntoName}</span>
          ) : view.capacity > 0 ? (
            <span className="mt-1.5 flex items-center gap-1 text-[11px] leading-none text-vimdy-text-secondary">
              <Users size={11} aria-hidden /> {view.capacity}
            </span>
          ) : null}
        </>
      )}
    </button>
  );
}

export const FloorTableNode = memo(FloorTableNodeBase);