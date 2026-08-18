import type { Subscription, SubscriptionPayment, SubscriptionAuditEntry } from "../../src/core/entities/SubscriptionTypes";

export class FakeSubscriptionRepository {
  private businesses: Map<string, Subscription> = new Map();
  private payments: Map<string, SubscriptionPayment> = new Map();
  private auditLog: SubscriptionAuditEntry[] = [];

  setBusiness(sub: Subscription): void {
    this.businesses.set(sub.businessId, sub);
  }

  getBusiness(businessId: string): Subscription | undefined {
    return this.businesses.get(businessId);
  }

  updateBusiness(businessId: string, patch: Partial<Subscription>): void {
    const existing = this.businesses.get(businessId);
    if (!existing) return;
    this.businesses.set(businessId, { ...existing, ...patch });
  }

  addPayment(payment: SubscriptionPayment): void {
    this.payments.set(payment.id, payment);
  }

  getPayment(paymentId: string): SubscriptionPayment | undefined {
    return this.payments.get(paymentId);
  }

  updatePayment(paymentId: string, patch: Partial<SubscriptionPayment>): void {
    const existing = this.payments.get(paymentId);
    if (!existing) return;
    this.payments.set(paymentId, { ...existing, ...patch });
  }

  addAuditEntry(entry: SubscriptionAuditEntry): void {
    this.auditLog.push(entry);
  }

  getAuditLog(businessId: string): SubscriptionAuditEntry[] {
    return this.auditLog.filter((e) => e.businessId === businessId);
  }

  clear(): void {
    this.businesses.clear();
    this.payments.clear();
    this.auditLog = [];
  }
}
