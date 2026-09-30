import React, { useEffect, useState } from "react";
import { Key, Eye, EyeOff, ShieldCheck, ShieldX, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { savePaymentCredentials, testPaymentCredentials, getPaymentCredentials } from "../../../core/services/paymentCredentialsService";
import { companyConfigStore } from "../../../core/store/companyConfigStore";

const PROVIDERS = [
  { id: "wompi", label: "Wompi / Nequi", description: "Colombia" }
];

export function PaymentCredentialsSettingsSection() {
  const { businessId } = useAuth();
  const country = companyConfigStore.get().country;

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState("wompi");
  const [publicKey, setPublicKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [integritySecret, setIntegritySecret] = useState("");
  const [eventsSecret, setEventsSecret] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !businessId) return;
    setLoading(true);
    getPaymentCredentials(businessId, provider)
      .then((creds) => {
        if (creds) {
          setPublicKey(creds.publicKey);
          setPrivateKey(creds.privateKey);
          setIntegritySecret(creds.integritySecret);
          setEventsSecret(creds.eventsSecret);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [enabled, businessId, provider]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!businessId) return;

    setSaving(true);
    setError(null);
    setTestResult(null);

    try {
      await savePaymentCredentials(businessId, {
        provider: provider as "wompi",
        publicKey,
        privateKey,
        integritySecret,
        eventsSecret
      });
      setTestResult({ success: true, message: "Credenciales guardadas correctamente." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar credenciales.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!businessId) return;

    setTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const result = await testPaymentCredentials(businessId, provider);
      setTestResult({
        success: result.success,
        message: result.success ? "Credenciales válidas." : result.errorMessage || "Error al probar credenciales."
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al probar credenciales.");
    } finally {
      setTesting(false);
    }
  }

  if (country !== "CO") {
    return null;
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-vimdy-surface flex items-center justify-center flex-shrink-0">
          <Key className="w-5 h-5 text-vimdy-blue" />
        </div>
        <div>
          <h3 className="text-white font-bold">Credenciales de pago</h3>
          <p className="text-slate-400 text-xs">Conecta tus propias credenciales de Wompi/Nequi para recibir pagos directamente.</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? "bg-cyan-600" : "bg-slate-700"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <span className="text-xs text-slate-300">
          {enabled ? "Usar credenciales propias de Wompi/Nequi" : "Usar credenciales globales (por defecto)"}
        </span>
      </div>

      {enabled && (
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          {loading && (
            <div className="text-xs text-slate-400">Cargando credenciales guardadas...</div>
          )}

          <div>
            <label className="text-xs text-slate-400">Proveedor</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="mt-1 w-full h-10 rounded-xl bg-vimdy-surface border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} — {p.description}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400">Public Key</label>
            <input
              type={showKeys ? "text" : "password"}
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              placeholder="pub_prod_..."
              className="mt-1 w-full h-10 rounded-xl bg-vimdy-surface border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500"
              required
            />
          </div>

          <div>
            <label className="text-xs text-slate-400">Private Key / Secret</label>
            <input
              type={showKeys ? "text" : "password"}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="••••••••••••••••"
              className="mt-1 w-full h-10 rounded-xl bg-vimdy-surface border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500"
              required
            />
          </div>

          <div>
            <label className="text-xs text-slate-400">Integrity Secret</label>
            <input
              type={showKeys ? "text" : "password"}
              value={integritySecret}
              onChange={(e) => setIntegritySecret(e.target.value)}
              placeholder="••••••••••••••••"
              className="mt-1 w-full h-10 rounded-xl bg-vimdy-surface border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500"
              required
            />
          </div>

          <div>
            <label className="text-xs text-slate-400">Events Secret</label>
            <input
              type={showKeys ? "text" : "password"}
              value={eventsSecret}
              onChange={(e) => setEventsSecret(e.target.value)}
              placeholder="••••••••••••••••"
              className="mt-1 w-full h-10 rounded-xl bg-vimdy-surface border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500"
              required
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowKeys((v) => !v)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs transition-colors"
            >
              {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showKeys ? "Ocultar" : "Mostrar"} claves
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <ShieldX className="w-4 h-4" />
              {error}
            </div>
          )}

          {testResult && (
            <div className={`flex items-center gap-2 p-3 rounded-xl border text-xs ${
              testResult.success
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-red-500/10 border-red-500/20 text-red-400"
            }`}>
              {testResult.success ? <ShieldCheck className="w-4 h-4" /> : <ShieldX className="w-4 h-4" />}
              {testResult.message}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? "Guardando..." : "Guardar credenciales"}
            </button>

            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !publicKey || !privateKey}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {testing && <Loader2 className="w-4 h-4 animate-spin" />}
              {testing ? "Probando..." : "Probar conexión"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
