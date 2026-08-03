import React, { useState, FormEvent } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { VimdyBackground } from "../components/ui/VimdyBackground";
import { VimdyLogo } from "../components/ui/VimdyLogo";
import { GlassCard } from "../components/ui/GlassCard";
import { VimdyButton } from "../components/ui/VimdyButton";

/**
 * Pantalla de inicio de sesión — sirve tanto al dueño como a cualquier
 * empleado (cajero/mesero/cocina) creado desde Configuración > Usuarios,
 * ya que todos son usuarios reales de Supabase Auth (ver CRÍTICO #1 del
 * checklist de lanzamiento).
 * Se conecta al AuthProvider (src/presentation/context/AuthContext.tsx)
 * a través de useAuth(). No contiene lógica de autenticación propia:
 * solo captura email/contraseña y delega el login al AuthContext, que
 * a su vez llama a signIn() (authBusinessContext.ts), es decir,
 * supabase.auth.signInWithPassword() — la verificación real ocurre
 * siempre en el servidor de Supabase, nunca en este componente.
 */
export function LoginPage() {
  const { login, isAuthenticated, isReady, isLoading, error } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Si ya hay una sesión activa, no tiene sentido mostrar el login.
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (!email.trim() || !password.trim()) {
      setLocalError("Ingresa tu correo y tu contraseña.");
      return;
    }

    try {
      await login(email.trim(), password);
      navigate("/dashboard", { replace: true });
    } catch {
      // El AuthContext ya guarda el mensaje de error en `error`,
      // no hace falta hacer nada más aquí.
    }
  }

  return (
    <VimdyBackground>
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="mb-8 flex flex-col items-center gap-4">
          <VimdyLogo size={90} />
          <h1 className="text-2xl font-bold text-white tracking-wide">
            VIMDY OS
          </h1>
          <p className="text-sm text-slate-400">
            Inicia sesión para continuar
          </p>
        </div>

        <GlassCard className="w-full max-w-sm p-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-sm text-slate-300">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!isReady || isLoading}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
                placeholder="tucorreo@vimdy.com"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-sm text-slate-300">
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!isReady || isLoading}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 pr-11 text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  disabled={!isReady || isLoading}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-cyan-400 disabled:opacity-50"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <Link
                to="/recuperar-password"
                className="self-end text-xs text-slate-400 hover:text-cyan-400 transition-colors"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>

            {(localError || error) && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
                {localError || error}
              </div>
            )}

            <VimdyButton
              type="submit"
              disabled={!isReady || isLoading}
              className="w-full mt-2"
            >
              {!isReady ? "Preparando..." : isLoading ? "Ingresando..." : "Iniciar sesión"}
            </VimdyButton>

            <Link
              to="/registro"
              className="text-center text-sm text-slate-400 hover:text-cyan-400 transition-colors"
            >
              ¿Tu negocio no tiene cuenta? Créala aquí
            </Link>
          </form>
        </GlassCard>
      </div>
    </VimdyBackground>
  );
}