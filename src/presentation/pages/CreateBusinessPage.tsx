import React, { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { createAdditionalBusiness } from "../../infrastructure/supabase/authBusinessContext";
import { VimdyBackground } from "../components/ui/VimdyBackground";
import { VimdyLogo } from "../components/ui/VimdyLogo";
import { VimdyCard } from "../components/ui/VimdyCard";
import { VimdyButton } from "../components/ui/VimdyButton";
import { AVAILABLE_COUNTRIES, CountryCode, getCountryName } from "../../core/config/globalization";
import { companyConfigStore } from "../../core/store/companyConfigStore";
import { useTranslation } from "../../core/i18n/useTranslation";

export function CreateBusinessPage() {
  const { isAuthenticated, isReady, switchBusiness } = useAuth();
  const navigate = useNavigate();
  const { language } = useTranslation();

  const [businessName, setBusinessName] = useState("");
  const [country, setCountry] = useState(() => companyConfigStore.get().country);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedCountry = AVAILABLE_COUNTRIES.find((c) => c.code === country);

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    navigate("/login", { replace: true });
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!businessName.trim() || !country) {
      setError("Completa el nombre del negocio y selecciona un país.");
      return;
    }

    setLoading(true);

    try {
      const userId = (useAuth() as unknown as { user?: { id?: string } }).user?.id;
      if (!userId) {
        throw new Error("No se pudo identificar el usuario autenticado.");
      }

      const session = await createAdditionalBusiness(userId, {
        businessName: businessName.trim(),
        ownerName: "",
        country
      });

      await switchBusiness(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo crear el negocio.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <VimdyBackground>
      <div className="min-h-[100dvh] flex flex-col">
        <header className="relative z-20 flex items-center justify-between px-5 py-4 sm:px-8 lg:px-10 shrink-0">
          <VimdyLogo size={32} />
          <button
            onClick={() => navigate(-1)}
            className="text-xs sm:text-sm text-slate-400 hover:text-white transition-colors"
          >
            Volver
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
          <div className="w-full max-w-sm">
            <VimdyCard className="p-5 sm:p-6 lg:p-8">
              <div className="mb-5 sm:mb-6">
                <h1 className="text-lg sm:text-xl font-bold text-white mb-1">
                  Crear nuevo negocio
                </h1>
                <p className="text-[11px] sm:text-xs text-slate-500">
                  Usa la misma cuenta para administrar varios negocios.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:gap-4">
                <div className="flex flex-col gap-1">
                  <label htmlFor="businessName" className="text-xs sm:text-sm text-slate-300">
                    Nombre del negocio
                  </label>
                  <input
                    id="businessName"
                    type="text"
                    autoComplete="organization"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    disabled={!isReady || loading}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 sm:px-4 sm:py-2.5 text-white text-sm placeholder-slate-500 outline-none transition-colors focus:border-cyan-400 disabled:opacity-50"
                    placeholder="Restaurante El Buen Sabor"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="country" className="text-xs sm:text-sm text-slate-300">
                    País
                  </label>
                  <select
                    id="country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value as CountryCode)}
                    disabled={!isReady || loading}
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
                      <span className="text-xs sm:text-sm text-slate-300 font-medium">
                        Configuración regional aplicada
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 ml-0">
                      <div>
                        <p className="text-[10px] sm:text-[11px] text-slate-500 uppercase tracking-wide">Moneda</p>
                        <p className="text-xs sm:text-sm text-white">{getCountryName(selectedCountry.currency, language)}</p>
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
                    </div>
                  </div>
                )}

                {(error) && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs sm:text-sm text-red-300">
                    {error}
                  </div>
                )}

                <VimdyButton
                  type="submit"
                  disabled={!isReady || loading}
                  size="sm"
                  className="sm:size-md"
                >
                  {!isReady ? "Preparando..." : loading ? "Creando..." : "Crear negocio →"}
                </VimdyButton>
              </form>
            </VimdyCard>
          </div>
        </main>
      </div>
    </VimdyBackground>
  );
}
