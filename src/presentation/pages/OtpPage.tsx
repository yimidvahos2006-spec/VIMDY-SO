import React, { useEffect, useState, FormEvent } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { VimdyBackground } from "../components/ui/VimdyBackground";
import { VimdyLogo } from "../components/ui/VimdyLogo";
import { GlassCard } from "../components/ui/GlassCard";
import { VimdyButton } from "../components/ui/VimdyButton";

/**
 * Pantalla de verificación del código OTP ("Verifica tu correo").
 * ---------------------------------------------------------------------------
 * Segundo paso del registro seguro (ver RegisterPage.tsx -> register(),
 * que ya dejó el usuario creado sin confirmar y disparó el correo con el
 * código de 6 dígitos):
 *
 *   1. El usuario escribe el código -> verifyOtp(code) en AuthContext.
 *   2. Si es correcto: AuthContext confirma la sesión, crea el negocio +
   *      membresía ADMIN + trial de 30 días (Edge Function register-business)
 *      y deja la sesión activa. Esta pantalla solo espera y navega.
 *   3. Si el usuario no recibió el código, "Reenviar código" (con
 *      enfriamiento de 30s manejado en authOtp.ts) dispara uno nuevo.
 *
 * Si el usuario llega aquí sin haber pasado por RegisterPage (no hay
 * registro pendiente en sessionStorage), lo mandamos de vuelta a
 * /registro — no tiene sentido pedir un código para un correo que no se
 * conoce.
 */
export function OtpPage() {
  const {
    verifyOtp,
    resendOtp,
    resendCooldownSeconds,
    pendingRegistrationEmail,
    cancelRegistration,
    isAuthenticated,
    isLoading,
    error
  } = useAuth();
  const navigate = useNavigate();

  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const email = pendingRegistrationEmail();

  // Refresca el contador de "Reenviar código (Ns)" cada segundo, sin
  // duplicar el temporizador real (ese vive en authOtp.ts).
  useEffect(() => {
    setCooldown(resendCooldownSeconds());
    const interval = setInterval(() => {
      setCooldown(resendCooldownSeconds());
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldownSeconds]);

  // Si ya hay sesión activa, no tiene sentido mostrar esta pantalla.
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  // No hay registro en curso (llegó aquí directo por URL, recargó la
  // página y sessionStorage se perdió, etc.) -> vuelve a empezar.
  if (!email) {
    return <Navigate to="/registro" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setResendMessage(null);

    if (!/^\d{6}$/.test(code.trim())) {
      setLocalError("El código debe tener 6 dígitos.");
      return;
    }

    try {
      await verifyOtp(code.trim());
      navigate("/dashboard", { replace: true });
    } catch {
      // El AuthContext ya guarda el mensaje de error en `error`,
      // no hace falta hacer nada más aquí.
    }
  }

  async function handleResend() {
    setLocalError(null);
    setResendMessage(null);
    setIsResending(true);
    try {
      await resendOtp();
      setResendMessage("Te enviamos un nuevo código.");
      setCooldown(resendCooldownSeconds());
    } catch {
      // El AuthContext ya guarda el mensaje de error en `error`.
    } finally {
      setIsResending(false);
    }
  }

  function handleBack() {
    cancelRegistration();
    navigate("/registro", { replace: true });
  }

  return (
    <VimdyBackground>
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
        <div className="mb-8 flex flex-col items-center gap-4">
          <VimdyLogo size={90} />
          <h1 className="text-2xl font-bold text-white tracking-wide">
            Verifica tu correo
          </h1>
          <p className="text-sm text-slate-400 text-center max-w-xs">
            Enviamos un código de 6 dígitos a <span className="text-slate-200">{email}</span>
          </p>
        </div>

        <GlassCard className="w-full max-w-sm p-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="otpCode" className="text-sm text-slate-300">
                Código de verificación
              </label>
              <input
                id="otpCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                disabled={isLoading}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-center text-2xl tracking-[0.5em] text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
                placeholder="000000"
              />
            </div>

            {(localError || error) && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
                {localError || error}
              </div>
            )}

            {resendMessage && !localError && !error && (
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-300">
                {resendMessage}
              </div>
            )}

            <VimdyButton
              type="submit"
              disabled={isLoading || code.length !== 6}
              className="w-full mt-2"
            >
              {isLoading ? "Verificando..." : "Verificar código"}
            </VimdyButton>

            <button
              type="button"
              onClick={handleResend}
              disabled={isResending || cooldown > 0}
              className="text-center text-sm text-slate-400 hover:text-cyan-400 transition-colors disabled:opacity-50 disabled:hover:text-slate-400"
            >
              {cooldown > 0
                ? `Reenviar código (${cooldown}s)`
                : isResending
                ? "Enviando..."
                : "Reenviar código"}
            </button>

            <button
              type="button"
              onClick={handleBack}
              className="text-center text-sm text-slate-500 hover:text-slate-300 transition-colors"
            >
              Volver a 'Crear cuenta'
            </button>

            <Link
              to="/login"
              className="text-center text-sm text-slate-400 hover:text-cyan-400 transition-colors"
            >
              ¿Ya tienes cuenta? Inicia sesión
            </Link>
          </form>
        </GlassCard>
      </div>
    </VimdyBackground>
  );
}