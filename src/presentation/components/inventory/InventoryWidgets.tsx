import React, { useEffect, useMemo, useState } from "react";
import { toast } from "../../../core/store/toastStore";
import { AlertTriangle, History, ArrowUpCircle, ArrowDownCircle, ChevronUp, ChevronDown } from "lucide-react";
import { getStockStatus } from "../../../core/store/useInventory";
import { Product, InventoryMovement, Category } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import {
  MOVEMENT_VISIBLE_DAYS,
  describeMovement,
  filterVisibleMovements,
  getRelativeMovementTime
} from "../../../core/utils/movementDisplay";

export function KpiCard({
  icon,
  label,
  value,
  highlight
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: "yellow" | "red";
}) {
  const border =
    highlight === "red"
      ? "border-vimdy-danger/40"
      : highlight === "yellow"
      ? "border-vimdy-warning/40"
      : "border-vimdy-border";

  return (
    <div className={`rounded-vimdy-lg border ${border} bg-vimdy-surface p-4 flex items-center gap-3`}>
      <div className="w-11 h-11 rounded-vimdy-md bg-vimdy-surface flex items-center justify-center">{icon}</div>
      <div>
        <p className="text-vimdy-text-secondary text-xs">{label}</p>
        <p className="text-vimdy-text text-xl font-bold">{value}</p>
      </div>
    </div>
  );
}

/** Estación que se usa cuando una categoría no tiene ninguna configurada (ver kitchenTicketGrouping). */
const DEFAULT_STATION_LABEL = "Cocina";
const NEW_STATION_VALUE = "__nueva__";

/**
 * Une las estaciones ya usadas en el negocio (categorías y productos) sin
 * duplicar por mayúsculas/espacios: "Barra" y "barra " son la misma estación.
 */
export function collectKnownStations(
  categories: ReadonlyArray<{ printStation?: string }>,
  products: ReadonlyArray<{ printStationOverride?: string }> = []
): string[] {
  const byKey = new Map<string, string>();
  const add = (raw?: string) => {
    const name = raw?.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, name);
  };
  add(DEFAULT_STATION_LABEL);
  categories.forEach((c) => add(c.printStation));
  products.forEach((p) => add(p.printStationOverride));
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Selector de "estación" (zona donde se prepara y se imprime la comanda) de
 * la categoría YA seleccionada en el formulario de producto. Elegir una
 * opción de la lista se guarda al instante; "+ Nueva estación" pide el
 * nombre y reutiliza una existente si solo cambia mayúsculas/espacios.
 * No hay una pantalla aparte de "gestionar categorías" todavía, por eso
 * vive aquí.
 */
