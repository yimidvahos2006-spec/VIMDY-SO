import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { supabase } from "../../infrastructure/supabase/supabaseClient";
import { useAuth } from "../context/AuthContext";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { isReady, isAuthenticated, businessId, businessCount, businessBootstrapError } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const handleCallback = async () => {
      try {
        const query = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const callbackError = query.get("error_description") || query.get("error");

        if (callbackError) {
          throw new Error(callbackError);
        }

        let { data: existingSessionData, error: existingSessionError } =
          await supabase.auth.getSession();
        if (existingSessionError) throw existingSessionError;

        const code = query.get("code");

        if (!existingSessionData.session && code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (!existingSessionData.session) {
          const accessToken = hash.get("access_token");
          const refreshToken = hash.get("refresh_token");

          if (accessToken && refreshToken) {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken
            });
            if (sessionError) throw sessionError;
          } else {
            throw new Error("No encontramos una sesión válida. Vuelve a iniciar sesión.");
          }
        }

        window.history.replaceState({}, document.title, window.location.pathname);

        if (!cancelled) setExchanging(false);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo completar el inicio de sesión. Vuelve a intentarlo."
        );
        setExchanging(false);
      }
    };

    void handleCallback();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (error || exchanging || !isReady || !isAuthenticated) return;
    if (businessBootstrapError) return;

    if (businessCount > 1 && !businessId) {
      navigate("/business-selector", { replace: true });
      return;
    }

    if (businessCount === 0 || !businessId) {
      navigate("/crear-negocio", { replace: true });
      return;
    }

    navigate("/dashboard", { replace: true });
  }, [businessBootstrapError, businessCount, businessId, error, exchanging, isAuthenticated, isReady, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505] text-white px-4">
        <div className="text-center space-y-4 max-w-md">
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => navigate("/login", { replace: true })}
            className="px-6 py-2 bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors"
          >
            Ir al login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505] text-white">
      <div className="text-center space-y-4">
        <div className="mx-auto w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
        <p className="text-sm text-slate-400">Preparando tu sesión...</p>
        {businessBootstrapError && (
          <p className="text-xs text-amber-300 max-w-sm">{businessBootstrapError}</p>
        )}
      </div>
    </div>
  );
}
