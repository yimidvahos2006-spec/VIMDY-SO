// src/presentation/components/waiter/TableQuickOrder.tsx
/* ===========================================================================
   Toma de pedido ágil desde la mesa (vista táctil liviana)
   ---------------------------------------------------------------------------
   Se abre al tocar una mesa con cuenta abierta. Hace tres cosas, rápido:
     1. Agregar platos: un toque agrega 1; los que tienen tamaño/extras (o
        cuando el mesero toca "Opciones") abren la hoja para elegirlos.
     2. Notas especiales: botones de un toque (SIN CEBOLLA, SIN HIELO…) más
        un texto libre, al agregar o después sobre cualquier línea.
     3. "Enviar a cocina": crea la comanda con TableEngine.sendToKitchen, el
        mismo camino que ya alimenta el KDS (nada paralelo).

   Reglas de seguridad:
     - Todas las escrituras van por UNA cola en orden: el mesero puede tocar
       muy rápido sin esperar y el bloqueo optimista de la mesa nunca choca
       con nuestras propias escrituras.
     - "+" y "−" leen la cantidad real de la mesa en el momento de ejecutarse
       (no la que se veía en pantalla), así un toque rápido nunca se pierde.
     - El precio de la línea ya incluye tamaño y extras; el cobro usa ese
       precio tal cual.
     - Cobrar, unir, transferir, dividir y cancelar siguen en el panel
       completo ("Cuenta y más"): aquí no se duplica ninguna regla.
=========================================================================== */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChefHat,
  ClipboardList,
  Loader2,
  MessageSquarePlus,
  Minus,
  MoreHorizontal,
  Plus,
  Search,
  ShoppingBasket,
  SlidersHorizontal,
  Trash2,
  Users,
  UtensilsCrossed,
  X
} from "lucide-react";

import type { OrderPriority, Product, SaleItem, Table } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { isOptimisticLockError } from "../../../core/errors/OptimisticLockError";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { sameLine } from "../../../core/offline/tableLineRules";
import { toast } from "../../../core/store/toastStore";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { useCategories } from "../../../hooks/useCategories";
import { VimdyButton } from "../ui/VimdyButton";
import { STATUS_STYLES } from "./TableGrid";
import { QuickOptionsSheet, type QuickOptionsResult } from "./quickOrder/QuickOptionsSheet";
import {
  buildLineNote,
  buildVariantLabel,
  computeUnitPrice,
  lineDisplayKey,
  lineRefFromItem,
  needsOptions,
  parseLineNote,
  resolveLineVariant
} from "./quickOrder/quickOrderLogic";

interface Props {
  table: Table;
  products: Product[];
  onClose: () => void;
  /** Pide a la pantalla de mesas que vuelva a leer la mesa. */
  onChanged: () => void;
  /** Se llama cuando la comanda ya salió a cocina. */
  onOrderSent: () => void;
  /** Abre el panel completo (cobrar, unir, transferir, dividir, cancelar…). */
  onOpenFullPanel: () => void;
}

type Sheet =
  | { kind: "add"; product: Product }
  | { kind: "note"; item: SaleItem; product: Product }
  | null;

const PRIORITIES: ReadonlyArray<{ value: OrderPriority; label: string }> = [
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" }
];

