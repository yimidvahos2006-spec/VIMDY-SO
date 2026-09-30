import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { VimdyBackground } from "../components/ui/VimdyBackground";
import { VimdyLogo } from "../components/ui/VimdyLogo";
import { GlassCard } from "../components/ui/GlassCard";
import { VimdyButton } from "../components/ui/VimdyButton";

/**
 * Pantalla de verificación del código OTP (registro).
 *
 * Flujo:
 *  1. El usuario llega aquí después de iniciar el registro.
 *  2. Escribe el código de 6 dígitos recibido por correo.
 *  3. AuthContext verifica el OTP y completa el registro del negocio.
 *  4. Si no llegó el correo, puede solicitar un nuevo código cuando termine
 *     el cooldown administrado por authOtp.ts.
 */
export function OtpPage() {
  const {
    verifyOtp,
    resendOtp,
    resendCooldownSeconds,
    pendingRegistrationEmail,
    cancelRegistration,
    isLoading,
    error
  } = useAuth();
  const navigate = useNavigate();

  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [showDeliveryHelp, setShowDeliveryHelp] = useState(false);

  const email = pendingRegistrationEmail();

  // Refresca el contador visual sin duplicar el temporizador real de authOtp.ts.
  useEffect(() => {
    const refreshCooldown = () => {
      setCooldown(resendCooldownSeconds());
    };

    refreshCooldown();
    const intervalId = window.setInterval(refreshCooldown, 1000);
    return () => window.clearInterval(intervalId);
  }, [resendCooldownSeconds]);

  // Si se perdió el contexto del registro pendiente, vuelve a registro.
  if (!email) {
    return <Navigate to="/registro" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setResendMessage(null);
    setShowDeliveryHelp(false);

    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setLocalError("El código debe tener 6 dígitos.");
      return;
    }

    try {
      await verifyOtp(trimmedCode);
    } catch (err) {
      setLocalError(
        err instanceof Error
          ? err.message
          : "No se pudo verificar el código. Inténtalo de nuevo."
      );
    }
  }

  async function handleResend() {
    setLocalError(null);
    setResendMessage(null);
    setShowDeliveryHelp(false);
    setIsResending(true);

    try {
      await resendOtp();
      setResendMessage(
        "Solicitamos un nuevo código. Revisa también Spam, Promociones o Correo no deseado."
      );
      setCooldown(resendCooldownSeconds());
      setShowDeliveryHelp(true);
    } catch (err) {
      setLocalError(
        err instanceof Error
          ? err.message
          : "No se pudo reenviar el código. Inténtalo de nuevo."
      );
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
            Enviamos un código de 6 dígitos a{" "}
            <span className="text-slate-200">{email}</span>
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
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                disabled={isLoading}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-center text-2xl tracking-[0.5em] text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
                placeholder="000000"
                aria-label="Código de verificación de 6 dígitos"
              />
            </div>

            {(localError || error) && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300"
              >
                {localError || error}
              </div>
            )}

            {resendMessage && !localError && !error && (
              <div
                role="status"
                className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-300"
              >
                {resendMessage}
              </div>
            )}

            {showDeliveryHelp && !localError && !error && (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-slate-400">
                El sistema aceptó la solicitud. Si no aparece en 1–2 minutos,
                revisa Spam/Promociones y confirma que el correo mostrado arriba
                sea correcto.
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
              disabled={isResending || cooldown > 0 || isLoading}
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
