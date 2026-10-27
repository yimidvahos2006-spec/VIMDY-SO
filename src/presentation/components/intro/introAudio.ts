/**
 * introAudio
 * ---------------------------------------------------------------------------
 * Sonido y voz de la intro de bienvenida (WelcomeIntro).
 *
 * - Sonido: se genera en el navegador con Web Audio (un colchón suave de
 *   notas, un barrido ascendente cuando las luces se reúnen y una campanita
 *   cuando aparece el logo). No usa archivos de audio ni servicios externos.
 * - Voz: usa la voz en español que ya trae el dispositivo (speechSynthesis).
 *   Elige la más natural disponible (las "Natural"/"Online" de Edge y las de
 *   Google en Chrome suenan mucho mejor que las básicas).
 *
 * Los navegadores no dejan sonar nada hasta que la persona ha interactuado
 * con la página (por ejemplo, al tocar "Empezar a vender"). Si todavía no hay
 * interacción, la intro simplemente se ve en silencio y no falla nada.
 */

const MUTE_KEY = "vimdy:intro:muted";

export function isIntroMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setIntroMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, "1");
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    /* no es crítico */
  }
}

/* ------------------------------ Sonido ------------------------------ */

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export interface IntroSound {
  /** Empieza (o reanuda) el colchón de sonido. Se puede llamar varias veces. */
  start(): void;
  /** Barrido ascendente cuando las luces se reúnen. */
  sweep(): void;
  /** Campanita cuando aparece el logo. */
  chime(): void;
  /** Golpe grave de cine (caída de sub-bajo) en el instante del destello. */
  hit(): void;
  /** Baja el volumen a cero suavemente. */
  fadeOut(): void;
  setMuted(muted: boolean): void;
  /** Libera todo. Después de esto el objeto ya no suena. */
  stop(): void;
}

const MASTER_LEVEL = 0.5;

export function createIntroSound(): IntroSound {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let started = false;
  let muted = false;
  let closed = false;

  function ensure(): AudioContext | null {
    if (closed) return null;
    if (ctx) return ctx;
    try {
      const Ctor =
        typeof AudioContext !== "undefined" ? AudioContext : (window as WebkitWindow).webkitAudioContext;
      if (!Ctor) return null;
      const created = new Ctor();
      const gain = created.createGain();
      gain.gain.value = 0;
      gain.connect(created.destination);
      ctx = created;
      master = gain;
      return created;
    } catch {
      return null;
    }
  }

  function isAudible(): boolean {
    return !!ctx && ctx.state === "running" && !muted && !closed;
  }

  function rampMaster(target: number, seconds: number): void {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(target, now + seconds);
  }

  return {
    start() {
      const c = ensure();
      if (!c || !master) return;
      void c.resume().catch(() => undefined);
      if (!muted) rampMaster(MASTER_LEVEL, 1.6);
      if (started) return;
      started = true;

      // Colchón: acorde suave (La menor con novena), filtrado para que no sea áspero.
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      filter.connect(master);

      [
        { f: 110, d: -4 },
        { f: 164.81, d: 3 },
        { f: 220, d: -3 },
        { f: 277.18, d: 4 }
      ].forEach(({ f, d }) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        osc.detune.value = d;
        gain.gain.value = 0.18;
        osc.connect(gain);
        gain.connect(filter);
        osc.start();
      });
    },

    sweep() {
      if (!isAudible() || !ctx || !master) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.7);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.45);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.8);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 0.9);
    },

    hit() {
      if (!isAudible() || !ctx || !master) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(34, now + 1.1);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.9, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 1.4);
    },

    chime() {
      if (!isAudible() || !ctx || !master) return;
      const now = ctx.currentTime;
      [
        { f: 880, g: 0.25 },
        { f: 1318.5, g: 0.12 },
        { f: 1760, g: 0.08 },
        { f: 2637, g: 0.04 }
      ].forEach(({ f, g }) => {
        const osc = ctx!.createOscillator();
        const gain = ctx!.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        gain.gain.setValueAtTime(g, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.0);
        osc.connect(gain);
        gain.connect(master!);
        osc.start(now);
        osc.stop(now + 2.1);
      });
    },

    fadeOut() {
      rampMaster(0, 0.6);
    },

    setMuted(next: boolean) {
      muted = next;
      rampMaster(next ? 0 : MASTER_LEVEL, next ? 0.15 : 0.6);
    },

    stop() {
      closed = true;
      const c = ctx;
      ctx = null;
      master = null;
      if (c) void c.close().catch(() => undefined);
    }
  };
}

/* -------------------------------- Voz -------------------------------- */

type IntroLanguage = "es" | "en" | "pt";

const FALLBACK_LANG: Record<IntroLanguage, string> = {
  es: "es-CO",
  en: "en-US",
  pt: "pt-BR"
};

// Regiones preferidas (acento más neutro/cercano para Colombia).
const PREFERRED_REGIONS: Record<IntroLanguage, string[]> = {
  es: ["es-co", "es-mx", "es-us", "es-419", "es-es"],
  en: ["en-us", "en-gb"],
  pt: ["pt-br", "pt-pt"]
};

function getSynth(): SpeechSynthesis | null {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
    if (typeof SpeechSynthesisUtterance === "undefined") return null;
    return window.speechSynthesis;
  } catch {
    return null;
  }
}

/** Los navegadores cargan la lista de voces con retraso: se pide temprano. */
export function preloadVoices(): void {
  try {
    getSynth()?.getVoices();
  } catch {
    /* no es crítico */
  }
}

function pickVoice(lang: IntroLanguage): SpeechSynthesisVoice | null {
  const synth = getSynth();
  if (!synth) return null;
  const candidates = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  if (candidates.length === 0) return null;

  const regions = PREFERRED_REGIONS[lang];
  const score = (v: SpeechSynthesisVoice): number => {
    const name = v.name.toLowerCase();
    const region = regions.indexOf(v.lang.toLowerCase().replace("_", "-"));
    let s = 0;
    if (/natural|neural|online/.test(name)) s += 30; // voces de alta calidad de Edge/Windows
    if (name.includes("google")) s += 20; // voces de Chrome
    if (/premium|enhanced|siri/.test(name)) s += 25; // macOS/iOS
    if (region >= 0) s += 10 - region;
    if (v.localService === false) s += 1;
    return s;
  };
  return [...candidates].sort((a, b) => score(b) - score(a))[0];
}

export function speakIntro(text: string, lang: IntroLanguage): void {
  const synth = getSynth();
  if (!synth) return;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(lang);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = FALLBACK_LANG[lang];
    }
    utterance.rate = 0.92; // un poco más lento: se siente más claro y profesional
    utterance.pitch = 0.95;
    utterance.volume = 1;
    synth.speak(utterance);
  } catch {
    /* si el navegador no deja hablar, la intro sigue en silencio */
  }
}

export function cancelSpeech(): void {
  try {
    getSynth()?.cancel();
  } catch {
    /* no es crítico */
  }
}