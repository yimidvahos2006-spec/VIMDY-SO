/**
 * PaymentWebhookManager.ts
 * ---------------------------------------------------------------------------
 * Punto único de entrada para notificaciones (webhooks) de los proveedores.
 * Valida la respuesta con el proveedor correspondiente y devuelve un
 * WebhookEvent ya normalizado — el resto de VIMDY nunca ve el payload
 * crudo de Wompi, Mercado Pago o PayPal.
 */

import type { PaymentProviderName, PaymentStatus } from "./types/payment.types";
import type { WebhookEvent } from "./models/PaymentModels";
import { PaymentFactory } from "./PaymentFactory";
import { nowIso } from "./utils/paymentUtils";

export class PaymentWebhookManager {
  static handle(params: {
    provider: PaymentProviderName;
    paymentId: string;
    providerStatus: string;
    payload: unknown;
    signature?: string;
  }): WebhookEvent {
    const providerInstance = PaymentFactory.create(params.provider);

    const isValid = providerInstance.validateResponse(params.payload, params.signature);
    if (!isValid) {
      throw new Error(`PaymentWebhookManager: webhook inválido para el proveedor "${params.provider}".`);
    }

    const status: PaymentStatus = providerInstance.getStatus(params.providerStatus);

    return {
      provider: params.provider,
      paymentId: params.paymentId,
      status,
      receivedAt: nowIso(),
      raw: params.payload
    };
  }
}