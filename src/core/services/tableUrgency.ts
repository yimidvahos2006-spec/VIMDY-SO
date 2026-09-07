import { Table } from "../entities/Entities";

export type UrgencyLevel = "free" | "low" | "medium" | "high";

export interface TableUrgency {
  level: UrgencyLevel;
  action: string;
  progress: number;
}

const AVG_DURATION_FALLBACK_MS = 45 * 60 * 1000; // 45 minutos, fallback cuando no hay historial suficiente
export { AVG_DURATION_FALLBACK_MS };

export function getTableUrgency(table: Table, avgDurationMs: number): TableUrgency {
  if (table.status === "FREE" || !table.openedAt) {
    return { level: "free", action: "Sin acción", progress: 0 };
  }

  const now = Date.now();
  const elapsed = now - table.openedAt.getTime();
  const progress = Math.min((elapsed / avgDurationMs) * 100, 100);

  const isBillRequested =
    table.status === "CUENTA_SOLICITADA" || table.status === "WAITING_BILL";

  if (isBillRequested && elapsed > 5 * 60 * 1000) {
    return { level: "high", action: "Pasar cuenta ya", progress: Math.max(progress, 100) };
  }

  if (progress < 60) {
    return { level: "low", action: "Todo tranquilo", progress };
  }

  if (progress < 85) {
    const waitingFood = table.status === "WAITING_FOOD";
    return {
      level: "medium",
      action: waitingFood ? "Verificar con cocina" : "Ir preguntando",
      progress
    };
  }

  return { level: "high", action: "Pasar cuenta ya", progress };
}

export function getUrgencyBorder(level: UrgencyLevel): string {
  switch (level) {
    case "free":
      return "border-slate-800";
    case "low":
      return "border-emerald-500";
    case "medium":
      return "border-amber-500";
    case "high":
      return "border-red-500";
  }
}

export function getUrgencyBg(level: UrgencyLevel): string {
  switch (level) {
    case "free":
      return "bg-slate-800/40";
    case "low":
      return "bg-emerald-500/5";
    case "medium":
      return "bg-amber-500/5";
    case "high":
      return "bg-red-500/5";
  }
}

export function getUrgencyProgress(level: UrgencyLevel): string {
  switch (level) {
    case "free":
      return "bg-slate-600";
    case "low":
      return "bg-emerald-500";
    case "medium":
      return "bg-amber-500";
    case "high":
      return "bg-red-500";
  }
}

export function getUrgencyDot(level: UrgencyLevel): string {
  switch (level) {
    case "free":
      return "bg-slate-600";
    case "low":
      return "bg-emerald-500";
    case "medium":
      return "bg-amber-500";
    case "high":
      return "bg-red-500";
  }
}
