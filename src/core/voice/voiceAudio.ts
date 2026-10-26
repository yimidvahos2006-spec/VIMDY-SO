/**
 * Captura de audio para VIMDY Voice (Mesas y Caja).
 *
 * Abre el micrófono con `getUserMedia` pidiéndole al navegador cancelación de
 * eco, supresión de ruido y control automático de ganancia, y además pasa la
 * señal por una cadena propia de Web Audio:
 *
 *   mic → pasa-altos 80 Hz → pasa-bajos 7,6 kHz → [medidor]
 *                                      └→ ganancia dinámica → compresor → pista procesada
 *
 *  - Pasa-altos / pasa-bajos: recortan el retumbe de graves (bocinas, aire
 *    acondicionado) y el siseo agudo, sin tocar la voz (fundamental ≥ ~85 Hz
 *    en voces muy graves; formantes hasta ~5 kHz en voces agudas).
 *  - Ganancia dinámica: sube lo que se dice "pasito" y baja lo que se grita,
 *    para que el reconocedor reciba siempre un nivel parecido. Solo reacciona
 *    cuando hay VOZ (por encima del piso de ruido que se aprende solo); en
 *    silencio vuelve a una ganancia de reposo moderada, así no se infla el
 *    ruido del local.
 *  - Compresor: red de seguridad contra picos (un grito o un golpe de vaso).
 *
 * Toda la lógica de decisión (piso de ruido, ganancia deseada) son funciones
 * PURAS exportadas para poder probarlas sin navegador.
 */

/* ------------------------------ restricciones ------------------------------ */

export const VOICE_AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1
  },
  video: false
};

/* ------------------------- decisión de ganancia (pura) ---------------------- */

export const GAIN_CONFIG = {
  /** Nivel RMS al que queremos llevar la voz (≈ -18 dBFS). */
  targetRms: 0.12,
  minGain: 0.4,
  /** Un susurro puede ser ~25 veces más suave que una voz normal. */
  maxGain: 12,
  /** Ganancia cuando no hay voz: cubre el arranque de un susurro sin inflar el ruido. */
  restGain: 2,
  /** Cuántas veces por encima del piso de ruido debe estar la señal para ser voz. */
  speechMargin: 2.5,
  /** Por debajo de esto nunca es voz, aunque el piso sea casi cero. */
  absoluteSpeechFloor: 0.006,
  noiseFloorMin: 0.001,
  noiseFloorMax: 0.05,
  /** Constantes de tiempo (s): bajar rápido para gritos, subir con calma. */
  attackTime: 0.03,
  releaseTime: 0.2
} as const;

/**
 * Piso de ruido adaptativo: baja rápido cuando el ambiente se calma y sube
 * muy despacio, para que una frase larga no lo contamine y se tome como ruido.
 */
export function updateNoiseFloor(floor: number, rms: number): number {
  const { noiseFloorMin, noiseFloorMax } = GAIN_CONFIG;
  const next = rms < floor ? floor * 0.8 + rms * 0.2 : Math.min(rms, floor * 1.003 + 0.00001);
  return Math.min(noiseFloorMax, Math.max(noiseFloorMin, next));
}

/** ¿El nivel actual es voz (y no el ruido de fondo)? */
export function isSpeechLevel(rms: number, noiseFloor: number): boolean {
  return rms > Math.max(noiseFloor * GAIN_CONFIG.speechMargin, GAIN_CONFIG.absoluteSpeechFloor);
}

/** Ganancia a la que conviene llevar la señal dado el nivel de entrada (antes de ganancia). */
export function computeDesiredGain(rms: number, noiseFloor: number): number {
  const { targetRms, minGain, maxGain, restGain } = GAIN_CONFIG;
  if (!isSpeechLevel(rms, noiseFloor)) return restGain;
  return Math.min(maxGain, Math.max(minGain, targetRms / rms));
}

/** Bajar la ganancia (voz fuerte) debe ser rápido; subirla (susurro), más suave. */
export function gainTimeConstant(desired: number, current: number): number {
  return desired < current ? GAIN_CONFIG.attackTime : GAIN_CONFIG.releaseTime;
}

/** RMS de un bloque de muestras en [-1, 1]. */
export function rmsOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Nivel 0–1 para el medidor visual (raíz cuadrada: se parece más a cómo oímos). */
export function meterLevel(rms: number): number {
  return Math.min(1, Math.sqrt(rms) * 2.2);
}

/* --------------------------------- captura --------------------------------- */

export type CaptureFailure = "unsupported" | "insecure" | "not-allowed" | "audio-capture" | "unknown";

