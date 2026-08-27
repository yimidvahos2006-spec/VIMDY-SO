import { useEffect, useSyncExternalStore } from "react";
import { notificationStore, type Notification, type NotificationCategory } from "./notificationStore";
import { vimdyCore } from "../VimdyCore";

/** Orden fijo de categorías tal como se muestran en NotificationCenter. */
export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  "STOCK_BAJO",
  "PEDIDO_RETRASADO",
  "CAJA_ABIERTA",
  "META_CUMPLIDA",
  "IA_COMPRA",
  "RECORDATORIO",
  "SUSCRIPCION",
  "GENERAL"
];

/**
 * useNotifications
 * ---------------------------------------------------------------------------
 * Se suscribe a notificationStore (PASO 4 — Alertas automáticas) y expone
 * las acciones de la campana: marcar como leída, marcar todas, descartar.
 *
 * PASO 5 — Centro de notificaciones: además agrupa por `category` para que
 * NotificationCenter pueda mostrar secciones (stock bajo, pedido retrasado,
 * caja abierta, meta cumplida, IA recomienda comprar, recordatorios) con
 * su propio contador de no leídas.
 */
export function useNotifications() {
  const notifications = useSyncExternalStore(notificationStore.subscribe, notificationStore.getSnapshot);

  useEffect(() => {
    notificationStore.init();
  }, []);

  useEffect(() => {
    const unsubscribe = vimdyCore.on("notification", () => {
      notificationStore.refresh();
    });
    return unsubscribe;
  }, []);

  const unread = notifications.filter((n) => !n.read);

  const byCategory: Record<NotificationCategory, Notification[]> = {
    STOCK_BAJO: [],
    PEDIDO_RETRASADO: [],
    CAJA_ABIERTA: [],
    META_CUMPLIDA: [],
    IA_COMPRA: [],
    RECORDATORIO: [],
    SUSCRIPCION: [],
    GENERAL: []
  };
  for (const n of notifications) {
    byCategory[n.category].push(n);
  }

  const unreadByCategory: Record<NotificationCategory, number> = {
    STOCK_BAJO: 0,
    PEDIDO_RETRASADO: 0,
    CAJA_ABIERTA: 0,
    META_CUMPLIDA: 0,
    IA_COMPRA: 0,
    RECORDATORIO: 0,
    SUSCRIPCION: 0,
    GENERAL: 0
  };
  for (const n of unread) {
    unreadByCategory[n.category] += 1;
  }

  return {
    notifications,
    unread,
    unreadCount: unread.length,
    byCategory,
    unreadByCategory,
    markAsRead: (id: string) => notificationStore.markAsRead(id),
    markAllAsRead: () => notificationStore.markAllAsRead(),
    remove: (id: string) => notificationStore.remove(id),
    clear: () => notificationStore.clear(),
    addReminder: (message: string) => notificationStore.addReminder(message)
  };
}