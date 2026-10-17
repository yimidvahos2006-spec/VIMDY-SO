import React, { useMemo, useState } from "react";
import { Minus, Plus, Trash2, X, ChefHat, Wallet, Search, Mic, MicOff, CheckCircle2, MessageSquarePlus, ClipboardList, UtensilsCrossed, Users, GitMerge, ArrowRightLeft, Receipt, MoreVertical, XCircle, Clock, AlertTriangle, ArrowRight } from "lucide-react";

import { Table, Product, OrderPriority } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { isOptimisticLockError } from "../../../core/errors/OptimisticLockError";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { useVoiceOrder } from "../../../core/voice/useVoiceOrder";
import { VoiceOrder } from "../../../core/voice/voiceParser";
import { CloseTableDialog } from "./CloseTableDialog";
import { useAuth } from "../../context/AuthContext";
import { useCategories } from "../../../hooks/useCategories";
import { toast } from "../../../core/store/toastStore";
import { splitBillEvenly } from "../../../core/utils/splitBill";
import {
  canChargeTables,
  TABLE_CHARGE_FORBIDDEN_MESSAGE
} from "../../../core/config/tableChargeRoles";

interface Props {
  table: Table;
  tables: Table[];
  products: Product[];
  onClose: () => void;
  onChanged: () => void;
  onClosedTable: () => void;
  onOrderSent?: () => void;
}

