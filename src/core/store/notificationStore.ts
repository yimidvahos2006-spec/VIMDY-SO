import { ObservableStore } from "./ObservableStore";
import { container } from "../../infrastructure/di/CompositionRoot";
import { logError } from "../../infrastructure/logging/opsLogger";

/**
 * Categoría de negocio de la notificación (PASO 5 — Centro de notificaciones).
 * Independiente de `type` (que solo define el color/icono genérico):
 * `category` es lo que permite agrupar y filtrar en NotificationCenter.
 */
export type NotificationCategory =
  | "STOCK_BAJO"
  | "PEDIDO_RETRASADO"
  | "CAJA_ABIERTA"
  | "META_CUMPLIDA"
  | "IA_COMPRA"
  | "RECORDATORIO"
  | "GENERAL";

export interface Notification {
  readonly id: string;
  /**
   * Clave de deduplicación: mientras una alerta con la misma `key` siga
   * activa (ej. "STOCK_BAJO"), no se vuelve a insertar en cada recálculo
   * del negocio — evita que la campana se llene con la misma alerta
   * repetida cada pocos segundos.
   */
  readonly key: string;
  readonly title: string;
  readonly message: string;
  readonly type: "success" | "warning" | "error" | "info";
  readonly category: NotificationCategory;
  readonly read: boolean;
  readonly date: Date;
}

/** Cuántas notificaciones se conservan como máximo (evita crecer sin límite). */
const MAX_NOTIFICATIONS = 50;

/**
 * notificationStore
 * ---------------------------------------------------------------------------
 * PASO 4 — Alertas automáticas. PASO 5 — Centro de notificaciones (real,
 * multi-negocio).
 *
 * Antes: vivía SOLO en memoria (RAM del navegador) — al recargar la
 * página, o al entrar desde otro dispositivo, todo desaparecía. Eso
 * estaba bien para una demo, pero no para un negocio real, y mucho menos
 * para muchos negocios usando la misma app a la vez.
 *
 * Ahora: es un ObservableStore reactivo (mismo patrón que cartStore /
 * searchStore) que además persiste cada cambio en la tabla `notifications`
 * de Supabase vía NotificationRepository — aislada por negocio con Row
 * Level Security, igual que products/sales/shifts. Un negocio JAMÁS ve
 * las notificaciones de otro, y las notificaciones de un negocio se ven
 * iguales en cualquier dispositivo donde ese negocio inicie sesión.
 *
 * Quien la llena automáticamente es useAutoAlerts (stock bajo, pedido
 * retrasado, meta cumplida, IA recomienda comprar) y ShiftPanel (caja
 * abierta). Los recordatorios los agrega directamente el usuario desde
 * NotificationCenter.
 */
class NotificationStore extends ObservableStore<Notification[]> {
  private notifications: Notification[] = [];
  private loaded = false;
  private loading: Promise<void> | null = null;

  constructor() {
    super([]);
  }

  private sync() {
    this.publish([...this.notifications]);
  }

  /**
   * Deduplica por `key`, quedándose con la más reciente de cada una.
   *
   * ¿Por qué hace falta si add() ya deduplica? add() solo compara contra
   * this.notifications EN MEMORIA de este dispositivo. Si Computador A y
   * Computador B detectan la misma alerta (ej. "stock bajo" del mismo
   * producto) casi al mismo tiempo, ninguno todavía tiene la key del otro
   * en su caché local, así que ambos pasan la validación y ambos la
   * insertan en Supabase: quedan dos filas con la misma key pero distinto
   * id. Sin este paso, refresh()/init() mostrarían las dos en la campana.
   * Requiere que `list` ya venga ordenada más reciente primero.
   */
  private dedupeByKey(list: Notification[]): Notification[] {
    const seen = new Set<string>();
    const result: Notification[] = [];
    for (const n of list) {
      if (seen.has(n.key)) continue;
      seen.add(n.key);
      result.push(n);
    }
    return result;
  }

  private persist(notification: Notification) {
    container.notificationRepo.save(notification).catch((err) => {
      logError("[notificationStore] No se pudo guardar la notificación en Supabase", { category: "sync", context: { error: String(err) } });
    });
  }