export function CategoryStationEditor({
  category,
  knownStations = [],
  onUpdated
}: {
  category: Category | undefined;
  knownStations?: string[];
  onUpdated: (updated: Category) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  if (!category) return null;

  const current = category.printStation?.trim() ?? "";
  const stations = collectKnownStations([
    { printStation: current },
    ...knownStations.map((k) => ({ printStation: k }))
  ]);
  const selectValue = creating
    ? NEW_STATION_VALUE
    : stations.find((o) => o.toLowerCase() === current.toLowerCase()) ?? "";

  async function save(station: string) {
    if (!category) return;
    setSaving(true);
    try {
      const reuse = stations.find((o) => o.toLowerCase() === station.trim().toLowerCase());
      const finalName = reuse ?? station.trim();
      // "Cocina" es el valor por defecto: se guarda como "sin estación".
      const toStore = finalName.toLowerCase() === DEFAULT_STATION_LABEL.toLowerCase() ? undefined : finalName || undefined;
      const updated = await container.categoryEngine.get().update(category.id, { printStation: toStore });
      onUpdated(updated);
      setCreating(false);
      setNewName("");
      toast.success(`Los productos de "${category.name}" se preparan en: ${toStore ?? DEFAULT_STATION_LABEL}.`);
    } catch {
      toast.error("No se pudo guardar la estación de esta categoría.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2">
      <label className="block text-vimdy-text-secondary text-xs mb-1">
        ¿Dónde se prepara? <span className="text-vimdy-text-tertiary">(solo si tienes cocina, barra, etc.)</span>
      </label>
      <select
        value={selectValue}
        disabled={saving}
        onChange={(e) => {
          const v = e.target.value;
          if (v === NEW_STATION_VALUE) {
            setCreating(true);
          } else {
            setCreating(false);
            void save(v);
          }
        }}
        className="w-full h-9 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-xs focus:outline-none focus:border-vimdy-accent disabled:opacity-60"
      >
        <option value="">{DEFAULT_STATION_LABEL} (por defecto)</option>
        {stations
          .filter((o) => o.toLowerCase() !== DEFAULT_STATION_LABEL.toLowerCase())
          .map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        <option value={NEW_STATION_VALUE}>+ Nueva estación...</option>
      </select>
      {creating && (
        <div className="flex gap-2 mt-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                e.preventDefault();
                void save(newName);
              }
            }}
            placeholder="Ej: Barra, Pastelería, Parrilla"
            className="flex-1 h-9 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-xs placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
          />
          <button
            type="button"
            onClick={() => void save(newName)}
            disabled={saving || !newName.trim()}
            className="px-3 h-9 rounded-vimdy-sm bg-vimdy-accent text-vimdy-background text-xs font-semibold hover:bg-vimdy-accent-hover disabled:opacity-50 shrink-0"
          >
            {saving ? "Guardando..." : "Crear"}
          </button>
        </div>
      )}
      <p className="text-vimdy-text-tertiary text-xs mt-1">
        Aplica a todos los productos de "{category.name}". Al imprimir la comanda sale un ticket por estación.
      </p>
    </div>
  );
}

export function CategoryChip({
  label,
  count,
  active,
  onClick
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`h-8 px-3 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5 ${
        active
          ? "bg-vimdy-accent border-vimdy-accent text-vimdy-background"
          : "border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface-hover"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={active ? "text-vimdy-background/70" : "text-vimdy-text-tertiary"}>{count}</span>
      )}
    </button>
  );
}

export function SortableHeader({
  label,
  active,
  dir,
  onClick
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th
      className="px-4 py-3 font-medium"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button onClick={onClick} className="flex items-center gap-1 hover:text-vimdy-text transition-colors">
        {label}
        {active && (dir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
      </button>
    </th>
  );
}

export function AlertsPanel({
  products,
  onSelect
}: {
  products: Product[];
  onSelect: (p: Product) => void;
}) {
  const alerts = products
    .filter((p) => p.active !== false && getStockStatus(p) !== "normal")
    .sort((a, b) => a.stock - b.stock);

  return (
    <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={18} className="text-vimdy-warning" />
        <h2 className="text-vimdy-text font-bold">Alertas de stock</h2>
      </div>

      {alerts.length === 0 ? (
        <p className="text-vimdy-text-tertiary text-sm">Todo el inventario está en niveles normales.</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((product) => {
            const status = getStockStatus(product);
            return (
              <li
                key={product.id}
                className="flex items-center justify-between rounded-vimdy-md border border-vimdy-border bg-vimdy-surface px-3 py-2"
              >
                <div>
                  <p className="text-vimdy-text text-sm font-medium">{product.name}</p>
                  <p className="text-vimdy-text-tertiary text-xs">
                    Stock: {product.stock} / mínimo {product.minStock}
                  </p>
                </div>
                <button
                  onClick={() => onSelect(product)}
                  className={`text-xs px-3 py-1.5 rounded-vimdy-sm font-semibold ${
                    status === "agotado"
                      ? "bg-vimdy-danger text-vimdy-text hover:bg-vimdy-danger-hover"
                      : "bg-vimdy-warning text-vimdy-background hover:bg-vimdy-warning-hover"
                  }`}
                >
                  Reabastecer
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function RecentMovementsPanel({
  movements,
  products
}: {
  movements: InventoryMovement[];
  products: Product[];
}) {
  // Orden de prioridad: 1) el nombre real guardado en el propio movimiento
  // (ya no se pierde aunque el producto se edite o se elimine después),
  // 2) el nombre actual en la lista de productos (por si el movimiento es
  // viejo, de antes de este cambio, y no trae productName), 3) si ninguno
  // existe (producto eliminado y movimiento viejo), un texto claro en vez
  // del id crudo (UUID) que no le dice nada al usuario.
  const nameOf = (m: InventoryMovement) =>
    m.productName ?? products.find((p) => p.id === m.productId)?.name ?? "Producto eliminado";

  const { timezone, language } = companyConfigStore.get();

  // "hoy" / "ayer" se calcula al mostrar, así que se refresca solo cada minuto
  // (y cambia a "ayer" al pasar la medianoche del negocio sin recargar).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // El historial completo sigue guardado en el Kardex (lo usan Pérdidas y el
  // Kardex de cada producto); aquí solo se muestran los últimos 30 días.
  const visible = useMemo(
    () => filterVisibleMovements(movements, now, timezone),
    [movements, now, timezone]
  );

  return (
    <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <History size={18} className="text-vimdy-accent" />
        <h2 className="text-vimdy-text font-bold">Últimos movimientos</h2>
      </div>

      {movements.length === 0 ? (
        <p className="text-vimdy-text-tertiary text-sm">Todavía no hay movimientos registrados.</p>
      ) : visible.length === 0 ? (
        <p className="text-vimdy-text-tertiary text-sm">
          No hay movimientos en los últimos {MOVEMENT_VISIBLE_DAYS} días.
        </p>
      ) : (
        <>
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {visible.map((m) => {
              const info = describeMovement(m, nameOf(m));
              const toneClass =
                info.tone === "up"
                  ? "text-vimdy-success"
                  : info.tone === "down"
                  ? "text-vimdy-danger"
                  : "text-vimdy-text-secondary";
              return (
                <li key={m.id} className="flex items-start gap-2 text-sm">
                  {info.tone === "up" ? (
                    <ArrowUpCircle size={16} className="text-vimdy-success mt-0.5 shrink-0" />
                  ) : (
                    <ArrowDownCircle
                      size={16}
                      className={`${info.tone === "down" ? "text-vimdy-danger" : "text-vimdy-text-secondary"} mt-0.5 shrink-0`}
                    />
                  )}
                  <div>
                    <p className="text-vimdy-text">
                      {info.title}{" "}
                      <span className={toneClass}>
                        {info.sign}
                        {m.quantity}
                      </span>
                    </p>
                    <p className="text-vimdy-text-tertiary text-xs">
                      {getRelativeMovementTime(m.date, now, timezone, language)}
                      {m.reason ? ` · ${m.reason}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-vimdy-text-tertiary text-xs mt-3">
            Se muestran los últimos {MOVEMENT_VISIBLE_DAYS} días. El historial completo sigue en el Kardex de cada producto.
          </p>
        </>
      )}
    </div>
  );
}

export function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-vimdy-md border border-vimdy-border bg-vimdy-surface p-3">
      <p className="text-vimdy-text-tertiary text-xs">{label}</p>
      <p className="text-vimdy-text font-bold">{value}</p>
    </div>
  );
}