export function TableDetailPanel({
  table,
  tables,
  products,
  onClose,
  onChanged,
  onClosedTable,
  onOrderSent
}: Props) {
  const { role } = useAuth();
  // Solo ADMIN, GERENTE y CAJERO cobran (misma lista que exige la base de datos).
  const canCharge = canChargeTables(role?.id);
  const [category, setCategory] = useState<string>("Todos");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [priority, setPriority] = useState<OrderPriority>("NORMAL");
  const [voiceSuccess, setVoiceSuccess] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [mobileTab, setMobileTab] = useState<"order" | "products">("products");
  const [showActions, setShowActions] = useState(false);
  const [addPeopleCount, setAddPeopleCount] = useState(1);
  const [showAddPeople, setShowAddPeople] = useState(false);
  const [showSplitBill, setShowSplitBill] = useState(false);
  const [splitPeople, setSplitPeople] = useState(2);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const { listening, listen } = useVoiceOrder({
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

  // Transferir: solo mesas libres. Unir: solo mesas con una cuenta abierta.
  const freeTables = useMemo(() => {
    return tables.filter(t => t.id !== table.id && t.status === "FREE");
  }, [tables, table.id]);

  const openTables = useMemo(() => {
    return tables.filter(
      t => t.id !== table.id && t.status !== "FREE" && t.status !== "CLOSED" && t.status !== "RESERVED"
    );
  }, [tables, table.id]);

  // Las pestañas muestran el NOMBRE de la categoría (antes salía el UUID).
  const { categories: categoryList } = useCategories();
  const categoryNames = useMemo(() => {
    const map = new Map<string, string>();
    categoryList.forEach(c => map.set(c.id, c.name));
    return map;
  }, [categoryList]);
  const categoryLabel = (id: string) =>
    id === "Todos" ? "Todos" : categoryNames.get(id) ?? "Otros";

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

  const hasItems = table.items.length > 0;
  const hasKitchenItems = table.items.some(item => item.requiresKitchen === true);

  async function run(
    action: () => Promise<unknown>,
    options: { closePanel?: boolean; success?: string } = {}
  ) {
    setBusy(true);
    setErrorMsg(null);
    try {
      await action();
      onChanged();
      if (options.success) toast.success(options.success);
      if (options.closePanel) onClose();
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
      if (!currentTable) throw new Error("TABLE_NOT_FOUND");
      const items = currentTable.items.map((item: any) =>
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
      const sent = await container.tableEngine.get().sendToKitchen(table.id, priority);
      setPriority("NORMAL");
      onChanged();
      onOrderSent?.();
      const isFresh = sent ? Date.now() - new Date(sent.createdAt).getTime() < 15000 : false;
      if (!sent) toast.info("No hay productos que necesiten cocina.");
      else if (isFresh) toast.success("Pedido enviado a cocina.");
      else toast.info("Todo ya estaba enviado a cocina.");
    } catch (err) {
      setErrorMsg(translateBusinessError(err, "Ocurrió un error."));

      if (isOptimisticLockError(err)) {
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleAddPeople() {
    if (addPeopleCount <= 0) return;
    // El motor SUMA: se manda cuántas personas llegan, no el total nuevo.
    run(() => container.tableEngine.get().addPeople(table.id, addPeopleCount), {
      success: addPeopleCount === 1 ? "Se agregó 1 persona." : `Se agregaron ${addPeopleCount} personas.`
    });
    setShowAddPeople(false);
    setAddPeopleCount(1);
  }

  async function handleRequestBill() {
    run(() => container.tableEngine.get().requestBill(table.id));
  }

  async function handleRelease() {
    run(() => container.tableEngine.get().releaseEmptyTable(table.id), {
      closePanel: true,
      success: `${table.name} quedó libre.`
    });
    setShowReleaseConfirm(false);
  }

  async function handleCancelOrder(reason: string) {
    run(() => container.tableEngine.get().cancelTableOrder(table.id, reason), {
      closePanel: true,
      success: `Pedido cancelado. ${table.name} quedó libre y cocina fue avisada.`
    });
    setShowCancelConfirm(false);
  }

  async function handleMerge(targetTableId: string) {
    const target = tables.find(t => t.id === targetTableId);
    run(() => container.tableEngine.get().mergeTables(table.id, targetTableId), {
      closePanel: true,
      success: `${table.name} se unió a ${target?.name ?? "la otra mesa"}. ${table.name} quedó libre.`
    });
    setShowMergeDialog(false);
  }

  async function handleTransfer(targetTableId: string) {
    const target = tables.find(t => t.id === targetTableId);
    run(() => container.tableEngine.get().transferTable(table.id, targetTableId), {
      closePanel: true,
      success: `La cuenta pasó a ${target?.name ?? "la mesa nueva"}.`
    });
    setShowTransferDialog(false);
  }

  const splitResult = useMemo(() => {
    try {
      return splitBillEvenly(table.total, splitPeople);
    } catch {
      return null;
    }
  }, [table.total, splitPeople]);

  function closeSplit() {
    setShowSplitBill(false);
    setSplitPeople(2);
  }

  const statusLabel =
    table.status === "CUENTA_SOLICITADA"
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
                  : "Disponible";

  return (
    <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-6xl h-[90vh] rounded-3xl bg-vimdy-surface border border-slate-700 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white">{table.name}</h2>
              <p className="text-slate-400 text-sm">
                {table.peopleCount} personas • {table.zone ?? "Sin zona"} • {statusLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowActions(!showActions)}
                className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition"
              >
                <MoreVertical size={18} />
              </button>
              {showActions && (
                <div className="absolute top-full right-0 mt-2 w-64 rounded-2xl border border-slate-700 bg-vimdy-surface shadow-2xl overflow-hidden z-50">
                  <button onClick={() => { setShowAddPeople(true); setShowActions(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 transition">
                    <Users size={16} /> Agregar personas
                  </button>
                  <button onClick={() => { setShowMergeDialog(true); setShowActions(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 transition">
                    <GitMerge size={16} /> Unir mesa
                  </button>
                  <button onClick={() => { setShowTransferDialog(true); setShowActions(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 transition">
                    <ArrowRightLeft size={16} /> Transferir mesa
                  </button>
                  {table.items.length > 0 && (
                    <>
                      <button onClick={() => { setShowSplitBill(true); setShowActions(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 transition">
                        <Receipt size={16} /> Dividir cuenta
                      </button>
                      <button onClick={() => { handleRequestBill(); setShowActions(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 transition">
                        <ClipboardList size={16} /> Solicitar cuenta
                      </button>
                      <button onClick={() => { setShowCancelConfirm(true); setShowActions(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-300 hover:bg-red-500/10 transition">
                        <XCircle size={16} /> Cancelar pedido
                      </button>
                    </>
                  )}
                  {table.items.length === 0 && (
                    <button onClick={() => { setShowReleaseConfirm(true); setShowActions(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-300 hover:bg-red-500/10 transition">
                      <Trash2 size={16} /> Liberar mesa
                    </button>
                  )}
                </div>
              )}
            </div>
            <button onClick={onClose} className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition">
              <X size={18} />
            </button>
          </div>
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

        <div className="flex-1 overflow-hidden">
          {/* Mobile tab switcher */}
          <div className="flex md:hidden border-b border-slate-700 bg-vimdy-background">
            <button
              onClick={() => setMobileTab("products")}
              className={`flex-1 flex items-center justify-center gap-2 h-12 text-sm font-bold transition ${
                mobileTab === "products"
                  ? "text-vimdy-accent border-b-2 border-vimdy-accent"
                  : "text-slate-400"
              }`}
            >
              <UtensilsCrossed size={18} />
              Productos
            </button>
            <button
              onClick={() => setMobileTab("order")}
              className={`flex-1 flex items-center justify-center gap-2 h-12 text-sm font-bold transition relative ${
                mobileTab === "order"
                  ? "text-vimdy-accent border-b-2 border-vimdy-accent"
                  : "text-slate-400"
              }`}
            >
              <ClipboardList size={18} />
              Pedido
              {hasItems && (
                <span className="absolute top-2 right-4 w-2 h-2 rounded-full bg-cyan-400" />
              )}
            </button>
          </div>

          {/* Desktop: 3 columns. Mobile: tabbed single column */}
          <div className="hidden md:grid grid-cols-3 gap-4 h-full p-6 overflow-hidden">
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
                    className="w-full h-10 pl-9 pr-4 rounded-xl bg-vimdy-surface border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 transition"
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
                    {categoryLabel(cat)}
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

          {/* Mobile layout */}
          <div className="md:hidden h-full flex flex-col">
            {mobileTab === "order" ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <h3 className="text-slate-300 font-bold text-lg">Pedido actual</h3>
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
                              className="mt-1 w-full h-10 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm px-2 outline-none focus:border-cyan-500"
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
                          <p className="text-cyan-400 text-sm mt-1">
                            ${item.price.toLocaleString("es-CO")}
                          </p>
                        </div>
                        <button
                          disabled={busy}
                          onClick={() => removeItem(item.productId)}
                          className="text-red-400 hover:text-red-300 disabled:opacity-40 p-2"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                      <div className="flex items-center gap-3 mt-3">
                        <button
                          disabled={busy}
                          onClick={() => decreaseItem(item.productId, item.quantity)}
                          className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center disabled:opacity-40 active:scale-95 transition"
                        >
                          <Minus size={18} />
                        </button>
                        <span className="text-white font-bold text-lg w-8 text-center">
                          {item.quantity}
                        </span>
                        <button
                          disabled={busy}
                          onClick={() => increaseItem(item.productId, item.quantity)}
                          className="w-10 h-10 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 flex items-center justify-center disabled:opacity-40 active:scale-95 transition"
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Totales mobile */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                  <div className="flex justify-between text-slate-400">
                    <span>Subtotal</span>
                    <span>${table.subtotal.toLocaleString("es-CO")}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Impuesto</span>
                    <span>${table.tax.toLocaleString("es-CO")}</span>
                  </div>
                  <div className="flex justify-between text-white font-bold text-lg pt-2 border-t border-slate-800">
                    <span>Total</span>
                    <span>${table.total.toLocaleString("es-CO")}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-4 space-y-3 flex-shrink-0">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar producto..."
                      className="w-full h-11 pl-9 pr-4 rounded-xl bg-vimdy-surface border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 transition"
                    />
                  </div>
                  <button
                    onClick={listen}
                    disabled={listening}
                    className={`w-full h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-bold transition ${
                      listening
                        ? "bg-red-500 text-white animate-pulse"
                        : "bg-cyan-500 hover:bg-cyan-400 text-slate-950"
                    }`}
                  >
                    {listening ? <MicOff size={16} /> : <Mic size={16} />}
                    Pedir por voz
                  </button>
                  <div className="flex gap-2 overflow-x-auto pb-1">
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
                        {categoryLabel(cat)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-4 pb-4 grid grid-cols-2 gap-3 content-start">
                  {visibleProducts.map(product => (
                    <button
                      key={product.id}
                      disabled={busy}
                      onClick={() => addProduct(product)}
                      className="bg-slate-950/60 border border-slate-800 hover:border-cyan-500 rounded-2xl p-4 text-left transition disabled:opacity-40 active:scale-[0.98]"
                    >
                      <h4 className="text-white font-semibold text-base">{product.name}</h4>
                      <p className="text-cyan-400 mt-2 font-bold">
                        ${product.price.toLocaleString("es-CO")}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Acciones principales */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Prioridad:</span>
            <div className="flex gap-1">
              {(["NORMAL", "HIGH", "URGENT"] as OrderPriority[]).map(value => (
                <button
                  key={value}
                  onClick={() => setPriority(value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    priority === value
                      ? value === "NORMAL"
                        ? "bg-slate-600 text-white"
                        : value === "HIGH"
                          ? "bg-orange-500 text-slate-950"
                          : "bg-red-500 text-slate-950"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {value === "NORMAL" ? "Normal" : value === "HIGH" ? "Alta" : "Urgente"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={busy || !hasKitchenItems}
              onClick={sendToKitchen}
              className="flex items-center gap-2 h-11 px-5 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-40 disabled:hover:bg-orange-500 text-slate-950 font-bold transition"
            >
              <ChefHat size={18} />
              Enviar a cocina
            </button>
            {canCharge ? (
              <button
                disabled={busy || !hasItems}
                onClick={() => setShowCloseDialog(true)}
                className="flex items-center gap-2 h-11 px-5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-bold transition"
              >
                <Wallet size={18} />
                Cerrar y cobrar
              </button>
            ) : (
              <div
                title={TABLE_CHARGE_FORBIDDEN_MESSAGE}
                className="flex items-center gap-2 h-11 px-4 rounded-xl bg-slate-800 text-slate-400 text-sm font-semibold"
              >
                <Wallet size={18} />
                Cobra el cajero
              </div>
            )}
          </div>
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

      {showAddPeople && (
        <div className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-vimdy-surface p-6 shadow-2xl">
            <h3 className="text-white text-lg font-bold mb-4">Agregar personas</h3>
            <div className="flex items-center gap-3 mb-6">
              <button onClick={() => setAddPeopleCount(v => Math.max(1, v - 1))} className="w-10 h-10 rounded-lg bg-slate-700 text-white font-bold">−</button>
              <input type="number" min={1} value={addPeopleCount} onChange={e => setAddPeopleCount(Math.max(1, Number(e.target.value)))} className="flex-1 h-10 rounded-lg bg-slate-800 border border-slate-700 text-center text-white font-bold outline-none" />
              <button onClick={() => setAddPeopleCount(v => v + 1)} className="w-10 h-10 rounded-lg bg-cyan-500 text-slate-950 font-bold">+</button>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAddPeople(false)} className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm">Cancelar</button>
              <button onClick={handleAddPeople} className="px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-bold">Guardar</button>
            </div>
          </div>
        </div>
      )}

      {showSplitBill && (
        <div className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-vimdy-surface p-6 shadow-2xl">
            <h3 className="text-white text-lg font-bold mb-4">Dividir cuenta</h3>
            <p className="text-slate-400 text-sm mb-4">La cuenta se divide en partes iguales. Es solo una guía: el cobro sigue siendo uno solo.</p>
            <div className="flex items-center gap-3 mb-6">
              <button onClick={() => setSplitPeople(v => Math.max(1, v - 1))} className="w-10 h-10 rounded-lg bg-slate-700 text-white font-bold">−</button>
              <input type="number" min={1} value={splitPeople} onChange={e => setSplitPeople(Math.max(1, Number(e.target.value)))} className="flex-1 h-10 rounded-lg bg-slate-800 border border-slate-700 text-center text-white font-bold outline-none" />
              <button onClick={() => setSplitPeople(v => v + 1)} className="w-10 h-10 rounded-lg bg-cyan-500 text-slate-950 font-bold">+</button>
            </div>
            {splitResult && (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 mb-6 text-center">
                <p className="text-slate-400 text-xs uppercase tracking-wide">Cada persona paga</p>
                <p className="text-white text-3xl font-extrabold mt-1">${splitResult.high.toLocaleString("es-CO")}</p>
                {!splitResult.even && (
                  <p className="text-slate-400 text-xs mt-2">
                    {splitResult.highCount} {splitResult.highCount === 1 ? "persona paga" : "personas pagan"} ${splitResult.high.toLocaleString("es-CO")} y las demás ${splitResult.low.toLocaleString("es-CO")} (así suma exacto).
                  </p>
                )}
                <p className="text-slate-500 text-xs mt-2">Total ${splitResult.total.toLocaleString("es-CO")} entre {splitResult.people}</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={closeSplit} className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {showMergeDialog && (
        <MergeTableDialog
          tables={openTables}
          currentTable={table}
          onSelect={handleMerge}
          onClose={() => setShowMergeDialog(false)}
        />
      )}

      {showTransferDialog && (
        <TransferTableDialog
          tables={freeTables}
          currentTable={table}
          onSelect={handleTransfer}
          onClose={() => setShowTransferDialog(false)}
        />
      )}

      {showReleaseConfirm && (
        <ConfirmReleaseDialog
          onConfirm={handleRelease}
          onCancel={() => setShowReleaseConfirm(false)}
        />
      )}

      {showCancelConfirm && (
        <ConfirmCancelOrderDialog
          table={table}
          onConfirm={handleCancelOrder}
          onCancel={() => setShowCancelConfirm(false)}
        />
      )}
    </div>
  );
}

const money = (value: number) => `$${Math.round(value).toLocaleString("es-CO")}`;

/** Resumen corto de una mesa para elegirla: personas, productos y total. */
function TableChoiceCard({
  table,
  selected,
  onClick
}: {
  table: Table;
  selected: boolean;
  onClick: () => void;
}) {
  const units = table.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-xl border transition ${
        selected ? "border-cyan-500 bg-cyan-500/10" : "border-slate-700 hover:border-slate-600"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-white font-semibold">{table.name}</p>
        {table.status !== "FREE" && <p className="text-cyan-400 font-bold text-sm">{money(table.total)}</p>}
      </div>
      <p className="text-slate-400 text-xs mt-0.5">
        {table.zone ?? "Sin zona"} • {table.status === "FREE"
          ? `${table.capacity} puestos`
          : `${table.peopleCount} personas • ${units} ${units === 1 ? "producto" : "productos"}`}
      </p>
    </button>
  );
}

interface MoveTableDialogProps {
  tables: Table[];
  currentTable: Table;
  onSelect: (tableId: string) => void;
  onClose: () => void;
}

/**
 * Unir mesa (punto 3C): se elige entre las mesas con cuenta abierta y, antes
 * de unir, se muestra qué va a pasar con una confirmación clara.
 */
function MergeTableDialog({ tables, currentTable, onSelect, onClose }: MoveTableDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const selected = tables.find(t => t.id === selectedId) ?? null;

  return (
    <div className="fixed inset-0 z-[1002] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-vimdy-surface p-6 shadow-2xl">
        <h3 className="text-white text-lg font-bold mb-2">Unir mesa</h3>
        {!confirming || !selected ? (
          <>
            <p className="text-slate-400 text-sm mb-4">
              Elige la mesa que recibirá la cuenta de <span className="text-white font-semibold">{currentTable.name}</span>.
            </p>
            <div className="space-y-2 max-h-72 overflow-y-auto mb-6 pr-1">
              {tables.length === 0 && (
                <p className="text-slate-500 text-sm text-center py-4">
                  No hay otras mesas con una cuenta abierta. Si la mesa de destino está libre, usa “Transferir mesa”.
                </p>
              )}
              {tables.map(t => (
                <TableChoiceCard key={t.id} table={t} selected={selectedId === t.id} onClick={() => setSelectedId(t.id)} />
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm">Cancelar</button>
              <button
                disabled={!selectedId}
                onClick={() => setConfirming(true)}
                className="px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-bold disabled:opacity-40"
              >
                Continuar
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-center gap-3 my-5 text-white">
              <div className="text-center">
                <p className="font-bold">{currentTable.name}</p>
                <p className="text-cyan-400 text-sm">{money(currentTable.total)}</p>
              </div>
              <ArrowRight size={22} className="text-slate-500" />
              <div className="text-center">
                <p className="font-bold">{selected.name}</p>
                <p className="text-cyan-400 text-sm">{money(selected.total)}</p>
              </div>
            </div>
            <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-4 text-sm text-slate-300 space-y-1 mb-6">
              <p>• Todos los productos de {currentTable.name} pasan a {selected.name}.</p>
              <p>• Se suman las personas ({currentTable.peopleCount} + {selected.peopleCount}).</p>
              <p>• Lo que ya salió a cocina no se vuelve a enviar.</p>
              <p>• {currentTable.name} queda libre.</p>
              <p className="text-white font-semibold pt-1">
                Nuevo total de {selected.name}: {money(currentTable.total + selected.total)}
              </p>
              <p className="text-amber-300/90 text-xs pt-1">Esto no se puede deshacer con un botón; si te equivocas, tendrás que separar la cuenta a mano.</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm">Atrás</button>
              <button onClick={() => onSelect(selected.id)} className="px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-bold">
                Sí, unir mesas
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TransferTableDialog({ tables, currentTable, onSelect, onClose }: MoveTableDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-[1002] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-vimdy-surface p-6 shadow-2xl">
        <h3 className="text-white text-lg font-bold mb-2">Transferir mesa</h3>
        <p className="text-slate-400 text-sm mb-4">
          Elige una mesa libre. La cuenta completa de <span className="text-white font-semibold">{currentTable.name}</span> pasa allí
          (cocina también se actualiza) y {currentTable.name} queda libre.
        </p>
        <div className="space-y-2 max-h-60 overflow-y-auto mb-6 pr-1">
          {tables.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-4">No hay mesas libres disponibles.</p>
          )}
          {tables.map(t => (
            <TableChoiceCard key={t.id} table={t} selected={selectedId === t.id} onClick={() => setSelectedId(t.id)} />
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm">Cancelar</button>
          <button disabled={!selectedId} onClick={() => selectedId && onSelect(selectedId)} className="px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-bold disabled:opacity-40">Transferir</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmReleaseDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[1003] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-vimdy-surface p-6 shadow-2xl">
        <h3 className="text-white text-lg font-bold mb-2">¿Liberar esta mesa?</h3>
        <p className="text-slate-400 text-sm mb-6">
          Se eliminarán las personas registradas y la mesa volverá a estar disponible.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm">Volver</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-bold">Sí, liberar mesa</button>
        </div>
      </div>
    </div>
  );
}

const CANCEL_REASONS = ["El cliente se fue", "Error al tomar el pedido", "Producto agotado", "Otro motivo"] as const;

function ConfirmCancelOrderDialog({
  table,
  onConfirm,
  onCancel
}: {
  table: Table;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<string>(CANCEL_REASONS[0]);
  const units = table.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="fixed inset-0 z-[1003] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-vimdy-surface p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={20} className="text-red-400" />
          <h3 className="text-white text-lg font-bold">¿Cancelar este pedido?</h3>
        </div>
        <p className="text-slate-400 text-sm mb-4">
          Se cancelan {units} {units === 1 ? "producto" : "productos"} ({money(table.total)}), cocina deja de preparar lo pendiente y {table.name} queda libre.
        </p>
        <label className="text-slate-400 text-xs uppercase tracking-wide">Motivo</label>
        <div className="grid grid-cols-2 gap-2 mt-2 mb-6">
          {CANCEL_REASONS.map(option => (
            <button
              key={option}
              onClick={() => setReason(option)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold border transition ${
                reason === option ? "border-red-400 bg-red-500/10 text-red-200" : "border-slate-700 text-slate-300 hover:border-slate-600"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm">Volver</button>
          <button onClick={() => onConfirm(reason)} className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-bold">Cancelar pedido</button>
        </div>
      </div>
    </div>
  );
}