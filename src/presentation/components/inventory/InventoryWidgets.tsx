import React, { useState } from "react";
import { toast } from "../../../core/store/toastStore";
import { AlertTriangle, History, ArrowUpCircle, ArrowDownCircle, ChevronUp, ChevronDown } from "lucide-react";
import { getStockStatus } from "../../../core/store/useInventory";
import { Product, InventoryMovement, Category } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";

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

/**
 * Editor rápido, inline, para la estación de impresión de la categoría YA
 * seleccionada en el formulario de producto (ej. si "Bebidas" todavía no
 * tiene estación, o si el negocio quiere cambiarla de "Barra" a "Bar").
 * No hay una pantalla aparte de "gestionar categorías" todavía — esto es
 * lo mínimo real para poder configurar/corregir la estación sin tener que
 * borrar y recrear la categoría.
 */
export function CategoryStationEditor({
  category,
  onUpdated
}: {
  category: Category | undefined;
  onUpdated: (updated: Category) => void;
}) {
  const [value, setValue] = useState(category?.printStation ?? "");
  const [saving, setSaving] = useState(false);

  if (!category) return null;

  const dirty = value.trim() !== (category.printStation ?? "");

  async function handleSave() {
    if (!category) return;
    setSaving(true);
    try {
      const updated = await container.categoryEngine.get().update(category.id, {
        printStation: value.trim() || undefined
      });
      onUpdated(updated);
      toast.success(`Estación de "${category.name}" actualizada.`);
    } catch {
      toast.error("No se pudo guardar la estación de esta categoría.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2">
      <label className="block text-vimdy-text-secondary text-xs mb-1">
        Estación de impresión de "{category.name}"{" "}
        <span className="text-vimdy-text-tertiary">(ej: Barra, Cocina, Pastelería)</span>
      </label>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Sin estación configurada"
          className="flex-1 h-9 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-xs placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
        />
        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-3 h-9 rounded-vimdy-sm bg-vimdy-accent text-vimdy-background text-xs font-semibold hover:bg-vimdy-accent-hover disabled:opacity-50 shrink-0"
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
        )}
      </div>
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

  return (
    <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <History size={18} className="text-vimdy-accent" />
        <h2 className="text-vimdy-text font-bold">Últimos movimientos</h2>
      </div>

      {movements.length === 0 ? (
        <p className="text-vimdy-text-tertiary text-sm">Todavía no hay movimientos registrados.</p>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto">
          {movements.map((m) => (
            <li key={m.id} className="flex items-start gap-2 text-sm">
              {m.type === "INCREASE" ? (
                <ArrowUpCircle size={16} className="text-vimdy-success mt-0.5 shrink-0" />
              ) : (
                <ArrowDownCircle size={16} className="text-vimdy-danger mt-0.5 shrink-0" />
              )}
              <div>
                <p className="text-vimdy-text">
                  {nameOf(m)}{" "}
                  <span className={m.type === "INCREASE" ? "text-vimdy-success" : "text-vimdy-danger"}>
                    {m.type === "INCREASE" ? "+" : "-"}
                    {m.quantity}
                  </span>
                </p>
                <p className="text-vimdy-text-tertiary text-xs">{m.reason}</p>
              </div>
            </li>
          ))}
        </ul>
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