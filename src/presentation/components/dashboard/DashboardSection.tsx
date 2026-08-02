import React from "react";
import { LucideIcon } from "lucide-react";

type DashboardSectionAccent = "indicators" | "actions" | "activity";

interface Props {
  title: string;
  icon: LucideIcon;
  accent?: DashboardSectionAccent;
  children: React.ReactNode;
}

/**
 * Fase 3 (5.2 — colores fuera de paleta): antes cada pantalla pasaba un
 * hex suelto por `color` (#22c55e / #facc15 / #f472b6 en Dashboard.tsx),
 * aplicado con `style={{ background: `${color}20` }}` + el prop `color`
 * de lucide-react — ninguno de esos tres colores venía de
 * tailwind.config.js. Ahora el llamador solo dice QUÉ bloque es y el
 * mapeo a clases vimdy.* vive acá una sola vez.
 */
const ACCENT_CLASS: Record<DashboardSectionAccent, { badge: string; icon: string }> = {
  // Indicadores principales: ya existía el token exacto (vimdy-success
  // = #22C55E, mismo valor que se usaba suelto antes).
  indicators: { badge: "bg-vimdy-success/20", icon: "text-vimdy-success" },
  // Acciones rápidas: el amarillo más cercano ya documentado es
  // vimdy-warning-hover (#FBBF24) — se reutiliza solo por el tono, esto
  // no es un estado de advertencia.
  actions: { badge: "bg-vimdy-warning-hover/20", icon: "text-vimdy-warning-hover" },
  // Actividad reciente: no había tono rosa en la paleta, se agregó
  // vimdy-pink en tailwind.config.js (ver comentario ahí).
  activity: { badge: "bg-vimdy-pink/20", icon: "text-vimdy-pink" }
};

/**
 * DashboardSection — envoltorio de tarjeta fijo para un bloque del
 * Dashboard (Paso 1.1: la estructura son 5 bloques fijos, no widgets
 * reordenables/ocultables). Mismos tokens visuales que el resto de
 * VIMDY OS (borde, sombra y radio de GlassCard).
 */
export function DashboardSection({ title, icon: Icon, accent = "indicators", children }: Props) {
  const { badge, icon } = ACCENT_CLASS[accent];

  return (
    <div className="col-span-12 rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface shadow-vimdy-md overflow-hidden">
      <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-vimdy-border">
        <div className={`w-10 h-10 rounded-vimdy-md flex items-center justify-center shrink-0 ${badge}`}>
          <Icon size={18} className={icon} />
        </div>
        <h3 className="text-vimdy-body font-bold text-vimdy-text">{title}</h3>
      </div>

      <div className="p-6">{children}</div>
    </div>
  );
}