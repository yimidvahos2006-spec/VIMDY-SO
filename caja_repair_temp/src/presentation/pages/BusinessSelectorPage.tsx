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

  useEffect(() => {
    if (!isAuthenticated || !isReady || !user?.id) return;

    let cancelled = false;

    getUserBusinesses(user.id, user.name).then((list) => {
      if (cancelled) return;
      setBusinesses(list);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isReady, user?.id]);

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-vimdy-background text-vimdy-text">
        <div className="w-8 h-8 rounded-full border-2 border-vimdy-text/10 border-t-vimdy-text animate-spin" />
      </div>
    );
  }

  if (businesses.length === 0) {
    return <Navigate to="/onboarding" replace />;
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