export function TableQuickOrder({
  table,
  products,
  onClose,
  onChanged,
  onOrderSent,
  onOpenFullPanel
}: Props) {
  const { money } = useTranslation();
  const { categories: categoryList } = useCategories();

  const [category, setCategory] = useState<string>("Todos");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"menu" | "order">("menu");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [priority, setPriority] = useState<OrderPriority>("NORMAL");
  const [pending, setPending] = useState(0);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* ---------------------------- cola de escrituras --------------------------- */

  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const enqueue = useCallback((task: () => Promise<unknown>): Promise<void> => {
    pendingRef.current += 1;
    setPending(pendingRef.current);

    const run = queueRef.current.then(async () => {
      try {
        await task();
        setErrorMsg(null);
      } catch (err) {
        setErrorMsg(translateBusinessError(err, "Ocurrió un error."));
        if (isOptimisticLockError(err)) onChangedRef.current();
      } finally {
        pendingRef.current -= 1;
        setPending(pendingRef.current);
        // Se relee la mesa una sola vez cuando se vacía la cola, no por cada toque.
        if (pendingRef.current === 0) onChangedRef.current();
      }
    });

    queueRef.current = run;
    return run;
  }, []);

  /* --------------------------------- catálogo -------------------------------- */

  const sellable = useMemo(
    () => products.filter((product) => product.active !== false && product.isIngredient !== true),
    [products]
  );

  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  const categoryNames = useMemo(() => {
    const map = new Map<string, string>();
    categoryList.forEach((item) => map.set(item.id, item.name));
    return map;
  }, [categoryList]);

  const categoryIds = useMemo(() => {
    const present = new Set(sellable.map((product) => product.categoryId));
    const ordered = categoryList.filter((item) => present.has(item.id)).map((item) => item.id);
    const known = new Set(ordered);
    const rest = [...present].filter((id) => !known.has(id));
    return ["Todos", ...ordered, ...rest];
  }, [sellable, categoryList]);

  const visibleProducts = useMemo(() => {
    let list = category === "Todos" ? sellable : sellable.filter((p) => p.categoryId === category);
    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter((product) => {
        const name = product.name.toLowerCase();
        const aliases = (product.aliases ?? []).join(" ").toLowerCase();
        return name.includes(term) || aliases.includes(term);
      });
    }
    return list;
  }, [sellable, category, search]);

  const unitsByProduct = useMemo(() => {
    const map = new Map<string, number>();
    table.items.forEach((item) =>
      map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity)
    );
    return map;
  }, [table.items]);

  const itemCount = table.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const hasItems = table.items.length > 0;
  const hasKitchenItems = table.items.some((item) => item.requiresKitchen === true);

  /* --------------------------------- acciones -------------------------------- */

  function addToOrder(product: Product, result: QuickOptionsResult) {
    const size = product.sizes?.find((candidate) => candidate.id === result.sizeId) ?? null;
    const extras = (product.extras ?? []).filter((candidate) => result.extraIds.includes(candidate.id));
    const note = buildLineNote({
      variantLabel: buildVariantLabel(size, extras),
      quickNotes: result.quickNotes,
      freeText: result.freeText
    });
    const unitPrice = computeUnitPrice(product.price, size, extras);

    void enqueue(() =>
      container.tableEngine.get().addItem({
        tableId: table.id,
        // El precio de la línea ya incluye tamaño y extras.
        product: { ...product, price: unitPrice },
        quantity: result.quantity,
        note,
        selectedSizeId: size?.id ?? null,
        selectedExtraIds: extras.map((extra) => extra.id)
      })
    );
  }

  function handleProductTap(product: Product) {
    if (needsOptions(product)) {
      setSheet({ kind: "add", product });
      return;
    }
    addToOrder(product, {
      sizeId: null,
      extraIds: [],
      quantity: 1,
      quickNotes: [],
      freeText: ""
    });
  }

  function changeQuantity(item: SaleItem, delta: 1 | -1) {
    const ref = lineRefFromItem(item);
    void enqueue(async () => {
      const engine = container.tableEngine.get();
      // Cantidad real en este instante (no la de la pantalla): un toque rápido no se pierde.
      const fresh = await engine.getTable(table.id);
      const line = fresh?.items.find((candidate: SaleItem) =>
        sameLine(candidate, { productId: item.productId, ...ref })
      );
      if (!line) return;
      await engine.updateItemQuantity(table.id, item.productId, line.quantity + delta, ref);
    });
  }

  function removeLine(item: SaleItem) {
    void enqueue(() =>
      container.tableEngine.get().removeItem(table.id, item.productId, lineRefFromItem(item))
    );
  }

  function saveNote(item: SaleItem, product: Product, result: QuickOptionsResult) {
    const { label } = resolveLineVariant(product, item);
    const next =
      buildLineNote({
        variantLabel: label,
        quickNotes: result.quickNotes,
        freeText: result.freeText
      }) ?? "";

    if (next === (item.note ?? "").trim()) return;

    void enqueue(() =>
      container.tableEngine.get().updateItemNote(
        table.id,
        item.productId,
        item.note,
        next,
        result.units,
        {
          selectedSizeId: item.selectedSizeId ?? null,
          selectedExtraIds: item.selectedExtraIds ?? []
        }
      )
    );
  }

  async function handleSend() {
    if (sending) return;
    setSending(true);
    setErrorMsg(null);
    try {
      // Primero se termina de guardar todo lo que el mesero ya tocó.
      await queueRef.current;

      const sent = await container.tableEngine.get().sendToKitchen(table.id, priority);
      setPriority("NORMAL");

      const isFresh = sent ? Date.now() - new Date(sent.createdAt).getTime() < 15000 : false;
      if (!sent) toast.info("No hay productos que necesiten cocina.");
      else if (isFresh) toast.success("Pedido enviado a cocina.");
      else toast.info("Todo ya estaba enviado a cocina.");

      onChanged();
      if (sent) onOrderSent();
    } catch (err) {
      setErrorMsg(translateBusinessError(err, "No se pudo enviar a cocina."));
      if (isOptimisticLockError(err)) onChanged();
    } finally {
      setSending(false);
    }
  }

  /* Esc cierra la vista (si no hay una hoja abierta encima). */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !sheet) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sheet, onClose]);

  /* ---------------------------------- vistas --------------------------------- */

  const statusStyle = STATUS_STYLES[table.status];
  const StatusIcon = statusStyle.icon;

  function renderProductCard(product: Product) {
    const inOrder = unitsByProduct.get(product.id) ?? 0;
    const hasOptions = needsOptions(product);
    return (
      <div
        key={product.id}
        className="relative rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface hover:border-vimdy-accent/60 transition-colors"
      >
        <button
          type="button"
          onClick={() => handleProductTap(product)}
          aria-label={`${hasOptions ? "Elegir opciones de" : "Agregar"} ${product.name}, ${money(product.price)}`}
          className="w-full min-h-[96px] p-3 pr-3 flex flex-col text-left rounded-vimdy-lg active:scale-[0.98] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-vimdy-accent/30"
        >
          <div className="flex gap-3 items-start">
            {product.image && (
              <img
                src={product.image}
                alt=""
                loading="lazy"
                decoding="async"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
                className="w-14 h-14 shrink-0 rounded-vimdy-md object-cover bg-vimdy-background"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-vimdy-text font-bold text-vimdy-small leading-tight line-clamp-2 pr-8">
                {product.name}
              </p>
              <p className="text-vimdy-accent-hover font-black text-vimdy-body mt-1 tabular-nums">
                {hasOptions ? "Desde " : ""}
                {money(product.price)}
              </p>
            </div>
          </div>
          {hasOptions && (
            <span className="mt-2 text-vimdy-text-secondary text-vimdy-micro">Tamaño / extras</span>
          )}
        </button>

        {inOrder > 0 && (
          <span
            aria-label={`${inOrder} en el pedido`}
            className="absolute top-2 right-2 min-w-[28px] h-7 px-2 rounded-full bg-vimdy-accent text-white text-vimdy-micro font-bold flex items-center justify-center tabular-nums pointer-events-none"
          >
            {inOrder}
          </span>
        )}

        {!hasOptions && (
          <button
            type="button"
            onClick={() => setSheet({ kind: "add", product })}
            aria-label={`Opciones y notas de ${product.name}`}
            className="absolute bottom-1.5 right-1.5 w-11 h-11 rounded-vimdy-md text-vimdy-text-secondary hover:text-vimdy-text hover:bg-vimdy-surface-active flex items-center justify-center transition-colors"
          >
            <SlidersHorizontal size={18} />
          </button>
        )}
      </div>
    );
  }

  function renderOrderLine(item: SaleItem) {
    const product = productMap.get(item.productId);
    const name = product?.name ?? "Producto";
    return (
      <li
        key={lineDisplayKey(item)}
        className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-background p-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-vimdy-text font-semibold text-vimdy-small leading-tight">{name}</p>
            {item.note ? (
              <p className="text-vimdy-warning-hover text-vimdy-micro mt-1 leading-snug break-words">
                {item.note}
              </p>
            ) : null}
            <p className="text-vimdy-text-secondary text-vimdy-micro mt-1 tabular-nums">
              {money(item.price)} c/u
            </p>
          </div>
          <p className="text-vimdy-text font-bold text-vimdy-small tabular-nums shrink-0">
            {money(item.price * item.quantity)}
          </p>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => changeQuantity(item, -1)}
              aria-label={`Menos ${name}`}
              className="w-11 h-11 rounded-vimdy-md bg-vimdy-surface-active border border-vimdy-border text-vimdy-text flex items-center justify-center active:scale-95 transition"
            >
              <Minus size={16} />
            </button>
            <span className="w-9 text-center text-vimdy-text font-black text-lg tabular-nums">
              {item.quantity}
            </span>
            <button
              type="button"
              onClick={() => changeQuantity(item, 1)}
              aria-label={`Más ${name}`}
              className="w-11 h-11 rounded-vimdy-md bg-vimdy-accent text-white flex items-center justify-center active:scale-95 transition"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => product && setSheet({ kind: "note", item, product })}
              disabled={!product}
              aria-label={`Notas de ${name}`}
              className="h-11 px-3 rounded-vimdy-md border border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text hover:border-vimdy-warning/60 flex items-center gap-1.5 text-vimdy-micro font-semibold disabled:opacity-40 transition-colors"
            >
              <MessageSquarePlus size={15} />
              Nota
            </button>
            <button
              type="button"
              onClick={() => removeLine(item)}
              aria-label={`Quitar ${name}`}
              className="w-11 h-11 rounded-vimdy-md text-vimdy-danger hover:bg-vimdy-danger-bg flex items-center justify-center transition-colors"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </li>
    );
  }

  const noteSheetData =
    sheet?.kind === "note"
      ? (() => {
          const { label } = resolveLineVariant(sheet.product, sheet.item);
          return { label, ...parseLineNote(sheet.item.note, label) };
        })()
      : null;

  return (
    <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-stretch md:items-center justify-center md:p-4">
      <div className="w-full max-w-6xl h-full md:h-[92vh] md:rounded-vimdy-xl bg-vimdy-background md:bg-vimdy-surface md:border md:border-vimdy-border md:shadow-vimdy-lg flex flex-col overflow-hidden">
        {/* Encabezado */}
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-vimdy-border flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-vimdy-text font-black text-2xl leading-tight whitespace-nowrap">
                {table.name}
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-vimdy-micro font-bold ${statusStyle.pill}`}
              >
                <StatusIcon size={13} aria-hidden="true" />
                {statusStyle.label}
              </span>
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 text-vimdy-text-secondary text-vimdy-micro">
              <Users size={13} aria-hidden="true" />
              {table.peopleCount} {table.peopleCount === 1 ? "persona" : "personas"}
              {table.zone ? ` · ${table.zone}` : ""}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {pending > 0 && (
              <span
                role="status"
                className="hidden sm:inline-flex items-center gap-1.5 text-vimdy-text-secondary text-vimdy-micro"
              >
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                Guardando…
              </span>
            )}
            <button
              type="button"
              onClick={onOpenFullPanel}
              className="h-11 px-3.5 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface text-vimdy-text text-vimdy-small font-semibold flex items-center gap-2 hover:bg-vimdy-surface-hover transition-colors"
            >
              <MoreHorizontal size={18} aria-hidden="true" />
              <span className="hidden sm:inline">Cuenta y más</span>
              <span className="sm:hidden">Más</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Volver a las mesas"
              className="w-11 h-11 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface text-vimdy-text-secondary hover:text-vimdy-text flex items-center justify-center transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {errorMsg && (
          <div
            role="alert"
            className="mx-4 mt-3 rounded-vimdy-md bg-vimdy-danger-bg border border-vimdy-danger/40 text-vimdy-danger-hover px-4 py-3 text-vimdy-small flex-shrink-0"
          >
            {errorMsg}
          </div>
        )}

        {/* Pestañas (solo celular) */}
        <div className="flex md:hidden border-b border-vimdy-border flex-shrink-0" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "menu"}
            onClick={() => setTab("menu")}
            className={`flex-1 h-12 flex items-center justify-center gap-2 text-vimdy-small font-bold border-b-2 transition-colors ${
              tab === "menu"
                ? "text-vimdy-accent-hover border-vimdy-accent"
                : "text-vimdy-text-secondary border-transparent"
            }`}
          >
            <UtensilsCrossed size={18} />
            Menú
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "order"}
            onClick={() => setTab("order")}
            className={`relative flex-1 h-12 flex items-center justify-center gap-2 text-vimdy-small font-bold border-b-2 transition-colors ${
              tab === "order"
                ? "text-vimdy-accent-hover border-vimdy-accent"
                : "text-vimdy-text-secondary border-transparent"
            }`}
          >
            <ClipboardList size={18} />
            Pedido
            {itemCount > 0 && (
              <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-vimdy-accent text-white text-vimdy-micro font-bold flex items-center justify-center tabular-nums">
                {itemCount}
              </span>
            )}
          </button>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[minmax(0,1fr)_360px] lg:grid-cols-[minmax(0,1fr)_400px] md:gap-4 md:p-4 overflow-hidden">
          {/* Menú */}
          <section
            aria-label="Menú"
            className={`${tab === "menu" ? "flex" : "hidden"} md:flex flex-1 min-h-0 flex-col overflow-hidden p-3 md:p-0`}
          >
            <div className="relative mb-3 flex-shrink-0">
              <Search
                size={18}
                aria-hidden="true"
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-vimdy-text-tertiary"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar plato o bebida…"
                aria-label="Buscar producto"
                autoComplete="off"
                className="w-full h-12 pl-10 pr-4 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-vimdy-small outline-none focus:border-vimdy-accent transition-colors placeholder:text-vimdy-text-tertiary"
              />
            </div>

            <div className="flex gap-2 mb-3 overflow-x-auto pb-1 flex-shrink-0" role="tablist" aria-label="Categorías">
              {categoryIds.map((id) => {
                const active = category === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setCategory(id)}
                    className={`h-11 px-5 rounded-full border text-vimdy-small font-semibold whitespace-nowrap transition-colors ${
                      active
                        ? "bg-vimdy-accent border-vimdy-accent text-white"
                        : "bg-vimdy-surface border-vimdy-border text-vimdy-text-secondary hover:border-vimdy-accent/50"
                    }`}
                  >
                    {id === "Todos" ? "Todos" : categoryNames.get(id) ?? "Otros"}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {visibleProducts.length === 0 ? (
                <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-6 text-center text-vimdy-text-secondary text-vimdy-small">
                  {search.trim() || category !== "Todos"
                    ? "No se encontraron productos con ese filtro."
                    : "Todavía no hay productos para vender."}
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5 content-start pb-2">
                  {visibleProducts.map(renderProductCard)}
                </div>
              )}
            </div>
          </section>

          {/* Pedido */}
          <section
            aria-label="Pedido de la mesa"
            className={`${tab === "order" ? "flex" : "hidden"} md:flex flex-1 md:flex-none min-h-0 flex-col overflow-hidden md:rounded-vimdy-lg md:border md:border-vimdy-border md:bg-vimdy-background`}
          >
            <div className="hidden md:flex items-center justify-between px-4 py-3 border-b border-vimdy-border flex-shrink-0">
              <h3 className="text-vimdy-text font-bold text-vimdy-body flex items-center gap-2">
                <ClipboardList size={18} aria-hidden="true" />
                Pedido
              </h3>
              <span className="px-3 py-1 rounded-full border border-vimdy-border bg-vimdy-surface text-vimdy-text text-vimdy-small font-semibold tabular-nums">
                {itemCount} {itemCount === 1 ? "ítem" : "ítems"}
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              {!hasItems ? (
                <div className="h-full min-h-[180px] flex flex-col items-center justify-center text-center px-6">
                  <ShoppingBasket size={44} className="text-vimdy-text-tertiary mb-3" aria-hidden="true" />
                  <p className="text-vimdy-text font-bold text-vimdy-body">Todavía no hay nada pedido</p>
                  <p className="text-vimdy-text-secondary text-vimdy-small mt-1">
                    Toca un plato del menú para agregarlo a {table.name}.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2.5">{table.items.map(renderOrderLine)}</ul>
              )}
            </div>
          </section>
        </div>

        {/* Barra de acción */}
        <footer className="border-t border-vimdy-border bg-vimdy-surface px-4 py-3 flex-shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center justify-between sm:justify-start gap-4">
              <div>
                <p className="text-vimdy-text-secondary text-vimdy-micro">Total de la mesa</p>
                <p className="text-vimdy-text font-black text-2xl tabular-nums leading-tight">
                  {money(table.total)}
                </p>
              </div>

              <div
                className="flex gap-1 p-1 rounded-vimdy-md bg-vimdy-background border border-vimdy-border"
                role="group"
                aria-label="Prioridad en cocina"
              >
                {PRIORITIES.map(({ value, label }) => {
                  const active = priority === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setPriority(value)}
                      className={`h-10 px-3 rounded-vimdy-sm text-vimdy-micro font-bold transition-colors ${
                        active
                          ? value === "URGENT"
                            ? "bg-vimdy-danger text-white"
                            : value === "HIGH"
                              ? "bg-vimdy-warning text-vimdy-background"
                              : "bg-vimdy-surface-active text-vimdy-text"
                          : "text-vimdy-text-secondary hover:text-vimdy-text"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="sm:ml-auto sm:min-w-[260px]">
              <VimdyButton
                variant="primary"
                size="xl"
                fullWidth
                loading={sending}
                disabled={sending || !hasKitchenItems}
                onClick={() => void handleSend()}
                icon={<ChefHat size={20} />}
              >
                {pending > 0 ? "Guardando y enviar a cocina" : "Enviar a cocina"}
              </VimdyButton>
            </div>
          </div>
        </footer>
      </div>

      {sheet?.kind === "add" && (
        <QuickOptionsSheet
          product={sheet.product}
          mode="add"
          onCancel={() => setSheet(null)}
          onConfirm={(result) => {
            addToOrder(sheet.product, result);
            setSheet(null);
          }}
        />
      )}

      {sheet?.kind === "note" && noteSheetData && (
        <QuickOptionsSheet
          product={sheet.product}
          mode="edit-note"
          lockedVariantLabel={noteSheetData.label}
          lineQuantity={sheet.item.quantity}
          lineUnitPrice={sheet.item.price}
          initialQuickNotes={noteSheetData.quickNotes}
          initialFreeText={noteSheetData.freeText}
          onCancel={() => setSheet(null)}
          onConfirm={(result) => {
            saveNote(sheet.item, sheet.product, result);
            setSheet(null);
          }}
        />
      )}
    </div>
  );
}