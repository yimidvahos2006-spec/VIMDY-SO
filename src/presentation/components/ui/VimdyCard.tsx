import React from "react";

interface VimdyCardProps {
  children: React.ReactNode;
  className?: string;
  /**
   * "static" — tarjeta de contenido/formulario, sin efecto hover (default).
   * "interactive" — tarjeta seleccionable/clicable: el borde pasa a
   * vimdy-accent en hover. Nunca hay translate/scale/glow: el sistema
   * prohíbe efectos decorativos, solo cambios de color/sombra (150-250ms).
   */
  variant?: "static" | "interactive";
  /** Padding interno usando la escala de espaciado oficial. */
  padding?: "none" | "sm" | "md" | "lg";
  onClick?: () => void;
}

const PADDING_MAP: Record<NonNullable<VimdyCardProps["padding"]>, string> = {
  none: "",
  sm: "p-vimdy-md",
  md: "p-vimdy-lg",
  lg: "p-vimdy-xl"
};

/**
 * VimdyCard — tarjeta base oficial del design system (reemplaza GlassCard).
 * Plana, sin blur/gradiente/glow. Todas las tarjetas de la app deben
 * compartir este mismo radio, borde, sombra y padding.
 */
export function VimdyCard({
  children,
  className = "",
  variant = "static",
  padding = "md",
  onClick
}: VimdyCardProps) {
  const interactive = variant === "interactive";

  return (
    <div
      onClick={onClick}
      className={`
        rounded-vimdy-lg
        border
        border-vimdy-border
        bg-vimdy-surface
        shadow-vimdy-sm
        transition-colors
        duration-vimdy-fast
        ${PADDING_MAP[padding]}
        ${interactive ? "cursor-pointer hover:border-vimdy-accent hover:bg-vimdy-surface-hover" : ""}
        ${onClick ? "cursor-pointer" : ""}
        ${className}
      `}
    >
      {children}
    </div>
  );
}