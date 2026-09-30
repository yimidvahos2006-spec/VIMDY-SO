import { useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../../context/AuthContext";
import { useEnabledModules } from "../../../core/store/useEnabledModules";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyLogo } from "../ui/VimdyLogo";

interface WelcomeGuideProps {
  onComplete: () => void;
}

interface GuideStep {
  id: string;
  title: string;
  description: string;
  icon: string;
  highlight?: string;
}

/**
 * Guía de bienvenida post-onboarding.
 *
 * Muestra una introducción a VIMDY y explica los módulos activos
 * del negocio. Se muestra solo una vez después de completar el onboarding.
 *
 * El usuario puede saltarla o seguirla paso a paso.
 */
export function WelcomeGuide({ onComplete }: WelcomeGuideProps) {
  const { user } = useAuth();
  const enabledModules = useEnabledModules();
  const [currentStep, setCurrentStep] = useState(0);

  const hasMesas = enabledModules?.includes("mesas") ?? false;
  const hasMeseros = enabledModules?.includes("mesas") ?? false;
  const hasCocina = enabledModules?.includes("cocina") ?? false;
  const hasInventario = enabledModules?.includes("inventario") ?? false;

  const steps: GuideStep[] = [
    {
      id: "intro",
      title: `¡Bienvenido a VIMDY, ${user?.name ?? ""}!`,
      description: "Tu punto de venta para negocios de alimentos. Controla mesas, cocina, inventario y caja desde un solo lugar.",
      icon: "👋"
    },
    {
      id: "what-is",
      title: "¿Qué es VIMDY?",
      description: "VIMDY es tu sistema de punto de venta (POS) diseñado para restaurantes, cafeterías, panaderías y todo tipo de negocios de alimentos y bebidas.",
      icon: "💡"
    },
    ...(hasMesas
      ? [{
          id: "mesas",
          title: "Módulo de Mesas",
          description: hasMeseros
            ? "Gestiona las mesas de tu negocio. Tus meseros pueden tocar su nombre y empezar a tomar pedidos."
            : "Gestiona las mesas de tu negocio. Los clientes se sientan solos y tú controlas todo desde aquí.",
          icon: "🪑",
          highlight: hasMeseros ? "Meseros" : "Mesas"
        }]
      : []),
    ...(hasCocina
      ? [{
          id: "cocina",
          title: "Módulo de Cocina",
          description: "Recibe los pedidos en cocina en tiempo real. Tus cocineros pueden ver las comandas y marcarlas como listas.",
          icon: "👨‍🍳",
          highlight: "Cocina"
        }]
      : []),
    {
      id: "caja",
      title: "Módulo de Caja",
      description: "Registra ventas, abre y cierra turnos, y controla el dinero en efectivo. Es el corazón de tu negocio.",
      icon: "💵",
      highlight: "Caja"
    },
    ...(hasInventario
      ? [{
          id: "inventario",
          title: "Módulo de Inventario",
          description: "Controla el stock de tus productos. Recibe alertas cuando algo se esté agotando.",
          icon: "📦",
          highlight: "Inventario"
        }]
      : []),
    {
      id: "first-steps",
      title: "Tus primeros pasos",
      description: "1. Crea más productos en Inventario\n2. Abre tu turno de caja\n3. ¡Empieza a vender!",
      icon: "🚀"
    },
    {
      id: "help",
      title: "¿Necesitas ayuda?",
      description: "Cada módulo tiene un botón de ayuda (?) que te explica cómo funciona. También puedes usar VIMDY IA para hacer preguntas.",
      icon: "❓"
    }
  ];

  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  if (!step) {
    return <Navigate to="/dashboard" replace />;
  }

  function handleNext() {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep(currentStep + 1);
    }
  }

  function handleSkip() {
    onComplete();
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-3xl bg-vimdy-surface border border-slate-700 shadow-2xl overflow-hidden">
        {/* Header con progreso */}
        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center justify-between mb-4">
            <VimdyLogo size={32} />
            <button
              onClick={handleSkip}
              className="text-sm text-slate-400 hover:text-white transition-colors"
            >
              Saltar guía
            </button>
          </div>
          <div className="flex gap-1">
            {steps.map((_, idx) => (
              <div
                key={idx}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  idx <= currentStep ? "bg-vimdy-accent" : "bg-slate-700"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Contenido del paso */}
        <div className="px-6 py-8">
          <div className="flex flex-col items-center text-center">
            <span className="text-5xl mb-4">{step.icon}</span>
            <h2 className="text-2xl font-bold text-white mb-3">{step.title}</h2>
            <p className="text-slate-300 text-base whitespace-pre-line leading-relaxed">
              {step.description}
            </p>
            {step.highlight && (
              <div className="mt-4 px-4 py-2 rounded-lg bg-vimdy-accent/20 border border-vimdy-accent/30">
                <span className="text-sm text-vimdy-accent font-medium">
                  Módulo activo: {step.highlight}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer con navegación */}
        <div className="px-6 pb-6 flex items-center justify-between">
          <button
            onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
            disabled={currentStep === 0}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Anterior
          </button>
          <span className="text-sm text-slate-500">
            {currentStep + 1} / {steps.length}
          </span>
          <VimdyButton onClick={handleNext}>
            {isLastStep ? "¡Empezar!" : "Siguiente →"}
          </VimdyButton>
        </div>
      </div>
    </div>
  );
}
