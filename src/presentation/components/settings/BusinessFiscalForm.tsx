import React, { useEffect, useId, useState } from "react";
import { Building2 } from "lucide-react";

import {
  EMPTY_BUSINESS_FISCAL_IDENTITY,
  type BusinessFiscalIdentity
} from "../../../core/invoicing/types/fiscal.types";
import {
  computeNitVerificationDigit,
  normalizeFiscalIdentity,
  prepareFiscalIdentity,
  validateFiscalIdentity,
  type FiscalIdentityErrors
} from "../../../core/invoicing/fiscalValidation";
import {
  fetchBusinessFiscalIdentity,
  saveBusinessFiscalIdentity
} from "../../../infrastructure/supabase/businessFiscalRepository";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { toast } from "../../../core/store/toastStore";
import { VimdyButton } from "../ui/VimdyButton";
import { Field, SectionCard, inputClass, inputErrorClass } from "./settingsPrimitives";

/** Datos del perfil del negocio que sirven para sugerir los campos fiscales que aún están vacíos. */
export interface FiscalPrefill {
  nit?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
}

interface BusinessFiscalFormProps {
  /** Negocio activo. Sin negocio no se carga ni se guarda nada. */
  businessId: string | null;
  /** La pestaña está visible: la carga se hace la primera vez que se abre. */
  active: boolean;
  prefill?: FiscalPrefill;
  /** Inyectables para pruebas; por defecto usan Supabase. */
  load?: (businessId: string) => Promise<BusinessFiscalIdentity>;
  save?: (businessId: string, identity: BusinessFiscalIdentity) => Promise<BusinessFiscalIdentity>;
}

type Status = "idle" | "loading" | "ready" | "error";

/** Rellena SOLO los campos vacíos con lo que ya se sabe del negocio (nada se inventa). */
function applyPrefill(saved: BusinessFiscalIdentity, prefill?: FiscalPrefill): BusinessFiscalIdentity {
  if (!prefill) return saved;
  const next = { ...saved };
  if (!next.nit && prefill.nit) {
    const n = normalizeFiscalIdentity({ ...EMPTY_BUSINESS_FISCAL_IDENTITY, nit: prefill.nit });
    next.nit = n.nit;
    if (!next.verificationDigit) next.verificationDigit = n.verificationDigit;
  }
  if (!next.address && prefill.address) next.address = prefill.address.trim();
  if (!next.city && prefill.city) next.city = prefill.city.trim();
  if (!next.phone && prefill.phone) next.phone = prefill.phone.trim();
  if (!next.email && prefill.email) next.email = prefill.email.trim();
  return next;
}

const same = (a: BusinessFiscalIdentity, b: BusinessFiscalIdentity) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Formulario "Datos fiscales del negocio" (Ajustes > Facturación).
 *
 * Guarda SOLO las columnas fiscales de `businesses` (ver businessFiscalRepository),
 * con su propio botón: no depende del borrador del resto de Ajustes ni puede
 * tocar el interruptor/proveedor de facturación.
 */
