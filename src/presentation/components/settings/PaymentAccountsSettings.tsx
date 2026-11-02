import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Info, Landmark, Lightbulb, Plus, QrCode, ShieldCheck, Trash2 } from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import {
  PAYMENT_BANKS,
  createPaymentAccount,
  deletePaymentAccount,
  listPaymentAccounts,
  setPaymentAccountActive,
  type PaymentAccount,
  type PaymentBank
} from "../../../infrastructure/supabase/paymentAccountsRepository";
import { toast } from "../../../core/store/toastStore";

const fieldClass =
  "w-full h-11 rounded-xl bg-vimdy-surface border border-vimdy-border px-3 text-sm text-vimdy-text outline-none transition focus:border-emerald-400 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.15)]";

interface BankGuide {
  /** Nombre en el selector. */
  optionLabel: string;
  /** Qué es, en una frase. */
  tagline: string;
  /** Para qué sirve / cómo se usa. */
  bullets: string[];
  numberLabel: string;
  numberPlaceholder: string;
  numeric: boolean;
  /** Si la plataforma suele ser un QR universal, se marca por defecto. */
  universalByDefault: boolean;
}

/** Textos de ayuda para el dueño del negocio, uno por plataforma. */
const BANK_GUIDES: Record<PaymentBank, BankGuide> = {
  Nequi: {
    optionLabel: "Nequi",
    tagline: "Recibe transferencias al celular Nequi de tu negocio.",
    bullets: [
      "Registra el número de celular donde llega la plata.",
      "Tus clientes pagan desde su app Nequi escaneando tu QR o enviando al número.",
      "Si tienes varias cajas, registra un Nequi por caja y ponles etiqueta (Caja 1, Barra...)."
    ],
    numberLabel: "Celular de la cuenta Nequi",
    numberPlaceholder: "Ej: 3001234567",
    numeric: true,
    universalByDefault: false
  },
  Bancolombia: {
    optionLabel: "Bancolombia",
    tagline: "Cuenta de ahorros o corriente, o QR Bancolombia.",
    bullets: [
      "Registra el número de cuenta (o el del QR) donde recibes.",
      "Sirve para transferencias de clientes Bancolombia y desde otros bancos.",
      "Puedes tener varias cuentas, por ejemplo una para el local y otra para domicilios."
    ],
    numberLabel: "Número de cuenta",
    numberPlaceholder: "Ej: 12345678901",
    numeric: true,
    universalByDefault: false
  },
  Daviplata: {
    optionLabel: "Daviplata",
    tagline: "Recibe pagos al celular Daviplata de tu negocio.",
    bullets: [
      "Registra el celular asociado a Daviplata.",
      "Tus clientes te envían desde su app Daviplata al número o con tu QR.",
      "Útil si muchos de tus clientes usan esta billetera."
    ],
    numberLabel: "Celular de la cuenta Daviplata",
    numberPlaceholder: "Ej: 3109876543",
    numeric: true,
    universalByDefault: false
  },
  "Bre-B": {
    optionLabel: "Bre-B (QR universal)",
    tagline: "Pagos inmediatos entre cualquier banco o billetera, con una llave o un QR.",
    bullets: [
      "Un solo QR o llave sirve para que te paguen desde distintas apps y bancos.",
      "Registra tu llave Bre-B (celular, correo u otra) o el código de tu QR.",
      "Marca \"QR universal\" cuando un mismo código recibe de varias plataformas."
    ],
    numberLabel: "Llave Bre-B o código del QR",
    numberPlaceholder: "Ej: 3001234567 o tu llave",
    numeric: false,
    universalByDefault: true
  },
  Wompi: {
    optionLabel: "Wompi",
    tagline: "Pasarela para cobrar con tarjeta de crédito/débito, PSE y otros medios.",
    bullets: [
      "Cobras con tarjeta, PSE, Nequi y más desde un solo enlace o botón de pago.",
      "Registra el nombre o identificador de tu comercio en Wompi para reconocer esos pagos.",
      "Útil para domicilios y pagos a distancia, donde el cliente no está en el mostrador."
    ],
    numberLabel: "Identificador del comercio en Wompi",
    numberPlaceholder: "Ej: Mi Restaurante - Wompi",
    numeric: false,
    universalByDefault: false
  }
};

/** Tarjeta informativa reutilizable (Dark Mode + esmeralda). */
function HelpCard({
  icon,
  title,
  children
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/25 p-4">
      <div className="mb-2 flex items-center gap-2 text-emerald-300">
        <span className="shrink-0 text-emerald-400">{icon}</span>
        <h4 className="text-xs font-black uppercase tracking-wider">{title}</h4>
      </div>
      <div className="text-xs leading-relaxed text-vimdy-text-secondary">{children}</div>
    </div>
  );
}

