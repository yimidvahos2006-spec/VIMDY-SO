import { useMemo, useState } from "react";
import { AlertTriangle, ChefHat, Package, Search, Trash2, X } from "lucide-react";
import { toast } from "../../../core/store/toastStore";
import type { Product } from "../../../core/entities/Entities";
import type { InventoryState } from "./inventoryShared";

type Kind = "productos" | "insumos";

/**
 * Ventana "Eliminar producto": buscador arriba, dos pestañas (Productos /
 * Insumos) y debajo la lista de lo que está agregado. Cada fila tiene su
 * botón Eliminar y arriba de la lista está "Eliminar todos", que pide una
 * confirmación aparte avisando que no hay forma de recuperarlos.
 */
export function DeleteItemsModal({
  inventory,
  initialKind = "productos",
  onClose,
}: {
  inventory: InventoryState;
  initialKind?: Kind;
  onClose: () => void;
}) {
  const { sellableProducts, insumos, deleteProduct, deleteAllByKind } = inventory;
  const [kind, setKind] = useState<Kind>(initialKind);
  const [search, setSearch] = useState("");
  const [single, setSingle] = useState<Product | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeProducts = useMemo(() => sellableProducts.filter((p) => p.active !== false), [sellableProducts]);
  const activeInsumos = useMemo(() => insumos.filter((p) => p.active !== false), [insumos]);
  const list = kind === "productos" ? activeProducts : activeInsumos;
  const label = kind === "productos" ? "productos" : "insumos";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? list.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.sku ?? "").toLowerCase().includes(q) ||
            (p.barcode ?? "").toLowerCase().includes(q)
        )
      : list;
    return [...base].sort((a, b) => a.name.localeCompare(b.name));
  }, [list, search]);

  const tabClass = (active: boolean) =>
    `flex-1 h-11 text-sm font-semibold rounded-vimdy-md transition flex items-center justify-center gap-2 ${
      active ? "bg-vimdy-accent text-vimdy-background" : "text-vimdy-text-secondary hover:text-vimdy-text"
    }`;

  async function runSingle() {
    if (!single || busy) return;
    setBusy(true);
    const ok = await deleteProduct(single.id);
    setBusy(false);
    if (ok) toast.success(`"${single.name}" eliminado.`);
    else toast.error(`No se pudo eliminar "${single.name}". Puede que esté en uso en una receta.`);
    setSingle(null);
  }

  async function runAll() {
    if (busy) return;
    setBusy(true);
    const ok = await deleteAllByKind(kind === "productos" ? "products" : "insumos");
    setBusy(false);
    setConfirmAll(false);
    if (ok) toast.success(`Todos los ${label} fueron eliminados.`);
    else toast.error(`No se pudieron eliminar todos los ${label}. Intenta de nuevo.`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-vimdy-text">Eliminar producto</h2>
            <p className="text-sm text-vimdy-text-secondary mt-0.5">Busca lo que quieres borrar del inventario.</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-vimdy-text-secondary hover:text-vimdy-text">
            <X size={20} />
          </button>
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-vimdy-text-tertiary" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={kind === "productos" ? "Buscar producto..." : "Buscar insumo..."}
            className="w-full h-11 pl-9 pr-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm outline-none focus:border-vimdy-accent"
          />
        </div>

        <div className="flex gap-1 p-1 rounded-vimdy-lg border border-vimdy-border bg-vimdy-background" role="tablist">
          <button role="tab" aria-selected={kind === "productos"} onClick={() => setKind("productos")} className={tabClass(kind === "productos")}>
            <Package size={16} /> Productos <span className="opacity-80">({activeProducts.length})</span>
          </button>
          <button role="tab" aria-selected={kind === "insumos"} onClick={() => setKind("insumos")} className={tabClass(kind === "insumos")}>
            <ChefHat size={16} /> Insumos <span className="opacity-80">({activeInsumos.length})</span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-vimdy-text-tertiary">
            {filtered.length} {filtered.length === 1 ? "resultado" : "resultados"}
          </span>
          <button
            onClick={() => setConfirmAll(true)}
            disabled={list.length === 0}
            className="h-9 px-3 rounded-vimdy-md border border-vimdy-danger/40 text-vimdy-danger text-xs font-bold flex items-center gap-1.5 hover:bg-vimdy-danger/10 transition disabled:opacity-40 disabled:pointer-events-none"
          >
            <Trash2 size={14} /> Eliminar todos
          </button>
        </div>

        <div className="flex-1 min-h-[160px] overflow-y-auto rounded-vimdy-md border border-vimdy-border divide-y divide-vimdy-border">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-vimdy-text-tertiary">
              {search.trim() ? `Ningún ${kind === "productos" ? "producto" : "insumo"} coincide con la búsqueda.` : `No hay ${label} agregados.`}
            </p>
          ) : (
            filtered.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-vimdy-background/30">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-vimdy-text truncate">{p.name}</p>
                  {p.sku && <p className="text-xs text-vimdy-text-tertiary truncate">SKU: {p.sku}</p>}
                </div>
                <button
                  onClick={() => setSingle(p)}
                  aria-label={`Eliminar ${p.name}`}
                  className="h-8 px-3 shrink-0 rounded-vimdy-sm text-vimdy-danger text-xs font-bold flex items-center gap-1.5 hover:bg-vimdy-danger/10 transition"
                >
                  <Trash2 size={14} /> Eliminar
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {single && (
        <Confirm
          title={kind === "productos" ? "Eliminar producto" : "Eliminar insumo"}
          confirmLabel="Eliminar"
          busy={busy}
          onConfirm={runSingle}
          onCancel={() => setSingle(null)}
        >
          ¿Eliminar <b className="text-slate-200">"{single.name}"</b>? Esta acción no se puede deshacer.
        </Confirm>
      )}

      {confirmAll && (
        <Confirm
          title={`Confirmar la eliminación de todos los ${label}`}
          confirmLabel={`Sí, eliminar todos (${list.length})`}
          busy={busy}
          onConfirm={runAll}
          onCancel={() => setConfirmAll(false)}
        >
          <span className="block">
            Vas a eliminar los <b className="text-slate-200">{list.length} {label}</b> que tienes agregados.
          </span>
          <span className="block mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">
            ¿Está seguro de eliminar? Ya no se podrá recuperar ningún {kind === "productos" ? "producto" : "insumo"} eliminado.
          </span>
          {kind === "insumos" && (
            <span className="block mt-2 text-xs">Las recetas que usen estos insumos quedarán sin ellos.</span>
          )}
        </Confirm>
      )}
    </div>
  );
}

function Confirm({
  title,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-6">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-red-400" />
          </div>
          <h2 className="text-slate-100 font-semibold text-base pt-1.5">{title}</h2>
        </div>
        <div className="text-slate-400 text-sm mb-6">{children}</div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-10 px-4 rounded-lg border border-slate-700 text-slate-300 text-sm font-medium hover:bg-slate-700/50 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-10 px-4 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-400 transition-colors disabled:opacity-60"
          >
            {busy ? "Eliminando..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}