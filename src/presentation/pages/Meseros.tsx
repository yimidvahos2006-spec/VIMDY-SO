import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Check } from "lucide-react";

import { useTranslation } from "../../core/i18n/useTranslation";
import { Table, Product, Waiter } from "../../core/entities/Entities";
import {
  container,
  tablesReady,
  productsReady
} from "../../infrastructure/di/CompositionRoot";
import { getCurrentBusinessId } from "../../infrastructure/supabase/supabaseClient";
import { useVimdyEvent } from "../../hooks/useVimdyCore";
import { startLiveCatalog } from "../../core/utils/liveCatalog";
import { logWarning } from "../../infrastructure/logging/opsLogger";

import { WaiterSelect } from "../components/waiter/WaiterSelect";
import { TableGrid } from "../components/waiter/TableGrid";
import { OpenTableDialog } from "../components/waiter/OpenTableDialog";
import { TableDetailPanel } from "../components/waiter/TableDetailPanel";
import { VoiceCommandButton } from "../components/waiter/VoiceCommandButton";
import type { TableVoiceMerge, TableVoiceTarget } from "../../core/voice/useTableVoiceCommand";
import type { ParsedVoiceOrder } from "../../core/voice/orderParser";
import { playVoiceError, playVoiceSuccess } from "../../core/voice/voiceFeedback";
import { healOrphanLinkedTables, isMergeableTableStatus } from "../../core/utils/tableMerge";
import { translateBusinessError } from "../../core/errors/translateBusinessError";
import { toast } from "../../core/store/toastStore";
import { OfflineStatusBadge } from "../components/ui/OfflineStatusBadge";
import { usePendingTableOperationsQueue } from "../../core/offline/usePendingTableOperationsQueue";
import { TableConflictBanner } from "../components/waiter/TableConflictBanner";
import { RequirePermission } from "../navigation/RequirePermission";
import { useCanUse } from "../../hooks/useCanUse";

/** "Juan Martínez Gómez" → "Juan M." (cabe en la barra del tablet). */
function shortWaiterName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? name;
  return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
}

/** "mesero 2" → "Mesero 2" (solo para mostrar; el nombre guardado no cambia). */
function capitalizeFirst(text: string): string {
  const trimmed = text.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : text;
}

/** El mesero activo sobrevive a una recarga o a una caída del Wi-Fi. */
function activeWaiterStorageKey(businessId: string | null | undefined): string {
  return `vimdy.meseros.activeWaiter.${businessId ?? "default"}`;
}

function readStoredWaiterId(businessId: string | null | undefined): string | null {
  try {
    return window.localStorage.getItem(activeWaiterStorageKey(businessId));
  } catch {
    return null;
  }
}

function writeStoredWaiterId(businessId: string | null | undefined, waiterId: string | null): void {
  try {
    const key = activeWaiterStorageKey(businessId);
    if (waiterId) window.localStorage.setItem(key, waiterId);
    else window.localStorage.removeItem(key);
  } catch {
    /* modo privado o almacenamiento lleno: se sigue sin recordar */
  }
}

function MeserosContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tablesEnabled = useCanUse("tables");
  const waiterModeEnabled = useCanUse("waiters");
  const [ready, setReady] = useState(false);
  const [rawTables, setTables] = useState<Table[]>([]);
  // Una mesa "unida" cuya principal ya no tiene cuenta se trata como libre.
  const tables = useMemo(() => healOrphanLinkedTables(rawTables), [rawTables]);
  const [products, setProducts] = useState<Product[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [avgDurationMs, setAvgDurationMs] = useState<number>(45 * 60 * 1000);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // PASO 1.10 (offline elegante en Mesas) — cuántas aperturas/cierres de
  // mesa hechos sin conexión siguen esperando sincronizarse, para el badge
  // del encabezado (ver OfflineStatusBadge más abajo).
  const { count: pendingTableOperationsCount, blocked: blockedTables } = usePendingTableOperationsQueue();

  // null = todavía estamos en la pantalla de tarjetas de mesero.
  const [activeWaiter, setActiveWaiter] = useState<Waiter | null>(null);

  const restoredWaiterRef = useRef(false);
  const [waiterMenuOpen, setWaiterMenuOpen] = useState(false);

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"open" | "detail" | null>(null);
  // Comensales dictados por voz para precargar el diálogo de apertura.
  const [voicePeopleCount, setVoicePeopleCount] = useState<number | null>(null);
  // Pedido dictado junto a la mesa ("Mesa 3, dos cervezas…"): se agrega al abrirla.
  const [voiceOrder, setVoiceOrder] = useState<ParsedVoiceOrder<Product> | null>(null);
  // El menú ⋮ de la mesa abre el diálogo directamente en "Reservar".
  const [openInReserveMode, setOpenInReserveMode] = useState(false);

  const reloadTables = useCallback(async () => {
    const all = await container.tableEngine.get().getAllTables();

    const seen = new Set<string>();
    const unique = all.filter((table) => {
      if (seen.has(table.id)) {
        return false;
      }
      seen.add(table.id);
      return true;
    });

    if (unique.length !== all.length) {
      console.warn("[Meseros] Se detectaron mesas duplicadas en la respuesta del engine, se deduplicaron antes de actualizar el estado.", {
        total: all.length,
        unicas: unique.length
      });
    }

    setTables(unique);
  }, []);

  const reloadWaiters = useCallback(async () => {
    const all = await container.waiterEngine.get().listActive();
    setWaiters(all);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    setReady(false);

    Promise.all([tablesReady, productsReady])
      .then(async () => {
        const businessId = getCurrentBusinessId();
        const [allTables, allProducts, allWaiters, avgDuration] = await Promise.all([
          container.tableEngine.get().getAllTables(),
          container.inventoryEngine.get().listAll(),
          container.waiterEngine.get().listActive(),
          businessId ? container.tableEngine.get().getAverageDuration(businessId) : Promise.resolve(45 * 60 * 1000)
        ]);

        if (cancelled) return;

        setTables(allTables);
        setProducts(allProducts);
        setWaiters(allWaiters);
        setAvgDurationMs(avgDuration);

        // Recupera al mesero que estaba atendiendo antes de recargar (una sola vez).
        if (!restoredWaiterRef.current) {
          restoredWaiterRef.current = true;
          const storedId = readStoredWaiterId(businessId);
          const stored = storedId ? allWaiters.find(w => w.id === storedId) : undefined;
          if (stored) setActiveWaiter(stored);
        }

        setReady(true);
      })
      .catch(() => {
        // Antes se mostraba "no tienes mesas configuradas", que engañaba:
        // aquí el problema es la carga, no que falten mesas.
        if (!cancelled) {
          setLoadError(true);
          setReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Cualquier cambio de mesa en cualquier parte de la app (incluso desde
  // otro módulo) refresca el grid al instante.
  useVimdyEvent("table", () => {
    reloadTables();
  });

  // Si el dueño agrega/edita/quita un mesero desde Configuración mientras
  // esta pantalla está abierta en el tablet del restaurante, se refleja
  // de inmediato sin recargar la página.
  useVimdyEvent("waiter", () => {
    reloadWaiters();
  });

  // Lo mismo con el catálogo: si cambia un precio, un producto se desactiva o
  // cambia su flag de cocina, el mesero lo ve sin recargar la página. Antes
  // los productos se leían una sola vez al abrir la pantalla.
  useEffect(
    () =>
      startLiveCatalog({
        load: () => container.inventoryEngine.get().listAll(),
        apply: setProducts,
        onError: (error) =>
          logWarning("[Meseros] No se pudo refrescar el catálogo", {
            category: "inventory",
            context: { error: String(error) }
          })
      }),
    []
  );

  const selectedTable = selectedTableId
    ? tables.find(t => t.id === selectedTableId) ?? null
    : null;

  function handleSelectTable(table: Table, options?: { reserve?: boolean }) {
    setOpenInReserveMode(Boolean(options?.reserve));
    setSelectedTableId(table.id);
    if (table.status === "FREE" || table.status === "RESERVED") {
      setDialog("open");
    } else {
      setDialog("detail");
    }
  }

  /** Control por voz: abre la mesa dicha con los comensales ya cargados. */
  function handleVoiceTarget({ table, peopleCount, order }: TableVoiceTarget) {
    setVoicePeopleCount(peopleCount);
    setVoiceOrder(order ?? null);
    handleSelectTable(table);
  }

  /** Control por voz: unir dos mesas con cuenta abierta (ya confirmado por el mesero). */
  async function handleVoiceMerge({ primary, secondary, peopleCount }: TableVoiceMerge) {
    const engine = container.tableEngine.get();
    try {
      // Siempre con datos frescos: el estado pudo cambiar mientras se dictaba.
      const [freshPrimary, freshSecondary] = await Promise.all([
        engine.getTable(primary.id),
        engine.getTable(secondary.id)
      ]);

      if (!freshPrimary || !freshSecondary) {
        playVoiceError();
        toast.error("No encontré una de las mesas. Actualiza e inténtalo de nuevo.");
        return;
      }

      const closed = [freshPrimary, freshSecondary].find(t => !isMergeableTableStatus(t.status));
      if (closed) {
        playVoiceError();
        toast.warning(`${closed.name} no tiene una cuenta abierta. Ábrela primero y luego únelas.`);
        return;
      }

      await engine.mergeTables(freshSecondary.id, freshPrimary.id);

      if (peopleCount && peopleCount > 0) {
        await engine.updateTable(freshPrimary.id, { peopleCount });
      }

      playVoiceSuccess();
      toast.success(`${freshSecondary.name} unida a ${freshPrimary.name}.`);
      await reloadTables();
    } catch (err) {
      playVoiceError();
      toast.error(translateBusinessError(err, "No se pudieron unir las mesas."));
      await reloadTables();
    }
  }

  function handleSelectWaiter(waiter: Waiter) {
    if (!tablesEnabled && waiterModeEnabled) {
      navigate("/caja", { state: { tab: "venta", waiterId: waiter.id } });
      return;
    }
    writeStoredWaiterId(getCurrentBusinessId(), waiter.id);
    setActiveWaiter(waiter);
  }

  /** Cambio rápido de mesero desde la barra superior, sin pasar por las tarjetas. */
  function handleQuickSwitch(waiter: Waiter) {
    setWaiterMenuOpen(false);
    if (waiter.id === activeWaiter?.id) return;
    writeStoredWaiterId(getCurrentBusinessId(), waiter.id);
    setActiveWaiter(waiter);
    toast.info(`Ahora atiende ${waiter.name}.`, 2500);
  }

  function closeDialogs() {
    setDialog(null);
    setSelectedTableId(null);
    setVoicePeopleCount(null);
    setVoiceOrder(null);
  }

  /** Cierra todo y regresa a la pantalla de tarjetas para el siguiente mesero. */
  function returnToWaiterSelect() {
    closeDialogs();
    setWaiterMenuOpen(false);
    writeStoredWaiterId(getCurrentBusinessId(), null);
    setActiveWaiter(null);
  }

  const showTableTools = ready && !loadError && tablesEnabled && (!waiterModeEnabled || activeWaiter);

  // La pantalla de elegir mesero sigue llamándose "Meseros"; en cuanto hay
  // un mesero activo (o el negocio no usa meseros) lo que se elige son mesas.
  const pageTitle = waiterModeEnabled
    ? tablesEnabled
      ? activeWaiter
        ? t("waiter.page.tablesTitle")
        : t("waiter.page.title")
      : "Pedidos de meseros"
    : "Mesas";

  return (
    <div className="p-4 sm:p-8">
      <TableConflictBanner blocked={blockedTables} />
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6 sm:mb-8">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl sm:text-5xl font-black text-white">{pageTitle}</h1>
            <OfflineStatusBadge
              pendingCount={pendingTableOperationsCount}
              pendingLabelSingular={t("waiter.offline.pendingSingular")}
              pendingLabelPlural={t("waiter.offline.pendingPlural", { count: pendingTableOperationsCount })}
            />
          </div>
          <p className="text-slate-400 mt-2 sm:mt-3 text-base sm:text-xl">
            {activeWaiter
              ? t("waiter.page.subtitleWaiter", { name: capitalizeFirst(activeWaiter.name) })
              : tablesEnabled ? t("waiter.page.subtitleAdmin") : "Selecciona quién atiende la venta de mostrador."}
          </p>
        </div>

        {/* Barra superior derecha: micrófono + mesero activo + cambio de mesero. */}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {showTableTools && dialog === null && (
            <VoiceCommandButton tables={tables} products={products} onTarget={handleVoiceTarget} onMerge={handleVoiceMerge} />
          )}

          {activeWaiter && (
            <div className="relative">
              <button
                onClick={() => setWaiterMenuOpen(open => !open)}
                aria-haspopup="listbox"
                aria-expanded={waiterMenuOpen}
                className="h-12 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-semibold flex items-center gap-2 transition"
              >
                <span className="text-slate-400 font-medium">Atendiendo:</span>
                <span className="font-bold">{shortWaiterName(activeWaiter.name)}</span>
                <ChevronDown size={16} className={`transition ${waiterMenuOpen ? "rotate-180" : ""}`} />
              </button>

              {waiterMenuOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Cerrar lista de meseros"
                    className="fixed inset-0 z-[890] cursor-default"
                    onClick={() => setWaiterMenuOpen(false)}
                  />
                  <ul
                    role="listbox"
                    className="absolute right-0 top-full mt-2 z-[900] w-64 max-h-[60vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl py-2"
                  >
                    {waiters.map(waiter => {
                      const selected = waiter.id === activeWaiter.id;
                      return (
                        <li key={waiter.id} role="option" aria-selected={selected}>
                          <button
                            onClick={() => handleQuickSwitch(waiter)}
                            className={`w-full min-h-[48px] px-4 flex items-center justify-between gap-3 text-left text-sm transition ${
                              selected ? "bg-cyan-500/15 text-cyan-300 font-bold" : "text-slate-200 hover:bg-slate-800"
                            }`}
                          >
                            <span className="truncate">{waiter.name}</span>
                            {selected && <Check size={16} />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}

          {activeWaiter && (
            <button
              onClick={returnToWaiterSelect}
              className="h-12 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold transition"
            >
              Cambiar de mesero
            </button>
          )}
        </div>
      </div>

      {!ready && (
        <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-12 text-center text-slate-400">
          Cargando…
        </div>
      )}

      {ready && loadError && (
        <div className="rounded-3xl border border-red-500/40 bg-red-500/10 p-10 text-center">
          <p className="text-red-200 text-lg font-bold">No pudimos cargar las mesas.</p>
          <p className="text-slate-400 text-sm mt-2">
            Revisa tu conexión e inténtalo de nuevo. Tus mesas no se borraron.
          </p>
          <button
            onClick={() => setReloadKey(key => key + 1)}
            className="mt-5 px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold transition"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Paso 1: tocar el nombre — sin login. */}
      {ready && !loadError && waiterModeEnabled && !activeWaiter && (
        <WaiterSelect waiters={waiters} onSelect={handleSelectWaiter} />
      )}

      {/* Paso 2: mesas, ya con el mesero identificado. */}
      {ready && !loadError && tablesEnabled && (!waiterModeEnabled || activeWaiter) && (
        <TableGrid tables={tables} waiters={waiters} onSelect={(table) => handleSelectTable(table)} onReserve={(table) => handleSelectTable(table, { reserve: true })} avgDurationMs={avgDurationMs} onTablesChanged={reloadTables} />
      )}

      {dialog === "open" && selectedTable && (
        <OpenTableDialog
          table={selectedTable}
          tables={tables}
          waiterId={activeWaiter?.id ?? null}
          initialPeopleCount={voicePeopleCount}
          initialMode={openInReserveMode ? "reserve" : "open"}
          onClose={closeDialogs}
          onOpened={() => {
            setDialog("detail");
            reloadTables();
          }}
        />
      )}

      {dialog === "detail" && selectedTable && (
        <TableDetailPanel
          table={selectedTable}
          tables={tables}
          products={products}
          initialVoiceOrder={voiceOrder}
          onVoiceOrderConsumed={() => setVoiceOrder(null)}
          onClose={closeDialogs}
          onChanged={reloadTables}
          onClosedTable={() => {
            closeDialogs();
            reloadTables();
          }}
          onOrderSent={() => {
            closeDialogs();
            reloadTables();
          }}
        />
      )}

    </div>
  );
}

export function Meseros() {
  const tablesEnabled = useCanUse("tables");

  return (
    <RequirePermission requires={tablesEnabled ? "tables.view" : "staff.view"}>
      <MeserosContent />
    </RequirePermission>
  );
}