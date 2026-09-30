import React, { useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { VimdyIntro } from "../components/intro/VimdyIntro";
import { appIntroStore } from "../../core/store/appIntroStore";

interface Props {
  children: React.ReactNode;
}

export function OnboardingGate({ children }: Props) {
  const {
    onboardingCompleted,
    businessId,
    businessCount,
    businessBootstrapError,
    retryBusinessBootstrap
  } = useAuth();
  const [showIntro, setShowIntro] = useState(() => !appIntroStore.hasBeenShown());

  if (businessBootstrapError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-vimdy-background px-4">
        <div className="w-full max-w-md rounded-2xl border border-vimdy-border bg-vimdy-surface p-8 text-center">
          <h1 className="text-lg font-semibold text-vimdy-text">No pudimos cargar tu negocio</h1>
          <p className="mt-2 text-sm text-vimdy-text-secondary">Tu sesión sigue activa. Revisa tu conexión y vuelve a intentarlo.</p>
          <button
            type="button"
            onClick={() => void retryBusinessBootstrap()}
            className="mt-6 w-full rounded-xl bg-vimdy-accent px-4 py-3 text-sm font-medium text-white hover:opacity-90"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (!businessId && businessCount > 1) {
    return <Navigate to="/business-selector" replace />;
  }

  if (!businessId && businessCount === 0) {
    return <Navigate to="/crear-negocio" replace />;
  }

  if (!onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  if (showIntro) {
    return (
      <VimdyIntro
        onComplete={() => {
          appIntroStore.markShown();
          setShowIntro(false);
        }}
      />
    );
  }

  return <>{children}</>;
}