export interface VoiceCapture {
  /**
   * Pista lista para el reconocedor. Es la procesada (ganancia dinámica) si la
   * cadena Web Audio arrancó; si no, la pista cruda de getUserMedia.
   */
  track: MediaStreamTrack | null;
  /** true si `track` pasó por la ganancia dinámica. */
  processed: boolean;
  /** Pico de nivel de voz visto desde que se abrió el micrófono (RMS pre-ganancia). */
  peakSpeechRms: () => number;
  /** Libera el micrófono (apaga el indicador del navegador). */
  stop: () => void;
}

export type StartCaptureResult =
  | { ok: true; capture: VoiceCapture }
  | { ok: false; reason: CaptureFailure };

export interface StartCaptureOptions {
  /** Nivel 0–1 del micrófono, ~25 veces por segundo, para animar el medidor. */
  onLevel?: (level: number) => void;
}

const METER_INTERVAL_MS = 40;

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
}

/**
 * Debe llamarse dentro del toque del usuario: el AudioContext se crea y se
 * reanuda ANTES del primer `await`, que es cuando el navegador aún lo permite.
 */
export async function startVoiceCapture(options: StartCaptureOptions = {}): Promise<StartCaptureResult> {
  if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "unsupported" };
  }
  if (window.isSecureContext === false) return { ok: false, reason: "insecure" };

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  let context: AudioContext | null = null;
  try {
    context = Ctor ? new Ctor({ latencyHint: "interactive" }) : null;
    if (context) void context.resume();
  } catch {
    context = null;
  }

  let stream: MediaStream;
  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia(VOICE_AUDIO_CONSTRAINTS);
    } catch (error) {
      // Un dispositivo que no acepta alguna restricción: reintentar sin ellas.
      if (errorName(error) !== "OverconstrainedError") throw error;
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
  } catch (error) {
    void context?.close().catch(() => undefined);
    const name = errorName(error);
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
      return { ok: false, reason: "not-allowed" };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "NotReadableError") {
      return { ok: false, reason: "audio-capture" };
    }
    return { ok: false, reason: "unknown" };
  }

  const rawTrack = stream.getAudioTracks()[0] ?? null;
  const releaseStream = () => stream.getTracks().forEach(t => t.stop());

  // Sin Web Audio: se sigue con la pista cruda (ya trae eco/ruido/ganancia del navegador).
  if (!context) {
    return {
      ok: true,
      capture: { track: rawTrack, processed: false, peakSpeechRms: () => 0, stop: releaseStream }
    };
  }

  try {
    const ctx = context;
    const source = ctx.createMediaStreamSource(stream);

    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 80;
    highpass.Q.value = 0.7;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 7600;
    lowpass.Q.value = 0.7;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;

    const gain = ctx.createGain();
    gain.gain.value = GAIN_CONFIG.restGain;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;

    const destination = ctx.createMediaStreamDestination();

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(analyser);
    lowpass.connect(gain);
    gain.connect(compressor);
    compressor.connect(destination);

    const buffer = new Float32Array(analyser.fftSize);
    let noiseFloor = 0.004;
    let peak = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      analyser.getFloatTimeDomainData(buffer);
      const rms = rmsOf(buffer);

      noiseFloor = updateNoiseFloor(noiseFloor, rms);
      if (isSpeechLevel(rms, noiseFloor)) peak = Math.max(peak, rms);

      const desired = computeDesiredGain(rms, noiseFloor);
      gain.gain.setTargetAtTime(desired, ctx.currentTime, gainTimeConstant(desired, gain.gain.value));

      options.onLevel?.(meterLevel(rms));
    };
    const timer = setInterval(tick, METER_INTERVAL_MS);

    const processedTrack = destination.stream.getAudioTracks()[0] ?? null;

    return {
      ok: true,
      capture: {
        track: processedTrack ?? rawTrack,
        processed: processedTrack !== null,
        peakSpeechRms: () => peak,
        stop: () => {
          if (stopped) return;
          stopped = true;
          clearInterval(timer);
          try { source.disconnect(); } catch { /* ya desconectado */ }
          processedTrack?.stop();
          releaseStream();
          void ctx.close().catch(() => undefined);
          options.onLevel?.(0);
        }
      }
    };
  } catch {
    // Si la cadena falla, el micrófono sigue sirviendo sin ella.
    void context.close().catch(() => undefined);
    return {
      ok: true,
      capture: { track: rawTrack, processed: false, peakSpeechRms: () => 0, stop: releaseStream }
    };
  }
}