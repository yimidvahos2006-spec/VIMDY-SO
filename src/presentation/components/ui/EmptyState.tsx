import React from "react";

interface EmptyStateAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly icon?: React.ReactNode;
}

interface EmptyStateProps {
  /** Ícono grande (lucide-react o un emoji simple). */
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  className?: string;
}

/**
 * EmptyState
 * ---------------------------------------------------------------------------
 * Un solo componente para todos los "no hay nada que mostrar todavía" de la
 * app — inventario sin productos, clientes sin registrar, reportes sin
 * ventas, mesas sin configurar. Antes cada pantalla tenía su propio texto
 * suelto ("Aún no hay clientes registrados.", "Sin datos.") o, como mucho,
 * su propia versión copiada a mano (InventoryDashboard.EmptyProductsState).
 * Ahora es un único componente reutilizable en toda la app.
 */
export function EmptyState({ icon, title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-slate-700 bg-slate-800/50 py-16 px-6 flex flex-col items-center text-center ${className}`}
    >
      <div className="w-16 h-16 rounded-2xl bg-vimdy-surface border border-slate-700 flex items-center justify-center mb-4 text-slate-500">
        {icon}
      </div>
      <h2 className="text-white text-lg font-bold mb-1">{title}</h2>
      {description && <p className="text-slate-400 text-sm mb-6 max-w-sm">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="h-11 px-6 rounded-xl bg-cyan-500 text-slate-950 font-bold hover:bg-cyan-400 flex items-center gap-2"
        >
          {action.icon}
          {action.label}
        </button>
      )}
    </div>
  );
}