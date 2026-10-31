import React, { useMemo, useState } from "react";
import { BadgeCheck, Building2, Check, Lock, MapPin, Phone, Save } from "lucide-react";

import { Business } from "../../../core/store/businessStore";
import { toast } from "../../../core/store/toastStore";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { AVAILABLE_COUNTRIES, getCountryName } from "../../../core/config/globalization";
import { SubscriptionCountdownBadge } from "../subscription/SubscriptionCountdownBadge";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyCard } from "../ui/VimdyCard";
import { VimdyInput } from "../ui/VimdyInput";
import { VimdySelect } from "../ui/VimdySelect";

/**
 * BusinessProfileTab — tarjeta "Datos del negocio" de Configuración > Mi negocio.
 * ---------------------------------------------------------------------------
 * Es un componente CONTROLADO por SettingsDashboard: el dashboard es dueño del
 * borrador (`draft`) y de la llamada real a Supabase (`persistAll` de
 * useSettings → saveBusinessSettings). Se hace así a propósito: useSettings
 * guarda su estado en el hook, y si este componente abriera su propia
 * instancia, el dashboard quedaría con datos viejos y un "Guardar todo"
 * posterior podría pisar lo que acaba de guardarse.
 *
 * Qué hace este componente:
 *  - Pinta los 9 campos en dos columnas, con el sistema de diseño VIMDY.
 *  - Valida en el cliente (nombre, correo, teléfonos, WhatsApp, país).
 *  - Llama a `onSave()` y, según el resultado, dispara el toast de éxito o error.
 *
 * Seguridad (RLS): el UPDATE sobre `businesses` solo lo aceptan un ADMIN del
 * negocio activo con suscripción vigente. Si Supabase responde con 0 filas,
 * saveBusinessSettings lanza un error y aquí se muestra como toast de error;
 * nunca se anuncia "guardado" si la base no lo aceptó.
 */

/** Resultado de intentar guardar. `message` ya viene listo para mostrar al usuario. */
export type BusinessSaveResult = { ok: true } | { ok: false; message: string };

type FieldKey =
  | "name"
  | "nit"
  | "owner"
  | "phone"
  | "email"
  | "whatsapp"
  | "address"
  | "city"
  | "country";

type FieldErrors = Partial<Record<FieldKey, string>>;

/** Orden visual de los campos: se usa para llevar el foco al primer error. */
const FIELD_ORDER: FieldKey[] = [
  "name",
  "nit",
  "owner",
  "phone",
  "email",
  "whatsapp",
  "address",
  "city",
  "country"
];

const FIELD_IDS: Record<FieldKey, string> = {
  name: "business-profile-name",
  nit: "business-profile-nit",
  owner: "business-profile-owner",
  phone: "business-profile-phone",
  email: "business-profile-email",
  whatsapp: "business-profile-whatsapp",
  address: "business-profile-address",
  city: "business-profile-city",
  country: "business-profile-country"
};

/**
 * Límites de longitud: coinciden con los que aplica el servidor al guardar
 * (infrastructure/supabase/businessSettings.ts), para que nada se recorte
 * en silencio.
 */
const MAX_LENGTH = {
  name: 120,
  nit: 40,
  owner: 120,
  phone: 40,
  email: 120,
  whatsapp: 40,
  address: 200,
  city: 80
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function validateBusinessProfile(draft: Business, whatsappRequired: boolean): FieldErrors {
  const errors: FieldErrors = {};

  if (!draft.name.trim()) {
    errors.name = "Escribe el nombre de tu negocio.";
  }

  const phone = (draft.phone ?? "").trim();
  if (phone && !isValidPhone(phone)) {
    errors.phone = "Revisa el teléfono: debe tener entre 7 y 15 dígitos.";
  }

  const email = (draft.email ?? "").trim();
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.email = "Escribe un correo válido, por ejemplo nombre@dominio.com.";
  }

  const whatsapp = (draft.whatsappOrders ?? "").trim();
  if (!whatsapp && whatsappRequired) {
    errors.whatsapp =
      "Falta el número: es donde te van a escribir los domicilios que escaneen el QR del ticket.";
  } else if (whatsapp && !isValidPhone(whatsapp)) {
    errors.whatsapp = "Revisa el número: debe tener entre 7 y 15 dígitos.";
  }

  if (!draft.country) {
    errors.country = "Selecciona el país del negocio.";
  }

  return errors;
}

