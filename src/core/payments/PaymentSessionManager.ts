/**
 * PaymentSessionManager.ts
 * ---------------------------------------------------------------------------
 * Mantiene el estado de las sesiones de checkout y permite persistirlas fuera
 * de la memoria del proceso. El backend real debería guardar esto en la tabla
 * payment_sessions en Postgres, pero en frontend/engine puro necesitamos una
 * implementación segura y compatible que no dependa de un Map como único
 * almacenamiento definitivo.
 */

import type { PaymentSession } from "./models/PaymentModels";
import type { CountryCode, CurrencyCode, PaymentProviderName, PaymentStatus } from "./types/payment.types";
import { generatePaymentId, nowIso } from "./utils/paymentUtils";

const STORAGE_KEY = "vimdy_payment_sessions";

export class PaymentSessionManager {
  private static readonly inMemoryStore = new Map<string, PaymentSession>();

  static create(params: {
    provider: PaymentProviderName;
    country: CountryCode;
    currency: CurrencyCode;
    amount: number;
    businessId?: string;
    branchId?: string | null;
    providerReference?: string | null;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown>;
    expiresAt?: string | null;
  }): PaymentSession {
    const now = nowIso();
    const session: PaymentSession = {
      id: generatePaymentId("session"),
      businessId: params.businessId,
      branchId: params.branchId ?? null,
      provider: params.provider,
      providerReference: params.providerReference ?? null,
      country: params.country,
      currency: params.currency,
      amount: params.amount,
      status: "pending",
      idempotencyKey: params.idempotencyKey ?? null,
      metadata: params.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      expiresAt: params.expiresAt ?? null,
    };

    this.inMemoryStore.set(session.id, session);
    this.persist(session);
    return session;
  }

  static get(sessionId: string): PaymentSession | undefined {
    const session = this.inMemoryStore.get(sessionId) ?? this.loadFromPersistence().get(sessionId);
    if (session) {
      this.inMemoryStore.set(sessionId, session);
    }
    return session;
  }

  static findByIdempotencyKey(idempotencyKey: string): PaymentSession | undefined {
    const candidates = this.loadFromPersistence();
    return [...candidates.values()].find(
      (session) => session.idempotencyKey === idempotencyKey
    );
  }

  static updateStatus(
    sessionId: string,
    status: PaymentStatus,
    patch: Partial<PaymentSession> = {}
  ): PaymentSession | undefined {
    const session = this.get(sessionId);
    if (!session) return undefined;

    Object.assign(session, patch, {
      status,
      updatedAt: nowIso(),
    });

    this.inMemoryStore.set(sessionId, session);
    this.persist(session);
    return session;
  }

  static listAll(): PaymentSession[] {
    return [...this.loadFromPersistence().values()];
  }

  static clearExpired(now: Date = new Date()): number {
    const expired = [...this.loadFromPersistence().values()].filter((session) => {
      if (!session.expiresAt) return false;
      return new Date(session.expiresAt).getTime() <= now.getTime();
    });

    for (const session of expired) {
      this.inMemoryStore.delete(session.id);
      this.removeFromPersistence(session.id);
    }

    return expired.length;
  }

  private static persist(session: PaymentSession): void {
    const storage = this.getStorage();
    if (!storage) return;

    try {
      const records = this.loadFromPersistence();
      records.set(session.id, session);
      storage.setItem(STORAGE_KEY, JSON.stringify([...records.entries()]));
    } catch {
      // Persistencia opcional: si no existe almacenamiento o falla, la sesión se
      // mantiene en la memoria del proceso; el backend real debe ser la fuente
      // definitiva en producción.
    }
  }

  private static removeFromPersistence(sessionId: string): void {
    const storage = this.getStorage();
    if (!storage) return;

    try {
      const records = this.loadFromPersistence();
      records.delete(sessionId);
      storage.setItem(STORAGE_KEY, JSON.stringify([...records.entries()]));
    } catch {
      // Ignorar si no hay storage disponible.
    }
  }

  private static loadFromPersistence(): Map<string, PaymentSession> {
    const storage = this.getStorage();
    if (!storage) {
      return this.inMemoryStore;
    }

    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) {
        return this.inMemoryStore;
      }

      const parsed = JSON.parse(raw) as Array<[string, PaymentSession]>;
      if (!Array.isArray(parsed)) {
        return this.inMemoryStore;
      }

      const records = new Map<string, PaymentSession>(parsed);
      for (const [id, session] of records.entries()) {
        this.inMemoryStore.set(id, session);
      }
      return this.inMemoryStore;
    } catch {
      return this.inMemoryStore;
    }
  }

  private static getStorage(): Storage | null {
    try {
      if (typeof window === "undefined") return null;
      return window.localStorage;
    } catch {
      return null;
    }
  }
}