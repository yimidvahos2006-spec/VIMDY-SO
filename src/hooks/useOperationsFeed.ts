import { useEffect, useRef, useState } from "react";

import { vimdyCore } from "../core/VimdyCore";
import { productCatalogStore } from "../core/store/productCatalogStore";
import { dashboardStore } from "../core/store/dashboardStore";
import { container, tablesReady } from "../infrastructure/di/CompositionRoot";
import { Table } from "../core/entities/Entities";

export type FeedKind =
  | "sale"
  | "login"
  | "lowStock"
  | "tableWaiting"
  | "kitchenOrder"
  | "ai";

export interface FeedEvent {
  id: string;
  kind: FeedKind;
  emoji: string;
  color: string;
  title: string;
  message: string;
  timestamp: number;
}

/** Debajo de esta cantidad de unidades, un producto se considera "agotándose". */
/** Minutos que una mesa puede estar ocupada antes de considerarse "esperando". */
const TABLE_WAITING_MINUTES = 15;
/** Cada cuánto se revisan los stores no-reactivos (mesas, cocina, inventario). */
const POLL_INTERVAL_MS = 4000;
/** Cada cuánto se genera un nuevo tip de IA a partir de los datos reales del día. */
const AI_INSIGHT_INTERVAL_MS = 45_000;
/** Cuántos eventos se conservan en el feed. */
const MAX_EVENTS = 30;

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Centro de monitoreo en vivo: combina eventos reales del bus (vimdyCore)
 * con lectura periódica de los stores operativos (mesas, cocina,
 * inventario) para producir un feed de actividad genuino — nada de datos
 * simulados ni entradas aleatorias.
 */
