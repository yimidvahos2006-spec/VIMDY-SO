import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Circle, LayoutGrid, Pencil, RotateCcw, Save, Square, RectangleHorizontal, WifiOff, X } from "lucide-react";

import type { Table, TableLayout, TableShape, Waiter } from "../../../core/entities/Entities";
import {
  buildFloorViews, groupByZone, summarizeFloor, placeZone, defaultShape, SHAPE_SIZE, clampPosition,
  type FloorState, type FloorTableView, type PlacedTable
} from "../../../core/services/floorPlan";
import type { SaveLayoutsResult, TableLayoutUpdate } from "../../../core/services/tableLayoutService";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { useConnection } from "../../../core/store/useConnection";
import { toast } from "../../../core/store/toastStore";
import { useNow } from "../../../hooks/useNow";
import { FloorSummaryBar } from "./FloorSummaryBar";
import { FloorZoneCanvas } from "./FloorZoneCanvas";
import { FLOOR_STYLES } from "./floorPlanStyles";

interface Props {
  tables: Table[];
  waiters?: Waiter[];
  /** Duración promedio de una mesa (TableEngine.getAverageDuration): base de la alerta por tiempo excedido. */
  avgDurationMs: number;
  onSelect: (table: Table) => void;
  /** Si se pasa, aparece "Editar plano" (solo para quien administra el salón). */
  onSaveLayouts?: (updates: TableLayoutUpdate[]) => Promise<SaveLayoutsResult>;
  /** Se llama tras guardar el plano para que la pantalla relea las mesas. */
  onLayoutSaved?: () => void | Promise<void>;
  /** Cuando no hay mesas: lleva a la vista donde se crean. */
  onGoToList?: () => void;
}

const ALL = "__ALL__";
const SHAPES: { shape: TableShape; label: string; icon: typeof Circle }[] = [
  { shape: "round", label: "Redonda", icon: Circle },
  { shape: "square", label: "Cuadrada", icon: Square },
  { shape: "rect", label: "Alargada", icon: RectangleHorizontal }
];

