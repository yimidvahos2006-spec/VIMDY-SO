import React, { useState } from "react";
import {
  Building2,
  Percent,
  Sliders,
  Users,
  UserCircle2,
  Check,
  UserPlus,
  X,
  ShieldCheck,
  Ban,
  RotateCcw,
  DownloadCloud,
  AlertTriangle,
  Globe2
} from "lucide-react";

import { WaitersSettingsSection } from "./WaitersSettingsSection";
import { PrintSettingsSection } from "./PrintSettingsSection";

import { useSettings } from "../../../core/store/useSettings";
import { useAuth } from "../../context/AuthContext";
import { Business } from "../../../core/store/businessStore";
import { CompanyConfig } from "../../../core/store/companyConfigStore";
import { UserStatus } from "../../../core/entities/Entities";
import { downloadBackup } from "../../../infrastructure/supabase/backupService";
import { useTranslation } from "../../../core/i18n/useTranslation";
import {
  COUNTRIES,
  CURRENCIES,
  LANGUAGES,
  TIMEZONES,
  getCountryDefaults,
  getCountryName,
  getCurrencyName
} from "../../../core/config/globalization";
import { SubscriptionSettingsSection } from "../subscription/SubscriptionSettingsSection";
import { SubscriptionCountdownBadge } from "../subscription/SubscriptionCountdownBadge";
import { VimdyButton } from "../ui/VimdyButton";

