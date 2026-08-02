/**
 * GlobalPaymentRouter.ts
 * ---------------------------------------------------------------------------
 * El cerebro de VIMDY Payments.
 *
 * Recibe ÚNICAMENTE: país, moneda (opcional), tipo de negocio, plan y
 * monto — y decide automáticamente qué proveedor real usar, resolviendo
 * también la moneda y los métodos de pago a mostrar.
 *
 * Prohibido: agregar cualquier `if (pais == "X") usar Y` fuera de los
 * resolvers (PaymentCountryResolver, PaymentCurrencyResolver,
 * PaymentMethodResolver). Este archivo solo ORQUESTA, no decide reglas.
 */

import type { IPaymentProvider } from "./interfaces/IPaymentProvider";
import type { PaymentMethodCode, PaymentProviderName } from "./types/payment.types";
import type { PaymentRequest, PaymentRoutingInput } from "./models/PaymentModels";
import { PaymentCountryResolver } from "./PaymentCountryResolver";
import { PaymentCurrencyResolver } from "./PaymentCurrencyResolver";
import { PaymentMethodResolver } from "./PaymentMethodResolver";
import { PaymentFactory } from "./PaymentFactory";
import { PaymentValidator } from "./PaymentValidator";
import { generatePaymentId } from "./utils/paymentUtils";

export interface RoutingDecision {
  provider: PaymentProviderName;
  providerInstance: IPaymentProvider;
  request: PaymentRequest;
  availableMethods: PaymentMethodCode[];
}

export class GlobalPaymentRouter {
  static route(input: PaymentRoutingInput): RoutingDecision {
    PaymentValidator.validateRoutingInput(input);

    const provider = PaymentCountryResolver.resolve(input.country);
    const providerInstance = PaymentFactory.create(provider);
    const currency = input.currency ?? PaymentCurrencyResolver.resolve(input.country);
    const availableMethods = PaymentMethodResolver.resolve(input.country);

    const request: PaymentRequest = {
      id: generatePaymentId(),
      provider,
      businessId: input.businessId,
      country: input.country,
      currency,
      amount: input.amount,
      method: input.method,
      businessType: input.businessType,
      plan: input.plan
    };

    return { provider, providerInstance, request, availableMethods };
  }
}