function ActiveSwitch({
  checked,
  disabled,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? "border-emerald-300/70 bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.55)]"
          : "border-vimdy-border bg-vimdy-surface-active"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 rounded-full bg-white transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
        style={{ width: 18, height: 18 }}
      />
    </button>
  );
}

/**
 * Pestaña "Cuentas y Pagos / QR" de Configuración.
 * El dueño registra las cuentas donde recibe pagos (Nequi, Bancolombia,
 * Daviplata, Bre-B, Wompi). Puede tener varias de la misma plataforma
 * (ej. una por caja), activarlas/desactivarlas o eliminarlas. Se guardan
 * en Supabase, aisladas por negocio con RLS; solo el ADMIN las modifica.
 */
export function PaymentAccountsSettings() {
  const { businessId } = useAuth();

  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [bankName, setBankName] = useState<PaymentBank>("Nequi");
  const [accountNumber, setAccountNumber] = useState("");
  const [label, setLabel] = useState("");
  const [holderName, setHolderName] = useState("");
  const [isUniversal, setIsUniversal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const guide = BANK_GUIDES[bankName];

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

  // Cuentas agrupadas por plataforma, en el orden del selector.
  const groups = useMemo(
    () =>
      PAYMENT_BANKS.map((bank) => ({
        bank,
        items: accounts.filter((account) => account.bankName === bank)
      })).filter((group) => group.items.length > 0),
    [accounts]
  );
  const activeCount = accounts.filter((account) => account.isActive).length;

  function handleBankChange(next: PaymentBank) {
    setBankName(next);
    setIsUniversal(BANK_GUIDES[next].universalByDefault);
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!businessId || saving) return;

    const number = accountNumber.trim();
    if (number.length < 3) {
      toast.warning(`Escribe: ${guide.numberLabel.toLowerCase()}.`);
      return;
    }

    setSaving(true);
    try {
      const created = await createPaymentAccount(businessId, {
        bankName,
        accountNumber: number,
        holderName,
        label,
        isUniversalQr: isUniversal
      });
      setAccounts((prev) => [...prev, created]);
      setAccountNumber("");
      setLabel("");
      setHolderName("");
      toast.success("Cuenta guardada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la cuenta.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(account: PaymentAccount, next: boolean) {
    if (busyId) return;
    setBusyId(account.id);
    // Cambio inmediato en pantalla; si el servidor falla, se devuelve.
    setAccounts((prev) => prev.map((item) => (item.id === account.id ? { ...item, isActive: next } : item)));
    try {
      await setPaymentAccountActive(account.id, next);
    } catch (error) {
      setAccounts((prev) =>
        prev.map((item) => (item.id === account.id ? { ...item, isActive: account.isActive } : item))
      );
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar el estado de la cuenta.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(accountId: string) {
    setBusyId(accountId);
    try {
      await deletePaymentAccount(accountId);
      setAccounts((prev) => prev.filter((account) => account.id !== accountId));
      toast.success("Cuenta eliminada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar la cuenta.");
    } finally {
      setBusyId(null);
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
            Registra dónde recibes transferencias y pagos para activar el Radar Antifraude en caja.
          </p>
        </div>
      </div>

      {/* Guía general */}
      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <HelpCard icon={<Info size={16} />} title="¿Para qué sirve?">
          Cuando un cliente paga por transferencia, VIMDY compara ese pago con las cuentas que registres aquí para
          avisarle al cajero en tiempo real y evitar comprobantes falsos.
        </HelpCard>
        <HelpCard icon={<CreditCard size={16} />} title="Varias cuentas">
          Puedes registrar más de una cuenta de la misma plataforma (por ejemplo dos Nequi, uno por caja). Ponles una
          etiqueta para distinguirlas.
        </HelpCard>
        <HelpCard icon={<QrCode size={16} />} title="Cuenta única vs. QR universal">
          <strong className="text-vimdy-text">Cuenta única</strong>: el QR o número lleva a una sola cuenta.{" "}
          <strong className="text-vimdy-text">QR universal</strong>: un solo código recibe de varias apps y bancos
          (como Bre-B).
        </HelpCard>
      </div>

      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-xs text-emerald-300">
        <ShieldCheck size={20} className="shrink-0 text-emerald-400" />
        <span>
          Las cuentas de tu negocio están aisladas del resto de negocios. Solo el administrador puede agregarlas,
          desactivarlas o eliminarlas.
        </span>
      </div>

      {/* Formulario */}
      <form onSubmit={handleAdd} className="mb-8 space-y-4 rounded-2xl border border-vimdy-border bg-black/40 p-5">
        <h3 className="text-sm font-bold uppercase tracking-wider text-vimdy-text-secondary">
          Agregar cuenta o QR
        </h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="pa-bank" className="mb-1 block text-xs text-vimdy-text-secondary">
              Plataforma
            </label>
            <select
              id="pa-bank"
              value={bankName}
              onChange={(event) => handleBankChange(event.target.value as PaymentBank)}
              className={fieldClass}
            >
              {PAYMENT_BANKS.map((bank) => (
                <option key={bank} value={bank}>
                  {BANK_GUIDES[bank].optionLabel}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="pa-number" className="mb-1 block text-xs text-vimdy-text-secondary">
              {guide.numberLabel}
            </label>
            <input
              id="pa-number"
              type="text"
              inputMode={guide.numeric ? "numeric" : "text"}
              autoComplete="off"
              maxLength={40}
              placeholder={guide.numberPlaceholder}
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="pa-label" className="mb-1 block text-xs text-vimdy-text-secondary">
              Etiqueta (opcional)
            </label>
            <input
              id="pa-label"
              type="text"
              autoComplete="off"
              maxLength={40}
              placeholder="Ej: Caja 1, Barra, Domicilios"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
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

        {/* Guía de la plataforma elegida */}
        <HelpCard icon={<Lightbulb size={16} />} title={`${guide.optionLabel}: ${guide.tagline}`}>
          <ul className="list-disc space-y-1 pl-4">
            {guide.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </HelpCard>

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

      {/* Listado agrupado por plataforma */}
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-vimdy-text-secondary">Tus cuentas</h3>
          {accounts.length > 0 && (
            <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-300">
              {activeCount} activa{activeCount === 1 ? "" : "s"} de {accounts.length}
            </span>
          )}
        </div>

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
            Aún no hay cuentas configuradas. Agrega la primera arriba.
          </p>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.bank} aria-label={`Cuentas ${group.bank}`} className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                  <span>{group.bank}</span>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                    {group.items.length}
                  </span>
                </div>

                {group.items.map((account) => (
                  <div
                    key={account.id}
                    className={`flex items-center justify-between gap-3 rounded-2xl border p-4 transition ${
                      account.isActive
                        ? "border-vimdy-border bg-black/40"
                        : "border-vimdy-border-subtle bg-black/20 opacity-60"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                          account.isActive
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border-vimdy-border bg-vimdy-surface text-vimdy-text-tertiary"
                        }`}
                      >
                        <QrCode size={20} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-bold text-vimdy-text">
                            {account.label || account.bankName}
                          </span>
                          {account.isUniversalQr ? (
                            <span className="rounded-full border border-emerald-400/50 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                              QR universal
                            </span>
                          ) : (
                            <span className="rounded-full border border-vimdy-border bg-vimdy-surface px-2 py-0.5 text-[10px] font-bold text-vimdy-text-secondary">
                              Cuenta única
                            </span>
                          )}
                          {!account.isActive && (
                            <span className="rounded-full border border-vimdy-warning/40 bg-vimdy-warning-bg px-2 py-0.5 text-[10px] font-bold text-vimdy-warning">
                              Desactivada
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-xs text-vimdy-text-secondary">
                          {account.accountNumber}
                        </p>
                        {account.holderName && (
                          <p className="truncate text-xs text-vimdy-text-tertiary">{account.holderName}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {confirmDeleteId === account.id ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyId === account.id}
                            onClick={() => void handleDelete(account.id)}
                            className="rounded-xl bg-vimdy-danger px-3 py-2 text-xs font-bold text-white transition hover:bg-vimdy-danger-hover disabled:opacity-50"
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
                        <>
                          <ActiveSwitch
                            checked={account.isActive}
                            disabled={busyId === account.id}
                            label={`${account.isActive ? "Desactivar" : "Activar"} cuenta ${account.bankName} ${account.accountNumber}`}
                            onChange={(next) => void handleToggle(account, next)}
                          />
                          <button
                            type="button"
                            aria-label={`Eliminar cuenta ${account.bankName} ${account.accountNumber}`}
                            onClick={() => setConfirmDeleteId(account.id)}
                            className="rounded-xl p-2 text-vimdy-text-tertiary transition hover:bg-vimdy-danger-bg hover:text-vimdy-danger"
                          >
                            <Trash2 size={18} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            ))}

            <p className="text-[11px] text-vimdy-text-tertiary">
              Desactivar una cuenta la deja guardada pero sin usarla; eliminarla la borra definitivamente.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}