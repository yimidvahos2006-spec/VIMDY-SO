import { useEffect, useMemo, useState } from "react";
import { BellRing, Check, Mail, Send } from "lucide-react";
import { supabase } from "../../../infrastructure/supabase/supabaseClient";
import { dailyReportDeliveryService } from "../../../infrastructure/supabase/dailyReportDeliveryService";
import { useAuth } from "../../context/AuthContext";
import { VimdyButton } from "../ui/VimdyButton";

interface SettingsRow {
  business_id: string;
  enabled: boolean;
  send_on_shift_close: boolean;
  whatsapp_enabled: boolean;
  whatsapp_recipients: string[];
  email_enabled: boolean;
  email_recipients: string[];
  email_fallback_enabled: boolean;
}

const DEFAULTS: Omit<SettingsRow, "business_id"> = {
  enabled: true,
  send_on_shift_close: true,
  whatsapp_enabled: false,
  whatsapp_recipients: [],
  email_enabled: true,
  email_recipients: [],
  email_fallback_enabled: true,
};

function splitLines(value: string): string[] {
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}


function normalizeEmails(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.toLowerCase().trim()).filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))));
}

export function DailyReportSettingsCard() {
  const { businessId, role } = useAuth();
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [emailText, setEmailText] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = role?.id === "ADMIN";

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      const { data, error: loadError } = await supabase
        .from("daily_report_settings")
        .select("business_id,enabled,send_on_shift_close,whatsapp_enabled,whatsapp_recipients,email_enabled,email_recipients,email_fallback_enabled")
        .eq("business_id", businessId)
        .maybeSingle();
      if (cancelled) return;
      if (loadError) {
        setError(loadError.message);
        return;
      }
      const next = ({ business_id: businessId, ...DEFAULTS, ...(data ?? {}) } as SettingsRow);
      setSettings(next);
      setEmailText((next.email_recipients ?? []).join("\n"));
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const emailValid = useMemo(() => normalizeEmails(splitLines(emailText)).length === splitLines(emailText).length, [emailText]);

  async function sendTestEmail() {
    if (!businessId || !canEdit) return;
    const recipients = normalizeEmails(splitLines(emailText));
    if (recipients.length !== 1) {
      setError("Escribe un único correo válido para enviar la prueba.");
      return;
    }

    setTestingEmail(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("process-daily-report", {
        body: { businessId, action: "TEST_EMAIL", recipient: recipients[0] },
      });
      if (invokeError) throw new Error(invokeError.message);
      if (!data?.ok) throw new Error(data?.error ?? "No se pudo enviar el correo de prueba.");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el correo de prueba.");
    } finally {
      setTestingEmail(false);
    }
  }

  async function save() {
    if (!businessId || !settings || !canEdit) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const emailRecipients = normalizeEmails(splitLines(emailText));
      if (!emailValid) throw new Error("Revisa el correo configurado.");
      if (settings.email_enabled && emailRecipients.length > 1) throw new Error("Configura un solo correo principal para el cierre diario.");
      const payload = {
        business_id: businessId,
        enabled: settings.enabled,
        send_on_shift_close: settings.send_on_shift_close,
        // Conservamos cualquier configuración histórica de WhatsApp.
        // El canal queda fuera de esta pantalla por ahora, pero no destruimos
        // sus datos si el negocio ya lo tenía configurado.
        whatsapp_enabled: settings.whatsapp_enabled,
        whatsapp_recipients: settings.whatsapp_recipients ?? [],
        email_enabled: settings.email_enabled,
        email_recipients: emailRecipients,
        email_fallback_enabled: settings.email_fallback_enabled,
      };
      const { error: saveError } = await supabase.from("daily_report_settings").upsert(payload, { onConflict: "business_id" });
      if (saveError) throw new Error(saveError.message);
      setSettings(payload);
      // Si ya existen cierres esperando configuración, el procesador se
      // despierta inmediatamente. El job es durable, así que este kick solo
      // reduce la latencia y nunca es un requisito para no perderlo.
      void dailyReportDeliveryService.kick({ businessId });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <div className="lg:col-span-2 rounded-2xl border border-slate-700 bg-slate-800 p-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-vimdy-surface flex items-center justify-center"><BellRing size={18} className="text-cyan-400" /></div>
        <div><h3 className="text-white font-bold">Cierre inteligente por correo</h3><p className="text-slate-400 text-xs">Al cerrar el turno, VIMDY prepara el resumen del día y lo envía automáticamente al correo configurado.</p></div>
      </div>

      <div className="mt-4 space-y-1">
        <label className="flex items-center justify-between gap-4 py-2.5 cursor-pointer">
          <span><span className="block text-white text-sm font-medium">Activar reportes automáticos</span><span className="block text-slate-500 text-xs mt-0.5">Se prepara automáticamente cuando se cierra una caja.</span></span>
          <input type="checkbox" disabled={!canEdit} checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between gap-4 py-2.5 cursor-pointer">
          <span><span className="block text-white text-sm font-medium">Enviar inmediatamente al cerrar el turno</span><span className="block text-slate-500 text-xs mt-0.5">El cierre no depende de que el navegador permanezca abierto.</span></span>
          <input type="checkbox" disabled={!canEdit} checked={settings.send_on_shift_close} onChange={(e) => setSettings({ ...settings, send_on_shift_close: e.target.checked })} />
        </label>
      </div>

      <div className="mt-5">
        <label className="flex items-center justify-between text-xs text-slate-400">
          <span className="inline-flex items-center gap-2"><Mail size={14} /> Correo del propietario</span>
          <input type="checkbox" disabled={!canEdit} checked={settings.email_enabled} onChange={(e) => setSettings({ ...settings, email_enabled: e.target.checked })} />
        </label>
        <p className="text-slate-500 text-xs mt-1">Aquí defines exactamente a qué correo llegará el cierre diario de VIMDY.</p>
        <input
          disabled={!canEdit}
          value={emailText}
          onChange={(e) => setEmailText(e.target.value)}
          type="email"
          inputMode="email"
          autoComplete="email"
          className="mt-2 w-full rounded-xl bg-vimdy-surface border border-slate-700 px-3 py-2.5 text-white text-sm outline-none focus:border-cyan-500 disabled:opacity-60"
          placeholder="dueno@negocio.com"
          aria-label="Correo del propietario para el cierre diario"
        />
        <p className="text-slate-500 text-xs mt-1.5">Usaremos este correo para el cierre automático. Si queda vacío, VIMDY usará el correo de un ADMIN o GERENTE del negocio como respaldo.</p>

        <label className="mt-4 flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" disabled={!canEdit} checked={settings.email_fallback_enabled} onChange={(e) => setSettings({ ...settings, email_fallback_enabled: e.target.checked })} />
          Usar el correo del negocio como respaldo si el canal principal no está configurado.
        </label>

        {canEdit ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <VimdyButton onClick={() => { void sendTestEmail(); }} loading={testingEmail} disabled={!emailValid || splitLines(emailText).length !== 1} variant="secondary" size="sm">
              <Send size={14} /> Enviar correo de prueba
            </VimdyButton>
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
      {!canEdit ? <p className="mt-4 text-xs text-slate-500">Solo ADMIN puede cambiar los destinatarios y la automatización.</p> : null}

      <div className="mt-4 flex items-center justify-between">
        {saved ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-400"><Check size={13} /> Guardado</span> : <span />}
        {canEdit ? <VimdyButton onClick={() => { void save(); }} loading={saving} variant="primary" size="sm">Guardar cierre inteligente</VimdyButton> : null}
      </div>
    </div>
  );
}