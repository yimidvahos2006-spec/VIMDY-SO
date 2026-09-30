import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";

interface LoadingStepProps {
  onDone: () => void;
}

const CHECKLIST = [
  "Preparando módulos...",
  "Activando IA...",
  "Organizando inventario...",
  "Creando Dashboard...",
  "Todo listo."
];

const STEP_DELAY_MS = 700;

export function LoadingStep({ onDone }: LoadingStepProps) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (visibleCount >= CHECKLIST.length) {
      const finalTimer = setTimeout(onDone, 500);
      return () => clearTimeout(finalTimer);
    }

    const timer = setTimeout(() => setVisibleCount((count) => count + 1), STEP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visibleCount, onDone]);

  const isComplete = visibleCount >= CHECKLIST.length;

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">Configurando tu negocio</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Estamos preparando todo para que empieces a vender.
        </p>
      </div>

      <VimdyCard padding="lg" className="w-full max-w-md mx-auto text-center">
        {isComplete ? (
          <div className="py-8">
            <div className="w-16 h-16 rounded-full bg-vimdy-accent/15 text-vimdy-accent flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} strokeWidth={1.8} />
            </div>
            <p className="text-vimdy-h3 text-vimdy-text">Todo listo</p>
            <p className="text-vimdy-small text-vimdy-text-secondary mt-2">
              Tu negocio está configurado y listo para usar.
            </p>
          </div>
        ) : (
          <div className="py-8">
            <div className="w-12 h-12 rounded-full bg-vimdy-accent/15 text-vimdy-accent flex items-center justify-center mx-auto mb-6">
              <Loader2 size={24} className="animate-spin" strokeWidth={1.8} />
            </div>

            <div className="flex flex-col gap-3 text-left">
              {CHECKLIST.map((label, index) => {
                const isVisible = index < visibleCount;
                const isCurrent = index === visibleCount;

                return (
                  <div
                    key={label}
                    className={`flex items-center gap-3 transition-all duration-300 ${
                      isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2"
                    }`}
                  >
                    <span className={`shrink-0 ${isVisible ? "text-vimdy-success" : "text-vimdy-text-muted"}`}>
                      {isVisible ? (
                        <CheckCircle2 size={18} strokeWidth={1.8} />
                      ) : isCurrent ? (
                        <Loader2 size={18} className="animate-spin" strokeWidth={1.8} />
                      ) : (
                        <span className="w-[18px] h-[18px] inline-block rounded-full border-2 border-vimdy-border" />
                      )}
                    </span>
                    <span className={`text-sm ${isVisible ? "text-vimdy-text font-medium" : "text-vimdy-text-muted"}`}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </VimdyCard>
    </div>
  );
}