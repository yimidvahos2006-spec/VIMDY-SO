import React, { useMemo, useState } from "react";
import { Minus, Plus, Trash2, X, ChefHat, Receipt, Wallet, AlertTriangle, ArrowUpCircle, CircleDot, Search, Mic, MicOff, CheckCircle2, MessageSquarePlus } from "lucide-react";

import { Table, Product, OrderPriority } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { isOptimisticLockError } from "../../../core/errors/OptimisticLockError";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { useVoiceOrder } from "../../../core/voice/useVoiceOrder";
import { VoiceOrder } from "../../../core/voice/voiceParser";
import { CloseTableDialog } from "./CloseTableDialog";

interface Props {
  table: Table;
  products: Product[];
  onClose: () => void;
  /** Se llama después de cualquier operación exitosa, para refrescar la mesa. */
  onChanged: () => void;
  /** Se llama cuando la mesa termina de cobrarse y vuelve a quedar libre. */
  onClosedTable: () => void;
  /**
   * Se llama justo después de enviar el pedido a cocina con éxito. La
   * pantalla Meseros lo usa para cerrar todo y volver sola a las tarjetas
   * de mesero — así el siguiente mesero puede tocar su nombre de inmediato.
   */
  onOrderSent?: () => void;
}

export function TableDetailPanel({
  table,
  products,
  onClose,
  onChanged,
  onClosedTable,
  onOrderSent
}: Props) {
  const [category, setCategory] = useState<string>("Todos");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [priority, setPriority] = useState<OrderPriority>("NORMAL");
  const [voiceSuccess, setVoiceSuccess] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const { listening, result, listen } = useVoiceOrder({
    onSuccess: (voiceResult) => {
      if (voiceResult.added.length > 0) {
        setVoiceSuccess(voiceResult.added.join(", "));
        setTimeout(() => setVoiceSuccess(null), 3000);
        onChanged();
      }
    },
    onError: (error) => {
      setErrorMsg(error);
    },
    onAddItem: (order: VoiceOrder, match) => {
      const note = order.modifiers.length > 0 ? order.modifiers.join(", ") : undefined;
      run(() =>
        container.tableEngine.get().addItem({
          tableId: table.id,
          product: match.product,
          quantity: order.quantity,
          note
        })
      );
    }
  });

  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach(p => map.set(p.id, p));
    return map;
  }, [products]);

  const categories = useMemo(() => {
    const set = new Set(products.map(p => p.categoryId));
    return ["Todos", ...Array.from(set)];
  }, [products]);

  const sellable = useMemo(() => {
    return products.filter(
      (product) => product.active !== false && product.isIngredient !== true
    );
  }, [products]);

  const visibleProducts = useMemo(() => {
    let filtered = category === "Todos" ? sellable : sellable.filter(p => p.categoryId === category);

    if (search.trim()) {
      const term = search.trim().toLowerCase();
      filtered = filtered.filter((product) => {
        const name = product.name.toLowerCase();
        const aliases = (product.aliases ?? []).join(" ").toLowerCase();
        return name.includes(term) || aliases.includes(term);
      });
    }

    return filtered;
  }, [sellable, category, search]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setErrorMsg(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setErrorMsg(translateBusinessError(err, "Ocurrió un error."));

      if (isOptimisticLockError(err)) {
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  function addProduct(product: Product) {
    run(() =>
      container.tableEngine.get().addItem({
        tableId: table.id,
        product,
        quantity: 1
      })
    );
  }

  function decreaseItem(productId: string, currentQty: number) {
    run(() =>
      container.tableEngine.get().updateItemQuantity(table.id, productId, currentQty - 1)
    );
  }

  function increaseItem(productId: string, currentQty: number) {
    run(() =>
      container.tableEngine.get().updateItemQuantity(table.id, productId, currentQty + 1)
    );
  }

  function removeItem(productId: string) {
    run(() => container.tableEngine.get().removeItem(table.id, productId));
  }

  function startEditNote(itemId: string, currentNote?: string) {
    setEditingNoteId(itemId);
    setNoteDraft(currentNote ?? "");
  }

  function saveNote(itemId: string) {
    const trimmed = noteDraft.trim();
    run(async () => {
      const currentTable = await container.tableEngine.get().getTable(table.id);
      const items = currentTable.items.map(item =>
        item.productId === itemId
          ? { ...item, note: trimmed || undefined }
          : item
      );
      await container.tableEngine.get().updateTable(currentTable.id, { items });
    });
    setEditingNoteId(null);
    setNoteDraft("");
  }

  async function sendToKitchen() {
    setBusy(true);
    setErrorMsg(null);
    try {
      await container.tableEngine.get().sendToKitchen(table.id, priority);
      setPriority("NORMAL");
      onChanged();
      onOrderSent?.();
    } catch (err) {
      setErrorMsg(translateBusinessError(err, "Ocurrió un error."));

      if (isOptimisticLockError(err)) {
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  function requestBill() {
    run(() => container.tableEngine.get().requestBill(table.id));
  }

  const hasItems = table.items.length > 0;
  const hasKitchenItems = table.items.some(item => item.requiresKitchen !== false);

  return (
    <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-6xl h-[85vh] rounded-3xl bg-vimdy-surface border border-slate-700 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-700 flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-white">{table.name}</h2>
            <p className="text-slate-400 text-sm mt-1">
              {table.peopleCount} personas • {table.zone ?? "Sin zona"} •{" "}
              {table.status === "CUENTA_SOLICITADA"
                ? "Cuenta solicitada"
                : table.status === "WAITING_BILL"
                  ? "Esperando cuenta"
                  : table.status === "WAITING_FOOD"
                    ? "Esperando comida"
                    : table.status === "EATING"
                      ? "Comiendo"
                      : table.status === "PAYING"
                        ? "Pagando"
                        : table.status === "BUSY"
                          ? "Ocupada"
                          : table.status === "RESERVED"
                            ? "Reservada"
                            : "Disponible"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition"
          >
            <X size={26} />
          </button>
        </div>

        {errorMsg && (
          <div className="mx-6 mt-4 rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 px-4 py-3 text-sm">
            {errorMsg}
          </div>
        )}

        {voiceSuccess && (
          <div className="mx-6 mt-4 rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 px-4 py-3 text-sm flex items-center gap-2">
            <CheckCircle2 size={16} />
            {voiceSuccess}
          </div>
        )}

        <div className="flex-1 grid grid-cols-3 gap-4 p-6 overflow-hidden">
          {/* Pedido actual */}
          <div className="flex flex-col overflow-hidden">
            <h3 className="text-slate-300 font-bold mb-3">Pedido actual</h3>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {!hasItems && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6 text-center text-slate-500">
                  {search.trim() || category !== "Todos"
                    ? "No se encontraron productos con ese filtro."
                    : "Toca un producto para agregarlo a esta mesa."}
                </div>
              )}
              {table.items.map(item => {
                const product = productMap.get(item.productId);
                const isEditing = editingNoteId === item.productId;
                return (
                  <div
                    key={item.productId}
                    className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-white font-semibold">
                          {product?.name ?? item.productId}
                        </p>
                        {isEditing ? (
                          <input
                            autoFocus
                            value={noteDraft}
                            onChange={(e) => setNoteDraft(e.target.value)}
                            onBlur={() => saveNote(item.productId)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveNote(item.productId);
                              if (e.key === "Escape") setEditingNoteId(null);
                            }}
                            placeholder="Ej: sin arroz, al punto..."
                            className="mt-1 w-full h-9 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm px-2 outline-none focus:border-cyan-500"
                          />
                        ) : (
                          <>
                            {item.note && (
                              <p className="text-amber-400 text-xs mt-1">
                                {item.note}
                              </p>
                            )}
                            {!item.note && (
                              <button
                                onClick={() => startEditNote(item.productId)}
                                className="text-slate-500 hover:text-slate-300 text-xs mt-1 flex items-center gap-1"
                              >
                                <MessageSquarePlus size={12} />
                                Agregar nota
                              </button>
                            )}
                          </>
                        )}
                        <p className="text-cyan-400 text-sm">
                          ${item.price.toLocaleString("es-CO")}
                        </p>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() => removeItem(item.productId)}
                        className="text-red-400 hover:text-red-300 disabled:opacity-40"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-3">
                      <button
                        disabled={busy}
                        onClick={() => decreaseItem(item.productId, item.quantity)}
                        className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center disabled:opacity-40"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="text-white font-bold w-6 text-center">
                        {item.quantity}
                      </span>
                      <button
                        disabled={busy}
                        onClick={() => increaseItem(item.productId, item.quantity)}
                        className="w-8 h-8 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 flex items-center justify-center disabled:opacity-40"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Totales */}
            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-1 flex-shrink-0">
              <div className="flex justify-between text-slate-400 text-sm">
                <span>Subtotal</span>
                <span>${table.subtotal.toLocaleString("es-CO")}</span>
              </div>
              <div className="flex justify-between text-slate-400 text-sm">
                <span>Impuesto</span>
                <span>${table.tax.toLocaleString("es-CO")}</span>
              </div>
              <div className="flex justify-between text-white font-bold text-lg pt-1 border-t border-slate-800 mt-1">
                <span>Total</span>
                <span>${table.total.toLocaleString("es-CO")}</span>
              </div>
            </div>
          </div>

          {/* Catálogo de productos */}
          <div className="col-span-2 flex flex-col overflow-hidden">
            <div className="flex gap-2 mb-3 flex-shrink-0">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar producto..."
                  className="w-full h-10 pl-9 pr-4 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 transition"
                />
              </div>
              <button
                onClick={listen}
                disabled={listening}
                className={`h-10 px-4 rounded-xl flex items-center gap-2 text-sm font-bold transition ${
                  listening
                    ? "bg-red-500 text-white animate-pulse"
                    : "bg-cyan-500 hover:bg-cyan-400 text-slate-950"
                }`}
              >
                {listening ? <MicOff size={16} /> : <Mic size={16} />}
                {listening ? "Escuchando..." : "Voz"}
              </button>
            </div>

            <div className="flex gap-2 mb-3 overflow-x-auto pb-1 flex-shrink-0">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition ${
                    category === cat
                      ? "bg-cyan-500 text-slate-950"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto grid grid-cols-3 gap-4 content-start pr-1">
              {visibleProducts.map(product => (
                <button
                  key={product.id}
                  disabled={busy}
                  onClick={() => addProduct(product)}
                  className="bg-slate-950/60 border border-slate-800 hover:border-cyan-500 rounded-2xl p-4 text-left transition disabled:opacity-40 active:scale-[0.98]"
                >
                  <h4 className="text-white font-semibold">{product.name}</h4>
                  <p className="text-cyan-400 mt-2 font-bold">
                    ${product.price.toLocaleString("es-CO")}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Prioridad de la comanda */}
        {hasItems && (
          <div className="flex items-center gap-3 px-6 pt-4 flex-shrink-0">
            <span className="text-slate-400 text-sm font-semibold">Prioridad:</span>
            <div className="flex gap-2">
              <PriorityButton
                value="NORMAL"
                current={priority}
                onSelect={setPriority}
                label="Normal"
                icon={<CircleDot size={16} />}
                activeClass="bg-slate-600 text-white"
              />
              <PriorityButton
                value="HIGH"
                current={priority}
                onSelect={setPriority}
                label="Alta"
                icon={<ArrowUpCircle size={16} />}
                activeClass="bg-orange-500 text-slate-950"
              />
              <PriorityButton
                value="URGENT"
                current={priority}
                onSelect={setPriority}
                label="Urgente"
                icon={<AlertTriangle size={16} />}
                activeClass="bg-red-500 text-slate-950"
              />
            </div>
          </div>
        )}

        {/* Acciones */}
        <div className="flex items-center justify-end gap-3 px-6 py-5 border-t border-slate-700 flex-shrink-0">
          <button
            disabled={busy || !hasKitchenItems}
            onClick={sendToKitchen}
            className="flex items-center gap-2 h-12 px-6 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-40 disabled:hover:bg-orange-500 text-slate-950 font-bold transition"
          >
            <ChefHat size={18} />
            Enviar a cocina
          </button>
          <button
            disabled={busy || !hasItems}
            onClick={requestBill}
            className="flex items-center gap-2 h-12 px-6 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white font-bold transition"
          >
            <Receipt size={18} />
            Pedir cuenta
          </button>
          <button
            disabled={busy || !hasItems}
            onClick={() => setShowCloseDialog(true)}
            className="flex items-center gap-2 h-12 px-6 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-bold transition"
          >
            <Wallet size={18} />
            Cobrar mesa
          </button>
        </div>
      </div>

      {showCloseDialog && (
        <CloseTableDialog
          table={table}
          onClose={() => setShowCloseDialog(false)}
          onClosed={() => {
            setShowCloseDialog(false);
            onClosedTable();
          }}
        />
      )}
    </div>
  );
}

interface PriorityButtonProps {
  value: OrderPriority;
  current: OrderPriority;
  onSelect: (value: OrderPriority) => void;
  label: string;
  icon: React.ReactNode;
  /** Clases aplicadas solo cuando este botón es el seleccionado. */
  activeClass: string;
}

function PriorityButton({ value, current, onSelect, label, icon, activeClass }: PriorityButtonProps) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition ${
        active ? activeClass : "bg-slate-800 text-slate-400 hover:bg-slate-700"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
