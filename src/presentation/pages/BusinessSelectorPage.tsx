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

    getUserBusinesses(user.id).then((list) => {
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
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white animate-spin" />
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-black px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">¿En qué negocio quieres trabajar?</h1>
          <p className="text-sm text-slate-400">Selecciona el negocio para continuar.</p>
        </div>

        <div className="space-y-3 mb-6">
          {businesses.map((business) => (
            <button
              key={business.businessId}
              onClick={() => switchBusiness(business)}
              className="w-full text-left rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:border-white/20 transition-colors"
            >
              <p className="text-white font-medium">{business.businessName}</p>
              <p className="text-xs text-slate-400 mt-1">{business.role}</p>
            </button>
          ))}
        </div>

        <button
          onClick={() => navigate("/crear-negocio")}
          className="w-full rounded-xl border border-dashed border-white/20 bg-white/[0.02] p-4 text-center text-sm text-slate-300 hover:border-white/30 transition-colors"
        >
          + Crear nuevo negocio
        </button>
      </div>
    </div>
  );
}
