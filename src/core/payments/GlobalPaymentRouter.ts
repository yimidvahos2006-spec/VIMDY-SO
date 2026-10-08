/**
 * GlobalPaymentRouter.ts
 * ---------------------------------------------------------------------------
 * Punto central de enrutamiento de VIMDY Payments.
 *
 * Este módulo NO contiene reglas de país/proveedor. Se limita a coordinar
 * PaymentValidator + resolvers + PaymentFactory y a construir el
 * PaymentRequest canónico que consumen los proveedores.
 *
 * IMPORTANTE:
 * - El amount efectivo de una suscripción se obtiene de getPlanPrice().
 * - Si el caller suministra amount, solo se acepta si coincide con el precio
 *   canónico; nunca se utiliza el monto del navegador como autoridad.
 * - Los métodos ofrecidos por PaymentMethodResolver se contrastan con los
 *   métodos que realmente declara el proveedor. Una discrepancia es un error
 *   de configuración y se rechaza en fail-closed.
 */

import type { IPaymentProvider } from "./interfaces/IPaymentProvider";
import type {
  PaymentMethodCode,
  PaymentProviderName
} from "./types/payment.types";
import type {
  PaymentRequest,
  PaymentRoutingInput
} from "./models/PaymentModels";
import { PaymentCountryResolver } from "./PaymentCountryResolver";
import { PaymentCurrencyResolver } from "./PaymentCurrencyResolver";
import { PaymentMethodResolver } from "./PaymentMethodResolver";
import { PaymentFactory } from "./PaymentFactory";
import { PaymentValidator } from "./PaymentValidator";
import { generatePaymentId } from "./utils/paymentUtils";
import { getPlanPrice } from "../entities/SubscriptionTypes";

export interface RoutingDecision {
  readonly provider: PaymentProviderName;
  readonly providerInstance: IPaymentProvider;
  readonly request: PaymentRequest;
  readonly availableMethods: PaymentMethodCode[];
}

const MAX_MONEY_DELTA = 0.005;

export class GlobalPaymentRouter {
  static route(input: PaymentRoutingInput): RoutingDecision {
    PaymentValidator.validateRoutingInput(input);

    const provider = PaymentCountryResolver.resolve(input.country);
    const providerInstance = PaymentFactory.create(provider);
    const currency = input.currency ?? PaymentCurrencyResolver.resolve(input.country);
    const resolverMethods = PaymentMethodResolver.resolve(input.country);
    const providerMethods = providerInstance.getAvailableMethods(input.country);
    const availableMethods = GlobalPaymentRouter.reconcileMethods(
      resolverMethods,
      providerMethods
    );

    if (input.method && !availableMethods.includes(input.method)) {
      throw new Error(
        `PaymentRouter: método "${input.method}" no está disponible para ${input.country} con ${provider}.`
      );
    }

    const plan = input.plan as "monthly" | "yearly";
    const canonicalAmount = getPlanPrice(plan, input.country);

    if (!Number.isFinite(canonicalAmount) || canonicalAmount <= 0) {
      throw new Error(
        `PaymentRouter: no existe un precio canónico válido para ${plan}/${input.country}.`
      );
    }

    if (
      input.amount !== undefined &&
      Math.abs(input.amount - canonicalAmount) > MAX_MONEY_DELTA
    ) {
      throw new Error(
        `PaymentRouter: monto no autorizado. Esperado ${canonicalAmount}, recibido ${input.amount}.`
      );
    }

    const request: PaymentRequest = {
      id: generatePaymentId(),
      provider,
      businessId: input.businessId,
      country: input.country,
      currency,
      amount: canonicalAmount,
      method: input.method,
      businessType: input.businessType,
      plan
    };

    return {
      provider,
      providerInstance,
      request,
      availableMethods
    };
  }

  private static reconcileMethods(
    resolverMethods: PaymentMethodCode[],
    providerMethods: PaymentMethodCode[]
  ): PaymentMethodCode[] {
    const providerSet = new Set(providerMethods);
    const result = resolverMethods.filter((method) => providerSet.has(method));

    if (result.length === 0) {
      throw new Error(
        "PaymentRouter: la configuración de país y proveedor no comparte métodos de pago válidos."
      );
    }

    return Array.from(new Set(result));
  }
}
