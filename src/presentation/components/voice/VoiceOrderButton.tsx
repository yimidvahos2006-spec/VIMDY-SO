import { Loader2, Mic } from "lucide-react";

import type { VoiceCatalogProduct } from "../../../core/voice/orderParser";
import type { VoiceOrderSession } from "../../../core/voice/useVoiceOrderSession";

interface Props<P extends VoiceCatalogProduct> {
  session: VoiceOrderSession<P>;
  label?: string;
  /** Alto del botón: "md" (h-11, barra de Caja) o "lg" (h-12, junto a un buscador grande). */
  size?: "md" | "lg";
  /** En pantallas angostas deja solo el micrófono. */
  hideLabelOnMobile?: boolean;
  className?: string;
}

/** Cuánto sube cada barra del medidor con la voz (cada una distinta para que se vea natural). */
const BAR_GAIN = [0.7, 1, 0.8, 0.9] as const;

/**
 * Botón "VIMDY Voice". Es el MISMO en Mesas y en Caja: toque → habla →
 * se ve el nivel real del micrófono → el pedido se agrega solo. Si el
 * navegador no tiene voz, abre el panel para escribir el pedido.
 */
export function VoiceOrderButton<P extends VoiceCatalogProduct>({
  session,
  label = "VIMDY Voice",
  size = "md",
  hideLabelOnMobile = false,
  className = ""
}: Props<P>) {
  const listening = session.phase === "listening";
  const busy = session.phase === "starting" || session.working;
  const active = listening || busy;

  return (
    <button
      type="button"
      onClick={session.supported ? session.startListening : session.openTyping}
      aria-label={listening ? "Detener micrófono" : "VIMDY Voice: tomar pedido por voz"}
      aria-pressed={listening}
      className={`
        flex items-center gap-2 ${size === "lg" ? "h-12" : "h-11"} px-4 rounded-vimdy-md border transition-all duration-vimdy-normal flex-shrink-0 select-none active:scale-95
        ${
          active
            ? "bg-vimdy-accent/10 border-vimdy-accent"
            : "bg-vimdy-surface-active border-vimdy-border hover:border-vimdy-accent animate-voice-idle-glow"
        }
        ${className}
      `}
    >
      {busy && !listening ? (
        <Loader2 size={18} className="text-vimdy-accent flex-shrink-0 animate-vimdy-spin" />
      ) : (
        <Mic size={18} className="text-vimdy-accent flex-shrink-0" />
      )}

      <span
        className={`text-vimdy-text text-vimdy-small font-semibold whitespace-nowrap ${
          hideLabelOnMobile ? "hidden sm:inline" : ""
        }`}
      >
        {label}
      </span>

      {listening && <LevelBars level={session.level} className="ml-1" />}
    </button>
  );
}

/** Medidor de 4 barras que sigue el nivel real del micrófono. */
export function LevelBars({ level, className = "" }: { level: number; className?: string }) {
  return (
    <span className={`flex items-end gap-[3px] h-3 ${className}`} aria-hidden="true">
      {BAR_GAIN.map((gain, i) => (
        <span
          key={i}
          className="w-[2.5px] h-full bg-vimdy-accent/80 rounded-full origin-bottom transition-transform duration-75"
          style={{ transform: `scaleY(${Math.min(1, 0.22 + level * gain).toFixed(2)})` }}
        />
      ))}
    </span>
  );
}