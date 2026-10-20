/**
 * Feedback sonoro y háptico sutil para el control por voz de Mesas.
 * Usa Web Audio (sin archivos de audio que puedan fallar en producción).
 * Todo va protegido: si el navegador no soporta audio o lo bloquea, simplemente
 * no suena y la app sigue funcionando igual.
 */

let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  try {
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioContext) audioContext = new Ctor();
    if (audioContext.state === "suspended") void audioContext.resume();
    return audioContext;
  } catch {
    return null;
  }
}

function tone(frequency: number, startOffset: number, duration: number, volume = 0.06): void {
  const ctx = getContext();
  if (!ctx) return;
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + startOffset;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  } catch {
    /* sin audio: no pasa nada */
  }
}

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* no soportado */
  }
}

/** Debe llamarse dentro de un toque del usuario para que el navegador permita sonar. */
export function primeVoiceAudio(): void {
  getContext();
}

/** "Ding" ascendente: el comando se entendió. */
export function playVoiceSuccess(): void {
  tone(660, 0, 0.12);
  tone(880, 0.1, 0.16);
  vibrate(40);
}

/** Tono grave doble: no se entendió o falló. */
export function playVoiceError(): void {
  tone(260, 0, 0.14);
  tone(200, 0.15, 0.2);
  vibrate([60, 40, 60]);
}

/** Tick muy suave al empezar a escuchar. */
export function playVoiceStart(): void {
  tone(520, 0, 0.08, 0.04);
}