function FormSection({
  icon,
  title,
  withDivider = true,
  children
}: {
  icon: React.ReactNode;
  title: string;
  withDivider?: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      className={`m-0 min-w-0 border-0 p-0 ${
        withDivider ? "border-t border-vimdy-border-subtle pt-vimdy-lg" : ""
      }`}
    >
      <legend className="mb-vimdy-md flex items-center gap-2 p-0 text-vimdy-small font-semibold text-vimdy-text">
        <span className="text-vimdy-text-tertiary">{icon}</span>
        {title}
      </legend>
      <div className="grid grid-cols-1 gap-x-vimdy-lg gap-y-vimdy-md md:grid-cols-2">{children}</div>
    </fieldset>
  );
}

interface BusinessProfileTabProps {
  /** Borrador editable que vive en SettingsDashboard. */
  draft: Business;
  onDraftChange: (next: Business) => void;
  /**
   * Cambio de país: el dashboard autocompleta moneda, idioma, zona horaria e
   * IVA y mantiene sincronizados los dos lugares donde vive el país.
   */
  onCountryChange: (countryCode: string) => void;
  /** true cuando el negocio vende por domicilio (pestaña Operación). */
  whatsappRequired: boolean;
  /** true si hay cambios pendientes (de este formulario o de otras tarjetas). */
  hasUnsavedChanges: boolean;
  saving: boolean;
  /** Guarda en Supabase (negocio activo + RLS). Nunca debe lanzar: devuelve el resultado. */
  onSave: () => Promise<BusinessSaveResult>;
}

