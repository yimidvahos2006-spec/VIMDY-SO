import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { VimdyBackground } from "../components/ui/VimdyBackground";
import { GlassCard } from "../components/ui/GlassCard";
import { WelcomeStep } from "../components/onboarding/WelcomeStep";
import { BusinessTypeStep } from "../components/onboarding/BusinessTypeStep";
import { ModulesStep } from "../components/onboarding/ModulesStep";
import { TablesStep } from "../components/onboarding/TablesStep";
import { EmployeesStep } from "../components/onboarding/EmployeesStep";
import { CategoriesStep } from "../components/onboarding/CategoriesStep";
import { FirstProductStep } from "../components/onboarding/FirstProductStep";
import { CashOpeningStep } from "../components/onboarding/CashOpeningStep";
import { LoadingStep } from "../components/onboarding/LoadingStep";
import { FinalStep } from "../components/onboarding/FinalStep";
import { OnboardingProgress } from "../components/onboarding/OnboardingProgress";
import {
  ONBOARDING_STEPS_BUILT,
  nextOnboardingStep,
  resolveAfterModules,
  type OnboardingStepId
} from "../components/onboarding/onboardingSteps";
import type { BusinessTypeId } from "../../core/config/businessTypes";
import type { ModuleId } from "../../core/config/modules";
import type { Category } from "../../core/entities/Entities";

/**
 * /onboarding — Asistente de configuración inicial (Fase 3).
 *
 * Los 11 pasos del documento de producto ya están construidos y
 * conectados de verdad a Supabase:
 *   PASO 1  — enrutamiento real (ver OnboardingGate.tsx / esta página).
 *   PASO 2  — bienvenida (WelcomeStep).
 *   PASO 3  — tipo de negocio, guarda business_type (BusinessTypeStep).
 *   PASO 4  — módulos según tipo de negocio, guarda enabled_modules y
 *             adapta el Sidebar en vivo (ModulesStep).
 *   PASO 5  — número de mesas, crea las mesas reales (TablesStep). Solo
 *             se muestra si el negocio usa el módulo "mesas".
 *   PASO 6  — empleados, opcional (EmployeesStep).
 *   PASO 7  — categorías automáticas según el tipo de negocio (CategoriesStep).
 *   PASO 8  — primer producto real (FirstProductStep).
 *   PASO 9  — apertura de caja real (CashOpeningStep).
 *   PASO 10 — animación de cierre (LoadingStep).
 *   PASO 11 — pantalla final, marca onboarding_completed = true (FinalStep).
 *
 * Cada paso guarda su propio dato en Supabase apenas el usuario lo
 * completa — nada se simula ni se guarda "de una vez" al final.
 */
export function OnboardingPage() {
  const { user, businessId, onboardingCompleted, isReady } = useAuth();
  const [step, setStep] = useState<OnboardingStepId>(() => {
    try {
      const saved = localStorage.getItem("vimdy_onboarding_step");
      if (saved && ONBOARDING_STEPS_BUILT.includes(saved as OnboardingStepId)) {
        return saved as OnboardingStepId;
      }
    } catch {
      // localStorage no disponible (modo privado/incógnito).
    }
    return "welcome";
  });

  const [businessType, setBusinessType] = useState<BusinessTypeId | null>(() => {
    try {
      const saved = localStorage.getItem("vimdy_onboarding_business_type");
      return saved ? (JSON.parse(saved) as BusinessTypeId) : null;
    } catch {
      return null;
    }
  });

  const [enabledModules, setEnabledModules] = useState<ModuleId[]>(() => {
    try {
      const saved = localStorage.getItem("vimdy_onboarding_enabled_modules");
      return saved ? (JSON.parse(saved) as ModuleId[]) : [];
    } catch {
      return [];
    }
  });

  const [categories, setCategories] = useState<Category[]>(() => {
    try {
      const saved = localStorage.getItem("vimdy_onboarding_categories");
      return saved ? (JSON.parse(saved) as Category[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("vimdy_onboarding_step", step);
    } catch {
      // ignore
    }
  }, [step]);

  useEffect(() => {
    try {
      if (businessType) {
        localStorage.setItem("vimdy_onboarding_business_type", JSON.stringify(businessType));
      } else {
        localStorage.removeItem("vimdy_onboarding_business_type");
      }
    } catch {
      // ignore
    }
  }, [businessType]);

  useEffect(() => {
    try {
      localStorage.setItem("vimdy_onboarding_enabled_modules", JSON.stringify(enabledModules));
    } catch {
      // ignore
    }
  }, [enabledModules]);

  useEffect(() => {
    try {
      localStorage.setItem("vimdy_onboarding_categories", JSON.stringify(categories));
    } catch {
      // ignore
    }
  }, [categories]);

  if (!isReady) return null;

  // El negocio ya está listo: no hay razón para quedarse en /onboarding.
  if (onboardingCompleted) {
    try {
      localStorage.removeItem("vimdy_onboarding_step");
      localStorage.removeItem("vimdy_onboarding_business_type");
      localStorage.removeItem("vimdy_onboarding_enabled_modules");
      localStorage.removeItem("vimdy_onboarding_categories");
    } catch {
      // ignore
    }
    return <Navigate to="/dashboard" replace />;
  }

  const stepIsBuilt = ONBOARDING_STEPS_BUILT.includes(step);

  return (
    <VimdyBackground>
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
        <OnboardingProgress step={step} />

        {stepIsBuilt && step === "welcome" && (
          <WelcomeStep
            ownerName={user?.name}
            onStart={() => setStep(nextOnboardingStep("welcome"))}
          />
        )}

        {stepIsBuilt && step === "business_type" && businessId && (
          <BusinessTypeStep
            businessId={businessId}
            onSaved={(type) => {
              setBusinessType(type);
              setStep(nextOnboardingStep("business_type"));
            }}
          />
        )}

        {stepIsBuilt && step === "modules" && businessId && (
          <ModulesStep
            businessId={businessId}
            businessType={businessType ?? undefined}
            onSaved={(modules) => {
              setEnabledModules(modules);
              setStep(resolveAfterModules());
            }}
          />
        )}

        {stepIsBuilt && step === "tables" && (
          <TablesStep onSaved={() => setStep(nextOnboardingStep("tables"))} />
        )}

        {stepIsBuilt && step === "employees" && (
          <EmployeesStep
            enabledModules={enabledModules}
            onDone={() => setStep(nextOnboardingStep("employees"))}
          />
        )}

        {stepIsBuilt && step === "categories" && businessType && (
          <CategoriesStep
            businessType={businessType}
            onSaved={(createdCategories) => {
              setCategories(createdCategories);
              setStep(nextOnboardingStep("categories"));
            }}
          />
        )}

        {stepIsBuilt && step === "first_product" && (
          <FirstProductStep
            categories={categories}
            onSaved={() => setStep(nextOnboardingStep("first_product"))}
          />
        )}

        {stepIsBuilt && step === "cash_opening" && (
          <CashOpeningStep onSaved={() => setStep(nextOnboardingStep("cash_opening"))} />
        )}

        {stepIsBuilt && step === "loading" && (
          <LoadingStep onDone={() => setStep(nextOnboardingStep("loading"))} />
        )}

        {stepIsBuilt && step === "final" && <FinalStep />}

        {!stepIsBuilt && (
          <GlassCard className="w-full max-w-md p-8 text-center">
            <p className="text-slate-300 text-sm">
              Este paso del asistente ({step}) todavía no está construido.
            </p>
          </GlassCard>
        )}
      </div>
    </VimdyBackground>
  );
}