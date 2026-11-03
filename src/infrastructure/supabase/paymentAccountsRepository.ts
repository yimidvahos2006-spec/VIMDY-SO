import { supabase } from "./supabaseClient";

/* ===========================================================================
   paymentAccountsRepository
   ---------------------------------------------------------------------------
   Cuentas de cobro del negocio (Nequi, Bancolombia, Daviplata, Bre-B, Wompi).
   Tabla: business_payment_accounts (ver supabase/payment_accounts_migration.sql).
   Puede haber varias cuentas de la misma plataforma (ej. una por caja).
   La seguridad real la da RLS: todos los miembros leen, solo ADMIN escribe.
=========================================================================== */

export const PAYMENT_BANKS = ["Nequi", "Bancolombia", "Daviplata", "Bre-B", "Wompi"] as const;
export type PaymentBank = (typeof PAYMENT_BANKS)[number];

export interface PaymentAccount {
  id: string;
  bankName: PaymentBank;
  accountNumber: string;
  holderName: string;
  label: string;
  isUniversalQr: boolean;
  isActive: boolean;
}

export interface NewPaymentAccountInput {
  bankName: PaymentBank;
  accountNumber: string;
  holderName?: string;
  label?: string;
  isUniversalQr: boolean;
}

interface PaymentAccountRow {
  id: string;
  bank_name: PaymentBank;
  account_number: string;
  holder_name: string | null;
  label: string | null;
  is_universal_qr: boolean;
  is_active: boolean;
}

const COLUMNS = "id, bank_name, account_number, holder_name, label, is_universal_qr, is_active";

function mapRow(row: PaymentAccountRow): PaymentAccount {
  return {
    id: row.id,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    holderName: row.holder_name ?? "",
    label: row.label ?? "",
    isUniversalQr: row.is_universal_qr,
    isActive: row.is_active
  };
}

function friendlyError(message: string | undefined, fallback: string): Error {
  if (!message) return new Error(fallback);
  if (message.includes("row-level security")) {
    return new Error("Solo el administrador del negocio puede cambiar las cuentas de cobro.");
  }
  if (message.includes("duplicate key")) {
    return new Error("Esa cuenta ya está registrada en esa plataforma.");
  }
  if (message.includes("bank_name_check")) {
    return new Error("Falta actualizar la base de datos: corre supabase/payment_accounts_migration.sql.");
  }
  return new Error(fallback);
}

/** Devuelve TODAS las cuentas del negocio, activas e inactivas. */
export async function listPaymentAccounts(businessId: string): Promise<PaymentAccount[]> {
  const { data, error } = await supabase
    .from("business_payment_accounts")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });

  if (error) throw friendlyError(error.message, "No se pudieron cargar las cuentas.");
  return ((data ?? []) as PaymentAccountRow[]).map(mapRow);
}

/**
 * Devuelve solo las cuentas ACTIVAS del negocio (is_active = true): las que el
 * cajero puede elegir al cobrar por transferencia. El filtro por business_id va
 * explícito además del RLS, para no depender solo de la política.
 */
export async function listActivePaymentAccounts(businessId: string): Promise<PaymentAccount[]> {
  const { data, error } = await supabase
    .from("business_payment_accounts")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) throw friendlyError(error.message, "No se pudieron cargar las cuentas de cobro.");
  return ((data ?? []) as PaymentAccountRow[]).map(mapRow);
}

/**
 * Nombre que ve el cajero y que queda guardado como referencia de la venta.
 * Ej.: "Nequi - Caja 1", "Wompi - Principal". Si la cuenta no tiene etiqueta,
 * se distingue por los últimos 4 dígitos: "Nequi - ••3210".
 */
export function getPaymentAccountDisplayName(
  account: Pick<PaymentAccount, "bankName" | "label" | "accountNumber">
): string {
  const label = account.label.trim();
  if (label) return `${account.bankName} - ${label}`;

  const number = account.accountNumber.trim();
  const tail = number.length > 4 ? `••${number.slice(-4)}` : number;
  return `${account.bankName} - ${tail}`;
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
      label: input.label?.trim() || null,
      is_universal_qr: input.isUniversalQr
    })
    .select(COLUMNS)
    .single();

  if (error || !data) throw friendlyError(error?.message, "No se pudo guardar la cuenta.");
  return mapRow(data as PaymentAccountRow);
}

export async function setPaymentAccountActive(accountId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from("business_payment_accounts")
    .update({ is_active: isActive })
    .eq("id", accountId);

  if (error) throw friendlyError(error.message, "No se pudo cambiar el estado de la cuenta.");
}

export async function deletePaymentAccount(accountId: string): Promise<void> {
  const { error } = await supabase.from("business_payment_accounts").delete().eq("id", accountId);
  if (error) throw friendlyError(error.message, "No se pudo eliminar la cuenta.");
}