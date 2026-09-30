/* ===========================================================================
   kitchenAlertService
   ---------------------------------------------------------------------------
   Alerta sonora + de voz para Cocina cuando llegan comandas nuevas.

   Todo se genera en vivo en el navegador (Web Audio API + SpeechSynthesis
   API): no hay archivos .mp3/.wav ni texto grabado. Así el cocinero puede
   estar de espaldas a la pantalla y aun así enterarse de un pedido nuevo.
=========================================================================== */

export interface AnnouncedOrder {
  /** Texto ya resuelto a algo legible ("Mesa 5", "Domicilio", "Mostrador"). */
  origin?: string;
}

const NUMBER_WORDS_ES = [
  "cero", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho",
  "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis",
  "diecisiete", "dieciocho", "diecinueve", "veinte"
];

function numberToSpanishWord(n: number): string {
  if (n >= 0 && n < NUMBER_WORDS_ES.length) {
    return NUMBER_WORDS_ES[n];
  }
  return String(n);
}

/** Arma el texto que se va a leer en voz alta según cuántas comandas llegaron. */
export function buildKitchenAnnouncementText(newOrders: AnnouncedOrder[]): string {
  if (newOrders.length === 0) {
    return "";
  }

  if (newOrders.length > 1) {
    return `${capitalize(numberToSpanishWord(newOrders.length))} nuevos pedidos recibidos.`;
  }

  const origin = (newOrders[0].origin ?? "").trim();

  if (origin.toLowerCase().startsWith("mesa")) {
    return `Nuevo pedido. ${origin}.`;
  }

  if (origin.toLowerCase().startsWith("domicilio")) {
    return "Nuevo pedido para domicilio.";
  }

  // "Mostrador" (venta rápida de Caja) u origen desconocido = para llevar.
  return "Nuevo pedido para llevar.";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Reproduce el "Tin" de aviso: dos tonos ascendentes sintetizados con
 * Web Audio API (sin depender de ningún archivo de audio).
 */
function playChime(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextClass) {
        resolve();
        return;
      }

      const ctx = new AudioContextClass();
      const now = ctx.currentTime;

      const notes = [
        { freq: 1046.5, start: 0, duration: 0.16 }, // Do6
        { freq: 1396.9, start: 0.14, duration: 0.28 } // Fa6
      ];

      notes.forEach(({ freq, start, duration }) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(freq, now + start);

        gain.gain.setValueAtTime(0, now + start);
        gain.gain.linearRampToValueAtTime(0.22, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);

        oscillator.connect(gain);
        gain.connect(ctx.destination);

        oscillator.start(now + start);
        oscillator.stop(now + start + duration + 0.02);
      });

      const totalDuration = Math.max(...notes.map((n) => n.start + n.duration));

      window.setTimeout(() => {
        ctx.close().catch(() => undefined);
        resolve();
      }, (totalDuration + 0.05) * 1000);
    } catch {
      resolve();
    }
  });
}

/** Lee en voz alta (español) el texto del anuncio. */
function speak(text: string): void {
  if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-CO";
  utterance.rate = 1;
  utterance.pitch = 1;

  const voices = window.speechSynthesis.getVoices();
  const spanishVoice =
    voices.find((voice) => voice.lang === "es-CO") ??
    voices.find((voice) => voice.lang?.startsWith("es"));

  if (spanishVoice) {
    utterance.voice = spanishVoice;
  }

  window.speechSynthesis.speak(utterance);
}

/**
 * Punto de entrada: suena el "Tin" y, justo después, anuncia por voz
 * cuántos pedidos llegaron (o de qué tipo, si fue solo uno).
 */
export async function announceNewKitchenOrders(newOrders: AnnouncedOrder[]): Promise<void> {
  if (newOrders.length === 0) {
    return;
  }

  await playChime();
  speak(buildKitchenAnnouncementText(newOrders));
}