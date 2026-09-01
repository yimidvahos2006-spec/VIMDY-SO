import { useState } from "react";
import { X, MessageCircle, ChevronRight } from "lucide-react";

const responses: Record<string, string> = {
  default:
    "No quiero darte información incorrecta. Puedes hablar con nuestro equipo de VIMDY por WhatsApp.",
  "que_es_vimdy":
    "VIMDY es una plataforma todo en uno para negocios de alimentos y bebidas. Integra ventas, caja, inventario, cocina y reportes.",
  "cuanto_cuesta":
    "Plan mensual: $79.000 COP/mes. Plan anual: $799.000 COP/año (ahorras $149.000).",
  "para_que_negocios":
    "Restaurantes, cafeterías, bares, panaderías, pizzerías, food trucks y cualquier negocio de alimentos y bebidas.",
  "como_funciona":
    "Te registras, creas tu negocio y empiezas a operar. Puedes registrar ventas, controlar caja, gestionar inventario y ver reportes.",
  "tiene_inventario":
    "Sí. Incluye control de inventario con alertas de stock bajo, recetas para productos elaborados y trazabilidad completa.",
    "soporte":
     "Puedes contactarnos por WhatsApp o correo electrónico: hola@vimdy.co"
};

const quickActions = [
  { id: "que_es_vimdy", label: "¿Qué es VIMDY?" },
  { id: "cuanto_cuesta", label: "¿Cuánto cuesta?" },
  { id: "para_que_negocios", label: "¿Para qué negocios sirve?" },
  { id: "como_funciona", label: "¿Cómo funciona?" },
  { id: "tiene_inventario", label: "¿Tiene inventario?" },
  { id: "soporte", label: "Hablar con soporte" }
];

export function VimdyAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<
    { from: "user" | "assistant"; text: string }[]
  >([]);

  function handleSend(actionId: string) {
    const action = quickActions.find((a) => a.id === actionId);
    if (!action) return;

    setMessages((prev) => [
      ...prev,
      { from: "user", text: action.label },
      { from: "assistant", text: responses[actionId] ?? responses.default }
    ]);
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-full shadow-lg shadow-blue-600/20 transition-all hover:scale-105"
        aria-label="Abrir asistente"
      >
        <MessageCircle size={24} />
      </button>

      {isOpen && (
        <div className="fixed bottom-20 right-6 z-50 w-[360px] max-w-[calc(100vw-2rem)] bg-[#111114] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-white/5">
            <div>
              <h3 className="text-white font-semibold text-sm">VIMDY Assistant</h3>
              <p className="text-zinc-500 text-xs">¿Te ayudo?</p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-zinc-500 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-4 space-y-3 max-h-[300px] overflow-y-auto">
            {messages.length === 0 ? (
              <p className="text-zinc-400 text-sm">
                👋 Hola. Soy VIMDY. ¿Qué quieres conocer?
              </p>
            ) : (
              messages.map((msg, i) => (
                <div
                  key={i}
                  className={`text-sm ${
                    msg.from === "user"
                      ? "text-right"
                      : "text-left"
                  }`}
                >
                  <span
                    className={`inline-block px-3 py-2 rounded-lg ${
                      msg.from === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-white/5 text-zinc-300"
                    }`}
                  >
                    {msg.text}
                  </span>
                </div>
              ))
            )}
          </div>

          {messages.length === 0 && (
            <div className="p-4 border-t border-white/5 space-y-2">
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => handleSend(action.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-zinc-300 transition-colors"
                >
                  <span>{action.label}</span>
                  <ChevronRight size={14} className="text-zinc-600" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