export function BusinessFiscalForm({
  businessId,
  active,
  prefill,
  load = fetchBusinessFiscalIdentity,
  save = saveBusinessFiscalIdentity
}: BusinessFiscalFormProps) {
  const uid = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<BusinessFiscalIdentity>(EMPTY_BUSINESS_FISCAL_IDENTITY);
  const [form, setForm] = useState<BusinessFiscalIdentity>(EMPTY_BUSINESS_FISCAL_IDENTITY);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active || !businessId) return;
    if (status === "ready" || status === "loading") return;
    let cancelled = false;
    setStatus("loading");
    setLoadError(null);
    load(businessId)
      .then((identity) => {
        if (cancelled) return;
        setSaved(identity);
        setForm(applyPrefill(identity, prefill));
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(translateBusinessError(e, "No se pudieron leer los datos fiscales."));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // `prefill` y `status` se leen a propósito solo al (re)intentar la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, businessId, attempt]);

  const errors: FiscalIdentityErrors = validateFiscalIdentity(normalizeFiscalIdentity(form));
  const dirty = !same(normalizeFiscalIdentity(form), saved);
  const visibleErrors: FiscalIdentityErrors = showErrors ? errors : {};

  function set<K extends keyof BusinessFiscalIdentity>(key: K, value: BusinessFiscalIdentity[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** Al salir del NIT: separa "…-7" y, si el DV está vacío, lo calcula. */
  function handleNitBlur() {
    const n = normalizeFiscalIdentity(form);
    const suggested = form.verificationDigit.trim() === "" ? computeNitVerificationDigit(n.nit) : null;
    setForm((f) => ({
      ...f,
      nit: n.nit,
      verificationDigit: n.verificationDigit !== "" ? n.verificationDigit : suggested ?? ""
    }));
  }

  async function handleSave() {
    if (!businessId || saving) return;
    setShowErrors(true);
    const prepared = prepareFiscalIdentity(form);
    if (Object.keys(prepared.errors).length > 0) {
      toast.error("Revisa los campos marcados en rojo.");
      return;
    }
    setSaving(true);
    try {
      const stored = await save(businessId, prepared.identity);
      setSaved(stored);
      setForm(stored);
      setShowErrors(false);
      toast.success("Datos fiscales guardados.");
    } catch (e: unknown) {
      toast.error(translateBusinessError(e, "No se pudieron guardar los datos fiscales."));
    } finally {
      setSaving(false);
    }
  }

  const id = (name: string) => `${uid}-${name}`;
  const cls = (key: keyof BusinessFiscalIdentity) => (visibleErrors[key] ? inputErrorClass : inputClass);
  const err = (key: keyof BusinessFiscalIdentity) =>
    visibleErrors[key] ? (
      <p id={id(`${key}-err`)} className="mt-1 text-xs text-red-400">
        {visibleErrors[key]}
      </p>
    ) : null;
  const aria = (key: keyof BusinessFiscalIdentity) => ({
    "aria-invalid": visibleErrors[key] ? true : undefined,
    "aria-describedby": visibleErrors[key] ? id(`${key}-err`) : undefined
  });

  return (
    <SectionCard
      icon={<Building2 size={18} className="text-orange-400" />}
      title="Datos fiscales del negocio"
      description="Identidad del emisor de tus facturas, tal como aparece en tu RUT."
    >
      {!businessId ? (
        <p className="text-sm text-slate-400">Inicia sesión en un negocio para editar sus datos fiscales.</p>
      ) : status === "loading" || status === "idle" ? (
        <p className="text-sm text-slate-400" role="status">
          Cargando datos fiscales…
        </p>
      ) : status === "error" ? (
        <div className="space-y-3">
          <p className="text-sm text-red-400" role="alert">
            {loadError}
          </p>
          <VimdyButton
            variant="secondary"
            size="sm"
            onClick={() => {
              setStatus("idle");
              setAttempt((n) => n + 1);
            }}
          >
            Reintentar
          </VimdyButton>
        </div>
      ) : (
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          <p className="text-xs text-slate-400">
            Si facturas con Factus, la identidad del emisor sale de tu cuenta en Factus: estos datos deben coincidir
            con los de allá. El prefijo sí se usa para elegir el rango de numeración de Factus.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label="NIT o cédula (sin dígito de verificación)" htmlFor={id("nit")}>
                <input
                  id={id("nit")}
                  className={cls("nit")}
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.nit}
                  onChange={(e) => set("nit", e.target.value)}
                  onBlur={handleNitBlur}
                  {...aria("nit")}
                />
              </Field>
              {err("nit")}
            </div>
            <div>
              <Field label="Dígito de verificación" htmlFor={id("verificationDigit")}>
                <input
                  id={id("verificationDigit")}
                  className={cls("verificationDigit")}
                  inputMode="numeric"
                  maxLength={1}
                  autoComplete="off"
                  value={form.verificationDigit}
                  onChange={(e) => set("verificationDigit", e.target.value)}
                  {...aria("verificationDigit")}
                />
              </Field>
              {err("verificationDigit")}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label="Razón social" htmlFor={id("legalName")}>
                <input
                  id={id("legalName")}
                  className={cls("legalName")}
                  autoComplete="organization"
                  value={form.legalName}
                  onChange={(e) => set("legalName", e.target.value)}
                  {...aria("legalName")}
                />
              </Field>
              {err("legalName")}
            </div>
            <div>
              <Field label="Tipo de persona" htmlFor={id("organizationType")}>
                <select
                  id={id("organizationType")}
                  className={cls("organizationType")}
                  value={form.organizationType}
                  onChange={(e) => set("organizationType", e.target.value as BusinessFiscalIdentity["organizationType"])}
                  {...aria("organizationType")}
                >
                  <option value="">Elige…</option>
                  <option value="PERSONA_JURIDICA">Persona jurídica</option>
                  <option value="PERSONA_NATURAL">Persona natural</option>
                </select>
              </Field>
              {err("organizationType")}
            </div>
          </div>

          <div>
            <Field label="Dirección fiscal" htmlFor={id("address")}>
              <input
                id={id("address")}
                className={cls("address")}
                autoComplete="street-address"
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                {...aria("address")}
              />
            </Field>
            {err("address")}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Field label="Ciudad o municipio" htmlFor={id("city")}>
                <input
                  id={id("city")}
                  className={cls("city")}
                  value={form.city}
                  onChange={(e) => set("city", e.target.value)}
                  {...aria("city")}
                />
              </Field>
              {err("city")}
            </div>
            <div>
              <Field label="Departamento" htmlFor={id("department")}>
                <input
                  id={id("department")}
                  className={cls("department")}
                  value={form.department}
                  onChange={(e) => set("department", e.target.value)}
                  {...aria("department")}
                />
              </Field>
              {err("department")}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Field label="Correo para facturación" htmlFor={id("email")}>
                <input
                  id={id("email")}
                  type="email"
                  className={cls("email")}
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  {...aria("email")}
                />
              </Field>
              {err("email")}
            </div>
            <div>
              <Field label="Teléfono (opcional)" htmlFor={id("phone")}>
                <input
                  id={id("phone")}
                  type="tel"
                  className={cls("phone")}
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  {...aria("phone")}
                />
              </Field>
              {err("phone")}
            </div>
          </div>

          <div className="sm:w-1/2">
            <Field label="Prefijo de numeración (opcional)" htmlFor={id("invoicePrefix")}>
              <input
                id={id("invoicePrefix")}
                className={cls("invoicePrefix")}
                autoComplete="off"
                maxLength={10}
                value={form.invoicePrefix}
                onChange={(e) => set("invoicePrefix", e.target.value)}
                {...aria("invoicePrefix")}
              />
            </Field>
            {err("invoicePrefix")}
            <p className="mt-1 text-xs text-slate-500">
              Debe ser el prefijo de un rango activo en Factus (por ejemplo SETP). Déjalo vacío si solo tienes un rango.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            {dirty && <span className="text-xs text-amber-400">Cambios sin guardar</span>}
            <VimdyButton type="submit" variant="secondary" size="sm" loading={saving} disabled={!dirty}>
              Guardar datos fiscales
            </VimdyButton>
          </div>
        </form>
      )}
    </SectionCard>
  );
}