export function useOperationsFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);

  // Memoria de qué ya se alertó, para no repetir el mismo aviso en cada poll.
  const alertedProducts = useRef(new Set<string>());
  const alertedTables = useRef(new Set<string>());
  const hasIndexedInitialState = useRef(false);

  // Copia real de las mesas: viene de container.tableEngine.get() (la misma
  // fuente que usa Meseros.tsx), no de datos inventados. Se refresca sola
  // cuando realtimeSync.ts avisa que una mesa cambió en cualquier
  // dispositivo, así el feed nunca queda mirando mesas desactualizadas.
  const tablesSnapshotRef = useRef<Table[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadTables() {
      await tablesReady;
      const all = await container.tableEngine.get().getAllTables();
      if (!cancelled) tablesSnapshotRef.current = all;
    }

    loadTables();
    const offTable = vimdyCore.on("table", () => {
      loadTables();
    });

    return () => {
      cancelled = true;
      offTable();
    };
  }, []);

  function pushEvent(event: Omit<FeedEvent, "id" | "timestamp">) {
    setEvents(prev =>
      [{ ...event, id: makeId(), timestamp: Date.now() }, ...prev].slice(0, MAX_EVENTS)
    );
  }

  // --- Eventos reales del bus (push) -------------------------------------
  useEffect(() => {
    const offSale = vimdyCore.on("sale", (payload: any) => {
      pushEvent({
        kind: "sale",
        emoji: "🟢",
        color: "var(--vimdy-success)", // Fase 3: antes hex suelto
        title: "Nueva venta",
        message: `Venta ${payload?.saleCode ?? ""} por $${Number(payload?.total ?? 0).toLocaleString("es-CO")}`
      });
    });

    const offKitchen = vimdyCore.on("kitchen", (payload: any) => {
      if (payload?.action !== "kitchen.order_created") return;

      const order = payload.payload;

      pushEvent({
        kind: "kitchenOrder",
        emoji: "🔵",
        color: "var(--vimdy-accent-hover)", // Fase 3: antes hex suelto
        title: "Pedido enviado a cocina",
        message: `${order?.origin ?? "Pedido"} — ${order?.items?.length ?? 0} producto(s).`
      });
    });

    const offSession = vimdyCore.on("session", async (payload: any) => {
      if (payload?.action !== "LOGIN") return;

      let name = "Usuario";
      try {
        const user = await container.userEngine.get().getUser(payload.userId);
        name = user.name;
      } catch {
        // Si no se encuentra el usuario, se muestra el mensaje genérico.
      }

      pushEvent({
        kind: "login",
        emoji: "🔵",
        color: "var(--vimdy-blue)", // Fase 3: antes hex suelto, token agregado en tailwind.config.js + index.css
        title: "Inicio de sesión",
        message: `${name} inició sesión en VIMDY.`
      });
    });

    return () => {
      offSale();
      offKitchen();
      offSession();
    };
  }, []);

  // --- Stores operativos no-reactivos (poll de solo lectura) -------------
  useEffect(() => {
    productCatalogStore.init();
  }, []);

  useEffect(() => {
    function poll() {
      // Inventario agotándose.
      const products = productCatalogStore.getSnapshot();
      for (const product of products) {
        // BLOQUEANTE (bug reportado en video 2026-07-31): trackStock ===
        // false (Cocina sin receta, ej. Caldo de Costilla) nace y se queda
        // en stock 0 a propósito porque no maneja stock propio. Sin este
        // chequeo, cada uno de estos productos disparaba un evento
        // "Producto agotándose" en el feed en vivo, y como su stock nunca
        // sube ni baja, nunca se limpiaba del set de alertados — quedaba
        // como ruido permanente. Mismo criterio que InventoryEngine/
        // AlertEngine/InventoryAI.
        if (product.trackStock === false) continue;

        const isLow = product.stock <= product.minStock;

        if (isLow && !alertedProducts.current.has(product.id)) {
          alertedProducts.current.add(product.id);

          if (hasIndexedInitialState.current) {
            pushEvent({
              kind: "lowStock",
              emoji: "🔴",
              color: "var(--vimdy-danger)", // Fase 3: antes hex suelto
              title: "Producto agotándose",
              message: `${product.name}: quedan ${product.stock} unidades.`
            });
          }
        } else if (!isLow && alertedProducts.current.has(product.id)) {
          // Se repuso stock: si vuelve a bajar, se puede alertar de nuevo.
          alertedProducts.current.delete(product.id);
        }
      }

      // Mesas esperando (cuenta o pago pendiente hace rato).
      const tables = tablesSnapshotRef.current;
      for (const table of tables) {
        const waitingPayment = table.status === "WAITING_BILL" || table.status === "PAYING";
        const stillOpen =
          table.status === "BUSY" || table.status === "EATING" || table.status === "WAITING_FOOD";
        const longOccupied =
          stillOpen &&
          !!table.openedAt &&
          (Date.now() - new Date(table.openedAt).getTime()) / 60_000 > TABLE_WAITING_MINUTES;

        const isWaiting = waitingPayment || longOccupied;

        if (isWaiting && !alertedTables.current.has(table.id)) {
          alertedTables.current.add(table.id);

          if (hasIndexedInitialState.current) {
            pushEvent({
              kind: "tableWaiting",
              emoji: "🟡",
              color: "#EAB308", // vimdy-gold (tailwind.config.js) — sin CSS var propia, mismo valor exacto
              title: waitingPayment ? "Mesa esperando pago" : "Mesa lleva mucho tiempo",
              message: `${table.name} — ${table.peopleCount} cliente(s).`
            });
          }
        } else if (!isWaiting && alertedTables.current.has(table.id)) {
          alertedTables.current.delete(table.id);
        }
      }

      // La primera pasada solo indexa el estado actual: evita que, al
      // cargar el Dashboard, se disparen alertas por productos/mesas que
      // ya estaban así desde antes.
      hasIndexedInitialState.current = true;
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // --- Insight de IA derivado de datos reales -----------------------------
  useEffect(() => {
    function emitInsight() {
      const { data, yesterday } = dashboardStore.getSnapshot();

      if (yesterday.sales === 0 || data.sales === 0) return;

      const change = ((data.sales - yesterday.sales) / yesterday.sales) * 100;
      if (Math.abs(change) < 1) return;

      const message =
        change > 0
          ? `Vas ${change.toFixed(1)}% por encima de ayer a esta hora. Buen ritmo.`
          : `Vas ${Math.abs(change).toFixed(1)}% por debajo de ayer a esta hora.`;

      pushEvent({
        kind: "ai",
        emoji: "🤖",
        color: "#A855F7", // vimdy-recipe (tailwind.config.js) — sin CSS var propia, mismo valor exacto
        title: "IA · Análisis de ventas",
        message
      });
    }

    const interval = setInterval(emitInsight, AI_INSIGHT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return events;
}