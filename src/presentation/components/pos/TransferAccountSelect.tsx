import React, { useEffect } from "react";
import { AlertCircle, Landmark } from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { usePaymentAccounts } from "../../../hooks/usePaymentAccounts";
import {
  getPaymentAccountDisplayName,
  type PaymentAccount
} from "../../../infrastructure/supabase/paymentAccountsRepository";
import { VimdySelect } from "../ui/VimdySelect";
import { VimdyButton } from "../ui/VimdyButton";

interface TransferAccountSelectProps {
  /** Id de la cuenta elegida (paymentStore.paymentAccountId). Vacío = ninguna. */
  value: string;
  /** Se llama con la cuenta elegida, o null si la selección ya no es válida. */
  onChange: (account: PaymentAccount | null) => void;
  label?: string;
  autoFocus?: boolean;
}

/**
 * Selector de la cuenta registrada (business_payment_accounts) a la que entra
 * el dinero de una transferencia. Reemplaza el campo de texto libre: el cajero
 * elige "Nequi - Caja 1", "Wompi - Principal", etc.
 *
 * - Solo lista cuentas activas del negocio actual.
 * - Si hay una sola cuenta, se selecciona sola (un toque menos en hora pico).
 * - Si la cuenta elegida se desactivó mientras tanto, se limpia la selección.
 */
export function TransferAccountSelect({
  value,
  onChange,
  label = "Cuenta que recibe el dinero",
  autoFocus = false
}: TransferAccountSelectProps) {
  const { businessId } = useAuth();
  const { accounts, loading, error, reload } = usePaymentAccounts(businessId);

  useEffect(() => {
    if (loading) return;

    if (value && !accounts.some((account) => account.id === value)) {
      onChange(null);
      return;
    }

    if (!value && accounts.length === 1) {
      onChange(accounts[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, loading, value]);

  if (loading) {
    return (
      <div className="space-y-1.5" aria-busy="true">
        <span className="text-vimdy-micro text-vimdy-text-secondary">{label}</span>
        <div className="h-12 w-full rounded-vimdy-md bg-vimdy-surface border border-vimdy-border animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg p-3 space-y-2"
      >
        <p className="flex items-start gap-2 text-vimdy-small text-vimdy-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error}
        </p>
        <VimdyButton type="button" variant="secondary" size="sm" onClick={() => void reload()}>
          Reintentar
        </VimdyButton>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div
        role="status"
        className="rounded-vimdy-md border border-vimdy-warning/30 bg-vimdy-warning-bg p-3 text-vimdy-small text-vimdy-warning flex items-start gap-2"
      >
        <Landmark size={16} className="mt-0.5 shrink-0" />
        <span>
          No hay cuentas de cobro activas. Pídele al administrador que registre una en
          Configuración para cobrar por transferencia.
        </span>
      </div>
    );
  }

  return (
    <VimdySelect
      label={label}
      value={value}
      autoFocus={autoFocus}
      onChange={(event) => {
        const selected = accounts.find((account) => account.id === event.target.value) ?? null;
        onChange(selected);
      }}
    >
      <option value="" disabled>
        Selecciona la cuenta…
      </option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {getPaymentAccountDisplayName(account)}
        </option>
      ))}
    </VimdySelect>
  );
}