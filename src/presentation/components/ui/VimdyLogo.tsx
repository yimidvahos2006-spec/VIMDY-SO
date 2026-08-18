import React from "react";

interface Props {
  size?: number;
}

/**
 * VimdyLogo — isotipo oficial de VIMDY OS.
 * Solo el ícono (nunca renderiza texto): en cada pantalla donde
 * aparece, el nombre "VIMDY" / "VIMDY OS" se agrega aparte, junto
 * a este componente (ver Header, Sidebar, LoginPage, etc.).
 *
 * Marca: cuadrado redondeado en superficie oscura con un
 * chevron ("V") trazado en degradé de marca (vimdy-blue -> accent).
 * Único lugar del sistema donde se permite un degradé — el resto de
 * la UI usa color plano, según el spec del design system.
 */
export function VimdyLogo({ size = 80 }: Props) {
  const gradientId = React.useId();

  return (
    <div
      className="relative shrink-0 select-none"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <linearGradient id={`${gradientId}-bg`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#141417" />
            <stop offset="100%" stopColor="#0A0A0C" />
          </linearGradient>
          <linearGradient id={`${gradientId}-stroke`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#2563EB" />
          </linearGradient>
        </defs>

        <rect
          x="1.5"
          y="1.5"
          width="97"
          height="97"
          rx="24"
          fill={`url(#${gradientId}-bg)`}
          stroke="#27272F"
          strokeWidth="1.5"
        />

        <path
          d="M30 30 L50 66 L70 30"
          fill="none"
          stroke={`url(#${gradientId}-stroke)`}
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}