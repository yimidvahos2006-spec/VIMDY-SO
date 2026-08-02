/**
 * PaymentSessionManager.ts
 * ---------------------------------------------------------------------------
 * Mantiene el estado de las sesiones de checkout mientras el usuario
 * completa el pago. En esta fase vive en memoria; el día que se reemplace
 * por persistencia real (base de datos), ningún otro archivo del motor de
 * pagos debería cambiar — solo este.
 */

import type { PaymentSession } from "./models/PaymentModels";
import type { CountryCode, CurrencyCode, PaymentProviderName, PaymentStatus } from "./types/payment.types";
import { generatePaymentId, nowIso } from "./utils/paymentUtils";

export class PaymentSessionManager {
  private static sessions = new Map<string, PaymentSession>();

  static create(params: {
    provider: PaymentProviderName;
    country: CountryCode;
    currency: CurrencyCode;
    amount: number;
  }): PaymentSession {
    const session: PaymentSession = {
      id: generatePaymentId("session"),
      provider: params.provider,
      country: params.country,
      currency: params.currency,
      amount: params.amount,
      status: "pending",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.sessions.set(session.id, session);
    return session;
  }

  static get(sessionId: string): PaymentSession | undefined {
    return this.sessions.get(sessionId);
  }

  static updateStatus(sessionId: string, status: PaymentStatus): PaymentSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.status = status;
    session.updatedAt = nowIso();
    return session;
  }
}