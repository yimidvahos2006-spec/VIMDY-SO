import React, { useEffect, useRef, useState } from "react";

import { obsidianRenderer } from "./obsidianRenderer";

interface AiAvatarProps {
  /** Diámetro en px (por defecto 40). */
  size?: number;
  className?: string;
}

const BASE_SIZE = 40;
const MAX_DPR = 2;

/** Esfera estática (sin WebGL): mismo lenguaje visual, solo sin movimiento. */
const FALLBACK_BACKGROUND = [
  "radial-gradient(ellipse 30% 18% at 33% 27%, rgba(255,255,255,0.70) 0%, rgba(255,255,255,0) 100%)",
  "radial-gradient(circle at 36% 32%, #25272e 0%, #0c0c10 42%, #000000 78%)"
].join(", ");

/**
 * AiAvatar
 * ---------------------------------------------------------------------------
 * Avatar de VIMDY IA: una esfera de obsidiana líquida. Negro profundo y
 * carbón, con reflejos especulares que fluyen y ondas de luz sutiles que se
 * mueven de forma constante (shader en obsidianRenderer.ts).
 *
 * Se usa en la cabecera, en la pantalla principal y en cada burbuja del chat;
 * todos comparten un único contexto WebGL. Si WebGL no está disponible se
 * muestra una esfera oscura estática.
 */
export const AiAvatar: React.FC<AiAvatarProps> = ({ size = BASE_SIZE, className = "" }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const redrawRef = useRef<(() => void) | null>(null);
  const [useFallback, setUseFallback] = useState(false);

  const dpr = typeof window === "undefined" ? 1 : Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const pixels = Math.max(16, Math.round(size * dpr));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handle = obsidianRenderer.register(canvas);
    if (!handle) {
      setUseFallback(true);
      return;
    }
    redrawRef.current = handle.redraw;

    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        const latest = entries[entries.length - 1];
        if (latest) handle.setVisible(latest.isIntersecting);
      });
      observer.observe(canvas);
    }

    return () => {
      observer?.disconnect();
      redrawRef.current = null;
      handle.dispose();
    };
  }, []);

  // Si cambia el tamaño, el canvas se limpia: se pide un nuevo cuadro (útil con movimiento reducido).
  useEffect(() => {
    redrawRef.current?.();
  }, [pixels]);

  return (
    <div
      className={`relative shrink-0 select-none overflow-hidden rounded-full bg-black ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {useFallback ? (
        <div className="h-full w-full rounded-full" style={{ background: FALLBACK_BACKGROUND }} />
      ) : (
        <canvas ref={canvasRef} width={pixels} height={pixels} className="block h-full w-full" />
      )}
    </div>
  );
};

export default AiAvatar;