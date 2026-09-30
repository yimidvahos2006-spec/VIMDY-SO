import { CashRegister } from "../entities/Entities";
import { CashRegisterRepository } from "../../infrastructure/di/repositories/CashRegisterRepository";
import { cashRegisterStore } from "../store/cashRegisterStore";

export class CashRegisterEngine {
  constructor(private readonly repository: CashRegisterRepository) {}

  async listActive(businessId: string, branchId: string): Promise<CashRegister[]> {
    cashRegisterStore.hydrate(businessId, branchId);
    const registers = (await this.repository.listActive())
      .filter((register) => register.businessId === businessId && register.branchId === branchId)
      .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)) || a.name.localeCompare(b.name));

    if (registers.length === 1 && cashRegisterStore.getSelectedId() === null) {
      cashRegisterStore.setSelected(businessId, branchId, registers[0].id);
    }

    return registers;
  }

  async ensureDefault(businessId: string, branchId: string): Promise<CashRegister> {
    const existing = await this.listActive(businessId, branchId);
    if (existing.length > 0) {
      const selectedId = cashRegisterStore.getSelectedId();
      return existing.find((r) => r.id === selectedId) ?? existing[0];
    }
    const created = await this.repository.ensureDefault(businessId, branchId);
    cashRegisterStore.setSelected(businessId, branchId, created.id);
    return created;
  }

  async create(params: { businessId: string; branchId: string; name: string; code: string; primary?: boolean }): Promise<CashRegister> {
    const name = params.name.trim();
    const code = params.code.trim().toUpperCase();
    if (!name) throw new Error("CASH_REGISTER_NAME_REQUIRED");
    if (!code) throw new Error("CASH_REGISTER_CODE_REQUIRED");

    const register: CashRegister = {
      id: crypto.randomUUID(),
      businessId: params.businessId,
      branchId: params.branchId,
      name,
      code,
      status: "ACTIVE",
      active: true,
      primary: params.primary ?? false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.repository.save(register);
    cashRegisterStore.setSelected(params.businessId, params.branchId, register.id);
    return register;
  }

  async deactivate(cashRegisterId: string, businessId: string, branchId: string): Promise<CashRegister> {
    const registers = await this.listActive(businessId, branchId);
    if (registers.length <= 1) throw new Error("CASH_REGISTER_LAST_ACTIVE_FORBIDDEN");
    const target = registers.find((r) => r.id === cashRegisterId);
    if (!target) throw new Error("CASH_REGISTER_NOT_FOUND");
    const deactivated = await this.repository.deactivate(cashRegisterId);
    if (cashRegisterStore.getSelectedId() === cashRegisterId) {
      const next = registers.find((r) => r.id !== cashRegisterId);
      if (next) cashRegisterStore.setSelected(businessId, branchId, next.id);
      else cashRegisterStore.clear();
    }
    return deactivated;
  }

  resolveSelectedId(businessId: string, branchId: string, registers: CashRegister[]): string {
    cashRegisterStore.hydrate(businessId, branchId);
    const selected = cashRegisterStore.getSelectedId();
    if (selected && registers.some((r) => r.id === selected && r.active && r.status === "ACTIVE")) {
      return selected;
    }
    if (registers.length === 1) {
      cashRegisterStore.setSelected(businessId, branchId, registers[0].id);
      return registers[0].id;
    }
    throw new Error("CASH_REGISTER_SELECTION_REQUIRED: seleccione la caja física antes de operar.");
  }
}
