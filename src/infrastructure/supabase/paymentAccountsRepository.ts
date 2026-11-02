import { supabase } from "./supabaseClient";

/* ===========================================================================
   paymentAccountsRepository
   ---------------------------------------------------------------------------
   Cuentas de cobro del negocio (Nequi, Bancolombia, Daviplata, Bre-B).
   Tabla: business_payment_accounts (ver supabase/payment_accounts_migration.sql).
   La seguridad real la da RLS: todos los miembros leen, solo ADMIN escribe.
=========================================================================== */

export const PAYMENT_BANKS = ["Nequi", "Bancolombia", "Daviplata", "Bre-B"] as const;
export type PaymentBank = (typeof PAYMENT_BANKS)[number];

export interface PaymentAccount {
  id: string;
  bankName: PaymentBank;
  accountNumber: string;
  holderName: string;
  isUniversalQr: boolean;
}

export interface NewPaymentAccountInput {
  bankName: PaymentBank;
  accountNumber: string;
  holderName?: string;
  isUniversalQr: boolean;
}

interface PaymentAccountRow {
  id: string;
  bank_name: PaymentBank;
  account_number: string;
  holder_name: string | null;
  is_universal_qr: boolean;
}

const COLUMNS = "id, bank_name, account_number, holder_name, is_universal_qr";

function mapRow(row: PaymentAccountRow): PaymentAccount {
  return {
    id: row.id,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    holderName: row.holder_name ?? "",
    isUniversalQr: row.is_universal_qr
  };
}

function friendlyError(message: string | undefined, fallback: string): Error {
  if (!message) return new Error(fallback);
  if (message.includes("row-level security")) {
    return new Error("Solo el administrador del negocio puede cambiar las cuentas de cobro.");
  }
  if (message.includes("duplicate key")) {
    return new Error("Esa cuenta ya está registrada.");
  }
  return new Error(fallback);
}

export async function listPaymentAccounts(businessId: string): Promise<PaymentAccount[]> {
  const { data, error } = await supabase
    .from("business_payment_accounts")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) throw friendlyError(error.message, "No se pudieron cargar las cuentas.");
  return ((data ?? []) as PaymentAccountRow[]).map(mapRow);
}

export async function createPaymentAccount(
  businessId: string,
  input: NewPaymentAccountInput
): Promise<PaymentAccount> {
  const { data, error } = await supabase
    .from("business_payment_accounts")
    .insert({
      business_id: businessId,
      bank_name: input.bankName,
      account_number: input.accountNumber.trim(),
      holder_name: input.holderName?.trim() || null,
      is_universal_qr: input.isUniversalQr
    })
    .select(COLUMNS)
    .single();

  if (error || !data) throw friendlyError(error?.message, "No se pudo guardar la cuenta.");
  return mapRow(data as PaymentAccountRow);
}

export async function deletePaymentAccount(accountId: string): Promise<void> {
  const { error } = await supabase.from("business_payment_accounts").delete().eq("id", accountId);
  if (error) throw friendlyError(error.message, "No se pudo eliminar la cuenta.");
}