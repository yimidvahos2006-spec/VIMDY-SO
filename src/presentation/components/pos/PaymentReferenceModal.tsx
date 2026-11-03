import React, { useEffect, useState } from "react";

import { VimdyModal } from "../ui/VimdyModal";
import { VimdyButton } from "../ui/VimdyButton";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { formatMoney } from "../../../core/utils/formatMoney";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { getPaymentAccountDisplayName } from "../../../infrastructure/supabase/paymentAccountsRepository";
import { TransferAccountSelect } from "./TransferAccountSelect";

interface PaymentReferenceModalProps {
  open: boolean;
  /** "card" | "transfer" | "mixed" — transfer usa el selector de cuentas; el resto, texto. */
  method: string;
  total: number;
  /** Referencia ya escrita (si el cajero la había puesto antes). */
  initialReference?: string;
  /** Cuenta de cobro ya elegida (transferencia). Vacío = ninguna. */
  initialAccountId?: string;
  loading?: boolean;
  onClose: () => void;
  /** Para transferencia, `accountId` trae la cuenta registrada elegida. */
  onConfirm: (reference: string, accountId?: string) => void;
}

interface SelectedAccount {
  id: string;
  name: string;
}

export function PaymentReferenceModal({
  open,
  method,
  total,
  initialReference = "",
  initialAccountId = "",
  loading = false,
  onClose,
  onConfirm
}: PaymentReferenceModalProps) {
  const { t, language } = useTranslation();
  const [reference, setReference] = useState(initialReference);
  const [account, setAccount] = useState<SelectedAccount | null>(
    initialAccountId ? { id: initialAccountId, name: initialReference } : null
  );

  const isTransfer = method === "transfer";

  useEffect(() => {
    if (!open) return;
    setReference(initialReference);
    setAccount(initialAccountId ? { id: initialAccountId, name: initialReference } : null);
  }, [open, initialReference, initialAccountId]);

  const label = t("pos.payment.cardReference");
  const placeholder = t("pos.payment.cardRefPlaceholder");

  const clean = isTransfer ? (account?.name.trim() ?? "") : reference.trim();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!clean || loading) return;

    if (isTransfer && account) {
      onConfirm(clean, account.id);
      return;
    }

    onConfirm(clean);
  }

  return (
    <VimdyModal open={open} onClose={onClose} title="Confirmar pago" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="text-center">
          <p className="text-vimdy-micro text-vimdy-text-secondary">
            {t("pos.payment.amountToCharge")}
          </p>
          <p className="text-vimdy-accent-hover font-black text-3xl tabular-nums">
            {formatMoney(total, companyConfigStore.get().currency, language)}
          </p>
        </div>

        {isTransfer ? (
          <TransferAccountSelect
            autoFocus
            value={account?.id ?? ""}
            onChange={(selected) =>
              setAccount(
                selected ? { id: selected.id, name: getPaymentAccountDisplayName(selected) } : null
              )
            }
          />
        ) : (
          <div>
            <label className="text-vimdy-micro text-vimdy-text-secondary">{label}</label>
            <input
              autoFocus
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={placeholder}
              className="mt-1 w-full h-12 rounded-vimdy-md bg-vimdy-surface border border-vimdy-border px-4 text-vimdy-text outline-none focus:border-vimdy-accent"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <VimdyButton type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </VimdyButton>
          <VimdyButton type="submit" variant="primary" disabled={!clean} loading={loading}>
            Confirmar y cobrar
          </VimdyButton>
        </div>
      </form>
    </VimdyModal>
  );
}