/**
 * PaymentStatusManager.ts
 * ---------------------------------------------------------------------------
 * Traduce el estado propio de cada proveedor al vocabulario normalizado de
 * VIMDY Payments. La lógica concreta de cada proveedor permanece dentro del
 * provider y este manager solo aplica el contrato común.
 */

import type { IPaymentProvider } from "./interfaces/IPaymentProvider";
import type { PaymentStatus } from "./types/payment.types";

export class PaymentStatusManager {
  static normalize(
    provider: IPaymentProvider,
    providerStatus: string
  ): PaymentStatus {
    if (!provider) {
      throw new Error("PAYMENT_STATUS_PROVIDER_REQUIRED");
    }

    if (typeof providerStatus !== "string" || !providerStatus.trim()) {
      throw new Error("PAYMENT_STATUS_PROVIDER_STATUS_REQUIRED");
    }

    const normalized = provider.getStatus(providerStatus.trim());

    switch (normalized) {
      case "pending":
      case "approved":
      case "declined":
      case "cancelled":
      case "expired":
      case "refunded":
      case "partially_refunded":
      case "error":
        return normalized;
      default: {
        const exhaustiveCheck: never = normalized;
        throw new Error(
          `PAYMENT_STATUS_INVALID_NORMALIZED_VALUE: ${String(exhaustiveCheck)}`
        );
      }
    }
  }
}
