import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { VimdyBackground } from "../components/ui/VimdyBackground";
import { GlassCard } from "../components/ui/GlassCard";
import { WelcomeStep } from "../components/onboarding/WelcomeStep";
import { BusinessTypeStep } from "../components/onboarding/BusinessTypeStep";
import { ModulesStep } from "../components/onboarding/ModulesStep";
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
import {
  onboardingDraftStore,
  type OnboardingDraft
} from "../components/onboarding/onboardingDraftStore";
import type { BusinessTypeId } from "../../core/config/businessTypes";
import type { ModuleId } from "../../core/config/modules";
import type { Category } from "../../core/entities/Entities";

/**
 * Asistente de configuración inicial.
 *
 * CRÍTICO:
 * El borrador local está aislado por businessId. Nunca se utiliza una clave
 * global como "vimdy_onboarding_step", porque esa clave podía hacer que una
 * cuenta nueva heredara el paso de otra cuenta que usó el mismo navegador.
 *
 * La verdad de negocio sigue estando en Supabase (business_type,
 * enabled_modules, categorías, productos, caja y onboarding_completed). El
 * almacenamiento local solo permite reanudar la interfaz sin confundir
 * negocios.
 */
export function OnboardingPage() {
  const {
    user,
    businessId,
    onboardingCompleted,
    isReady,
    businessBootstrapError,
    retryBusinessBootstrap
  } = useAuth();

  const [draftLoaded, setDraftLoaded] = useState(false);
  const [step, setStep] = useState<OnboardingStepId>("welcome");
  const [businessType, setBusinessType] = useState<BusinessTypeId | null>(null);
  const [enabledModules, setEnabledModules] = useState<ModuleId[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    onboardingDraftStore.clearLegacy();
  }, []);

  useEffect(() => {
    if (!isReady || !businessId) {
      setDraftLoaded(false);
      return;
    }

    const draft: OnboardingDraft | null = onboardingDraftStore.get(businessId);

    setStep(draft?.step && ONBOARDING_STEPS_BUILT.includes(draft.step) ? draft.step : "welcome");
    setBusinessType(draft?.businessType ?? null);
    setEnabledModules(draft?.enabledModules ?? []);
    setCategories(draft?.categories ?? []);
    setDraftLoaded(true);
  }, [businessId, isReady]);

  useEffect(() => {
    if (!draftLoaded || !businessId) return;

    onboardingDraftStore.save(businessId, {
      step,
      businessType,
      enabledModules,
      categories
    });
  }, [businessId, draftLoaded, step, businessType, enabledModules, categories]);

  useEffect(() => {
    if (onboardingCompleted) {
      onboardingDraftStore.clear(businessId);
    }
  }, [businessId, onboardingCompleted]);

  if (!isReady) return null;

  if (businessBootstrapError) {
    return (
      <VimdyBackground>
        <div className="min-h-screen flex items-center justify-center px-4">
          <GlassCard className="w-full max-w-md p-8 text-center">
            <p className="text-vimdy-text font-semibold mb-2">
              No pudimos cargar tu negocio
            </p>
            <p className="text-vimdy-text-secondary text-sm mb-6">
              Tu sesión sigue activa. Vuelve a intentarlo cuando tengas
              conexión con el servidor.
            </p>
            <button
              type="button"
              onClick={() => {
                void retryBusinessBootstrap();
              }}
              className="w-full rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface px-4 py-3 text-vimdy-text hover:border-vimdy-accent transition-colors"
            >
              Reintentar
            </button>
          </GlassCard>
        </div>
      </VimdyBackground>
    );
  }

  if (!businessId) {
    return <Navigate to="/crear-negocio" replace />;
  }

  if (onboardingCompleted) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!draftLoaded) return null;

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

        {stepIsBuilt && step === "business_type" && (
          <BusinessTypeStep
            businessId={businessId}
            onSaved={(type) => {
              setBusinessType(type);
              setStep(nextOnboardingStep("business_type"));
            }}
          />
        )}

        {stepIsBuilt && step === "modules" && (
          <ModulesStep
            businessId={businessId}
            businessType={businessType ?? undefined}
            onSaved={(modules) => {
              setEnabledModules(modules);
              setStep(resolveAfterModules());
            }}
          />
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
          <CashOpeningStep
            onSaved={() => setStep(nextOnboardingStep("cash_opening"))}
          />
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
