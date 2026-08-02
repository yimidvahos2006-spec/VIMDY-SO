import React from "react";

/**
 * VIMDY DESIGN SYSTEM v1.0 — VimdyButton
 * -------------------------------------------------------------
 * Única versión oficial de botón. Todos los módulos deben usar
 * este componente — nunca un <button> suelto con clases propias.
 *
 * 4 variantes: primary, secondary, ghost, danger (ver
 * docs/02_DESIGN_SYSTEM/09_BUTTON_SYSTEM.md — fuente de verdad).
 * 3 tamaños: sm, md (default), lg.
 * Sin glow, sin barrido de luz, sin scale en hover — el sistema
 * pide animaciones funcionales únicamente (fade / hover / focus),
 * 150–250ms. La sensación es "software", no "app llamativa".
 *
 * Regla suprema del spec: solo puede existir un botón Primary
 * visible por pantalla. Si dos VimdyButton variant="primary"
 * conviven en la misma vista, el diseño está mal — revisar antes
 * de mezclar variantes al armar una pantalla nueva.
 *
 * Controles solo-ícono (stepper +/-, quitar producto, quitar
 * descuento/propina) son una categoría aparte, NO una variante de
 * este componente — ver la sección "Controles icon-only" al final
 * de 09_BUTTON_SYSTEM.md. Nunca uses VimdyButton sin `children`
 * para ese caso.
 * -------------------------------------------------------------
 */

type VimdyButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type VimdyButtonSize = "sm" | "md" | "lg" | "xl";

interface VimdyButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  variant?: VimdyButtonVariant;
  size?: VimdyButtonSize;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

const VARIANT_CLASS: Record<VimdyButtonVariant, string> = {
  // Spec: fondo #FFFFFF, texto #09090B, peso 600, sin borde, sin
  // gradiente, sin sombra. Hover = opacity 90%, active = scale 0.98.
  // vimdy-background (#0A0A0C) es el token ya aprobado más cercano a
  // #09090B — no se introduce un hex nuevo fuera de tailwind.config.js.
  primary: `
    text-vimdy-background
    bg-white
    border border-transparent
    hover:opacity-90
    active:scale-[0.98]
  `,
  secondary: `
    text-vimdy-text
    bg-vimdy-surface
    border border-vimdy-border
    hover:bg-vimdy-surface-hover
    hover:border-vimdy-border
    active:bg-vimdy-surface-active
  `,
  ghost: `
    text-vimdy-text-secondary
    bg-transparent
    border border-transparent
    hover:bg-vimdy-surface-hover
    hover:text-vimdy-text
  `,
  // Spec: texto #EF4444, fondo transparente, hover rgba(239,68,68,.10).
  // "Nunca será rojo sólido. Debe advertir sin generar ansiedad."
  // Usamos el token vimdy-danger-bg (ya definido para el resto del
  // sistema de estado) como la aproximación sólida más cercana a esa
  // rgba, en vez de inventar una opacidad nueva fuera del token file.
  danger: `
    text-vimdy-danger
    bg-transparent
    border border-transparent
    hover:bg-vimdy-danger-bg
  `
};

const SIZE_CLASS: Record<VimdyButtonSize, string> = {
  sm: "text-vimdy-small px-vimdy-md py-vimdy-xs gap-1.5",
  md: "text-vimdy-body px-vimdy-lg py-vimdy-sm gap-2",
  lg: "text-vimdy-h3 px-vimdy-xl py-vimdy-md gap-2",
  // Fase 3 (Cocina): único caso legítimo hasta ahora es "Modo TV" — la
  // pantalla de cocina se lee desde el otro lado de la cocina, no de
  // cerca, así que necesita texto/controles más grandes que cualquier
  // botón normal de la app. No es una excepción por fuera del sistema:
  // es un tamaño más, documentado, para una necesidad real de distancia
  // de lectura (ver docs/02_DESIGN_SYSTEM/09_BUTTON_SYSTEM.md).
  xl: "text-2xl px-vimdy-xxl py-5 gap-3"
};

const GAP_CLASS: Record<VimdyButtonSize, string> = {
  sm: "gap-1.5",
  md: "gap-2",
  lg: "gap-2",
  xl: "gap-3"
};

export function VimdyButton({
  children,
  onClick,
  type = "button",
  disabled = false,
  loading = false,
  className = "",
  variant = "primary",
  size = "md",
  icon,
  fullWidth = false
}: VimdyButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading}
      className={`
        relative
        inline-flex
        items-center
        justify-center
        rounded-vimdy-sm
        font-semibold
        whitespace-nowrap
        transition-colors
        duration-vimdy-fast
        ease-out
        disabled:opacity-50
        disabled:cursor-not-allowed
        ${fullWidth ? "w-full" : ""}
        ${VARIANT_CLASS[variant]}
        ${SIZE_CLASS[size]}
        ${className}
      `}
    >
      {/*
        El botón nunca cambia de ancho al entrar en loading: el
        contenido real sigue ocupando su espacio (invisible, no
        "hidden"), y el spinner se centra encima con position absolute.
      */}
      <span
        className={`inline-flex items-center ${GAP_CLASS[size]} ${
          loading ? "invisible" : ""
        }`}
      >
        {icon}
        {children}
      </span>

      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span
            className="
              h-4 w-4
              rounded-full
              border-2
              border-current
              border-t-transparent
              animate-vimdy-spin
            "
          />
        </span>
      )}
    </button>
  );
}