function SectionCard({
  icon,
  title,
  description,
  children
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-vimdy-surface flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div>
          <h3 className="text-white font-bold">{title}</h3>
          {description && <p className="text-slate-400 text-xs">{description}</p>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-slate-400">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const inputClass =
  "w-full h-10 rounded-xl bg-vimdy-surface border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500";

function Toggle({
  label,
  description,
  checked,
  onChange
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 py-2.5 text-left"
    >
      <div className="min-w-0">
        <p className="text-white text-sm font-medium">{label}</p>
        {description && <p className="text-slate-500 text-xs mt-0.5">{description}</p>}
      </div>
      <span
        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${
          checked ? "bg-cyan-500" : "bg-slate-700"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </span>
    </button>
  );
}

function SavedToast({ show, label = "Guardado" }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-400">
      <Check size={13} />
      {label}
    </span>
  );
}

export function SettingsDashboard() {
  const { t, language } = useTranslation();
  const { user, can } = useAuth();
  const {
    business,
    config,
    users,
    roles,
    loading,
    error,
    saveBusiness,
    saveConfig,
    createUser,
    setUserStatus,
    roleName
  } = useSettings();

  const [businessDraft, setBusinessDraft] = useState<Business>(business);
  const [businessSaved, setBusinessSaved] = useState(false);
  const [configDraft, setConfigDraft] = useState<CompanyConfig>(config);
  const [configSaved, setConfigSaved] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupDone, setBackupDone] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  // Sincroniza los borradores cuando los datos reales terminan de cargar.
  React.useEffect(() => setBusinessDraft(business), [business]);
  React.useEffect(() => setConfigDraft(config), [config]);

  // El WhatsApp de pedidos solo es obligatorio si el negocio activó
  // Domicilios (toggle en la tarjeta "Operación / módulos" de abajo). Se
  // valida contra configDraft (no config) para que reaccione al toque,
  // sin esperar a que se guarde el toggle primero.
  const whatsappRequired = configDraft.enableDelivery;
  const whatsappMissing = whatsappRequired && !(businessDraft.whatsappOrders ?? "").trim();

  function handleSaveBusiness() {
    if (whatsappMissing) return;
    saveBusiness(businessDraft);
    setBusinessSaved(true);
    setTimeout(() => setBusinessSaved(false), 2000);
  }

  function handleSaveConfig() {
    saveConfig(configDraft);
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 2000);
  }

  /**
   * Al elegir un país se autocompletan moneda + idioma + zona horaria con
   * los valores por defecto de ese país (ver src/core/config/globalization.ts).
   * El negocio puede sobreescribir cualquiera de los tres campos después,
   * por si su caso es una excepción (ej. cobrar en USD estando en Colombia).
   */
  function handleCountryChange(countryCode: string) {
    const defaults = getCountryDefaults(countryCode);
    setConfigDraft({
      ...configDraft,
      country: countryCode as CompanyConfig["country"],
      ...(defaults
        ? {
            currency: defaults.currency,
            language: defaults.language,
            timezone: defaults.timezone,
            tax: defaults.taxRate
          }
        : {})
    });
  }

  async function handleDownloadBackup() {
    setBackingUp(true);
    setBackupError(null);
    try {
      await downloadBackup();
      setBackupDone(true);
      setTimeout(() => setBackupDone(false), 3000);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : "No se pudo generar el backup.");
    } finally {
      setBackingUp(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-60 text-slate-400">
        Cargando configuración...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">{t("settings.title")}</h1>
        <p className="text-slate-400 text-sm mt-1">{t("settings.subtitle")}</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-sm px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Datos del negocio */}
        <SectionCard
          icon={<Building2 size={18} className="text-cyan-400" />}
          title={t("settings.business.title")}
          description={t("settings.business.description")}
        >
          {/* VIMDY — FASE 7, PASO 3: contador de días restantes, también visible en Perfil del negocio. */}
          <div className="mb-4">
            <SubscriptionCountdownBadge compact />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Field label="Nombre del negocio">
                <input
                  className={inputClass}
                  value={businessDraft.name}
                  onChange={(e) => setBusinessDraft({ ...businessDraft, name: e.target.value })}
                />
              </Field>
            </div>
            <Field label="NIT">
              <input
                className={inputClass}
                value={businessDraft.nit}
                onChange={(e) => setBusinessDraft({ ...businessDraft, nit: e.target.value })}
              />
            </Field>
            <Field label="Propietario">
              <input
                className={inputClass}
                value={businessDraft.owner}
                onChange={(e) => setBusinessDraft({ ...businessDraft, owner: e.target.value })}
              />
            </Field>
            <Field label="Teléfono">
              <input
                className={inputClass}
                value={businessDraft.phone}
                onChange={(e) => setBusinessDraft({ ...businessDraft, phone: e.target.value })}
              />
            </Field>
            <Field label="Correo">
              <input
                className={inputClass}
                value={businessDraft.email}
                onChange={(e) => setBusinessDraft({ ...businessDraft, email: e.target.value })}
              />
            </Field>
            <div className="col-span-2">
              <Field label="Dirección">
                <input
                  className={inputClass}
                  value={businessDraft.address}
                  onChange={(e) => setBusinessDraft({ ...businessDraft, address: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Ciudad">
              <input
                className={inputClass}
                value={businessDraft.city}
                onChange={(e) => setBusinessDraft({ ...businessDraft, city: e.target.value })}
              />
            </Field>
            <Field label="País">
              <input
                className={inputClass}
                value={businessDraft.country}
                onChange={(e) => setBusinessDraft({ ...businessDraft, country: e.target.value })}
              />
            </Field>
            <div className="col-span-2">
              <Field
                label={
                  whatsappRequired
                    ? "WhatsApp de pedidos (obligatorio — tienes Domicilios activado)"
                    : "WhatsApp de pedidos (opcional)"
                }
              >
                <input
                  className={`${inputClass} ${whatsappMissing ? "border-red-500 focus:border-red-500" : ""}`}
                  placeholder="Ej: +57 300 1234567"
                  value={businessDraft.whatsappOrders ?? ""}
                  onChange={(e) => setBusinessDraft({ ...businessDraft, whatsappOrders: e.target.value })}
                />
              </Field>
              <p className={`text-xs mt-1 ${whatsappMissing ? "text-red-400" : "text-slate-500"}`}>
                {whatsappMissing
                  ? "Falta el número — es donde te van a escribir los domicilios que escaneen el QR del ticket."
                  : "Número real donde te llegan los pedidos. Es lo que codifica el QR del ticket (Configuración > Impresión)."}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4">
            <SavedToast show={businessSaved} label={t("settings.saved")} />
            <VimdyButton
              onClick={handleSaveBusiness}
              disabled={whatsappMissing}
              variant="primary"
              size="sm"
              className="ml-auto"
            >
              {t("settings.save.business")}
            </VimdyButton>
          </div>
        </SectionCard>

        {/* Suscripción — VIMDY FASE 7, PASO 8 */}
        <SubscriptionSettingsSection />

        {/* Globalización: país, idioma, moneda, zona horaria */}
        <SectionCard
          icon={<Globe2 size={18} className="text-cyan-400" />}
          title={t("settings.globalization.title")}
          description={t("settings.globalization.description")}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settings.field.country")}>
              <select
                className={inputClass}
                value={configDraft.country}
                onChange={(e) => handleCountryChange(e.target.value)}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {getCountryName(c.code, language)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("settings.field.language")}>
              <select
                className={inputClass}
                value={configDraft.language}
                onChange={(e) =>
                  setConfigDraft({ ...configDraft, language: e.target.value as CompanyConfig["language"] })
                }
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.nativeName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("settings.field.currency")}>
              <select
                className={inputClass}
                value={configDraft.currency}
                onChange={(e) =>
                  setConfigDraft({ ...configDraft, currency: e.target.value as CompanyConfig["currency"] })
                }
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {getCurrencyName(c.code, language)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("settings.field.timezone")}>
              <select
                className={inputClass}
                value={configDraft.timezone}
                onChange={(e) => setConfigDraft({ ...configDraft, timezone: e.target.value })}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="text-slate-500 text-xs mt-3">
            Al cambiar el país se autocompletan moneda, idioma y zona horaria — puedes ajustarlos
            después a mano si tu negocio es una excepción.
          </p>

          <div className="flex items-center justify-between mt-4">
            <SavedToast show={configSaved} label={t("settings.saved")} />
            <VimdyButton
              onClick={handleSaveConfig}
              variant="primary"
              size="sm"
              className="ml-auto"
            >
              {t("settings.save.globalization")}
            </VimdyButton>
          </div>
        </SectionCard>

        {/* Impuestos */}
        <SectionCard
          icon={<Percent size={18} className="text-yellow-400" />}
          title={t("settings.taxCurrency.title")}
          description={t("settings.taxCurrency.description")}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settings.field.tax")}>
              <input
                type="number"
                min={0}
                max={100}
                className={inputClass}
                value={configDraft.tax}
                onChange={(e) => setConfigDraft({ ...configDraft, tax: Number(e.target.value) })}
              />
            </Field>
            <Field label={t("settings.field.serviceCharge")}>
              <input
                type="number"
                min={0}
                max={100}
                className={inputClass}
                value={configDraft.serviceCharge}
                onChange={(e) => setConfigDraft({ ...configDraft, serviceCharge: Number(e.target.value) })}
              />
            </Field>
            <div className="col-span-2">
              <Field label={t("settings.field.dailyGoal")}>
                <input
                  type="number"
                  min={0}
                  step={10000}
                  className={inputClass}
                  placeholder="0 = sin meta"
                  value={configDraft.dailySalesGoal}
                  onChange={(e) => setConfigDraft({ ...configDraft, dailySalesGoal: Number(e.target.value) })}
                />
              </Field>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4">
            <SavedToast show={configSaved} label={t("settings.saved")} />
            <VimdyButton
              onClick={handleSaveConfig}
              variant="primary"
              size="sm"
              className="ml-auto"
            >
              {t("settings.save.taxes")}
            </VimdyButton>
          </div>
        </SectionCard>

        {/* Operación / módulos */}
        <SectionCard
          icon={<Sliders size={18} className="text-purple-400" />}
          title={t("settings.operation.title")}
          description={t("settings.operation.description")}
        >
          <div className="divide-y divide-slate-700/60">
            <Toggle
              label="Impresión automática de recibo"
              description="Abre el diálogo de impresión al cobrar una venta."
              checked={configDraft.autoPrintReceipt}
              onChange={(v) => setConfigDraft({ ...configDraft, autoPrintReceipt: v })}
            />
            <Toggle
              label="Permitir stock negativo"
              description="Deja vender productos aunque el inventario quede en negativo."
              checked={configDraft.allowNegativeStock}
              onChange={(v) => setConfigDraft({ ...configDraft, allowNegativeStock: v })}
            />
            <Toggle
              label="Módulo de Cocina"
              checked={configDraft.enableKitchen}
              onChange={(v) => setConfigDraft({ ...configDraft, enableKitchen: v })}
            />
            <Toggle
              label="Módulo de Mesas"
              checked={configDraft.enableTables}
              onChange={(v) => setConfigDraft({ ...configDraft, enableTables: v })}
            />
            <Toggle
              label="Domicilios"
              description="Exige un WhatsApp de pedidos en Datos del negocio y activa el QR de WhatsApp en el ticket."
              checked={configDraft.enableDelivery}
              onChange={(v) => setConfigDraft({ ...configDraft, enableDelivery: v })}
            />
            <Toggle
              label="Recomendaciones con IA"
              description="Sugerencias en Dashboard e Inventario."
              checked={configDraft.enableAI}
              onChange={(v) => setConfigDraft({ ...configDraft, enableAI: v })}
            />
            <Toggle
              label="Reportes por WhatsApp"
              checked={configDraft.enableWhatsAppReports}
              onChange={(v) => setConfigDraft({ ...configDraft, enableWhatsAppReports: v })}
            />
          </div>

          <div className="flex items-center justify-between mt-4">
            <SavedToast show={configSaved} label={t("settings.saved")} />
            <VimdyButton
              onClick={handleSaveConfig}
              variant="primary"
              size="sm"
              className="ml-auto"
            >
              {t("settings.save.operation")}
            </VimdyButton>
          </div>
        </SectionCard>

        {/* Impresión — plantillas de ticket, toggles y vista previa en vivo */}
        <PrintSettingsSection business={businessDraft} />

        {/* Backup manual */}
        <SectionCard
          icon={<DownloadCloud size={18} className="text-cyan-400" />}
          title="Backup de tu información"
          description="Descarga una copia completa de tu negocio en un archivo .json."
        >
          <p className="text-slate-400 text-xs leading-relaxed">
            Guarda este archivo en tu computador, Google Drive o donde prefieras.
            Incluye productos, ventas, clientes, turnos, usuarios y todo lo demás
            de <strong className="text-slate-300">tu negocio</strong> — nada de otros negocios.
            Recomendado: descárgalo con regularidad (por ejemplo, al cerrar el día).
          </p>

          {backupError && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-xs px-3 py-2.5">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{backupError}</span>
            </div>
          )}

          <div className="flex items-center justify-between mt-4">
            {backupDone ? (
              <SavedToast show={true} label="Backup descargado" />
            ) : (
              <span className="text-slate-500 text-xs">
                No reemplaza los backups automáticos del plan Pro de Supabase.
              </span>
            )}
            <VimdyButton
              onClick={handleDownloadBackup}
              loading={backingUp}
              variant="primary"
              size="sm"
              icon={<DownloadCloud size={16} />}
              className="ml-auto"
            >
              Descargar backup
            </VimdyButton>
          </div>
        </SectionCard>

        {/* Usuarios y roles */}
        {can("users.view") && (
          <SectionCard
            icon={<Users size={18} className="text-green-400" />}
            title="Usuarios y roles"
            description={`${users.length} usuario${users.length === 1 ? "" : "s"} registrado${users.length === 1 ? "" : "s"}.`}
          >
            {can("users.create") && (
              <VimdyButton
                onClick={() => setCreatingUser(true)}
                variant="secondary"
                icon={<UserPlus size={16} />}
                fullWidth
                className="mb-3 border-dashed"
              >
                Nuevo usuario
              </VimdyButton>
            )}

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{u.name}</p>
                    <p className="text-slate-500 text-xs truncate">
                      {u.email} · {roleName(u.roleId)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                        u.status === "ACTIVE"
                          ? "text-green-400 bg-green-500/10 border-green-500/30"
                          : u.status === "SUSPENDED"
                          ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
                          : "text-red-400 bg-red-500/10 border-red-500/30"
                      }`}
                    >
                      {u.status}
                    </span>
                    {can("users.edit") && u.id !== user?.id && (
                      <button
                        title={u.status === "ACTIVE" ? "Suspender" : "Reactivar"}
                        aria-label={u.status === "ACTIVE" ? "Suspender usuario" : "Reactivar usuario"}
                        onClick={() =>
                          setUserStatus(
                            user?.id ?? "SYSTEM",
                            u.id,
                            (u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE") as UserStatus
                          )
                        }
                        className="text-slate-400 hover:text-white"
                      >
                        {u.status === "ACTIVE" ? <Ban size={16} /> : <RotateCcw size={16} />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Meseros ligeros — sin login, solo nombre (pantalla Meseros) */}
        <SectionCard
          icon={<UserCircle2 size={18} className="text-cyan-400" />}
          title="Meseros"
          description="Nombres que aparecen como tarjetas en la pantalla Meseros, sin necesidad de iniciar sesión."
        >
          <WaitersSettingsSection />
        </SectionCard>
      </div>

      {creatingUser && (
        <CreateUserModal
          roles={roles}
          onClose={() => setCreatingUser(false)}
          onSubmit={async (data) => {
            const ok = await createUser(user?.id ?? "SYSTEM", data);
            if (ok) setCreatingUser(false);
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({
  roles,
  onClose,
  onSubmit
}: {
  roles: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (data: { name: string; email: string; password: string; roleId: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!name.trim() || !email.trim() || password.length < 6 || !roleId) return;
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), email: email.trim(), password, roleId });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-vimdy-surface border border-slate-700 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-bold flex items-center gap-2">
            <ShieldCheck size={16} className="text-cyan-400" />
            Nuevo usuario
          </h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Nombre">
            <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Correo">
            <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Contraseña (mínimo 6 caracteres)">
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Rol">
            <select className={inputClass} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex gap-2 pt-1">
            <VimdyButton
              onClick={onClose}
              variant="secondary"
              fullWidth
            >
              Cancelar
            </VimdyButton>
            <VimdyButton
              onClick={handleSubmit}
              disabled={!name.trim() || !email.trim() || password.length < 6}
              loading={saving}
              variant="primary"
              fullWidth
            >
              Crear usuario
            </VimdyButton>
          </div>
        </div>
      </div>
    </div>
  );
}