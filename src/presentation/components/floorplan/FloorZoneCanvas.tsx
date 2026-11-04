import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TableLayout } from "../../../core/entities/Entities";
import {
  CANVAS_W, GRID, clampPosition, overlapsAny, placeZone,
  type FloorState, type FloorTableView
} from "../../../core/services/floorPlan";
import { FloorTableNode } from "./FloorTableNode";

interface Props {
  views: readonly FloorTableView[];
  /** Posiciones sin guardar (modo edición). `null` = volver a acomodar solo. */
  draft: ReadonlyMap<string, TableLayout | null>;
  currency: string;
  editing: boolean;
  selectedId: string | null;
  focus: FloorState | null;
  onOpen: (view: FloorTableView) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, position: { x: number; y: number }) => void;
  onRejectedMove: () => void;
}

const MIN_SCALE = 0.7;
const MAX_SCALE = 1.4;
const DRAG_THRESHOLD_PX = 4;

interface DragState {
  id: string;
  x: number;
  y: number;
  invalid: boolean;
}

export function FloorZoneCanvas({
  views, draft, currency, editing, selectedId, focus, onOpen, onSelect, onMove, onRejectedMove
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Escala el lienzo (diseñado a 1000 px) al ancho disponible; en pantallas
  // muy angostas se queda en 0.7 y el contenedor hace scroll horizontal.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = (width: number) => {
      if (width > 0) setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, width / CANVAS_W)));
    };
    apply(el.clientWidth);
    const observer = new ResizeObserver((entries) => apply(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { placed, height } = useMemo(
    () => placeZone(views.map((v) => v.table), draft),
    [views, draft]
  );
  const placedById = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);

  const placedRef = useRef(placedById);
  placedRef.current = placedById;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const dragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  dragStateRef.current = drag;

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
      if (!editing || event.button !== 0) return;
      const current = placedRef.current.get(id);
      if (!current) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { id, startX: event.clientX, startY: event.clientY, originX: current.x, originY: current.y, moved: false };
      onSelect(id);
    },
    [editing, onSelect]
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragRef.current;
    if (!state) return;
    const dxPx = event.clientX - state.startX;
    const dyPx = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
    state.moved = true;

    const current = placedRef.current.get(state.id);
    if (!current) return;
    const k = scaleRef.current;
    const pos = clampPosition(state.originX + dxPx / k, state.originY + dyPx / k, current.shape);
    const others = [...placedRef.current.values()].filter((p) => p.id !== state.id);
    const invalid = overlapsAny({ ...pos, w: current.w, h: current.h }, others);
    setDrag({ id: state.id, ...pos, invalid });
  }, []);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = dragRef.current;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const dragging = dragStateRef.current;
      setDrag(null);
      if (!state || !state.moved || !dragging || event.type === "pointercancel") return;
      const current = placedRef.current.get(state.id);
      if (!current) return;
      if (dragging.invalid) {
        onRejectedMove();
        return;
      }
      onMove(state.id, { x: dragging.x, y: dragging.y });
    },
    [onMove, onRejectedMove]
  );

  const handleNudge = useCallback(
    (id: string, dx: number, dy: number) => {
      const current = placedRef.current.get(id);
      if (!current) return;
      const pos = clampPosition(current.x + dx, current.y + dy, current.shape);
      const others = [...placedRef.current.values()].filter((p) => p.id !== id);
      if (overlapsAny({ ...pos, w: current.w, h: current.h }, others)) {
        onRejectedMove();
        return;
      }
      onMove(id, pos);
    },
    [onMove, onRejectedMove]
  );

  const handleActivate = useCallback(
    (view: FloorTableView) => (editing ? onSelect(view.id) : onOpen(view)),
    [editing, onSelect, onOpen]
  );

  const canvasHeight = height + (editing ? 120 : 0);
  const gridAlpha = editing ? 0.18 : 0.06;

  return (
    <div ref={wrapRef} className="overflow-x-auto rounded-2xl border border-vimdy-border bg-vimdy-surface/60">
      <div className="relative mx-auto" style={{ width: CANVAS_W * scale, height: canvasHeight * scale }}>
        <div
          className="absolute left-0 top-0"
          style={{
            width: CANVAS_W,
            height: canvasHeight,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            backgroundImage: `radial-gradient(circle, rgba(255,255,255,${gridAlpha}) 1px, transparent 1px)`,
            backgroundSize: `${GRID * 4}px ${GRID * 4}px`
          }}
        >
          {views.map((view) => {
            const base = placedById.get(view.id);
            if (!base) return null;
            const isDragging = drag?.id === view.id;
            const position = isDragging ? { ...base, x: drag.x, y: drag.y } : base;
            return (
              <FloorTableNode
                key={view.id}
                view={view}
                placed={position}
                currency={currency}
                editing={editing}
                selected={selectedId === view.id}
                dimmed={focus !== null && view.state !== focus}
                dragging={isDragging}
                invalid={isDragging && drag.invalid}
                onActivate={handleActivate}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onNudge={handleNudge}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}