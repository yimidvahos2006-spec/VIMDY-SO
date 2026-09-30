import React, { useEffect, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { getUserBusinesses } from "../../infrastructure/supabase/authBusinessContext";
import { BusinessSession } from "../../infrastructure/supabase/authBusinessContext";

export function BusinessSelectorPage() {
  const { isAuthenticated, isReady, user, switchBusiness } = useAuth();
  const navigate = useNavigate();
  const [businesses, setBusinesses] = useState<BusinessSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !isReady || !user?.id) return;

    let cancelled = false;

    setLoadError(null);
    setLoading(true);

    getUserBusinesses(user.id, user.name)
      .then((list) => {
        if (cancelled) return;

        if (list.length === 1) {
          // Resolver el contexto antes de entrar al Dashboard. Un simple
          // <Navigate> aquí dejaría businessId/branchId sin hidratar.
          void switchBusiness(list[0]).catch((switchError) => {
            if (cancelled) return;
            setLoadError(
              switchError instanceof Error
                ? switchError.message
                : "No pudimos abrir tu negocio. Inténtalo de nuevo."
            );
            setLoading(false);
          });
          return;
        }

        setBusinesses(list);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error
            ? err.message
            : "No pudimos cargar tus negocios. Inténtalo de nuevo."
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isReady, user?.id, reloadToken, switchBusiness]);

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-vimdy-background text-vimdy-text">
        <div className="w-8 h-8 rounded-full border-2 border-vimdy-text/10 border-t-vimdy-text animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-vimdy-background px-4">
        <div className="w-full max-w-md rounded-2xl border border-vimdy-border bg-vimdy-surface p-8 text-center">
          <p className="text-vimdy-danger text-sm">{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              setLoading(true);
              setReloadToken((value) => value + 1);
            }}
            className="mt-5 w-full rounded-xl border border-vimdy-border px-4 py-3 text-sm text-vimdy-text"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-vimdy-background text-vimdy-text">
        <div className="w-8 h-8 rounded-full border-2 border-vimdy-text/10 border-t-vimdy-text animate-spin" />
      </div>
    );
  }

  if (businesses.length === 0) {
    return <Navigate to="/crear-negocio" replace />;
  }

  if (businesses.length === 1) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-vimdy-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-vimdy-text mb-2">¿En qué negocio quieres trabajar?</h1>
          <p className="text-sm text-vimdy-text-secondary">Selecciona el negocio para continuar.</p>
        </div>

        <div className="space-y-3 mb-6">
          {businesses.map((business) => (
            <button
              key={business.businessId}
              onClick={() => switchBusiness(business)}
              className="w-full text-left rounded-xl border border-vimdy-text/10 bg-vimdy-text/[0.02] p-4 hover:border-vimdy-text/20 transition-colors"
            >
              <p className="text-vimdy-text font-medium">{business.businessName}</p>
              <p className="text-xs text-vimdy-text-secondary mt-1">{business.role}</p>
            </button>
          ))}
        </div>

        <button
          onClick={() => navigate("/crear-negocio")}
          className="w-full rounded-xl border border-dashed border-vimdy-text/20 bg-vimdy-text/[0.02] p-4 text-center text-sm text-vimdy-text-secondary hover:border-vimdy-text/30 transition-colors"
        >
          + Crear nuevo negocio
        </button>
      </div>
    </div>
  );
}
