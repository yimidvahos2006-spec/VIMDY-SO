import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../../infrastructure/supabase/supabaseClient";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const hash = window.location.hash;
        const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const expiresIn = params.get("expires_in");

        if (!accessToken) {
          setError("Token no encontrado. Vuelve a intentar.");
          return;
        }

        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken ?? ""
        });

        if (sessionError) {
          setError("No se pudo iniciar sesión. Vuelve a intentar.");
          return;
        }

        window.history.replaceState({}, document.title, window.location.pathname);

        const expiresAt = expiresIn
          ? Date.now() + parseInt(expiresIn, 10) * 1000
          : Date.now() + 3600 * 1000;
        document.cookie = `vimdy_token_expiry=${expiresAt}; path=/; max-age=86400; SameSite=Lax`;

        navigate("/onboarding", { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    };

    handleCallback();
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505] text-white">
        <div className="text-center space-y-4">
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
      <div className="w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
    </div>
  );
}
