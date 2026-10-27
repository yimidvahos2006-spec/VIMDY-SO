import { useRef, useState, type FormEvent } from "react";
import { Store, FileText, MapPin, Loader2 } from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";
import { VimdySelect } from "../ui/VimdySelect";
import { businessStore } from "../../../core/store/businessStore";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import {
  BUSINESS_NAME_MAX,
  CITY_MAX,
  COLOMBIA_CITY_SHORTCUTS,
  DEFAULT_CURRENCY,
  getOnboardingCurrencyOptions,
  isOnboardingCurrency,
  isPlaceholderBusinessName,
  normalizeTaxId,
  sanitizeTaxIdTyping,
  validateBusinessName,
  validateTaxId
} from "../../../core/config/businessIdentity";
import { saveBusinessIdentity } from "../../../infrastructure/supabase/businessIdentity";
import { onboardingStepLabel } from "./onboardingSteps";
import { useStepDraft } from "./useStepDraft";

interface BusinessIdentityStepProps {
  businessId: string;
  /** Se llama en cuanto lo local quedó guardado (no espera a Supabase). */
  onSaved: () => void;
}

interface IdentityDraft {
  name: string;
  taxId: string;
  currency: string;
  city: string;
}

type FieldKey = "name" | "taxId";

function sanitizeIdentityDraft(raw: unknown): IdentityDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<Record<keyof IdentityDraft, unknown>>;
  return {
    name: typeof value.name === "string" ? value.name.slice(0, BUSINESS_NAME_MAX) : "",
    taxId: typeof value.taxId === "string" ? sanitizeTaxIdTyping(value.taxId) : "",
    currency: isOnboardingCurrency(value.currency) ? value.currency : DEFAULT_CURRENCY,
    city: typeof value.city === "string" ? value.city.slice(0, CITY_MAX) : ""
  };
}

/** Valores iniciales: lo que ya sabe la app del negocio (nombre del registro, etc.). */
function initialIdentity(): IdentityDraft {
  const business = businessStore.get();
  const config = companyConfigStore.get();
  return {
    name: isPlaceholderBusinessName(business.name) ? "" : business.name,
    taxId: business.nit ?? "",
    currency: isOnboardingCurrency(config.currency) ? config.currency : DEFAULT_CURRENCY,
    city: business.city ?? ""
  };
}

/**
 * PASO 2 del asistente — "Tu negocio".
 *
 * Pide lo que sale en los tiquetes de caja: nombre del establecimiento,
 * NIT o cédula, moneda y ciudad. Nombre y NIT/cédula son obligatorios.
 *
 * Local-first: al continuar, los datos quedan disponibles al instante en el
 * dispositivo y el paso avanza sin esperar a la red; la subida a Supabase
 * ocurre en segundo plano y se reintenta sola (ver infrastructure/supabase/businessIdentity.ts).
 * Mientras escribe, el borrador también se guarda al instante (useStepDraft).
 */
