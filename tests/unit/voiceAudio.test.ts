import { describe, it, expect } from "vitest";
import {
  GAIN_CONFIG,
  VOICE_AUDIO_CONSTRAINTS,
  computeDesiredGain,
  gainTimeConstant,
  isSpeechLevel,
  meterLevel,
  rmsOf,
  startVoiceCapture,
  updateNoiseFloor
} from "../../src/core/voice/voiceAudio";

describe("restricciones del micrófono", () => {
  it("pide cancelación de eco, supresión de ruido y control automático de ganancia", () => {
    const audio = VOICE_AUDIO_CONSTRAINTS.audio as MediaTrackConstraints;
    expect(audio.echoCancellation).toBe(true);
    expect(audio.noiseSuppression).toBe(true);
    expect(audio.autoGainControl).toBe(true);
    expect(VOICE_AUDIO_CONSTRAINTS.video).toBe(false);
  });
});

describe("rmsOf / meterLevel", () => {
  it("RMS de silencio, de una onda cuadrada y de un bloque vacío", () => {
    expect(rmsOf(new Float32Array(100))).toBe(0);
    expect(rmsOf(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5);
    expect(rmsOf([])).toBe(0);
  });

  it("el medidor está acotado a 0–1 y crece con el nivel", () => {
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(0.01)).toBeLessThan(meterLevel(0.1));
    expect(meterLevel(5)).toBe(1);
  });
});

describe("piso de ruido adaptativo", () => {
  it("baja rápido cuando el ambiente se calma", () => {
    let floor = 0.03;
    for (let i = 0; i < 30; i++) floor = updateNoiseFloor(floor, 0.002);
    expect(floor).toBeLessThan(0.004);
  });

  it("sube MUY despacio durante una frase (la voz no se vuelve 'ruido')", () => {
    let floor = 0.004;
    // 2 s de voz a 25 muestras/s
    for (let i = 0; i < 50; i++) floor = updateNoiseFloor(floor, 0.15);
    expect(floor).toBeLessThan(0.006);
  });

  it("siempre queda dentro de los límites", () => {
    expect(updateNoiseFloor(0.001, 0)).toBe(GAIN_CONFIG.noiseFloorMin);
    let floor = GAIN_CONFIG.noiseFloorMax;
    for (let i = 0; i < 5000; i++) floor = updateNoiseFloor(floor, 1);
    expect(floor).toBe(GAIN_CONFIG.noiseFloorMax);
  });
});

describe("ganancia dinámica", () => {
  const floor = 0.004;

  it("distingue voz de ruido de fondo", () => {
    expect(isSpeechLevel(0.004, floor)).toBe(false);
    expect(isSpeechLevel(0.012, floor)).toBe(true);
    // Con un piso casi cero, un soplido muy bajo tampoco es voz.
    expect(isSpeechLevel(0.003, 0.001)).toBe(false);
  });

  it("en silencio o ruido vuelve a la ganancia de reposo (no infla el ruido del local)", () => {
    expect(computeDesiredGain(0.003, floor)).toBe(GAIN_CONFIG.restGain);
    expect(computeDesiredGain(0, floor)).toBe(GAIN_CONFIG.restGain);
  });

  it("sube un susurro hacia el nivel objetivo", () => {
    const whisper = 0.012;
    const gain = computeDesiredGain(whisper, floor);
    expect(gain).toBeGreaterThan(5);
    expect(whisper * gain).toBeCloseTo(GAIN_CONFIG.targetRms, 1);
  });

  it("deja casi igual una voz normal", () => {
    const gain = computeDesiredGain(0.1, floor);
    expect(gain).toBeGreaterThan(1);
    expect(gain).toBeLessThan(1.5);
  });

  it("baja una voz fuerte o un grito", () => {
    expect(computeDesiredGain(0.4, floor)).toBeLessThan(1);
    expect(computeDesiredGain(0.9, floor)).toBe(GAIN_CONFIG.minGain);
  });

  it("nunca pasa de los límites aunque el susurro sea mínimo", () => {
    expect(computeDesiredGain(0.0061, 0.0001)).toBe(GAIN_CONFIG.maxGain);
  });

  it("voces graves, agudas, susurros y gritos terminan en un rango parecido", () => {
    const levels = [0.012, 0.03, 0.1, 0.3, 0.6];
    const out = levels.map(rms => rms * computeDesiredGain(rms, floor));
    const spread = Math.max(...out) / Math.min(...out);
    // Sin ganancia la diferencia sería de 50×; con ella queda muy por debajo.
    expect(spread).toBeLessThan(3);
  });

  it("baja la ganancia rápido y la sube despacio", () => {
    expect(gainTimeConstant(0.5, 4)).toBe(GAIN_CONFIG.attackTime);
    expect(gainTimeConstant(6, 2)).toBe(GAIN_CONFIG.releaseTime);
    expect(GAIN_CONFIG.attackTime).toBeLessThan(GAIN_CONFIG.releaseTime);
  });
});

describe("startVoiceCapture", () => {
  it("sin navegador (SSR / tests) falla de forma controlada", async () => {
    const result = await startVoiceCapture();
    expect(result).toEqual({ ok: false, reason: "unsupported" });
  });
});