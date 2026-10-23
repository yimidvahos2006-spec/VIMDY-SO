import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, Search, X } from "lucide-react";
import { toast } from "../../../core/store/toastStore";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";
import { useCategories } from "../../../hooks/useCategories";
import type { LossCategory } from "../../../core/entities/Entities";
import { LOSS_CATEGORY_LABEL } from "../../../core/engines/lossCategoryLabels";
import {
  DEFAULT_TOP_LIMIT,
  computeDifferences,
  countProgress,
  estimateCountMinutes,
  isSuspiciousDifference,
  parseCountInput,
  selectProductsForCount,
  type CountKind,
  type CountLine,
  type CountScope,
  type InventoryCountSession,
} from "../../../core/inventoryCount/inventoryCountLogic";
import type { InventoryState } from "./inventoryShared";
import { money } from "./inventoryShared";

type View = "list" | "new" | "count" | "review";

// Motivos para lo que faltó: cortos y neutrales (no acusan a nadie).
const MISSING_REASONS: LossCategory[] = ["AJUSTE_ADMINISTRATIVO", "MERMA", "VENCIDO", "DAÑO", "CONSUMO_INTERNO", "OTRO"];

const engine = () => container.inventoryCountEngine.get();

const formatMinutes = (min: number) => {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

// Texto escrito que no se entiende como número (ej. "12a"): se marca en rojo en vez de ignorarlo en silencio.
const isInvalidCount = (raw: string) => raw.trim() !== "" && parseCountInput(raw) === null;

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const dateText = (d: Date | string) =>
  new Date(d).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Conteo guiado: se elige qué contar, se cuenta (por defecto "a ciegas", sin
 * ver lo que dice el sistema), se revisan las diferencias y se aplican como
 * movimientos con motivo. Un conteo cerrado ya no se puede editar.
 */
export function InventoryCountModal({ inventory, onClose }: { inventory: InventoryState; onClose: () => void }) {
  const { user, can, role } = useAuth();
  const performedBy = user?.name ?? "Sistema";
  const canApply = can("inventory.adjust");
  // Ver "lo que dice el sistema" mientras se cuenta le quita el sentido al conteo a ciegas: solo el administrador.
  const canPeekSystem = role?.id === "ADMIN";
  const { categories } = useCategories();

  const [view, setView] = useState<View>("list");
  const [sessions, setSessions] = useState<InventoryCountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<InventoryCountSession | null>(null);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, LossCategory>>({});
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [search, setSearch] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const dirty = useRef(false);
  const countInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Los guardados se hacen de uno en uno y en orden, para que ninguno pise al anterior.
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  // Productos en cuyo campo la persona escribió desde el último guardado (aunque quede el mismo número).
  const typedIds = useRef<Set<string>>(new Set());

  // Nuevo conteo
  const [kind, setKind] = useState<CountKind>("todo");
  const [scopeMode, setScopeMode] = useState<CountScope["mode"]>("top");
  const [categoryId, setCategoryId] = useState("");
  const [blind, setBlind] = useState(true);

  // Vista previa de lo que se va a contar: usa la misma regla que el motor al abrir el conteo.
  const countPreview = useMemo(() => {
    const scope: CountScope =
      scopeMode === "category" ? { mode: "category", categoryId } : scopeMode === "top" ? { mode: "top", limit: DEFAULT_TOP_LIMIT } : { mode: "all" };
    const count = selectProductsForCount(inventory.products, kind, scope).length;
    return { count, minutes: estimateCountMinutes(count) };
  }, [inventory.products, kind, scopeMode, categoryId]);
  const needsCategory = scopeMode === "category" && !categoryId;
  const nothingToCount = !needsCategory && countPreview.count === 0;

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await engine().listSessions());
    } catch {
      toast.error("No se pudieron cargar los conteos. ¿Ya se aplicó la actualización de la base de datos?");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const readOnly = session?.status === "CLOSED";
  // Conteo a ciegas en curso y quien lo ve no es administrador: no se le muestran cifras del sistema ni diferencias.
  const blindLocked = !!session && session.blind && !canPeekSystem && session.status !== "CLOSED" && !session.prepared;

  function openSession(s: InventoryCountSession) {
    setSession(s);
    setLines(s.lines);
    setInputs(Object.fromEntries(s.lines.map((l) => [l.productId, l.counted === null ? "" : String(l.counted)])));
    setReasons(Object.fromEntries(s.lines.filter((l) => l.reason).map((l) => [l.productId, l.reason as LossCategory])));
    setShowSystem(!s.blind);
    setSearch("");
    dirty.current = false;
    setView(s.status === "CLOSED" || s.prepared ? "review" : "count");
  }

  function linesFromInputs(): CountLine[] {
    // La "foto" del sistema la pone el motor al guardar; aquí solo se conserva la ya guardada para mostrar la revisión.
    const saved = new Map((session?.lines ?? []).map((l) => [l.productId, l]));
    return lines.map((l) => {
      const s = saved.get(l.productId);
      return {
        ...l,
        counted: parseCountInput(inputs[l.productId] ?? ""),
        ...(s?.systemStockAtCount !== undefined ? { systemStockAtCount: s.systemStockAtCount } : {}),
        ...(s?.countedAt ? { countedAt: s.countedAt } : {}),
      };
    });
  }

  function persist(silent = false): Promise<InventoryCountSession | null> {
    if (!session || readOnly) return Promise.resolve(session);
    const toSave = linesFromInputs();
    const recountedIds = Array.from(typedIds.current);
    typedIds.current.clear();
    dirty.current = false;
    const run = saveChain.current.then(async () => {
      try {
        const saved = await engine().saveCounts(session, toSave, { recountedIds });
        setSession(saved);
        if (!silent) toast.success("Conteo guardado.");
        return saved;
      } catch (e) {
        dirty.current = true;
        recountedIds.forEach((id) => typedIds.current.add(id));
        toast.error("No se pudo guardar el conteo. Intenta de nuevo.");
        return null;
      }
    });
    saveChain.current = run;
    return run;
  }

  // Guardado automático: si alguien deja el conteo a la mitad no pierde lo contado.
  useEffect(() => {
    if (view !== "count" || !dirty.current) return;
    const t = window.setTimeout(() => void persist(true), 2000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, view]);

  async function createSession() {
    if (busy) return;
    if (scopeMode === "category" && !categoryId) {
      toast.error("Elige la categoría que vas a contar.");
      return;
    }
    const scope: CountScope =
      scopeMode === "category" ? { mode: "category", categoryId } : scopeMode === "top" ? { mode: "top", limit: DEFAULT_TOP_LIMIT } : { mode: "all" };
    const kindLabel = kind === "insumos" ? "Insumos" : kind === "productos" ? "Productos" : "Insumos y productos";
    const scopeLabel =
      scope.mode === "category"
        ? `${kindLabel} · ${categories.find((c) => c.id === categoryId)?.name ?? "Categoría"}`
        : scope.mode === "top"
          ? `${kindLabel} · los ${DEFAULT_TOP_LIMIT} de mayor valor`
          : `${kindLabel} · todo`;
    setBusy(true);
    try {
      const created = await engine().startSession({ kind, scope, scopeLabel, blind, createdBy: performedBy });
      openSession(created);
    } catch (e: any) {
      toast.error(e?.message === "COUNT_NO_PRODUCTS" ? "No hay nada para contar con esa selección." : "No se pudo abrir el conteo. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function goReview() {
    if (lines.some((l) => isInvalidCount(inputs[l.productId] ?? ""))) {
      toast.error("Hay números que no se entienden (en rojo). Escribe solo el número, por ejemplo 12 o 2,5.");
      return;
    }
    const saved = await persist(true);
    if (!saved) return;
    await inventory.refresh();
    setView("review");
  }

  // Diferencias de la revisión: contra el stock actual (si está abierto) o lo guardado (si está cerrado).
  const diffs = useMemo(() => {
    if (!session) return [];
    if (readOnly || session.prepared) {
      return session.lines
        .filter((l) => l.counted !== null && l.difference !== undefined)
        .map((l) => {
          const baseline = l.systemStockAtCount ?? l.systemStockAtClose ?? l.systemStockAtStart;
          const stockNow = l.systemStockAtClose ?? baseline;
          return {
            line: l,
            systemStock: baseline,
            stockNow,
            movedSince: Math.round((stockNow - baseline) * 10000) / 10000,
            counted: l.counted as number,
            difference: l.difference as number,
            value: Math.round((l.difference as number) * (l.unitCost ?? 0) * 10000) / 10000,
          };
        });
    }
    const stockById = new Map(inventory.products.map((p) => [p.id, p.stock]));
    return computeDifferences(linesFromInputs(), stockById);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, readOnly, inventory.products, inputs, lines]);

  const withDiff = diffs.filter((d) => d.difference !== 0);
  const matching = diffs.length - withDiff.length;
  const notCounted = session ? session.lines.length - diffs.length : 0;
  const totalValue = withDiff.reduce((sum, d) => sum + d.value, 0);
  const suspiciousCount = withDiff.filter((d) => isSuspiciousDifference(d.systemStock, d.counted)).length;
  // Lo que más plata mueve va primero: es lo que más conviene revisar.
  const sortedDiffs = [...withDiff].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  async function closeCount() {
    if (!session || busy) return;
    setBusy(true);
    try {
      const { session: result, failures } = await engine().closeSession(session.id, performedBy, reasons);
      await inventory.refresh();
      setSession(result);
      setConfirmClose(false);
      if (failures.length > 0) {
        toast.error(`No se pudo ajustar: ${failures.map((f) => f.name).join(", ")}. El conteo sigue abierto: intenta de nuevo.`);
      } else {
        toast.success("Conteo cerrado y el inventario quedó ajustado.");
        setView("review");
        void refreshList();
      }
    } catch (e: any) {
      setConfirmClose(false);
      toast.error(e?.message === "COUNT_SESSION_CLOSED" ? "Este conteo ya estaba cerrado." : "No se pudo cerrar el conteo. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? lines.filter((l) => l.name.toLowerCase().includes(q)) : lines;
  }, [lines, search]);
  const progress = countProgress(linesFromInputs());

  // Enter (o "Siguiente" en el teclado del celular) pasa al siguiente producto sin tocar la pantalla.
  function focusNextCountInput(productId: string) {
    const idx = shown.findIndex((l) => l.productId === productId);
    const next = shown[idx + 1];
    if (next) countInputRefs.current[next.productId]?.focus();
    else countInputRefs.current[productId]?.blur();
  }

  // Al abrir la lista, el cursor queda en el primer producto sin contar: se empieza a digitar de una vez.
  useEffect(() => {
    if (view !== "count" || !session) return;
    const target = search.trim() ? shown[0] : (shown.find((l) => (inputs[l.productId] ?? "").trim() === "") ?? shown[0]);
    if (!target) return;
    const timer = window.setTimeout(() => countInputRefs.current[target.productId]?.focus(), 60);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, session?.id]);

  const chip = (active: boolean) =>
    `h-10 px-4 rounded-vimdy-md border text-sm font-semibold transition ${
      active ? "bg-vimdy-accent text-vimdy-background border-vimdy-accent" : "border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text"
    }`;

  function back() {
    if (view === "review" && session && !readOnly && !session.prepared) setView("count");
    else {
      setView("list");
      setSession(null);
      void refreshList();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {view !== "list" && (
              <button onClick={back} aria-label="Volver" className="text-vimdy-text-secondary hover:text-vimdy-text">
                <ArrowLeft size={20} />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-vimdy-text">Contar inventario</h2>
              {session && view !== "list" && <p className="text-sm text-vimdy-text-secondary truncate">{session.scopeLabel}</p>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-vimdy-text-secondary hover:text-vimdy-text">
            <X size={20} />
          </button>
        </div>

        {/* ---------------- LISTA ---------------- */}
        {view === "list" && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
            <button onClick={() => setView("new")} className="w-full h-12 rounded-vimdy-md bg-vimdy-accent text-vimdy-background font-bold text-sm flex items-center justify-center gap-2">
              <ClipboardCheck size={18} /> Empezar un conteo nuevo
            </button>
            {loading ? (
              <p className="text-sm text-vimdy-text-tertiary p-4 text-center">Cargando...</p>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-vimdy-text-tertiary p-6 text-center">Todavía no has hecho ningún conteo.</p>
            ) : (
              <div className="rounded-vimdy-md border border-vimdy-border divide-y divide-vimdy-border">
                {sessions.map((s) => {
                  const p = countProgress(s.lines);
                  return (
                    <button key={s.id} onClick={() => openSession(s)} className="w-full text-left px-4 py-3 hover:bg-vimdy-background/30 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-vimdy-text truncate">{s.scopeLabel}</p>
                        <p className="text-xs text-vimdy-text-tertiary">
                          {dateText(s.createdAt)} · {s.createdBy} · {p.counted}/{p.total} contados
                        </p>
                      </div>
                      <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-full ${s.status === "CLOSED" ? "bg-vimdy-success/15 text-vimdy-success" : "bg-vimdy-warning/15 text-vimdy-warning"}`}>
                        {s.status === "CLOSED" ? "Cerrado" : "En curso"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ---------------- NUEVO ---------------- */}
        {view === "new" && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-5">
            <div>
              <p className="text-sm font-semibold text-vimdy-text mb-2">¿Qué vas a contar?</p>
              <div className="flex flex-wrap gap-2">
                <button className={chip(kind === "todo")} onClick={() => setKind("todo")}>Insumos y productos</button>
                <button className={chip(kind === "insumos")} onClick={() => setKind("insumos")}>Solo insumos</button>
                <button className={chip(kind === "productos")} onClick={() => setKind("productos")}>Solo productos</button>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-vimdy-text mb-2">¿Cuánto?</p>
              <div className="flex flex-wrap gap-2">
                <button className={chip(scopeMode === "top")} onClick={() => setScopeMode("top")}>Los {DEFAULT_TOP_LIMIT} de mayor valor</button>
                <button className={chip(scopeMode === "category")} onClick={() => setScopeMode("category")}>Una categoría</button>
                <button className={chip(scopeMode === "all")} onClick={() => setScopeMode("all")}>Todo</button>
              </div>
              {scopeMode === "category" && (
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="mt-3 w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm">
                  <option value="">Elige una categoría...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
              <p
                aria-live="polite"
                className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                  nothingToCount ? "border-vimdy-warning/40 bg-vimdy-warning/10 text-vimdy-warning" : "border-vimdy-border bg-vimdy-background/60 text-vimdy-text-secondary"
                }`}
              >
                {needsCategory ? (
                  <>⏱️ Elige una categoría y te digo cuánto tarda</>
                ) : nothingToCount ? (
                  <>No hay nada para contar con esta selección</>
                ) : (
                  <>
                    ⏱️ Tiempo estimado: <strong className="text-vimdy-text">≈ {formatMinutes(countPreview.minutes)}</strong> · {countPreview.count} por contar
                  </>
                )}
              </p>
              {scopeMode === "all" && countPreview.minutes >= 30 && (
                <p className="text-xs text-vimdy-text-tertiary mt-2">Es un conteo largo. Si prefieres, cuéntalo por categorías y termina más rápido cada vez.</p>
              )}
              {scopeMode === "top" && <p className="text-xs text-vimdy-text-tertiary mt-2">Los que más plata tienen guardada (cantidad × costo). Lo ideal para contar cada semana.</p>}
            </div>
            <label className="flex items-start gap-3 rounded-vimdy-md border border-vimdy-border p-3 cursor-pointer">
              <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} className="mt-0.5 w-4 h-4 accent-vimdy-accent" />
              <span>
                <span className="block text-sm font-semibold text-vimdy-text">Conteo a ciegas (recomendado)</span>
                <span className="block text-xs text-vimdy-text-secondary">Quien cuenta no ve lo que dice el sistema, así cuenta lo que de verdad hay.</span>
              </span>
            </label>
            <p className="text-xs text-vimdy-text-tertiary">Lo mejor es contar cuando no se esté vendiendo mucho.</p>
            <button
              onClick={createSession}
              disabled={busy || nothingToCount}
              className="group w-full rounded-vimdy-md bg-vimdy-accent px-4 py-3 text-vimdy-background transition active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="flex items-center justify-center gap-2 text-sm font-bold">
                {busy ? "Abriendo..." : "Empezar a contar"}
                {!busy && <ArrowRight size={16} className="motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />}
              </span>
              <span className="mt-0.5 block text-xs font-normal opacity-80">
                {busy
                  ? "Preparando tu lista..."
                  : needsCategory
                    ? "Primero elige la categoría"
                    : nothingToCount
                      ? "Cambia la selección para poder empezar"
                      : blind
                        ? "Se abrirá la lista rápida para digitar lo que cuentes (sin ver el stock del sistema). Se guarda solo."
                        : "Se abrirá la lista rápida para digitar lo que cuentes. Se guarda solo."}
              </span>
            </button>
          </div>
        )}

        {/* ---------------- CONTAR ---------------- */}
        {view === "count" && session && (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-vimdy-text-tertiary" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." className="w-full h-10 pl-9 pr-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm outline-none focus:border-vimdy-accent" />
              </div>
              <span className="text-sm font-semibold text-vimdy-text whitespace-nowrap">{progress.counted} de {progress.total}</span>
            </div>
            {session.blind && canPeekSystem && (
              <label className="flex items-center gap-2 text-xs text-vimdy-text-secondary">
                <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} className="accent-vimdy-accent" />
                Mostrar lo que dice el sistema
              </label>
            )}
            <div className="flex-1 min-h-[160px] overflow-y-auto rounded-vimdy-md border border-vimdy-border divide-y divide-vimdy-border">
              {shown.map((l) => (
                <div key={l.productId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-vimdy-text truncate">{l.name}</p>
                    {showSystem && <p className="text-xs text-vimdy-text-tertiary">Sistema: {fmt(l.systemStockAtStart)} {l.unit ?? "und"}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="text"
                      inputMode="decimal"
                      ref={(el) => {
                        countInputRefs.current[l.productId] = el;
                      }}
                      enterKeyHint="next"
                      onInput={() => {
                        // Cada vez que la persona escribe, se marca: así un reconteo con el mismo número también cuenta.
                        dirty.current = true;
                        typedIds.current.add(l.productId);
                      }}
                      value={inputs[l.productId] ?? ""}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={() => {
                        // Se guarda apenas sales del campo: la "foto" del sistema queda tomada en ese momento.
                        if (dirty.current) void persist(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          focusNextCountInput(l.productId);
                        }
                      }}
                      onChange={(e) => {
                        dirty.current = true;
                        setInputs((prev) => ({ ...prev, [l.productId]: e.target.value }));
                      }}
                      placeholder="—"
                      aria-label={`Cantidad contada de ${l.name}`}
                      aria-invalid={isInvalidCount(inputs[l.productId] ?? "")}
                      title={isInvalidCount(inputs[l.productId] ?? "") ? "Escribe solo el número, por ejemplo 12 o 2,5" : undefined}
                      className={`w-24 h-10 px-3 text-right rounded-vimdy-md bg-vimdy-background border text-vimdy-text text-sm focus:outline-none ${
                        isInvalidCount(inputs[l.productId] ?? "") ? "border-vimdy-danger focus:border-vimdy-danger" : "border-vimdy-border focus:border-vimdy-accent"
                      }`}
                    />
                    <span className="w-10 text-xs text-vimdy-text-tertiary">{l.unit ?? "und"}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => void persist()} className="h-11 px-4 rounded-vimdy-md border border-vimdy-border text-vimdy-text-secondary text-sm font-semibold hover:text-vimdy-text">
                Guardar y seguir después
              </button>
              <button onClick={goReview} disabled={progress.counted === 0} className="flex-1 h-11 rounded-vimdy-md bg-vimdy-accent text-vimdy-background text-sm font-bold disabled:opacity-50">
                {session.blind && !canPeekSystem ? "Terminar conteo" : "Terminar y revisar"}
              </button>
            </div>
          </>
        )}

        {/* ---------------- CONTEO A CIEGAS: SOLO EL ADMINISTRADOR VE LAS DIFERENCIAS ---------------- */}
        {view === "review" && session && blindLocked && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
            <div className="rounded-vimdy-md border border-vimdy-border p-5 text-center space-y-2">
              <CheckCircle2 size={28} className="mx-auto text-vimdy-success" />
              <p className="text-base font-bold text-vimdy-text">Conteo guardado</p>
              <p className="text-sm text-vimdy-text-secondary">
                Contaste {progress.counted} de {progress.total} productos. Es un conteo a ciegas: un administrador revisa las diferencias y aplica el ajuste.
              </p>
              {progress.counted < progress.total && (
                <p className="text-xs text-vimdy-text-tertiary">Quedan {progress.total - progress.counted} sin contar. Puedes volver y terminarlos.</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={back} className="h-11 px-4 rounded-vimdy-md border border-vimdy-border text-vimdy-text-secondary text-sm font-semibold hover:text-vimdy-text">
                Volver a contar
              </button>
              <button onClick={onClose} className="flex-1 h-11 rounded-vimdy-md bg-vimdy-accent text-vimdy-background text-sm font-bold">
                Listo
              </button>
            </div>
          </div>
        )}

        {/* ---------------- REVISAR / CERRADO ---------------- */}
        {view === "review" && session && !blindLocked && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-vimdy-md border border-vimdy-border p-2">
                <p className="text-lg font-bold text-vimdy-success">{matching}</p>
                <p className="text-xs text-vimdy-text-secondary">Coinciden</p>
              </div>
              <div className="rounded-vimdy-md border border-vimdy-border p-2">
                <p className="text-lg font-bold text-vimdy-warning">{withDiff.length}</p>
                <p className="text-xs text-vimdy-text-secondary">Con diferencia</p>
              </div>
              <div className="rounded-vimdy-md border border-vimdy-border p-2">
                <p className="text-lg font-bold text-vimdy-text">{notCounted}</p>
                <p className="text-xs text-vimdy-text-secondary">Sin contar</p>
              </div>
            </div>

            <div className="flex-1 min-h-[140px] overflow-y-auto rounded-vimdy-md border border-vimdy-border divide-y divide-vimdy-border">
              {withDiff.length === 0 ? (
                <p className="p-8 text-center text-sm text-vimdy-text-tertiary">Todo lo contado coincide con el sistema.</p>
              ) : (
                sortedDiffs.map((d) => {
                  const unit = d.line.unit ?? "und";
                  const short = d.difference < 0;
                  const suspicious = isSuspiciousDifference(d.systemStock, d.counted);
                  return (
                    <div key={d.line.productId} className="px-4 py-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-vimdy-text truncate">{d.line.name}</p>
                        <p className={`text-sm font-bold whitespace-nowrap ${short ? "text-vimdy-danger" : "text-vimdy-success"}`}>
                          {short ? "Faltan" : "Sobran"} {fmt(Math.abs(d.difference))} {unit}
                        </p>
                      </div>
                      <p className="text-xs text-vimdy-text-tertiary">
                        {d.line.systemStockAtCount !== undefined ? "Sistema al contar" : "Sistema"} {fmt(d.systemStock)} · Contado {fmt(d.counted)}
                        {d.value !== 0 && ` · ${money(Math.abs(d.value))}`}
                      </p>
                      {d.movedSince !== 0 && (
                        <p className="text-xs text-vimdy-text-tertiary">
                          💡 Desde que lo contaste {d.movedSince < 0 ? "salieron" : "entraron"} {fmt(Math.abs(d.movedSince))} {unit} (ventas, compras u otros movimientos).
                          El ajuste ya lo tiene en cuenta.
                        </p>
                      )}
                      {suspicious && !readOnly && !session.prepared && (
                        <div className="flex items-center justify-between gap-2 rounded-vimdy-sm bg-vimdy-warning/10 px-2.5 py-1.5">
                          <p className="text-xs text-vimdy-warning">⚠️ Diferencia grande. ¿Contaste bien?</p>
                          <button
                            type="button"
                            onClick={() => {
                              setSearch(d.line.name);
                              setView("count");
                            }}
                            className="shrink-0 text-xs font-semibold text-vimdy-accent hover:underline"
                          >
                            Volver a contar
                          </button>
                        </div>
                      )}
                      {short && !readOnly && !session.prepared && (
                        <select
                          value={reasons[d.line.productId] ?? "AJUSTE_ADMINISTRATIVO"}
                          onChange={(e) => setReasons((prev) => ({ ...prev, [d.line.productId]: e.target.value as LossCategory }))}
                          className="h-9 px-2 rounded-vimdy-sm bg-vimdy-background border border-vimdy-border text-vimdy-text text-xs"
                          aria-label="Motivo"
                        >
                          {MISSING_REASONS.map((r) => (
                            <option key={r} value={r}>
                              {r === "AJUSTE_ADMINISTRATIVO" ? "Al contar no coincidía" : LOSS_CATEGORY_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      )}
                      {short && (readOnly || session.prepared) && d.line.reason && (
                        <p className="text-xs text-vimdy-text-secondary">
                          Motivo: {d.line.reason === "AJUSTE_ADMINISTRATIVO" ? "Al contar no coincidía" : LOSS_CATEGORY_LABEL[d.line.reason]}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {readOnly ? (
              <p className="flex items-center gap-2 text-sm text-vimdy-success">
                <CheckCircle2 size={16} /> Cerrado {session.closedAt && dateText(session.closedAt)} por {session.closedBy}. Ya no se puede editar.
              </p>
            ) : !canApply ? (
              <p className="text-sm text-vimdy-warning">Solo quien puede ajustar el inventario puede cerrar el conteo y aplicar las diferencias.</p>
            ) : (
              <button onClick={() => setConfirmClose(true)} disabled={busy} className="w-full h-12 rounded-vimdy-md bg-vimdy-accent text-vimdy-background font-bold text-sm disabled:opacity-60">
                {session.prepared ? "Reintentar y cerrar conteo" : "Aplicar ajustes y cerrar conteo"}
              </button>
            )}
          </>
        )}
      </div>

      {confirmClose && session && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.stopPropagation()}>
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-6">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} className="text-amber-400" />
              </div>
              <h2 className="text-slate-100 font-semibold text-base pt-1.5">¿Cerrar el conteo?</h2>
            </div>
            <p className="text-slate-400 text-sm mb-6">
              Se van a ajustar <b className="text-slate-200">{withDiff.length}</b> {withDiff.length === 1 ? "producto" : "productos"} para que el inventario quede como lo contaste
              {totalValue !== 0 ? ` (diferencia de ${money(Math.abs(totalValue))})` : ""}. Después el conteo ya no se puede editar.
            </p>
            {suspiciousCount > 0 && (
              <p className="text-amber-400 text-xs mb-6 -mt-3">
                ⚠️ {suspiciousCount} {suspiciousCount === 1 ? "tiene una diferencia muy grande" : "tienen una diferencia muy grande"}. Si ves un error al digitar, cancela y vuelve a contarlo.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmClose(false)} disabled={busy} className="h-10 px-4 rounded-lg border border-slate-700 text-slate-300 text-sm font-medium hover:bg-slate-700/50">
                Cancelar
              </button>
              <button onClick={closeCount} disabled={busy} className="h-10 px-4 rounded-lg bg-vimdy-accent text-white text-sm font-semibold disabled:opacity-60">
                {busy ? "Aplicando..." : "Sí, cerrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}