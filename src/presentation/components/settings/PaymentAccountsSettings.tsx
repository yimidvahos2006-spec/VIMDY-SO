import React, { useCallback, useEffect, useState } from "react";
import { Landmark, Plus, QrCode, ShieldCheck, Trash2 } from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import {
  PAYMENT_BANKS,
  createPaymentAccount,
  deletePaymentAccount,
  listPaymentAccounts,
  type PaymentAccount,
  type PaymentBank
} from "../../../infrastructure/supabase/paymentAccountsRepository";
import { toast } from "../../../core/store/toastStore";

const fieldClass =
  "w-full h-11 rounded-xl bg-vimdy-surface border border-vimdy-border px-3 text-sm text-vimdy-text outline-none transition focus:border-emerald-400 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.15)]";

/**
 * Pestaña "Cuentas y Pagos / QR" de Configuración.
 * El dueño registra las cuentas donde recibe transferencias (Nequi,
 * Bancolombia, Daviplata, Bre-B) y marca si el QR es universal
 * (multi-cuenta) o de cuenta única. Se guardan en Supabase, aisladas por
 * negocio con RLS; solo el ADMIN puede modificarlas.
 */
export function PaymentAccountsSettings() {
  const { businessId } = useAuth();

  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [bankName, setBankName] = useState<PaymentBank>("Nequi");
  const [accountNumber, setAccountNumber] = useState("");
  const [holderName, setHolderName] = useState("");
  const [isUniversal, setIsUniversal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setLoadError(null);
    try {
      setAccounts(await listPaymentAccounts(businessId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudieron cargar las cuentas.");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleBankChange(next: PaymentBank) {
    setBankName(next);
    // Bre-B es un QR universal por naturaleza.
    if (next === "Bre-B") setIsUniversal(true);
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!businessId || saving) return;

    const number = accountNumber.trim();
    if (number.length < 3) {
      toast.warning("Escribe el número de cuenta o celular.");
      return;
    }

    setSaving(true);
    try {
      const created = await createPaymentAccount(businessId, {
        bankName,
        accountNumber: number,
        holderName,
        isUniversalQr: isUniversal
      });
      setAccounts((prev) => [...prev, created]);
      setAccountNumber("");
      setHolderName("");
      toast.success("Cuenta guardada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la cuenta.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(accountId: string) {
    try {
      await deletePaymentAccount(accountId);
      setAccounts((prev) => prev.filter((account) => account.id !== accountId));
      toast.success("Cuenta eliminada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar la cuenta.");
    } finally {
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface p-6 text-vimdy-text shadow-[0_0_40px_rgba(16,185,129,0.06)]">
      {/* Cabecera */}
      <div className="mb-6 flex items-center gap-4 border-b border-vimdy-border pb-6">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/50 bg-emerald-500/15 text-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.35)]">
          <Landmark size={24} />
        </div>
        <div>
          <h2 className="text-xl font-black tracking-wide text-emerald-400">Cuentas y Pagos / QR</h2>
          <p className="text-xs text-vimdy-text-secondary">
            Registra las cuentas donde recibes transferencias para activar el Radar Antifraude en caja.
          </p>
        </div>
      </div>

      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-xs text-emerald-300">
        <ShieldCheck size={20} className="shrink-0 text-emerald-400" />
        <span>
          Las cuentas de tu negocio están aisladas del resto de negocios. Solo el administrador puede agregarlas o
          eliminarlas.
        </span>
      </div>

      {/* Formulario */}
      <form onSubmit={handleAdd} className="mb-8 space-y-4 rounded-2xl border border-vimdy-border bg-black/40 p-5">
        <h3 className="text-sm font-bold uppercase tracking-wider text-vimdy-text-secondary">
          Agregar cuenta o QR
        </h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="pa-bank" className="mb-1 block text-xs text-vimdy-text-secondary">
              Banco / Plataforma
            </label>
            <select
              id="pa-bank"
              value={bankName}
              onChange={(event) => handleBankChange(event.target.value as PaymentBank)}
              className={fieldClass}
            >
              {PAYMENT_BANKS.map((bank) => (
                <option key={bank} value={bank}>
                  {bank === "Bre-B" ? "Bre-B (Universal)" : bank}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="pa-number" className="mb-1 block text-xs text-vimdy-text-secondary">
              Número de cuenta / celular
            </label>
            <input
              id="pa-number"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={40}
              placeholder="Ej: 3001234567"
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="pa-holder" className="mb-1 block text-xs text-vimdy-text-secondary">
              Titular (opcional)
            </label>
            <input
              id="pa-holder"
              type="text"
              autoComplete="off"
              maxLength={80}
              placeholder="Ej: Restaurante VIMDY SAS"
              value={holderName}
              onChange={(event) => setHolderName(event.target.value)}
              className={fieldClass}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 pt-1 md:flex-row md:items-center md:justify-between">
          <label htmlFor="pa-universal" className="flex cursor-pointer items-start gap-3 text-xs text-vimdy-text-secondary">
            <input
              id="pa-universal"
              type="checkbox"
              checked={isUniversal}
              onChange={(event) => setIsUniversal(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-emerald-500"
            />
            <span>
              <strong className="text-vimdy-text">QR universal / multi-cuenta</strong>: un solo código que recibe
              pagos de distintas cuentas o métodos.
            </span>
          </label>

          <button
            type="submit"
            disabled={saving || !businessId}
            className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-300/70 bg-emerald-500 px-5 text-sm font-black text-black shadow-[0_0_20px_rgba(16,185,129,0.45)] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <Plus size={18} />
            {saving ? "Guardando..." : "Guardar cuenta"}
          </button>
        </div>
      </form>

      {/* Listado */}
      <div className="space-y-3">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-vimdy-text-secondary">
          Tus cuentas activas
        </h3>

        {loading ? (
          <p className="py-6 text-center text-xs text-vimdy-text-secondary">Cargando cuentas...</p>
        ) : loadError ? (
          <div className="rounded-2xl border border-vimdy-danger/40 bg-vimdy-danger-bg p-4 text-xs text-vimdy-danger">
            {loadError}{" "}
            <button type="button" onClick={() => void load()} className="font-bold underline">
              Reintentar
            </button>
          </div>
        ) : accounts.length === 0 ? (
          <p className="py-6 text-center text-xs italic text-vimdy-text-tertiary">
            Aún no hay cuentas configuradas.
          </p>
        ) : (
          accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-vimdy-border bg-black/40 p-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                  <QrCode size={20} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-vimdy-text">{account.bankName}</span>
                    {account.isUniversalQr ? (
                      <span className="rounded-full border border-emerald-400/50 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                        QR universal
                      </span>
                    ) : (
                      <span className="rounded-full border border-vimdy-border bg-vimdy-surface px-2 py-0.5 text-[10px] font-bold text-vimdy-text-secondary">
                        Cuenta única
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-vimdy-text-secondary">{account.accountNumber}</p>
                  {account.holderName && (
                    <p className="truncate text-xs text-vimdy-text-tertiary">{account.holderName}</p>
                  )}
                </div>
              </div>

              {confirmDeleteId === account.id ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDelete(account.id)}
                    className="rounded-xl bg-vimdy-danger px-3 py-2 text-xs font-bold text-white transition hover:bg-vimdy-danger-hover"
                  >
                    Eliminar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="rounded-xl border border-vimdy-border px-3 py-2 text-xs font-semibold text-vimdy-text-secondary transition hover:text-vimdy-text"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={`Eliminar cuenta ${account.bankName} ${account.accountNumber}`}
                  onClick={() => setConfirmDeleteId(account.id)}
                  className="shrink-0 rounded-xl p-2 text-vimdy-text-tertiary transition hover:bg-vimdy-danger-bg hover:text-vimdy-danger"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}