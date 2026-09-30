import React from "react";

/**
 * Fase 3 (5.2 — colores fuera de paleta): este archivo usaba slate-800/
 * slate-900 (Tailwind genérico) en vez de los tokens vimdy-* — como es EL
 * componente compartido de loading, ese hueco se repetía en cada pantalla
 * que lo usara. vimdy-surface (#18181B) y vimdy-border (#27272F) son el
 * fondo/borde de tarjeta oficiales, ya usados en el resto del sistema.
 */

/** Bloque base: usar directamente para formas custom (avatar, badge, línea suelta). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-vimdy-surface-hover ${className}`} />;
}

/**
 * SkeletonRows
 * Filas de tabla (Clientes, Inventario, Reportes). Reserva el mismo alto que
 * una fila real para que el layout no salte cuando llegan los datos.
 */
export function SkeletonRows({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={`h-4 ${c === 0 ? "w-1/4" : "flex-1"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Tarjetas en grilla (KPIs, productos, mesas). */
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-5 space-y-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-7 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** Bloque de gráfico o panel grande (charts de Reportes/Dashboard). */
export function SkeletonPanel({ height = "h-60" }: { height?: string }) {
  return (
    <div className={`rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-5 ${height}`}>
      <Skeleton className="h-full w-full" />
    </div>
  );
}