  /**
   * Carga las notificaciones del negocio activo desde Supabase. Se llama
   * una sola vez (idempotente) — la dispara useNotifications al montar
   * NotificationBell/NotificationCenter, y también useAutoAlerts antes de
   * su primer chequeo, para no duplicar alertas que ya estaban guardadas.
   */
  async init(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const stored = await container.notificationRepo.findAll();
        const sorted = [...stored].sort((a, b) => b.date.getTime() - a.date.getTime());
        this.notifications = this.dedupeByKey(sorted).slice(0, MAX_NOTIFICATIONS);
        this.sync();
      } catch (err) {
        logError("[notificationStore] No se pudo cargar notificaciones de Supabase", { category: "sync", context: { error: String(err) } });
      } finally {
        this.loaded = true;
      }
    })();

    return this.loading;
  }

  /**
   * Vuelve a leer desde Supabase, sin importar si ya se había cargado
   * antes. A diferencia de init() (que es "una sola vez"), esta se llama
   * cada vez que llega un evento "notification" del bus — por ejemplo,
   * porque otro dispositivo marcó una notificación como leída o generó
   * una alerta nueva.
   */
  async refresh(): Promise<void> {
    try {
      const stored = await container.notificationRepo.findAll();
      const sorted = [...stored].sort((a, b) => b.date.getTime() - a.date.getTime());
      this.notifications = this.dedupeByKey(sorted).slice(0, MAX_NOTIFICATIONS);
      this.sync();
    } catch (err) {
      logError("[notificationStore] No se pudo refrescar notificaciones desde Supabase", { category: "sync", context: { error: String(err) } });
    }
  }

  /**
   * Agrega una notificación. Si ya existe una activa con la misma `key`
   * (por defecto, título+mensaje), no la duplica — así una alerta que
   * sigue vigente (ej. stock bajo que no se ha repuesto) no spamea la
   * campana en cada recálculo del negocio.
   */
  add(
    title: string,
    message: string,
    type: Notification["type"] = "info",
    key?: string,
    category: NotificationCategory = "GENERAL"
  ) {
    const dedupeKey = key ?? `${title}:${message}`;
    if (this.notifications.some((n) => n.key === dedupeKey)) return;

    const notification: Notification = {
      id: crypto.randomUUID(),
      key: dedupeKey,
      title,
      message,
      type,
      category,
      read: false,
      date: new Date()
    };

    this.notifications = [notification, ...this.notifications].slice(0, MAX_NOTIFICATIONS);
    this.sync();
    this.persist(notification);
  }

  /** 🔴 Stock bajo o agotado de un producto. */
  addStockAlert(message: string, key?: string) {
    this.add("Stock bajo", message, "warning", key ?? `STOCK_BAJO:${message}`, "STOCK_BAJO");
  }

  /** 🔴 Un pedido en cocina/barra lleva demasiado tiempo sin salir. */
  addOrderDelay(message: string, key?: string) {
    this.add("Pedido retrasado", message, "error", key ?? `PEDIDO_RETRASADO:${message}`, "PEDIDO_RETRASADO");
  }

  /** 🟢 Un turno de caja fue abierto. */
  addCashOpen(message: string, key?: string) {
    this.add("Caja abierta", message, "success", key, "CAJA_ABIERTA");
  }

  /** 🟢 Meta de ventas del día/turno alcanzada. */
  addGoalReached(message: string, key?: string) {
    this.add("Meta cumplida", message, "success", key ?? `META_CUMPLIDA:${message}`, "META_CUMPLIDA");
  }

  /** 🟣 Recomendación de compra generada por la IA de inventario. */
  addPurchaseRecommendation(message: string, key?: string) {
    this.add("IA recomienda comprar", message, "info", key, "IA_COMPRA");
  }

  /** 🔔 Recordatorio manual creado por el usuario. */
  addReminder(message: string, key?: string) {
    this.add("Recordatorio", message, "info", key ?? `RECORDATORIO:${message}:${Date.now()}`, "RECORDATORIO");
  }

  getAll(): Notification[] {
    return this.snapshot;
  }

  getByCategory(category: NotificationCategory): Notification[] {
    return this.snapshot.filter((n) => n.category === category);
  }

  getUnread(): Notification[] {
    return this.snapshot.filter((n) => !n.read);
  }

  unreadCount(): number {
    return this.getUnread().length;
  }

  markAsRead(id: string) {
    const target = this.notifications.find((n) => n.id === id);
    if (!target || target.read) return;

    const updated: Notification = { ...target, read: true };
    this.notifications = this.notifications.map((n) => (n.id === id ? updated : n));
    this.sync();
    this.persist(updated);
  }

  markAllAsRead() {
    const unread = this.notifications.filter((n) => !n.read);
    if (unread.length === 0) return;

    this.notifications = this.notifications.map((n) => (n.read ? n : { ...n, read: true }));
    this.sync();
    unread.forEach((n) => this.persist({ ...n, read: true }));
  }

  remove(id: string) {
    this.notifications = this.notifications.filter((n) => n.id !== id);
    this.sync();
    container.notificationRepo.delete(id).catch((err) => {
      logError("[notificationStore] No se pudo borrar la notificación en Supabase", { category: "sync", context: { error: String(err) } });
    });
  }

  clear() {
    const ids = this.notifications.map((n) => n.id);
    this.notifications = [];
    this.sync();
    if (ids.length === 0) return;
    container.notificationRepo.deleteMany(ids).catch((err) => {
      logError("[notificationStore] No se pudo vaciar las notificaciones en Supabase", { category: "sync", context: { error: String(err) } });
    });
  }
}

export const notificationStore = new NotificationStore();