export function FloorPlan({ tables, waiters, avgDurationMs, onSelect, onSaveLayouts, onLayoutSaved, onGoToList }: Props) {
  const now = useNow(15_000);
  const { isOnline } = useConnection();
  const currency = companyConfigStore.get().currency;

  const [zoneTab, setZoneTab] = useState<string>(ALL);
  const [focus, setFocus] = useState<FloorState | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Map<string, TableLayout | null>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Hora de la última lectura (la pantalla relee cuando Supabase avisa un cambio).
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  useEffect(() => setUpdatedAt(Date.now()), [tables]);

  const views = useMemo(
    () => buildFloorViews(tables, { now, avgDurationMs, waiters }),
    [tables, now, avgDurationMs, waiters]
  );
  const summary = useMemo(() => summarizeFloor(views), [views]);
  const zones = useMemo(() => groupByZone(views), [views]);

  const activeTab = zoneTab !== ALL && !zones.some((z) => z.zone === zoneTab) ? ALL : zoneTab;
  const visibleZones = activeTab === ALL ? zones : zones.filter((z) => z.zone === activeTab);
  const dirtyCount = draft.size;
  const selectedView = selectedId ? views.find((v) => v.id === selectedId) : undefined;

  const handleOpen = useCallback((view: FloorTableView) => onSelect(view.table), [onSelect]);
  const handleSelect = useCallback((id: string) => setSelectedId(id), []);

  /** Mesas de cada zona, para recalcular el acomodo al editar. */
  const zoneTablesById = useMemo(() => {
    const map = new Map<string, Table[]>();
    zones.forEach((z) => {
      const list = z.views.map((v) => v.table);
      list.forEach((t) => map.set(t.id, list));
    });
    return map;
  }, [zones]);

  /**
   * Cambia la posición/forma de UNA mesa. En la primera edición de una zona se
   * "congelan" las posiciones que hoy calcula el plano para las demás mesas:
   * así, mover una no hace saltar al resto (que se acomodaba sola).
   */
  const updateLayout = useCallback(
    (id: string, compute: (current: PlacedTable, existing: TableLayout | undefined) => TableLayout) => {
      setDraft((prev) => {
        const zoneTables = zoneTablesById.get(id);
        if (!zoneTables) return prev;
        const { placed } = placeZone(zoneTables, prev);
        const current = placed.find((p) => p.id === id);
        if (!current) return prev;

        const next = new Map(prev);
        const byId = new Map(zoneTables.map((t) => [t.id, t]));
        for (const p of placed) {
          const pending = next.get(p.id);
          const isAuto = pending === null || (pending === undefined && !byId.get(p.id)?.layout);
          if (isAuto) next.set(p.id, { x: p.x, y: p.y, ...(byId.get(p.id)?.layout?.shape ? { shape: byId.get(p.id)?.layout?.shape } : {}) });
        }
        const existing = next.get(id) ?? byId.get(id)?.layout ?? undefined;
        next.set(id, compute(current, existing));
        return next;
      });
    },
    [zoneTablesById]
  );

  const handleMove = useCallback(
    (id: string, position: { x: number; y: number }) =>
      updateLayout(id, (_current, existing) => ({ ...position, ...(existing?.shape ? { shape: existing.shape } : {}) })),
    [updateLayout]
  );

  const handleRejectedMove = useCallback(() => {
    toast.warning("Esa posición está ocupada por otra mesa.");
  }, []);

  function changeShape(shape: TableShape) {
    if (!selectedView) return;
    updateLayout(selectedView.id, (current) => ({ ...clampPosition(current.x, current.y, shape), shape }));
  }

  /** Pone a TODAS las mesas de la(s) zona(s) visible(s) a acomodarse solas. */
  function resetVisibleZones() {
    setDraft((prev) => {
      const next = new Map(prev);
      visibleZones.forEach((z) => z.views.forEach((v) => next.set(v.id, null)));
      return next;
    });
  }

  function startEditing() {
    setFocus(null);
    setDraft(new Map());
    setSelectedId(null);
    setEditing(true);
  }

  function discard() {
    setDraft(new Map());
    setSelectedId(null);
    setEditing(false);
  }

  async function save() {
    if (!onSaveLayouts || draft.size === 0) return;
    setSaving(true);
    try {
      const updates: TableLayoutUpdate[] = [...draft].map(([tableId, layout]) => ({ tableId, layout: layout ?? undefined }));
      const result = await onSaveLayouts(updates);
      if (result.failed.length === 0) {
        toast.success(result.saved === 1 ? "Plano guardado." : `Plano guardado (${result.saved} mesas).`);
        setDraft(new Map());
        setSelectedId(null);
        setEditing(false);
      } else {
        // Se conservan en borrador solo las que fallaron, para reintentar.
        const failedIds = new Set(result.failed.map((f) => f.tableId));
        setDraft((prev) => new Map([...prev].filter(([id]) => failedIds.has(id))));
        toast.error(`No se pudieron guardar ${result.failed.length} mesa(s). Revisa la conexión e inténtalo de nuevo.`);
      }
      await onLayoutSaved?.();
    } finally {
      setSaving(false);
    }
  }

  if (tables.length === 0) {
    return (
      <div className="rounded-3xl border border-vimdy-border bg-vimdy-surface p-12 text-center">
        <LayoutGrid className="mx-auto mb-3 text-vimdy-text-tertiary" size={36} aria-hidden />
        <p className="text-lg font-bold text-white">Aún no hay mesas en el salón</p>
        <p className="mt-1 text-vimdy-small text-vimdy-text-secondary">Crea tus zonas y mesas en la vista Lista; aparecerán aquí solas.</p>
        {onGoToList && (
          <button
            type="button"
            onClick={onGoToList}
            className="mt-5 rounded-xl bg-vimdy-accent px-6 py-3 font-bold text-white transition hover:bg-vimdy-accent-hover"
          >
            Ir a la vista Lista
          </button>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Plano del salón" className="space-y-4">
      <FloorSummaryBar summary={summary} currency={currency} focus={focus} onFocus={setFocus} />

      {/* Leyenda + estado en vivo + edición */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-vimdy-micro text-vimdy-text-secondary" aria-label="Leyenda de colores">
          {(["free", "occupied", "alert"] as const).map((state) => (
            <li key={state} className="flex items-center gap-1.5">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${FLOOR_STYLES[state].dot}`} />
              {state === "free" ? "Libre" : state === "occupied" ? "Ocupada" : "Pidiendo cuenta / alerta"}
            </li>
          ))}
          {summary.reserved > 0 && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${FLOOR_STYLES.reserved.dot}`} />
              Reservada ({summary.reserved})
            </li>
          )}
        </ul>

        <div className="flex flex-wrap items-center gap-3">
          <span
            role="status"
            className={`flex items-center gap-2 text-vimdy-micro ${isOnline ? "text-vimdy-text-secondary" : "text-vimdy-warning-hover"}`}
            title={`Última lectura: ${new Date(updatedAt).toLocaleTimeString()}`}
          >
            {isOnline ? (
              <>
                <span aria-hidden className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-vimdy-success opacity-60 animate-ping motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-vimdy-success" />
                </span>
                En vivo · {new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </>
            ) : (
              <>
                <WifiOff size={14} aria-hidden /> Sin conexión · mostrando datos guardados
              </>
            )}
          </span>

          {onSaveLayouts && !editing && (
            <button
              type="button"
              onClick={startEditing}
              className="flex h-10 items-center gap-2 rounded-xl border border-vimdy-border bg-vimdy-surface px-4 text-vimdy-small font-semibold text-white transition hover:bg-vimdy-surface-hover"
            >
              <Pencil size={15} aria-hidden /> Editar plano
            </button>
          )}
        </div>
      </div>

      {/* Barra de edición */}
      {editing && (
        <div className="space-y-3 rounded-2xl border border-vimdy-accent/40 bg-vimdy-accent/[0.07] p-4">
          <p className="text-vimdy-small text-vimdy-text">
            <span className="font-bold">Modo edición.</span> Arrastra las mesas a su lugar (o usa las flechas con una mesa seleccionada). Se ajustan a la cuadrícula y no pueden encimarse.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-vimdy-border bg-vimdy-surface p-1" role="group" aria-label="Forma de la mesa seleccionada">
              {SHAPES.map(({ shape, label, icon: Icon }) => {
                const current = selectedView ? (draft.get(selectedView.id) ?? selectedView.table.layout)?.shape : undefined;
                const active = selectedView ? (current ?? defaultShape(selectedView.capacity)) === shape : false;
                return (
                  <button
                    key={shape}
                    type="button"
                    disabled={!selectedView}
                    aria-pressed={active}
                    onClick={() => changeShape(shape)}
                    title={selectedView ? `${label} (${SHAPE_SIZE[shape].w}×${SHAPE_SIZE[shape].h})` : "Selecciona una mesa"}
                    className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-vimdy-micro font-semibold transition disabled:opacity-40 ${
                      active ? "bg-vimdy-accent text-white" : "text-vimdy-text-secondary hover:bg-vimdy-surface-hover"
                    }`}
                  >
                    <Icon size={14} aria-hidden /> {label}
                  </button>
                );
              })}
            </div>
            <span className="text-vimdy-micro text-vimdy-text-secondary">
              {selectedView ? `Seleccionada: ${selectedView.name}` : "Toca una mesa para cambiar su forma"}
            </span>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={resetVisibleZones}
                disabled={saving}
                className="flex h-10 items-center gap-2 rounded-xl border border-vimdy-border px-4 text-vimdy-small font-semibold text-vimdy-text-secondary transition hover:bg-vimdy-surface-hover disabled:opacity-50"
              >
                <RotateCcw size={15} aria-hidden /> Acomodar solas
              </button>
              <button
                type="button"
                onClick={discard}
                disabled={saving}
                className="flex h-10 items-center gap-2 rounded-xl border border-vimdy-border px-4 text-vimdy-small font-semibold text-vimdy-text-secondary transition hover:bg-vimdy-surface-hover disabled:opacity-50"
              >
                <X size={15} aria-hidden /> {dirtyCount > 0 ? "Descartar" : "Salir"}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || dirtyCount === 0}
                className="flex h-10 items-center gap-2 rounded-xl bg-vimdy-accent px-5 text-vimdy-small font-bold text-white transition hover:bg-vimdy-accent-hover disabled:opacity-40"
              >
                <Save size={15} aria-hidden /> {saving ? "Guardando…" : dirtyCount > 0 ? `Guardar plano (${dirtyCount})` : "Guardar plano"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pestañas de zona */}
      {zones.length > 1 && (
        <div role="tablist" aria-label="Zonas del salón" className="flex gap-2 overflow-x-auto pb-1">
          {[{ zone: ALL, label: "Todo el salón", list: views }, ...zones.map((z) => ({ zone: z.zone, label: z.zone, list: z.views }))].map(
            ({ zone, label, list }) => {
              const selected = activeTab === zone;
              const alerts = list.filter((v) => v.state === "alert").length;
              return (
                <button
                  key={zone}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setZoneTab(zone)}
                  className={`flex h-10 shrink-0 items-center gap-2 rounded-xl border px-4 text-vimdy-small font-semibold transition ${
                    selected
                      ? "border-vimdy-accent bg-vimdy-accent/15 text-white"
                      : "border-vimdy-border bg-vimdy-surface text-vimdy-text-secondary hover:bg-vimdy-surface-hover"
                  }`}
                >
                  {label}
                  {alerts > 0 && (
                    <span className="rounded-full bg-vimdy-warning px-1.5 text-[11px] font-black leading-5 text-black" aria-label={`${alerts} con alerta`}>
                      {alerts}
                    </span>
                  )}
                </button>
              );
            }
          )}
        </div>
      )}

      {/* Lienzos */}
      <div className="space-y-6">
        {visibleZones.map(({ zone, views: zoneViews }) => {
          const zs = summarizeFloor(zoneViews);
          return (
            <div key={zone} className="space-y-2">
              {(zones.length > 1 && activeTab === ALL) && (
                <h3 className="flex flex-wrap items-baseline gap-x-3 text-vimdy-h3 font-bold text-white">
                  {zone}
                  <span className="text-vimdy-micro font-medium text-vimdy-text-secondary">
                    {zs.free} libres · {zs.occupied} ocupadas · {zs.alert} en alerta
                  </span>
                </h3>
              )}
              <FloorZoneCanvas
                views={zoneViews}
                draft={draft}
                currency={currency}
                editing={editing}
                selectedId={selectedId}
                focus={focus}
                onOpen={handleOpen}
                onSelect={handleSelect}
                onMove={handleMove}
                onRejectedMove={handleRejectedMove}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}