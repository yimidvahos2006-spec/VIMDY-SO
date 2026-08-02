import React, { useState, FormEvent } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { VimdyBackground } from "../components/ui/VimdyBackground";
import { VimdyLogo } from "../components/ui/VimdyLogo";
import { GlassCard } from "../components/ui/GlassCard";
import { VimdyButton } from "../components/ui/VimdyButton";
import { AVAILABLE_COUNTRIES, CountryCode, getCountryName } from "../../core/config/globalization";
import { companyConfigStore } from "../../core/store/companyConfigStore";
import { useTranslation } from "../../core/i18n/useTranslation";

/**
 * Pantalla de registro de negocio ("Crear cuenta").
 * ---------------------------------------------------------------------------
 * Un solo botón dispara el PASO 1 del registro seguro (ver AuthContext.register()
 * -> beginRegistration() en authBusinessContext.ts):
 *   1. Crea el usuario en Supabase Auth (sin confirmar) y dispara el correo
 *      con el código OTP de 6 dígitos.
 *
 * Todavía NO crea el negocio ni deja sesión activa — eso ocurre en el
 * PASO 2, en /verificar-codigo (OtpPage.tsx -> AuthContext.verifyOtp()),
 * una vez el usuario confirma el código:
 *   2. Crea el negocio en `businesses` con trial de 30 días, ya con la
 *      moneda, idioma, zona horaria e IVA calculados a partir del país
 *      elegido (ver register-business/index.ts -> COUNTRY_DEFAULTS).
 *   3. Crea la fila en `business_members` con rol ADMIN.
 *   4. Deja la sesión activa y entra directo al Dashboard.
 *
 * No contiene lógica de negocio propia: solo captura los 5 campos
 * (nombre del negocio, propietario, correo, contraseña y país) y delega
 * todo al AuthContext, igual que hace LoginPage con login(). El resto de
 * la configuración (moneda, idioma, zona horaria, impuestos) es opcional
 * y se puede ajustar después desde Configuración.
 */
export function RegisterPage() {
  const { register, isAuthenticated, isReady, isLoading, error } = useAuth();
  const navigate = useNavigate();
  const { language } = useTranslation();

  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // El país ya se eligió en /pais antes de llegar acá (ver RequireCountry) —
  // este select arranca con ese país en vez de "CO" fijo, pero el usuario
  // sigue pudiendo cambiarlo aquí si su negocio opera en otro país.
  const [country, setCountry] = useState(() => companyConfigStore.get().country);
  const [localError, setLocalError] = useState<string | null>(null);

  // Si ya hay una sesión activa, no tiene sentido mostrar el registro.
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (!businessName.trim() || !ownerName.trim() || !email.trim() || !password.trim() || !country) {
      setLocalError("Completa todos los campos para crear tu negocio.");
      return;
    }

    if (password.length < 6) {
      setLocalError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    try {
      await register({
        businessName: businessName.trim(),
        ownerName: ownerName.trim(),
        email: email.trim(),
        password,
        country
      });
      navigate("/verificar-codigo", { replace: true });
    } catch {
      // El AuthContext ya guarda el mensaje de error en `error`,
      // no hace falta hacer nada más aquí.
    }
  }

  return (
    <VimdyBackground>
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
        <div className="mb-8 flex flex-col items-center gap-4">
          <VimdyLogo size={90} />
          <h1 className="text-2xl font-bold text-white tracking-wide">
            Crea tu negocio en VIMDY
          </h1>
          <p className="text-sm text-slate-400 text-center max-w-xs">
            30 días de prueba gratis. Sin tarjeta de crédito.
          </p>
        </div>

        <GlassCard className="w-full max-w-sm p-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="businessName" className="text-sm text-slate-300">
                Nombre del negocio
              </label>
              <input
                id="businessName"
                type="text"
                autoComplete="organization"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                disabled={!isReady || isLoading}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
                placeholder="Restaurante El Buen Sabor"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="ownerName" className="text-sm text-slate-300">
                Nombre del propietario
              </label>
              <input
                id="ownerName"
                type="text"
                autoComplete="name"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                disabled={!isReady || isLoading}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
                placeholder="Juan Pérez"
              />
            </div>

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
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!isReady || isLoading}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
                placeholder="Mínimo 6 caracteres"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="country" className="text-sm text-slate-300">
                País
              </label>
              <select
                id="country"
                autoComplete="country"
                value={country}
                onChange={(e) => setCountry(e.target.value as CountryCode)}
                disabled={!isReady || isLoading}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-white outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
              >
                {AVAILABLE_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {getCountryName(c.code, language)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                Con esto configuramos moneda, idioma, zona horaria e impuestos automáticamente.
              </p>
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
              {!isReady ? "Preparando..." : isLoading ? "Enviando código..." : "Crear negocio"}
            </VimdyButton>

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