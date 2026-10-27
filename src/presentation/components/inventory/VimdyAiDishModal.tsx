import React, { useEffect, useRef, useState } from "react";
import { Sparkles, X, Mic, Loader2, ArrowRight } from "lucide-react";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { startSpeechRecognition } from "../../../core/voice/speechRecognition";
import { isSpeechRecognitionSupported } from "../../../core/voice/tableSpeechListener";
import { DISH_TEXT_MAX_LENGTH, describeDishAIError, parseDishWithAI } from "../../../core/ia/DishAI";
import { buildDishDraft, DishDraft } from "./dishDraft";
import { collectKnownStations } from "./InventoryWidgets";

/**
 * VIMDY IA — "Describe tu plato".
 * ---------------------------------------------------------------------------
 * Interfaz limpia: el usuario escribe o dicta un plato en lenguaje natural
 * ("Una hamburguesa especial a $22.000 con 150g de carne molida, pan, queso
 * cheddar y tocineta"). El texto se manda de forma temporal a Gemini (a través
 * de la Edge Function `vimdy-ia-dish`, la clave nunca está en el navegador) y
 * lo que vuelve se entrega como un borrador (`DishDraft`) para que el padre
 * abra el formulario de producto ya relleno.
 *
 * Este modal NO crea nada en el inventario: solo entiende el texto.
 */

const EXAMPLES = [
  "Una hamburguesa especial a $22.000 con 150g de carne molida, pan, queso cheddar y tocineta",
  "Limonada de coco a 9 mil con 200 ml de crema de coco, 100 ml de jugo de limón y hielo",
  "Pizza hawaiana personal a $18.000 con 120g de queso mozzarella, 60g de jamón y 50g de piña"
];

export function VimdyAiDishModal({
  onClose,
  onResult
}: {
  onClose: () => void;
  /** Recibe el borrador ya cruzado con el inventario real. El padre abre el formulario. */
  onResult: (draft: DishDraft) => void;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceSupported = isSpeechRecognitionSupported();
  const busy = loading || listening;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  async function handleVoice() {
    if (busy) return;
    setError(null);
    setListening(true);
    const speech = await startSpeechRecognition();
    setListening(false);

    if (!speech.success) {
      setError(speech.error || "No pudimos escucharte. Inténtalo de nuevo o escribe el plato.");
      return;
    }

    // El dictado se agrega al final: se puede dictar en varias tandas.
    setText((prev) => `${prev.trim() ? `${prev.trim()} ` : ""}${speech.text.trim()}`.slice(0, DISH_TEXT_MAX_LENGTH));
    textareaRef.current?.focus();
  }

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setError(null);
    setLoading(true);

    try {
      // Listas reales del negocio: la IA solo puede elegir entre lo que existe.
      const [categories, products] = await Promise.all([
        container.categoryEngine.get().listAll(),
        container.inventoryEngine.get().listAll()
      ]);
      const sellCategories = categories.filter((c) => c.kind !== "INSUMO");
      const insumos = products.filter((p) => p.isIngredient === true);

      const ai = await parseDishWithAI(
        trimmed,
        sellCategories.map((c) => c.name),
        collectKnownStations(sellCategories, products)
      );

      if (!ai.name) {
        setError("No reconocimos un plato en ese texto. Cuéntanos qué es, cuánto cuesta y qué lleva.");
        return;
      }

      onResult(buildDishDraft(ai, sellCategories, insumos));
    } catch (err) {
      console.error("[VimdyAiDishModal] Error al interpretar el plato", err);
      setError(describeDishAIError(err));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="VIMDY IA"
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-vimdy-lg border border-vimdy-ai/30 bg-vimdy-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-vimdy-md bg-vimdy-ai/15 border border-vimdy-ai/30 flex items-center justify-center">
              <Sparkles size={18} className="text-vimdy-ai" />
            </div>
            <h2 className="text-xl font-bold text-vimdy-text">VIMDY IA</h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            aria-label="Cerrar"
            className="text-vimdy-text-secondary hover:text-vimdy-text disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>
        <p className="text-vimdy-text-secondary text-sm mb-4">
          Describe tu plato con tus palabras y VIMDY llena el formulario por ti: nombre, categoría, estación,
          precio e insumos con sus cantidades.
        </p>

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, DISH_TEXT_MAX_LENGTH))}
            onKeyDown={handleKeyDown}
            disabled={loading}
            rows={5}
            placeholder={EXAMPLES[0]}
            aria-label="Describe tu plato"
            className="w-full px-3 py-3 pr-14 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-ai resize-none disabled:opacity-60"
          />
          {voiceSupported && (
            <button
              type="button"
              onClick={handleVoice}
              disabled={busy}
              aria-label={listening ? "Escuchando…" : "Dictar el plato"}
              title={listening ? "Escuchando…" : "Dictar el plato"}
              className={`absolute right-2 top-2 w-10 h-10 rounded-full border flex items-center justify-center transition-colors disabled:opacity-60 ${
                listening
                  ? "border-vimdy-ai bg-vimdy-ai/20 text-vimdy-ai animate-pulse"
                  : "border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-ai hover:border-vimdy-ai/50"
              }`}
            >
              <Mic size={18} />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mt-1 mb-4 text-[11px] text-vimdy-text-tertiary">
          <span>
            {listening
              ? "Escuchando… habla ahora."
              : "Tip: di el precio y las cantidades. Si no dices una cantidad, VIMDY propone una y te la marca para revisar."}
          </span>
          <span className="shrink-0 ml-3">
            {text.length}/{DISH_TEXT_MAX_LENGTH}
          </span>
        </div>

        {!text.trim() && !loading && (
          <div className="mb-4">
            <p className="text-vimdy-text-tertiary text-xs mb-2">Prueba con un ejemplo:</p>
            <div className="flex flex-col gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setText(example);
                    textareaRef.current?.focus();
                  }}
                  className="text-left text-xs px-3 py-2 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary hover:border-vimdy-ai/40 hover:text-vimdy-text"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-3 py-2"
          >
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!text.trim() || busy}
          className="w-full h-11 rounded-vimdy-md bg-vimdy-ai text-vimdy-background font-bold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-vimdy-ai-hover"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Entendiendo tu plato…
            </>
          ) : (
            <>
              Crear producto con VIMDY IA
              <ArrowRight size={16} />
            </>
          )}
        </button>
        <p className="text-vimdy-text-tertiary text-[11px] text-center mt-3">
          Tu texto se envía a Gemini solo para interpretarlo; VIMDY no lo guarda. Antes de guardar, el formulario te deja revisar y corregir todo.
        </p>
      </div>
    </div>
  );
}