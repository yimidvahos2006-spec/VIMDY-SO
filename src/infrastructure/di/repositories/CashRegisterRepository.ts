import { CashRegister } from "../../../core/entities/Entities";
import { SupabaseRepository, reviveDates } from "./SupabaseRepository";
import { supabase } from "../../supabase/supabaseClient";

export interface ICashRegisterRepository {
  listActive(): Promise<CashRegister[]>;
  ensureDefault(businessId: string, branchId: string): Promise<CashRegister>;
  deactivate(cashRegisterId: string): Promise<CashRegister>;
}

export class CashRegisterRepository
  extends SupabaseRepository<CashRegister>
  implements ICashRegisterRepository
{
  protected tableName = "cash_registers" as const;

  async listActive(): Promise<CashRegister[]> {
    const rows = await this.findAll();
    return rows.filter((row) => row.active && row.status === "ACTIVE");
  }

  async ensureDefault(businessId: string, branchId: string): Promise<CashRegister> {
    const { data, error } = await supabase.rpc("ensure_default_cash_register", {
      p_business_id: businessId,
      p_branch_id: branchId
    });
    if (error) throw new Error(`CASH_REGISTER_DEFAULT_FAILED: ${error.message}`);
    const row = data?.[0];
    if (!row) throw new Error("CASH_REGISTER_DEFAULT_FAILED: la RPC no devolvió la caja principal.");
    return { ...reviveDates(row.data as CashRegister), version: row.version } as CashRegister;
  }

  async deactivate(cashRegisterId: string): Promise<CashRegister> {
    const { data, error } = await supabase.rpc("deactivate_cash_register_atomic", {
      p_cash_register_id: cashRegisterId
    });
    if (error) throw new Error(`CASH_REGISTER_DEACTIVATE_FAILED: ${error.message}`);
    const row = data?.[0];
    if (!row) throw new Error("CASH_REGISTER_DEACTIVATE_FAILED: la RPC no devolvió la caja.");
    return { ...reviveDates(row.data as CashRegister), version: row.version } as CashRegister;
  }
}
