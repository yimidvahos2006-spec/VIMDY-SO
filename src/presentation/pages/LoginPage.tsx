import React, { useState, FormEvent } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { Eye, EyeOff, AlertCircle } from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { VimdyBackground } from "../components/ui/VimdyBackground";
import { VimdyLogo } from "../components/ui/VimdyLogo";
import { VimdyCard } from "../components/ui/VimdyCard";
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

  const disabled = !isReady || isLoading;
  const shownError = localError || error;

  return (
    <VimdyBackground>
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-[400px] flex flex-col items-center">
          {/* Marca */}
          <div className="mb-vimdy-xl flex flex-col items-center gap-vimdy-md animate-vimdy-fade-in">
            <VimdyLogo size={56} />

            <div className="flex flex-col items-center gap-1">
              <p className="text-vimdy-micro uppercase text-vimdy-text-tertiary">
                Vimdy OS
              </p>
              <h1 className="text-vimdy-h2 text-vimdy-text">
                Bienvenido de nuevo
              </h1>
            </div>

            <p className="text-vimdy-small text-vimdy-text-secondary text-center">
              Inicia sesión para gestionar tu negocio
            </p>
          </div>

          {/* Formulario */}
          <VimdyCard padding="lg" className="w-full animate-vimdy-slide-up">
            <form onSubmit={handleSubmit} className="flex flex-col gap-vimdy-lg" noValidate>
              <div className="flex flex-col gap-vimdy-xs">
                <label
                  htmlFor="email"
                  className="text-vimdy-small font-medium text-vimdy-text-secondary"
                >
                  Correo electrónico
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={disabled}
                  className="
                    w-full rounded-vimdy-sm border border-vimdy-border
                    bg-vimdy-background px-4 py-3
                    text-vimdy-body text-vimdy-text placeholder-vimdy-text-tertiary
                    outline-none transition-colors duration-vimdy-fast
                    focus:border-vimdy-accent focus:shadow-vimdy-accent
                    disabled:opacity-50
                  "
                  placeholder="tucorreo@vimdy.com"
                />
              </div>

              <div className="flex flex-col gap-vimdy-xs">
                <label
                  htmlFor="password"
                  className="text-vimdy-small font-medium text-vimdy-text-secondary"
                >
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={disabled}
                    className="
                      w-full rounded-vimdy-sm border border-vimdy-border
                      bg-vimdy-background px-4 py-3 pr-11
                      text-vimdy-body text-vimdy-text placeholder-vimdy-text-tertiary
                      outline-none transition-colors duration-vimdy-fast
                      focus:border-vimdy-accent focus:shadow-vimdy-accent
                      disabled:opacity-50
                    "
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    disabled={disabled}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    aria-pressed={showPassword}
                    className="
                      absolute right-3 top-1/2 -translate-y-1/2
                      text-vimdy-text-tertiary transition-colors duration-vimdy-fast
                      hover:text-vimdy-accent-hover disabled:opacity-50
                    "
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <Link
                  to="/recuperar-password"
                  className="
                    self-end text-vimdy-micro text-vimdy-text-secondary
                    transition-colors duration-vimdy-fast hover:text-vimdy-accent-hover
                  "
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>

              {shownError && (
                <div
                  role="alert"
                  className="
                    flex items-start gap-2 rounded-vimdy-sm border border-vimdy-danger/25
                    bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger
                  "
                >
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{shownError}</span>
                </div>
              )}

              <VimdyButton
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={isLoading}
                disabled={!isReady}
                className="mt-vimdy-xs"
              >
                {!isReady ? "Preparando..." : "Iniciar sesión"}
              </VimdyButton>

              <p className="text-center text-vimdy-small text-vimdy-text-secondary">
                ¿Tu negocio no tiene cuenta?{" "}
                <Link
                  to="/registro"
                  className="font-medium text-vimdy-accent transition-colors duration-vimdy-fast hover:text-vimdy-accent-hover"
                >
                  Créala aquí
                </Link>
              </p>
            </form>
          </VimdyCard>

          <p className="mt-vimdy-xl text-vimdy-micro text-vimdy-text-tertiary text-center">
            © {new Date().getFullYear()} VIMDY OS · Gestión inteligente para negocios de comida y bebida
          </p>
        </div>
      </div>
    </VimdyBackground>
  );
}