export function BusinessIdentityStep({ businessId, onSaved }: BusinessIdentityStepProps) {
  const [draft, setDraft] = useStepDraft<IdentityDraft>(
    "business_identity",
    initialIdentity(),
    sanitizeIdentityDraft
  );
  const [touched, setTouched] = useState<Record<FieldKey, boolean>>({ name: false, taxId: false });
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveInFlight = useRef(false);

  const currencyOptions = getOnboardingCurrencyOptions();
  const showCityShortcuts = companyConfigStore.get().country === "CO";

  const nameError = validateBusinessName(draft.name);
  const taxIdError = validateTaxId(draft.taxId);
  const canContinue = !nameError && !taxIdError;

  const showNameError = (touched.name || submitted) && nameError ? nameError : undefined;
  const showTaxIdError = (touched.taxId || submitted) && taxIdError ? taxIdError : undefined;

  function update(patch: Partial<IdentityDraft>) {
    if (error) setError(null);
    setDraft((previous) => ({ ...previous, ...patch }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || saveInFlight.current) return;

    setSubmitted(true);
    if (!canContinue) return;

    saveInFlight.current = true;
    setSaving(true);
    setError(null);

    try {
      // Local primero: valida, guarda en el dispositivo y lanza la subida en segundo plano.
      const identity = saveBusinessIdentity(businessId, draft);
      // Deja el borrador con la forma ya limpia (por si el usuario vuelve con "Atrás").
      setDraft({
        name: identity.name,
        taxId: identity.taxId,
        currency: identity.currency,
        city: identity.city
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar los datos del negocio.");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">
          {onboardingStepLabel("business_identity")}
        </p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">Cuéntanos sobre tu negocio</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Estos datos salen en tus tiquetes de caja. Puedes cambiarlos después en Configuración.
        </p>
      </div>

      <VimdyCard padding="lg" className="w-full max-w-xl mx-auto">
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
          <VimdyInput
            type="text"
            autoComplete="off"
            autoFocus
            label="Nombre del establecimiento *"
            placeholder="Ej. Asados Doña Inés, Bar El Túnel"
            icon={<Store size={18} strokeWidth={1.8} />}
            maxLength={BUSINESS_NAME_MAX}
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            error={showNameError}
            disabled={saving}
          />

          <VimdyInput
            type="text"
            inputMode="text"
            autoComplete="off"
            label="NIT o Cédula *"
            placeholder="Ej. 900.123.456-7"
            icon={<FileText size={18} strokeWidth={1.8} />}
            hint="Es el que aparece en tus tiquetes. Si es NIT, puedes incluir el número después del guion."
            value={draft.taxId}
            onChange={(e) => update({ taxId: sanitizeTaxIdTyping(e.target.value) })}
            onBlur={() => {
              setTouched((t) => ({ ...t, taxId: true }));
              // Al salir del campo se acomoda: "900.123.456 - 7" → "900123456-7".
              if (draft.taxId) update({ taxId: normalizeTaxId(draft.taxId) });
            }}
            error={showTaxIdError}
            disabled={saving}
          />

          <VimdySelect
            label="Moneda"
            hint="Con esta moneda se calculan tus ventas y tu caja."
            value={draft.currency}
            onChange={(e) => update({ currency: e.target.value })}
            disabled={saving}
          >
            {currencyOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </VimdySelect>

          <div className="flex flex-col gap-2">
            <VimdyInput
              type="text"
              autoComplete="off"
              label="Ciudad / Ubicación"
              placeholder="Ej. Medellín"
              icon={<MapPin size={18} strokeWidth={1.8} />}
              maxLength={CITY_MAX}
              value={draft.city}
              onChange={(e) => update({ city: e.target.value })}
              disabled={saving}
            />

            {showCityShortcuts && (
              <div className="flex flex-wrap gap-2" aria-label="Ciudades frecuentes">
                {COLOMBIA_CITY_SHORTCUTS.map((city) => {
                  const active = draft.city.trim().toLowerCase() === city.toLowerCase();
                  return (
                    <button
                      key={city}
                      type="button"
                      onClick={() => update({ city })}
                      disabled={saving}
                      aria-pressed={active}
                      className={`
                        rounded-full border px-3 py-1 text-vimdy-micro normal-case transition-colors duration-vimdy-fast
                        disabled:cursor-not-allowed disabled:opacity-50
                        ${
                          active
                            ? "border-vimdy-accent bg-vimdy-accent/10 text-vimdy-text"
                            : "border-vimdy-border bg-vimdy-surface text-vimdy-text-secondary hover:border-vimdy-accent/60 hover:text-vimdy-text"
                        }
                      `}
                    >
                      {city}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger"
            >
              <span className="mt-0.5 shrink-0">⚠</span>
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col items-center gap-2 pt-2">
            <VimdyButton type="submit" size="lg" disabled={saving || !canContinue} className="min-w-[200px]">
              {saving ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={18} className="animate-spin" />
                  Guardando...
                </span>
              ) : (
                "Continuar"
              )}
            </VimdyButton>

            {!canContinue && (
              <p className="text-vimdy-micro normal-case text-vimdy-text-tertiary">
                Completa el nombre y el NIT o cédula para continuar.
              </p>
            )}
          </div>
        </form>
      </VimdyCard>
    </div>
  );
}