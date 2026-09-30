export interface SpeechResult {

  success: boolean;

  text: string;

  error?: string;

}

declare global {

  interface Window {

    SpeechRecognition: any;

    webkitSpeechRecognition: any;

  }

}

export function startSpeechRecognition(): Promise<SpeechResult> {

  return new Promise((resolve) => {

    const SpeechRecognition =

      window.SpeechRecognition ||

      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {

      resolve({

        success: false,

        text: "",

        error: "Este navegador no soporta reconocimiento de voz."

      });

      return;

    }

    const recognition = new SpeechRecognition();

    recognition.lang = "es-CO";

    recognition.interimResults = false;

    recognition.maxAlternatives = 1;

    recognition.continuous = false;

    recognition.start();

    recognition.onresult = (event: any) => {

      const text = event.results[0][0].transcript;

      resolve({

        success: true,

        text

      });

    };

    recognition.onerror = () => {

      resolve({

        success: false,

        text: "",

        error: "No fue posible reconocer la voz."

      });

    };

    recognition.onend = () => {

      recognition.stop();

    };

  });

}