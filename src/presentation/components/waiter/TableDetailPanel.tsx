import React, { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Trash2, X, ChefHat, Wallet, Search, Mic, MicOff, CheckCircle2, MessageSquarePlus, ClipboardList, UtensilsCrossed, Users, GitMerge, ArrowRightLeft, Receipt, MoreVertical, XCircle, Clock, AlertTriangle, ArrowRight, Armchair, DoorOpen, ShoppingBasket, MapPin } from "lucide-react";

import { Table, Product, OrderPriority } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { isOptimisticLockError } from "../../../core/errors/OptimisticLockError";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { useVoiceOrder } from "../../../core/voice/useVoiceOrder";
import { VoiceOrder } from "../../../core/voice/voiceParser";
import { CloseTableDialog } from "./CloseTableDialog";
import { STATUS_STYLES } from "./TableGrid";
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
  const [editingLineKey, setEditingLineKey] = useState<string | null>(null);
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
    const set = new Set(products.filter(p => p.isIngredient !== true).map(p => p.categoryId));
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

  // Un mismo producto puede tener varias líneas (una por nota): se identifica por producto + nota.
  const lineKey = (item: Table["items"][number]) => `${item.productId}::${(item.note ?? "").trim()}`;

  function decreaseItem(item: Table["items"][number]) {
    run(() =>
      container.tableEngine.get().updateItemQuantity(table.id, item.productId, item.quantity - 1, { note: item.note })
    );
  }

  function increaseItem(item: Table["items"][number]) {
    run(() =>
      container.tableEngine.get().updateItemQuantity(table.id, item.productId, item.quantity + 1, { note: item.note })
    );
  }

  function removeItem(item: Table["items"][number]) {
    run(() => container.tableEngine.get().removeItem(table.id, item.productId, { note: item.note }));
  }

  function startEditNote(item: Table["items"][number]) {
    setEditingLineKey(lineKey(item));
    setNoteDraft(item.note ?? "");
  }

  /**
   * Guarda la nota de una línea. `units` permite ponerla solo a una parte de
   * las unidades (2 hamburguesas, una "sin cebolla"). Si esas unidades ya
   * salieron a cocina, el motor lo rechaza y explica qué hacer.
   */
  function saveNote(item: Table["items"][number], units?: number) {
    const next = noteDraft.trim();
    setEditingLineKey(null);
    setNoteDraft("");
    if (next === (item.note ?? "").trim()) return;
    run(() =>
      container.tableEngine.get().updateItemNote(table.id, item.productId, item.note, next, units)
    );
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

  const statusStyle = STATUS_STYLES[table.status];
  const StatusIcon = statusStyle.icon;
  const now = useNow();
  const minutesOpen = table.openedAt ? Math.max(0, Math.floor((now - table.openedAt.getTime()) / 60000)) : null;
  const itemCount = table.items.reduce((sum, item) => sum + (item.quantity || 1), 0);

  /**
   * "Liberar mesa" siempre a la vista. Sin consumo se libera directo; con
   * consumo se usa el flujo de "Cancelar pedido" (pide motivo, avisa a cocina
   * y bloquea si ya se entregó comida), nunca se borra una cuenta en silencio.
   */
  const canRelease = table.status !== "FREE";

  function handleReleaseClick() {
    setShowActions(false);
    if (!canRelease) return;
    if (hasItems) setShowCancelConfirm(true);
    else setShowReleaseConfirm(true);
  }

  /** Tarjeta de producto: foto, nombre, precio y descripción; toda la tarjeta agrega (como en la Caja). */
  function renderProductCard(product: Product) {
    return (
      <button
        key={product.id}
        type="button"
        disabled={busy}
        onClick={() => addProduct(product)}
        aria-label={`Agregar ${product.name}, ${money(product.price)}`}
        className="group flex gap-3 p-3 text-left rounded-2xl bg-slate-950/60 border border-slate-800 hover:border-cyan-500 active:scale-[0.98] transition disabled:opacity-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/30"
      >
        <ProductThumb image={product.image} className="w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-xl text-3xl" />
        <div className="flex-1 min-w-0 flex flex-col">
          <h4 className="text-white font-bold leading-tight line-clamp-2">{product.name}</h4>
          <p className="text-cyan-400 font-black text-xl mt-1 tabular-nums">{money(product.price)}</p>
          {product.description && (
            <p className="text-slate-400 text-xs mt-1 leading-snug line-clamp-2">{product.description}</p>
          )}
          <span
            aria-hidden="true"
            className="mt-auto pt-1 self-end w-10 h-10 shrink-0 rounded-xl border-2 border-cyan-400 text-cyan-300 flex items-center justify-center group-hover:bg-cyan-500/10 transition"
          >
            <Plus size={20} />
          </span>
        </div>
      </button>
    );
  }

  /** Línea del pedido actual: miniatura, nota, precio y cantidad. */
  function renderOrderItem(item: Table["items"][number]) {
    const product = productMap.get(item.productId);
    const isEditing = editingLineKey === lineKey(item);
    const canSplitUnits = item.quantity > 1 && Number.isInteger(item.quantity);
    const name = product?.name ?? item.productId;
    return (
      <div key={lineKey(item)} className="bg-slate-950/60 border border-slate-800 rounded-2xl p-3 flex gap-3">
        <ProductThumb image={product?.image} className="w-14 h-14 shrink-0 rounded-xl text-xl" />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-white font-semibold leading-tight">{name}</p>
              {isEditing ? (
                <div className="mt-1">
                  <input
                    autoFocus
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onBlur={() => { if (!canSplitUnits) saveNote(item); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveNote(item);
                      if (e.key === "Escape") setEditingLineKey(null);
                    }}
                    placeholder="Ej: sin cebolla, al punto..."
                    className="w-full h-10 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm px-2 outline-none focus:border-cyan-500"
                  />
                  {canSplitUnits && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => saveNote(item, 1)}
                        className="h-9 px-3 rounded-lg bg-cyan-500 text-slate-950 text-xs font-bold"
                      >
                        Solo a 1 unidad
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => saveNote(item)}
                        className="h-9 px-3 rounded-lg bg-slate-700 text-white text-xs font-bold"
                      >
                        A las {item.quantity}
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setEditingLineKey(null)}
                        className="h-9 px-3 rounded-lg text-slate-400 text-xs font-semibold"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              ) : item.note ? (
                <p className="text-amber-400 text-xs mt-1">{item.note}</p>
              ) : (
                <button
                  onClick={() => startEditNote(item)}
                  className="text-slate-500 hover:text-slate-300 text-xs mt-1 flex items-center gap-1"
                >
                  <MessageSquarePlus size={12} />
                  Agregar nota
                </button>
              )}
              <p className="text-cyan-400 text-sm mt-1">{money(item.price)}</p>
            </div>
            <button
              disabled={busy}
              onClick={() => removeItem(item)}
              aria-label={`Quitar ${name}`}
              className="p-2 -m-1 text-red-400 hover:text-red-300 disabled:opacity-40"
            >
              <Trash2 size={18} />
            </button>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <button
              disabled={busy}
              onClick={() => decreaseItem(item)}
              aria-label={`Menos ${name}`}
              className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center disabled:opacity-40 active:scale-95 transition"
            >
              <Minus size={16} />
            </button>
            <span className="text-white font-bold text-lg w-8 text-center">{item.quantity}</span>
            <button
              disabled={busy}
              onClick={() => increaseItem(item)}
              aria-label={`Más ${name}`}
              className="w-10 h-10 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 flex items-center justify-center disabled:opacity-40 active:scale-95 transition"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-6xl h-[94vh] sm:h-[90vh] rounded-3xl bg-vimdy-surface border border-slate-700 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <div
              aria-hidden="true"
              className="hidden sm:flex w-14 h-14 shrink-0 rounded-2xl bg-slate-800 border border-slate-700 text-slate-200 items-center justify-center"
            >
              <Armchair size={26} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-2xl sm:text-3xl font-black text-white leading-tight whitespace-nowrap">{table.name}</h2>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-sm font-bold ${statusStyle.pill}`}>
                  <StatusIcon size={14} className="shrink-0" aria-hidden="true" />
                  {statusStyle.label}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 text-slate-400 text-xs sm:text-sm">
                <span className="flex items-center gap-1.5">
                  <Users size={15} aria-hidden="true" />
                  {table.peopleCount} {table.peopleCount === 1 ? "persona" : "personas"}
                </span>
                <span className="flex items-center gap-1.5">
                  <MapPin size={15} aria-hidden="true" />
                  {table.zone ?? "Sin zona"}
                </span>
                {minutesOpen !== null && (
                  <span className="flex items-center gap-1.5">
                    <Clock size={15} aria-hidden="true" />
                    {minutesOpen} min
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <button
                onClick={() => setShowActions(!showActions)}
                aria-label="Más acciones de la mesa"
                aria-haspopup="menu"
                aria-expanded={showActions}
                className="w-11 h-11 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition"
              >
                <MoreVertical size={18} />
              </button>
              {showActions && (
                <>
                  <button
                    type="button"
                    aria-label="Cerrar menú de la mesa"
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setShowActions(false)}
                  />
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
                  </div>
                </>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Volver a las mesas"
              className="w-11 h-11 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mx-4 sm:mx-6 mt-4 rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 px-4 py-3 text-sm">
            {errorMsg}
          </div>
        )}

        {voiceSuccess && (
          <div className="mx-4 sm:mx-6 mt-4 rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 px-4 py-3 text-sm flex items-center gap-2">
            <CheckCircle2 size={16} />
            {voiceSuccess}
          </div>
        )}

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Móvil: pestañas Productos / Pedido */}
          <div className="flex md:hidden border-b border-slate-700 bg-vimdy-background flex-shrink-0">
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
                <span className="absolute top-2 right-4 min-w-[20px] h-5 px-1.5 rounded-full bg-cyan-400 text-slate-950 text-[11px] font-bold flex items-center justify-center">
                  {itemCount}
                </span>
              )}
            </button>
          </div>

          {/* Escritorio/tablet: productos a la izquierda, pedido a la derecha. Móvil: una a la vez. */}
          <div className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[minmax(0,1fr)_340px] lg:grid-cols-[minmax(0,1fr)_400px] md:gap-5 md:p-6 overflow-hidden">
            {/* Catálogo de productos */}
            <section
              aria-label="Productos"
              className={`${mobileTab === "products" ? "flex" : "hidden"} md:flex flex-1 min-h-0 flex-col overflow-hidden p-4 md:p-0`}
            >
              <div className="flex gap-2 mb-3 flex-shrink-0">
                <div className="relative flex-1 min-w-0">
                  <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar producto o usar voz..."
                    className="w-full h-12 pl-10 pr-4 rounded-xl bg-vimdy-background border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 transition"
                  />
                </div>
                <button
                  onClick={listen}
                  disabled={listening}
                  className={`h-12 px-4 sm:px-5 rounded-xl flex items-center gap-2 text-sm font-bold transition ${
                    listening
                      ? "bg-red-500 text-white animate-pulse"
                      : "bg-cyan-500 hover:bg-cyan-400 text-slate-950"
                  }`}
                >
                  {listening ? <MicOff size={18} /> : <Mic size={18} />}
                  {listening ? "Escuchando..." : "Voz"}
                </button>
              </div>

              <div className="flex gap-2 mb-3 overflow-x-auto pb-1 flex-shrink-0">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    aria-pressed={category === cat}
                    className={`h-10 px-5 rounded-full border text-sm font-semibold whitespace-nowrap transition ${
                      category === cat
                        ? "bg-cyan-500 border-cyan-400 text-slate-950"
                        : "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {categoryLabel(cat)}
                  </button>
                ))}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                {visibleProducts.length === 0 ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6 text-center text-slate-500">
                    {search.trim() || category !== "Todos"
                      ? "No se encontraron productos con ese filtro."
                      : "Todavía no hay productos para vender."}
                  </div>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3 content-start">
                    {visibleProducts.map(renderProductCard)}
                  </div>
                )}
              </div>
            </section>

            {/* Pedido actual */}
            <section
              aria-label="Pedido actual"
              className={`${mobileTab === "order" ? "flex" : "hidden"} md:flex flex-1 md:flex-none min-h-0 flex-col overflow-hidden md:rounded-2xl md:border md:border-slate-800 md:bg-slate-950/40`}
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800 flex-shrink-0">
                <h3 className="flex items-center gap-2 text-white font-bold text-lg">
                  <ClipboardList size={20} className="text-slate-300" aria-hidden="true" />
                  Pedido actual
                </h3>
                <span className="px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 text-sm font-semibold">
                  {itemCount} {itemCount === 1 ? "ítem" : "ítems"}
                </span>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                {!hasItems ? (
                  <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-center px-6">
                    <ShoppingBasket size={48} className="text-slate-500 mb-4" aria-hidden="true" />
                    <p className="text-white font-bold text-lg">Tu pedido está vacío</p>
                    <p className="text-slate-400 text-sm mt-1">Selecciona productos para agregarlos a la mesa.</p>
                  </div>
                ) : (
                  table.items.map(renderOrderItem)
                )}
              </div>

              {/* Totales */}
              <div className="border-t border-slate-800 p-4 space-y-1 flex-shrink-0">
                <div className="flex justify-between text-slate-400 text-sm">
                  <span>Subtotal</span>
                  <span>{money(table.subtotal)}</span>
                </div>
                <div className="flex justify-between text-slate-400 text-sm">
                  <span>Impuestos</span>
                  <span>{money(table.tax)}</span>
                </div>
                <div className="flex justify-between items-baseline text-white font-bold text-xl pt-2 border-t border-slate-800 mt-2">
                  <span>Total</span>
                  <span className="text-cyan-400 text-2xl font-black">{money(table.total)}</span>
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* Liberar mesa: fila propia, encima de las acciones principales, separada para no pulsarla por error */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 px-4 sm:px-6 pt-3 pb-3 border-t border-slate-700 bg-slate-950/40 flex-shrink-0">
          <p className="text-slate-400 text-xs sm:text-sm leading-snug">
            {!canRelease
              ? "Esta mesa ya está libre."
              : hasItems
                ? "Esta mesa tiene consumo: para liberarla se cancela el pedido (pide motivo y avisa a cocina)."
                : "Mesa sin consumo: se libera de inmediato y queda disponible."}
          </p>
          <button
            type="button"
            disabled={busy || !canRelease}
            onClick={handleReleaseClick}
            aria-label={`Liberar mesa ${table.name}`}
            className="w-full sm:w-auto sm:min-w-[220px] h-12 px-6 rounded-xl border-2 border-red-500/60 bg-red-500/10 hover:bg-red-500/20 active:scale-[0.98] disabled:opacity-40 disabled:hover:bg-red-500/10 text-red-200 text-base font-bold flex items-center justify-center gap-2 whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-500/30"
          >
            <DoorOpen size={20} aria-hidden="true" />
            Liberar mesa
          </button>
        </div>

        {/* Acciones principales */}
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Prioridad</span>
            <div className="flex gap-1 p-1 rounded-xl bg-slate-900 border border-slate-700">
              {(["NORMAL", "HIGH", "URGENT"] as OrderPriority[]).map(value => (
                <button
                  key={value}
                  onClick={() => setPriority(value)}
                  aria-pressed={priority === value}
                  className={`h-9 px-3.5 rounded-lg text-xs font-bold transition ${
                    priority === value
                      ? value === "NORMAL"
                        ? "bg-cyan-500/20 text-cyan-200 border border-cyan-400/60"
                        : value === "HIGH"
                          ? "bg-orange-500 text-slate-950"
                          : "bg-red-500 text-slate-950"
                      : "text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {value === "NORMAL" ? "Normal" : value === "HIGH" ? "Alta" : "Urgente"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              disabled={busy || !hasKitchenItems}
              onClick={sendToKitchen}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 h-12 px-3 sm:px-6 rounded-xl whitespace-nowrap text-sm sm:text-base bg-orange-500 hover:bg-orange-400 disabled:opacity-40 disabled:hover:bg-orange-500 text-slate-950 font-bold transition"
            >
              <ChefHat size={20} />
              Enviar a cocina
            </button>
            {canCharge ? (
              <button
                disabled={busy || !hasItems}
                onClick={() => setShowCloseDialog(true)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 h-12 px-3 sm:px-6 rounded-xl whitespace-nowrap text-sm sm:text-base bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-bold transition"
              >
                <Wallet size={20} />
                Cobrar cuenta
              </button>
            ) : (
              <div
                title={TABLE_CHARGE_FORBIDDEN_MESSAGE}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 h-12 px-4 rounded-xl bg-slate-800 text-slate-400 text-sm font-semibold"
              >
                <Wallet size={20} />
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
          tableName={table.name}
          linkedNames={tables.filter(t => t.mergedInto === table.id).map(t => t.name)}
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

/** Reloj que se refresca solo: los minutos de la mesa avanzan sin tocar nada. */
function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Foto del producto igual que en la Caja (recortada a cuadro, carga diferida).
 * Si el producto no tiene foto, o la dirección falla, se muestra el plato de
 * siempre en vez de un icono de imagen rota.
 */
function ProductThumb({ image, className = "" }: { image?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);

  return (
    <div className={`${className} bg-vimdy-background border border-slate-800 flex items-center justify-center overflow-hidden`}>
      {image && !failed ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span aria-hidden="true">🍽️</span>
      )}
    </div>
  );
}

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

function ConfirmReleaseDialog({ onConfirm, onCancel, tableName, linkedNames = [] }: { onConfirm: () => void; onCancel: () => void; tableName: string; linkedNames?: string[] }) {
  return (
    <div className="fixed inset-0 z-[1003] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-2xl border border-slate-700 bg-vimdy-surface p-6 shadow-2xl">
        <h3 className="text-white text-lg font-bold mb-2">¿Liberar {tableName}?</h3>
        <p className="text-slate-400 text-sm mb-6">
          Se liberará <span className="text-white font-semibold">{tableName}</span>: se quitan las personas registradas y la mesa volverá a estar disponible. No se borra ninguna venta ni historial.
          {linkedNames.length > 0 && ` También quedan libres las mesas unidas: ${linkedNames.join(", ")}.`}
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
          <h3 className="text-white text-lg font-bold">¿Liberar {table.name} y cancelar su pedido?</h3>
        </div>
        <p className="text-slate-400 text-sm mb-4">
          {table.name} tiene consumo sin cobrar, por eso liberarla cancela el pedido (queda registrado con el motivo). Se cancelan {units} {units === 1 ? "producto" : "productos"} ({money(table.total)}), cocina deja de preparar lo pendiente y {table.name} queda libre.
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