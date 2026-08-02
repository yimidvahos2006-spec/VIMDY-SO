/**
 * PaymentStatusManager.ts
 * ---------------------------------------------------------------------------
 * Traduce estados propios de cada proveedor al vocabulario único de VIMDY
 * (PaymentStatus). El resto de la app solo debe ver PaymentStatus — nunca
 * strings crudos de Wompi, Mercado Pago o PayPal.
 */

import type { IPaymentProvider } from "./interfaces/IPaymentProvider";
import type { PaymentStatus } from "./types/payment.types";

export class PaymentStatusManager {
  static normalize(provider: IPaymentProvider, providerStatus: string): PaymentStatus {
    return provider.getStatus(providerStatus);
  }
}