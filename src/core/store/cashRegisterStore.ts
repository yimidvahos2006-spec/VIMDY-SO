import { ObservableStore } from "./ObservableStore";

export interface CashRegisterSelectionSnapshot {
  readonly businessId: string | null;
  readonly branchId: string | null;
  readonly cashRegisterId: string | null;
}

const EMPTY: CashRegisterSelectionSnapshot = {
  businessId: null,
  branchId: null,
  cashRegisterId: null
};

function storageKey(businessId: string, branchId: string): string {
  return `vimdy.cash-register-selection.v1:${businessId}:${branchId}`;
}

class CashRegisterStore extends ObservableStore<CashRegisterSelectionSnapshot> {
  private current: CashRegisterSelectionSnapshot = EMPTY;

  constructor() {
    super(EMPTY);
  }

  hydrate(businessId: string | null, branchId: string | null): void {
    if (!businessId || !branchId) {
      this.current = EMPTY;
      this.publish(this.current);
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    try {
      const saved = window.localStorage.getItem(storageKey(businessId, branchId));
      const next = {
        businessId,
        branchId,
        cashRegisterId: saved?.trim() || null
      };
      if (
        next.businessId !== this.current.businessId ||
        next.branchId !== this.current.branchId ||
        next.cashRegisterId !== this.current.cashRegisterId
      ) {
        this.current = next;
        this.publish(this.current);
      }
    } catch {
      const next = { businessId, branchId, cashRegisterId: null };
      this.current = next;
      this.publish(this.current);
    }
  }

  getSelectedId(): string | null {
    return this.current.cashRegisterId;
  }

  getSnapshotValue(): CashRegisterSelectionSnapshot {
    return this.current;
  }

  setSelected(businessId: string, branchId: string, cashRegisterId: string): void {
    this.current = { businessId, branchId, cashRegisterId };
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey(businessId, branchId), cashRegisterId);
    } catch {
      // La persistencia local es solo UX; la autoridad es Supabase.
    }
    this.publish(this.current);
  }

  clear(): void {
    const { businessId, branchId } = this.current;
    if (businessId && branchId && typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(storageKey(businessId, branchId));
      } catch {
        // no-op
      }
    }
    this.current = { businessId, branchId, cashRegisterId: null };
    this.publish(this.current);
  }
}

export const cashRegisterStore = new CashRegisterStore();
