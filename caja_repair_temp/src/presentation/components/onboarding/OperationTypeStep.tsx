import React from "react";

interface Props {
  answers: {
    hasTables: boolean | null;
    hasStaff: boolean | null;
    hasKitchen: boolean | null;
    hasInventory: boolean | null;
    useCustomers: boolean | null;
  };
  onChange: (answers: Props["answers"]) => void;
}

/**
 * OperationTypeStep — Paso del onboarding: "¿Cómo operas?"
 * Pregunta de sí/no/configurar-después para cada módulo operativo.
 */
export function OperationTypeStep({ answers, onChange }: Props) {
  function toggle(key: keyof typeof answers, value: boolean | null) {
    onChange({ ...answers, [key]: value });
  }

  const questions = [
    {
      key: "hasTables" as const,
      icon: "🪑",
      title: "¿Usas mesas?",
      description: "Atiendes clientes en mesas dentro del local"
    },
    {
      key: "hasStaff" as const,
      icon: "👥",
      title: "¿Usas personal para atender u operar?",
      description: "Tienes empleados que toman pedidos, atienden o preparan"
    },
    {
      key: "hasKitchen" as const,
      icon: "👨‍🍳",
      title: "¿Preparas productos?",
      description: "Tienes cocina o preparas pedidos antes de entregarlos"
    },
    {
      key: "hasInventory" as const,
      icon: "📦",
      title: "¿Manejas inventario?",
      description: "Controlas ingredientes, productos terminados o ambos"
    },
    {
      key: "useCustomers" as const,
      icon: "👤",
      title: "¿Quieres gestionar clientes?",
      description: "Llevar registro de clientes, historial, fidelización"
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">¿Cómo operas?</h2>
        <p className="text-slate-400">
          Selecciona cómo funciona tu negocio. Puedes cambiarlo después.
        </p>
      </div>

      <div className="space-y-4">
        {questions.map(q => (
          <div
            key={q.key}
            className="p-4 rounded-xl border border-slate-700 bg-slate-800/50"
          >
            <div className="flex items-start gap-3 mb-3">
              <span className="text-2xl">{q.icon}</span>
              <div>
                <h3 className="text-white font-semibold">{q.title}</h3>
                <p className="text-slate-400 text-sm">{q.description}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => toggle(q.key, true)}
                className={`
                  px-4 py-2 rounded-lg text-sm font-medium transition
                  ${answers[q.key] === true
                    ? "bg-cyan-500 text-slate-950"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }
                `}
              >
                Sí
              </button>
              <button
                type="button"
                onClick={() => toggle(q.key, false)}
                className={`
                  px-4 py-2 rounded-lg text-sm font-medium transition
                  ${answers[q.key] === false
                    ? "bg-slate-500 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }
                `}
              >
                No
              </button>
              <button
                type="button"
                onClick={() => toggle(q.key, null)}
                className={`
                  px-4 py-2 rounded-lg text-sm font-medium transition
                  ${answers[q.key] === null
                    ? "bg-slate-500 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }
                `}
              >
                Configurar después
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
