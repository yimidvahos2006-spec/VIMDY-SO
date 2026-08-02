import React, { useState, FormEvent } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { VimdyBackground } from "../components/ui/VimdyBackground";
import { VimdyLogo } from "../components/ui/VimdyLogo";
import { GlassCard } from "../components/ui/GlassCard";
import { VimdyButton } from "../components/ui/VimdyButton";

/**
 * Recuperación de contraseña — paso 1.
 * Pide el correo y dispara requestPasswordReset() (AuthContext ->
 * authBusinessContext -> supabase.auth.resetPasswordForEmail). Supabase
 * envía un correo con un link a /actualizar-password.
 *
 * Por seguridad, siempre muestra el mismo mensaje de éxito exista o no
 * esa cuenta — así este formulario no sirve para averiguar qué correos
 * están registrados en VIMDY.
 */
export function ForgotPasswordPage() {
  const { requestPasswordReset, isLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (!email.trim()) {
      setLocalError("Ingresa tu correo electrónico.");
      return;
    }

    try {
      await requestPasswordReset(email.trim());
    } catch {
      // Si el correo no existe, Supabase igual responde éxito (no lo
      // revela). Un error real acá es de red/config, pero mostramos el
      // mismo mensaje de todas formas para no dar pistas de qué falló.
    } finally {
      setSent(true);
    }
  }

  return (
    <VimdyBackground>
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="mb-8 flex flex-col items-center gap-4">
          <VimdyLogo size={90} />
          <h1 className="text-2xl font-bold text-white tracking-wide">VIMDY OS</h1>
          <p className="text-sm text-slate-400">Recupera el acceso a tu cuenta</p>
        </div>

        <GlassCard className="w-full max-w-sm p-8">
          {sent ? (
            <div className="flex flex-col gap-5 text-center">
              <div className="text-4xl">📩</div>
              <p className="text-white font-medium">Revisa tu correo</p>
              <p className="text-sm text-slate-400">
                Si <span className="text-slate-300">{email.trim()}</span> tiene una cuenta en VIMDY, te enviamos un
                link para crear una nueva contraseña. Puede tardar unos minutos en llegar.
              </p>
              <Link
                to="/login"
                className="text-center text-sm text-cyan-400 hover:text-cyan-300 transition-colors mt-2"
              >
                Volver a iniciar sesión
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <p className="text-sm text-slate-400 -mt-1">
                Ingresa el correo con el que te registraste y te enviaremos un link para crear una nueva contraseña.
              </p>

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
                  disabled={isLoading}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
                  placeholder="tucorreo@vimdy.com"
                  autoFocus
                />
              </div>

              {localError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
                  {localError}
                </div>
              )}

              <VimdyButton type="submit" disabled={isLoading} className="w-full mt-2">
                {isLoading ? "Enviando..." : "Enviar link de recuperación"}
              </VimdyButton>

              <Link
                to="/login"
                className="text-center text-sm text-slate-400 hover:text-cyan-400 transition-colors"
              >
                Volver a iniciar sesión
              </Link>
            </form>
          )}
        </GlassCard>
      </div>
    </VimdyBackground>
  );
}