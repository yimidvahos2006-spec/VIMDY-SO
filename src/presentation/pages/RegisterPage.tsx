import React, { useState, FormEvent } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import {
  Check,
  TrendingUp,
  Package,
  Wallet,
  BarChart3,
  WifiOff,
  ChevronRight,
  ChevronLeft
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { VimdyBackground } from "../components/ui/VimdyBackground";
import { VimdyLogo } from "../components/ui/VimdyLogo";
import { VimdyCard } from "../components/ui/VimdyCard";
import { VimdyButton } from "../components/ui/VimdyButton";
import { PasswordField } from "../components/ui/PasswordField";
import { AVAILABLE_COUNTRIES, CountryCode, getCountryName } from "../../core/config/globalization";
import { companyConfigStore } from "../../core/store/companyConfigStore";
import { useTranslation } from "../../core/i18n/useTranslation";

type Step = 0 | 1 | 2;

const STEP_LABELS = ["Tu cuenta", "Tu negocio", "Configuración"] as const;

const features = [
  { icon: <TrendingUp size={18} />, label: "Ventas rápidas" },
  { icon: <Package size={18} />, label: "Inventario inteligente" },
  { icon: <Wallet size={18} />, label: "Caja y pagos" },
  { icon: <BarChart3 size={18} />, label: "Cocina y mesas" },
  { icon: <WifiOff size={18} />, label: "Funciona sin internet" }
];

const metrics = [
  { value: "$ 4.850.000", label: "Ventas" },
  { value: "1.284", label: "Productos" },
  { value: "98%", label: "Stock controlado" },
  { value: "✓", label: "Caja cuadrada" }
];

export function RegisterPage() {
  const { register, isAuthenticated, isReady, isLoading, error } = useAuth();
  const navigate = useNavigate();
  const { language } = useTranslation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [country, setCountry] = useState(() => companyConfigStore.get().country);
  const [localError, setLocalError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(0);

  const selectedCountry = AVAILABLE_COUNTRIES.find((c) => c.code === country);
  const currency = selectedCountry ? getCountryName(selectedCountry.currency, language) : "";

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  function validateStep0(): boolean {
    if (!email.trim() || !password.trim()) {
      setLocalError("Completa el correo y la contraseña.");
      return false;
    }
    if (password.length < 8) {
      setLocalError("La contraseña debe tener al menos 8 caracteres.");
      return false;
    }
    setLocalError(null);
    return true;
  }

  function validateStep1(): boolean {
    if (!businessName.trim() || !ownerName.trim()) {
      setLocalError("Completa el nombre del negocio y tu nombre.");
      return false;
    }
    setLocalError(null);
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (!country) {
      setLocalError("Selecciona un país para continuar.");
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
      // El AuthContext ya guarda el mensaje de error en `error`.
    }
  }

  return (
    <VimdyBackground>
      <div className="min-h-[100dvh] flex flex-col">
        <header className="relative z-20 flex items-center justify-between px-5 py-4 sm:px-8 lg:px-10 shrink-0">
          <VimdyLogo size={32} />
          <Link
            to="/login"
            className="text-xs sm:text-sm text-slate-400 hover:text-white transition-colors"
          >
            ¿Ya tienes cuenta? Inicia sesión
          </Link>
        </header>

        <main className="flex-1 grid grid-cols-1 xl:grid-cols-2 min-h-0">
          <div className="hidden xl:flex flex-col justify-center px-16 2xl:px-24">
            <div className="max-w-md">
              <h2 className="text-3xl xl:text-4xl font-bold text-white leading-tight mb-4">
                Tu negocio.<br />
                Bajo control.
              </h2>
              <p className="text-slate-400 text-base leading-relaxed mb-10">
                Vende más. Controla todo. Crece sin complicaciones.
              </p>

              <div className="space-y-3 mb-12">
                {features.map((feature) => (
                  <div key={feature.label} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white">
                      {feature.icon}
                    </div>
                    <span className="text-slate-300 text-sm">{feature.label}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-xl border border-white/5 bg-white/[0.02] p-4"
                  >
                    <p className="text-white font-semibold text-sm mb-1">{metric.value}</p>
                    <p className="text-slate-500 text-xs">{metric.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center px-4 py-6 sm:px-6 sm:py-8 xl:px-8 xl:py-0">
            <div className="w-full max-w-sm">
              <div className="xl:hidden text-center mb-6 sm:mb-8">
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-wide">
                  Crea tu negocio en VIMDY
                </h1>
                <p className="text-xs sm:text-sm text-slate-400 mt-2 max-w-xs mx-auto">
                  Empieza a vender, controlar tu inventario y administrar tu negocio desde un solo lugar.
                </p>
              </div>

              <VimdyCard className="p-5 sm:p-6 lg:p-8">
                <div className="hidden xl:block mb-5">
                  <h1 className="text-lg sm:text-xl font-bold text-white mb-1">
                    Empecemos con tu cuenta
                  </h1>
                  <p className="text-[11px] sm:text-xs text-slate-500">
                    Crea tu cuenta de VIMDY. Después configuras tu negocio en pocos pasos.
                  </p>
                </div>

                <div className="mb-5 sm:mb-6">
                  <div className="flex items-center justify-between gap-2 sm:gap-3">
                    {STEP_LABELS.map((label, idx) => {
                      const isActive = idx === step;
                      const isCompleted = idx < step;
                      return (
                        <React.Fragment key={label}>
                          <div className="flex flex-col items-center gap-1.5 sm:gap-2 min-w-0">
                            <div className="flex items-center gap-1.5 sm:gap-2">
                              <div
                                className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-semibold shrink-0 ${
                                  isCompleted
                                    ? "bg-white text-black"
                                    : isActive
                                      ? "bg-white text-black"
                                      : "bg-white/10 text-slate-400"
                                }`}
                              >
                                {isCompleted ? <Check size={10} /> : idx + 1}
                              </div>
                              <span
                                className={`text-[10px] sm:text-xs font-medium truncate ${
                                  isActive || isCompleted ? "text-white" : "text-slate-500"
                                }`}
                              >
                                {label}
                              </span>
                            </div>
                          </div>
                          {idx < STEP_LABELS.length - 1 && (
                            <div className={`h-px flex-1 ${idx < step ? "bg-white" : "bg-white/10"}`} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                  <div className="xl:hidden mt-3 text-center">
                    <p className="text-[11px] text-slate-500">
                      Paso {step + 1} de 3
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:gap-4">
                  {step === 0 && (
                    <>
                      <div className="flex flex-col gap-1">
                        <label htmlFor="email" className="text-xs sm:text-sm text-slate-300">
                          ¿Cuál es tu correo?
                        </label>
                        <input
                          id="email"
                          type="email"
                          autoComplete="username"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          disabled={!isReady || isLoading}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 sm:px-4 sm:py-2.5 text-white text-sm placeholder-slate-500 outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
                          placeholder="tu@correo.com"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label htmlFor="password" className="text-xs sm:text-sm text-slate-300">
                          Crea una contraseña segura
                        </label>
                        <PasswordField
                          id="password"
                          value={password}
                          onChange={setPassword}
                          disabled={!isReady || isLoading}
                          placeholder="Mínimo 8 caracteres"
                          autoComplete="new-password"
                        />
                        <p className="text-[10px] sm:text-[11px] text-slate-500">
                          Usa al menos 8 caracteres, combinando letras, números y símbolos.
                        </p>
                      </div>

                      <div className="flex justify-end pt-1 sm:pt-2">
                        <VimdyButton
                          type="button"
                          onClick={() => {
                            if (validateStep0()) setStep(1);
                          }}
                          disabled={!isReady || isLoading}
                          size="sm"
                          className="sm:size-md"
                        >
                          Continuar <ChevronRight size={14} />
                        </VimdyButton>
                      </div>
                    </>
                  )}

                  {step === 1 && (
                    <>
                      <div className="flex flex-col gap-1">
                        <label htmlFor="businessName" className="text-xs sm:text-sm text-slate-300">
                          ¿Cómo se llama tu negocio?
                        </label>
                        <input
                          id="businessName"
                          type="text"
                          autoComplete="organization"
                          value={businessName}
                          onChange={(e) => setBusinessName(e.target.value)}
                          disabled={!isReady || isLoading}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 sm:px-4 sm:py-2.5 text-white text-sm placeholder-slate-500 outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
                          placeholder="Restaurante El Buen Sabor"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label htmlFor="ownerName" className="text-xs sm:text-sm text-slate-300">
                          ¿Cómo te llamas?
                        </label>
                        <input
                          id="ownerName"
                          type="text"
                          autoComplete="name"
                          value={ownerName}
                          onChange={(e) => setOwnerName(e.target.value)}
                          disabled={!isReady || isLoading}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 sm:px-4 sm:py-2.5 text-white text-sm placeholder-slate-500 outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
                          placeholder="Juan Pérez"
                        />
                      </div>

                      <div className="flex items-center justify-between pt-1 sm:pt-2">
                        <button
                          type="button"
                          onClick={() => setStep(0)}
                          className="text-xs sm:text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1"
                        >
                          <ChevronLeft size={14} /> Atrás
                        </button>
                        <VimdyButton
                          type="button"
                          onClick={() => {
                            if (validateStep1()) setStep(2);
                          }}
                          disabled={!isReady || isLoading}
                          size="sm"
                          className="sm:size-md"
                        >
                          Continuar <ChevronRight size={14} />
                        </VimdyButton>
                      </div>
                    </>
                  )}

                  {step === 2 && (
                    <>
                      <div className="flex flex-col gap-1">
                        <label htmlFor="country" className="text-xs sm:text-sm text-slate-300">
                          ¿Dónde está tu negocio?
                        </label>
                        <select
                          id="country"
                          autoComplete="country"
                          value={country}
                          onChange={(e) => setCountry(e.target.value as CountryCode)}
                          disabled={!isReady || isLoading}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 sm:px-4 sm:py-2.5 text-white text-sm outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
                        >
                          {AVAILABLE_COUNTRIES.map((c) => (
                            <option key={c.code} value={c.code}>
                              {getCountryName(c.code, language)}
                            </option>
                          ))}
                        </select>
                      </div>

                      {selectedCountry && (
                        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 sm:p-4 space-y-2.5">
                          <div className="flex items-center gap-2">
                            <Check size={14} className="text-emerald-400 shrink-0" />
                            <span className="text-xs sm:text-sm text-slate-300 font-medium">
                              Configuración regional aplicada
                            </span>
                          </div>
                          <div className="grid grid-cols-1 gap-2 ml-6">
                            <div>
                              <p className="text-[10px] sm:text-[11px] text-slate-500 uppercase tracking-wide">Moneda</p>
                              <p className="text-xs sm:text-sm text-white">{currency}</p>
                            </div>
                            <div>
                              <p className="text-[10px] sm:text-[11px] text-slate-500 uppercase tracking-wide">Idioma</p>
                              <p className="text-xs sm:text-sm text-white">
                                {selectedCountry.language === "es" ? "Español" : selectedCountry.language === "en" ? "Inglés" : "Português"}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] sm:text-[11px] text-slate-500 uppercase tracking-wide">Zona horaria</p>
                              <p className="text-xs sm:text-sm text-white">{selectedCountry.timezone}</p>
                            </div>
                            <div>
                              <p className="text-[10px] sm:text-[11px] text-slate-500 uppercase tracking-wide">Impuestos</p>
                              <p className="text-xs sm:text-sm text-white">
                                {selectedCountry.taxRate > 0
                                  ? `Configuración fiscal de ${getCountryName(selectedCountry.code, language)} (${selectedCountry.taxRate}%)`
                                  : `Configuración fiscal de ${getCountryName(selectedCountry.code, language)}`}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {(localError || error) && (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs sm:text-sm text-red-300">
                          {localError || error}
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1 sm:pt-2">
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="text-xs sm:text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1"
                        >
                          <ChevronLeft size={14} /> Atrás
                        </button>
                        <VimdyButton
                          type="submit"
                          disabled={!isReady || isLoading}
                          size="sm"
                          className="sm:size-md"
                        >
                          {!isReady ? "Preparando..." : isLoading ? "Enviando código..." : "Crear mi negocio →"}
                        </VimdyButton>
                      </div>
                    </>
                  )}
                </form>

                <p className="text-center text-[10px] sm:text-[11px] text-slate-500 mt-4 sm:mt-5">
                  Gratis para comenzar · Sin tarjeta de crédito
                </p>
              </VimdyCard>
            </div>
          </div>
        </main>
      </div>
    </VimdyBackground>
  );
}
