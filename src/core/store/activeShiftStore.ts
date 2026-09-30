import { ObservableStore } from "./ObservableStore";

export interface ActiveShiftSnapshot {
  readonly businessId: string | null;
  readonly branchId: string | null;
  readonly cashierId: string | null;
  readonly shiftId: string | null;
  readonly cashRegisterId: string | null;
}

const EMPTY: ActiveShiftSnapshot = {
  businessId: null,
  branchId: null,
  cashierId: null,
  shiftId: null,
  cashRegisterId: null,
};

function storageKey(businessId: string, branchId: string, cashierId: string): string {
  return `vimdy.active-shift.v1:${businessId}:${branchId}:${cashierId}`;
}

function isValidSnapshot(value: unknown): value is Omit<ActiveShiftSnapshot, "businessId" | "branchId" | "cashierId"> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.shiftId === "string" && typeof record.cashRegisterId === "string";
}

class ActiveShiftStore extends ObservableStore<ActiveShiftSnapshot> {
  private current: ActiveShiftSnapshot = EMPTY;

  constructor() {
    super(EMPTY);
  }

  hydrate(businessId: string | null, branchId: string | null, cashierId: string | null): void {
    if (!businessId || !branchId || !cashierId || typeof window === "undefined") {
      if (this.current !== EMPTY) {
        this.current = EMPTY;
        this.publish(this.current);
      }
      return;
    }

    try {
      const raw = window.localStorage.getItem(storageKey(businessId, branchId, cashierId));
      if (!raw) {
        this.current = { businessId, branchId, cashierId, shiftId: null, cashRegisterId: null };
        this.publish(this.current);
        return;
      }

      const parsed: unknown = JSON.parse(raw);
      if (!isValidSnapshot(parsed)) {
        window.localStorage.removeItem(storageKey(businessId, branchId, cashierId));
        this.current = { businessId, branchId, cashierId, shiftId: null, cashRegisterId: null };
        this.publish(this.current);
        return;
      }

      const next: ActiveShiftSnapshot = {
        businessId,
        branchId,
        cashierId,
        shiftId: parsed.shiftId,
        cashRegisterId: parsed.cashRegisterId,
      };
      this.current = next;
      this.publish(this.current);
    } catch {
      this.current = { businessId, branchId, cashierId, shiftId: null, cashRegisterId: null };
      this.publish(this.current);
    }
  }

  set(snapshot: { businessId: string; branchId: string; cashierId: string; shiftId: string; cashRegisterId: string }): void {
    this.current = snapshot;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          storageKey(snapshot.businessId, snapshot.branchId, snapshot.cashierId),
          JSON.stringify({ shiftId: snapshot.shiftId, cashRegisterId: snapshot.cashRegisterId })
        );
      } catch {
        // Persistencia local = recuperación UX; el servidor sigue siendo autoridad.
      }
    }
    this.publish(this.current);
  }

  getFor(businessId: string, branchId: string, cashierId: string): ActiveShiftSnapshot {
    if (
      this.current.businessId === businessId &&
      this.current.branchId === branchId &&
      this.current.cashierId === cashierId
    ) {
      return this.current;
    }
    this.hydrate(businessId, branchId, cashierId);
    return this.current;
  }

  clear(businessId?: string, branchId?: string, cashierId?: string): void {
    const targetBusiness = businessId ?? this.current.businessId;
    const targetBranch = branchId ?? this.current.branchId;
    const targetCashier = cashierId ?? this.current.cashierId;

    if (targetBusiness && targetBranch && targetCashier && typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(storageKey(targetBusiness, targetBranch, targetCashier));
      } catch {
        // no-op
      }
    }

    if (
      this.current.businessId === targetBusiness &&
      this.current.branchId === targetBranch &&
      this.current.cashierId === targetCashier
    ) {
      this.current = {
        businessId: targetBusiness ?? null,
        branchId: targetBranch ?? null,
        cashierId: targetCashier ?? null,
        shiftId: null,
        cashRegisterId: null,
      };
      this.publish(this.current);
    }
  }
}

export const activeShiftStore = new ActiveShiftStore();
