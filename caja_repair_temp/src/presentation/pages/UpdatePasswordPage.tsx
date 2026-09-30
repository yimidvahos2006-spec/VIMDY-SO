import React, { useState, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { VimdyBackground } from "../components/ui/VimdyBackground";
import { VimdyLogo } from "../components/ui/VimdyLogo";
import { GlassCard } from "../components/ui/GlassCard";
import { VimdyButton } from "../components/ui/VimdyButton";
import { PasswordField } from "../components/ui/PasswordField";

const MIN_PASSWORD_LENGTH = 8;

/**
 * Recuperación de contraseña — paso 2.
 * A esta ruta llega el usuario al hacer clic en el link del correo. El SDK
 * de Supabase detecta el token de recuperación directamente en la URL y
 * deja una sesión temporal activa antes de que este componente monte —
 * por eso updatePassword() no necesita el token a mano, solo la contraseña
 * nueva.
 *
 * Si alguien abre esta ruta sin pasar por el link del correo (sin sesión
 * de recuperación válida), Supabase responde con un error claro que se
 * muestra tal cual, con un link para pedir uno nuevo.
 */
export function UpdatePasswordPage() {
  const { updatePassword, logout, isLoading } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setServerError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirmPassword) {
      setLocalError("Las contraseñas no coinciden.");
      return;
    }

    try {
      await updatePassword(password);
      // Cierra la sesión temporal de recuperación: así el usuario confirma
      // que la contraseña nueva funciona iniciando sesión de cero, en vez
      // de quedar "adentro" por una sesión que vino de un link de correo.
      await logout();
      setDone(true);
    } catch (err) {
      setServerError(
        err instanceof Error
          ? err.message
          : "No se pudo actualizar la contraseña. El link puede haber expirado."
      );
    }
  }

  return (
    <VimdyBackground>
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="mb-8 flex flex-col items-center gap-4">
          <VimdyLogo size={90} />
           <h1 className="text-2xl font-bold text-white tracking-wide">VIMDY</h1>
            <p className="text-vimdy-text-secondary">Actualizar contraseña</p>
        </div>

        <GlassCard className="w-full max-w-sm p-8">
          {done ? (
            <div className="flex flex-col gap-5 text-center">
              <div className="text-4xl">✅</div>
              <p className="text-white font-medium">Contraseña actualizada</p>
              <p className="text-vimdy-text-secondary">Ya puedes iniciar sesión con tu nueva contraseña.</p>
              <VimdyButton onClick={() => navigate("/login", { replace: true })} className="w-full mt-2">
                Iniciar sesión
              </VimdyButton>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <PasswordField
                id="password"
                label="Nueva contraseña"
                value={password}
                onChange={setPassword}
                disabled={isLoading}
                placeholder="••••••••"
                autoComplete="new-password"
              />

              <PasswordField
                id="confirmPassword"
                 label="Confirmar contraseña"
                value={confirmPassword}
                onChange={setConfirmPassword}
                disabled={isLoading}
                placeholder="••••••••"
                autoComplete="new-password"
              />

              {(localError || serverError) && (
                <div className="rounded-vimdy-sm border border-vimdy-danger/25 bg-vimdy-danger-bg px-4 py-2 text-sm text-vimdy-danger">
                  {localError || serverError}
                </div>
              )}

              <VimdyButton type="submit" disabled={isLoading} className="w-full mt-2">
                {isLoading ? "Actualizando..." : "Actualizar contraseña"}
              </VimdyButton>

              {serverError && (
                <Link
                  to="/recuperar-password"
                  className="text-center text-sm text-vimdy-accent hover:text-vimdy-accent-hover transition-colors"
                >
                  Pedir un nuevo link de recuperación
                </Link>
              )}
            </form>
          )}
        </GlassCard>
      </div>
    </VimdyBackground>
  );
}