import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { vimdyCore, EventType } from "../../core/VimdyCore";

/* ===========================================================================
   realtimeSync
   ---------------------------------------------------------------------------
   Esta es la pieza que faltaba para que Computador A, Computador B, Tablet
   y Celular vean EXACTAMENTE lo mismo sin recargar la página.

   Cómo funciona:
     1. Al iniciar sesión, se abre UN canal de Supabase Realtime para el
        negocio activo, suscrito a los cambios (INSERT/UPDATE/DELETE) de
        cada tabla, filtrados por business_id (nadie recibe cambios de
        otro negocio — misma barrera que ya usa RLS).
     2. Cuando llega un cambio remoto (lo hizo OTRO dispositivo), este
        módulo lo traduce a un evento de tu bus interno `vimdyCore`
        (el mismo que ya usas para "inventory", "customer", "table", etc).
     3. Cada hook (useProducts, useInventory, useCategories...) se suscribe
        a vimdyCore y vuelve a leer — se conecta hook por hook, ver
        checklist al final de este archivo.

   Requisito previo (server): haber corrido supabase/realtime_migration.sql
   en el SQL Editor de tu proyecto. Sin eso, este canal se abre pero nunca
   recibe nada (Postgres no transmite cambios de tablas que no están en la
   publicación `supabase_realtime`).
=========================================================================== */

/** Tabla real de Postgres -> evento del bus interno que ya escuchan (o van a escuchar) los hooks. */
const TABLE_EVENT_MAP: Record<string, EventType> = {
  products: "inventory",
  categories: "inventory",
  suppliers: "inventory",
  inventory_movements: "inventory",
  sales: "sale",
  customers: "customer",
  kitchen_orders: "kitchen",
  alerts: "notification",
  notifications: "notification",
  receipts: "receipt",
  cash_movements: "payment",
  tables: "table",
  orders: "order",
  shifts: "shift",
  roles: "access",
  permissions: "access",
  app_users: "user",
  audit_logs: "audit",
  businesses: "subscription"
};

let channel: RealtimeChannel | null = null;
let activeBusinessId: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Si llegan 30 filas cambiadas de golpe (ej. una venta grande que descuenta
// 30 productos), no queremos disparar 30 recargas seguidas: agrupamos por
// tipo de evento y disparamos una sola vez, 250ms después del último cambio.
const debounceTimers = new Map<EventType, ReturnType<typeof setTimeout>>();
function emitDebounced(event: EventType) {
  const existing = debounceTimers.get(event);
  if (existing) clearTimeout(existing);
  debounceTimers.set(
    event,
    setTimeout(() => {
      debounceTimers.delete(event);
      vimdyCore.emit(event, { source: "remote-sync" });
    }, 250)
  );
}

/**
 * Abre (o reabre) el canal de sincronización para el negocio dado.
 * Llamar justo después de que se conoce el business_id: al restaurar
 * sesión, al hacer login y al registrar un negocio nuevo.
 * Es seguro llamarla más de una vez con el mismo businessId (no hace nada).
 */
export function startRealtimeSync(businessId: string): void {
  if (channel && activeBusinessId === businessId) return;

  stopRealtimeSync();
  activeBusinessId = businessId;

  let builder = supabase.channel(`business-sync-${businessId}`);

  for (const table of Object.keys(TABLE_EVENT_MAP)) {
    const filter =
      table === "businesses"
        ? { column: "id", value: businessId }
        : { column: "business_id", value: businessId };

    builder = builder.on(
      "postgres_changes" as any,
      {
        event: "*",
        schema: "public",
        table,
        filter: `${filter.column}=eq.${filter.value}`
      },
      () => emitDebounced(TABLE_EVENT_MAP[table])
    );
  }

  builder.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      console.info(`[realtimeSync] conectado (negocio ${businessId})`);
    }

    // Si se cae la conexión (wifi inestable en la tablet, celular con datos
    // móviles, etc), reintentamos solos en 3s en vez de dejar el dispositivo
    // sordo hasta que el usuario recargue manualmente.
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (activeBusinessId === businessId) {
          channel = null;
          startRealtimeSync(businessId);
        }
      }, 3000);
    }
  });

  channel = builder;
}

/** Cierra el canal (llamar en logout, para no dejar sockets abiertos ni filtrar eventos entre negocios). */
export function stopRealtimeSync(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  activeBusinessId = null;
  debounceTimers.forEach((timer) => clearTimeout(timer));
  debounceTimers.clear();
}

/**
 * CHECKLIST — hooks que hay que conectar a vimdyCore para que la
 * sincronización llegue hasta la pantalla (se hace uno por uno, ver
 * conversación):
 *   [x] src/hooks/useProducts.ts            -> escuchar "inventory"
 *   [x] src/core/store/useInventory.ts      -> escuchar "inventory"
 *   [x] src/hooks/useCategories.ts          -> escuchar "inventory"
 *   [x] src/core/store/useCustomers.ts      -> escuchar "customer"
 *   [x] mesas -> Meseros.tsx ya escucha "table"
 *       via container.tableEngine.get() (tableStore.ts/useTables.ts se borraron,
 *       eran datos falsos en memoria, nunca estuvieron conectados a esto)
 *   [x] src/hooks/useKitchenOrders.ts       -> escuchar "kitchen"
 *   [x] src/hooks/useKitchenHistory.ts      -> escuchar "kitchen"
 *   [x] src/hooks/useSuppliers.ts           -> escuchar "inventory"
 *   [x] src/core/store/useReports.ts        -> escuchar "sale" y "payment"
 *   [x] src/core/store/useNotifications.ts  -> escuchar "notification"
 *   [x] src/hooks/useAutoAlerts.ts          -> no necesitaba cambios (el
 *       fix de duplicados en la campana quedó en notificationStore.ts)
 */