import { CalendarClock, CircleCheck, Link2, Receipt, TriangleAlert, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { AlertReason, FloorState } from "../../../core/services/floorPlan";

/**
 * Estilos del plano por estado. Clases ESTÁTICAS (Tailwind no compila
 * clases armadas con template strings) y solo tokens del design system
 * `vimdy-*` (verde = success, rojo = danger, ámbar = warning).
 */
export interface FloorStateStyle {
  /** Nombre corto para filtros y leyenda. */
  name: string;
  icon: LucideIcon;
  /** Borde + fondo de la tarjeta de mesa. */
  card: string;
  /** Color del texto de acento (icono, tiempo). */
  accent: string;
  /** Punto de color de la leyenda. */
  dot: string;
  /** Tarjeta-filtro del resumen. */
  stat: string;
  statActive: string;
}

export const FLOOR_STYLES: Record<FloorState, FloorStateStyle> = {
  free: {
    name: "Libres",
    icon: CircleCheck,
    card: "border-vimdy-success/70 bg-vimdy-success/[0.13] hover:bg-vimdy-success/[0.22] shadow-[0_0_0_1px_rgba(34,197,94,0.08)]",
    accent: "text-vimdy-success",
    dot: "bg-vimdy-success",
    stat: "border-vimdy-success/30 bg-vimdy-success/[0.06] hover:bg-vimdy-success/10",
    statActive: "border-vimdy-success bg-vimdy-success/15"
  },
  occupied: {
    name: "Ocupadas",
    icon: Users,
    card: "border-vimdy-danger/70 bg-vimdy-danger/[0.16] hover:bg-vimdy-danger/[0.26] shadow-[0_0_0_1px_rgba(239,68,68,0.08)]",
    accent: "text-vimdy-danger-hover",
    dot: "bg-vimdy-danger",
    stat: "border-vimdy-danger/30 bg-vimdy-danger/[0.06] hover:bg-vimdy-danger/10",
    statActive: "border-vimdy-danger bg-vimdy-danger/15"
  },
  alert: {
    name: "Pidiendo cuenta / alerta",
    icon: Receipt,
    card: "border-vimdy-warning/80 bg-vimdy-warning/[0.17] hover:bg-vimdy-warning/[0.27] shadow-[0_0_0_1px_rgba(245,158,11,0.1)]",
    accent: "text-vimdy-warning-hover",
    dot: "bg-vimdy-warning",
    stat: "border-vimdy-warning/30 bg-vimdy-warning/[0.06] hover:bg-vimdy-warning/10",
    statActive: "border-vimdy-warning bg-vimdy-warning/15"
  },
  reserved: {
    name: "Reservadas",
    icon: CalendarClock,
    card: "border-indigo-400/50 bg-indigo-500/[0.08] hover:bg-indigo-500/15",
    accent: "text-indigo-300",
    dot: "bg-indigo-400",
    stat: "border-indigo-400/30 bg-indigo-500/[0.06] hover:bg-indigo-500/10",
    statActive: "border-indigo-400 bg-indigo-500/15"
  },
  merged: {
    name: "Unidas",
    icon: Link2,
    card: "border-dashed border-vimdy-border bg-vimdy-surface hover:bg-vimdy-surface-hover",
    accent: "text-vimdy-text-secondary",
    dot: "bg-vimdy-text-tertiary",
    stat: "border-vimdy-border bg-vimdy-surface",
    statActive: "border-vimdy-text-secondary bg-vimdy-surface-active"
  }
};

/** El ícono cambia según el motivo de la alerta (no depender solo del color). */
export const ALERT_ICONS: Record<AlertReason, LucideIcon> = {
  bill: Receipt,
  paying: Receipt,
  overstay: TriangleAlert
};