export function BusinessProfileTab({
  draft,
  onDraftChange,
  onCountryChange,
  whatsappRequired,
  hasUnsavedChanges,
  saving,
  onSave
}: BusinessProfileTabProps) {
  const { t, language } = useTranslation();
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});

  const errors = useMemo(
    () => validateBusinessProfile(draft, whatsappRequired),
    [draft, whatsappRequired]
  );

  function visibleError(field: FieldKey): string | undefined {
    // El WhatsApp obligatorio es un bloqueo ya conocido: se muestra sin esperar al clic.
    if (field === "whatsapp" && whatsappRequired && !(draft.whatsappOrders ?? "").trim()) {
      return errors.whatsapp;
    }
    return submitted || touched[field] ? errors[field] : undefined;
  }

  function markTouched(field: FieldKey) {
    setTouched((previous) => (previous[field] ? previous : { ...previous, [field]: true }));
  }

  function update<K extends keyof Business>(key: K, value: Business[K]) {
    onDraftChange({ ...draft, [key]: value });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSubmitted(true);

    const firstInvalid = FIELD_ORDER.find((field) => errors[field]);
    if (firstInvalid) {
      toast.warning("Revisa los campos marcados antes de guardar.");
      document.getElementById(FIELD_IDS[firstInvalid])?.focus();
      return;
    }

    if (!hasUnsavedChanges) {
      toast.info("No hay cambios por guardar.");
      return;
    }

    try {
      const result = await onSave();
      if (result.ok) {
        setSubmitted(false);
        setTouched({});
        toast.success("Datos del negocio guardados correctamente.");
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error("No se pudieron guardar los datos del negocio. Intenta de nuevo.");
    }
  }

  return (
    <section aria-labelledby="business-profile-title" className="lg:col-span-2">
      <VimdyCard padding="md">
        <form onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-vimdy-md sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-vimdy-md">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-vimdy-md border border-vimdy-border bg-vimdy-background">
                <Building2 size={20} className="text-vimdy-blue" />
              </div>
              <div className="min-w-0">
                <h3 id="business-profile-title" className="text-vimdy-h3 text-vimdy-text">
                  {t("settings.business.title")}
                </h3>
                <p className="text-vimdy-small text-vimdy-text-secondary">
                  {t("settings.business.description")}
                </p>
              </div>
            </div>
            <SubscriptionCountdownBadge compact />
          </div>

          <div className="mt-vimdy-lg space-y-vimdy-lg">
            <FormSection
              icon={<BadgeCheck size={16} />}
              title="Identidad del negocio"
              withDivider={false}
            >
              <div className="md:col-span-2">
                <VimdyInput
                  id={FIELD_IDS.name}
                  label="Nombre del negocio"
                  placeholder="Ej: Café Yimid"
                  autoComplete="organization"
                  maxLength={MAX_LENGTH.name}
                  value={draft.name}
                  onChange={(e) => update("name", e.target.value)}
                  onBlur={() => markTouched("name")}
                  error={visibleError("name")}
                />
              </div>
              <VimdyInput
                id={FIELD_IDS.nit}
                label="NIT"
                placeholder="Ej: 900123456-7"
                autoComplete="off"
                maxLength={MAX_LENGTH.nit}
                value={draft.nit}
                onChange={(e) => update("nit", e.target.value)}
                onBlur={() => markTouched("nit")}
                error={visibleError("nit")}
              />
              <VimdyInput
                id={FIELD_IDS.owner}
                label="Propietario"
                placeholder="Nombre de quien dirige el negocio"
                autoComplete="name"
                maxLength={MAX_LENGTH.owner}
                value={draft.owner}
                onChange={(e) => update("owner", e.target.value)}
                onBlur={() => markTouched("owner")}
                error={visibleError("owner")}
              />
            </FormSection>

            <FormSection icon={<Phone size={16} />} title="Contacto">
              <VimdyInput
                id={FIELD_IDS.phone}
                label="Teléfono"
                type="tel"
                inputMode="tel"
                placeholder="Ej: +57 601 234 5678"
                autoComplete="tel"
                maxLength={MAX_LENGTH.phone}
                value={draft.phone}
                onChange={(e) => update("phone", e.target.value)}
                onBlur={() => markTouched("phone")}
                error={visibleError("phone")}
              />
              <VimdyInput
                id={FIELD_IDS.email}
                label="Correo"
                type="email"
                inputMode="email"
                placeholder="Ej: hola@minegocio.com"
                autoComplete="email"
                maxLength={MAX_LENGTH.email}
                value={draft.email}
                onChange={(e) => update("email", e.target.value)}
                onBlur={() => markTouched("email")}
                error={visibleError("email")}
              />
              <div className="md:col-span-2">
                <VimdyInput
                  id={FIELD_IDS.whatsapp}
                  label={
                    whatsappRequired
                      ? "WhatsApp de pedidos (obligatorio: vendes por domicilio)"
                      : "WhatsApp de pedidos (opcional)"
                  }
                  type="tel"
                  inputMode="tel"
                  placeholder="Ej: +57 300 1234567"
                  autoComplete="off"
                  maxLength={MAX_LENGTH.whatsapp}
                  value={draft.whatsappOrders ?? ""}
                  onChange={(e) => update("whatsappOrders", e.target.value)}
                  onBlur={() => markTouched("whatsapp")}
                  error={visibleError("whatsapp")}
                  hint="Número donde te llegan los pedidos por WhatsApp. Sale como QR en el ticket si tu plantilla lo incluye."
                />
              </div>
            </FormSection>

            <FormSection icon={<MapPin size={16} />} title="Ubicación">
              <div className="md:col-span-2">
                <VimdyInput
                  id={FIELD_IDS.address}
                  label="Dirección"
                  placeholder="Ej: Calle 10 # 5-20, local 3"
                  autoComplete="street-address"
                  maxLength={MAX_LENGTH.address}
                  value={draft.address}
                  onChange={(e) => update("address", e.target.value)}
                  onBlur={() => markTouched("address")}
                  error={visibleError("address")}
                />
              </div>
              <VimdyInput
                id={FIELD_IDS.city}
                label="Ciudad"
                placeholder="Ej: Bogotá"
                autoComplete="address-level2"
                maxLength={MAX_LENGTH.city}
                value={draft.city}
                onChange={(e) => update("city", e.target.value)}
                onBlur={() => markTouched("city")}
                error={visibleError("city")}
              />
              <VimdySelect
                id={FIELD_IDS.country}
                label="País"
                value={draft.country}
                onChange={(e) => onCountryChange(e.target.value)}
                onBlur={() => markTouched("country")}
                error={visibleError("country")}
              >
                <option value="">Selecciona un país</option>
                {AVAILABLE_COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {getCountryName(country.code, language)}
                  </option>
                ))}
              </VimdySelect>
            </FormSection>
          </div>

          <div className="mt-vimdy-lg flex flex-col gap-vimdy-md border-t border-vimdy-border-subtle pt-vimdy-lg sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1" aria-live="polite">
              {hasUnsavedChanges ? (
                <p className="flex items-center gap-2 text-vimdy-small text-vimdy-warning">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-vimdy-warning" />
                  Tienes cambios sin guardar
                </p>
              ) : (
                <p className="flex items-center gap-2 text-vimdy-small text-vimdy-text-secondary">
                  <Check size={14} className="text-vimdy-success" />
                  Todo está guardado
                </p>
              )}
              <p className="flex items-center gap-2 text-vimdy-micro text-vimdy-text-tertiary">
                <Lock size={12} />
                Solo el administrador puede guardar estos datos.
              </p>
            </div>

            <VimdyButton
              type="submit"
              variant="primary"
              size="md"
              loading={saving}
              icon={<Save size={16} />}
              className="w-full sm:w-auto"
            >
              {t("settings.save.business")}
            </VimdyButton>
          </div>
        </form>
      </VimdyCard>
    </section>
  );
}