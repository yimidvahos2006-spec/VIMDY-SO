/**
 * PaymentFactory.ts
 * ---------------------------------------------------------------------------
 * Único lugar de todo VIMDY que sabe instanciar un proveedor concreto.
 * Agregar un proveedor nuevo en el futuro es: crear su carpeta en
 * providers/, implementar IPaymentProvider, y registrarlo en el switch de
 * abajo. Ningún otro archivo del sistema necesita cambiar.
 */

import type { IPaymentProvider } from "./interfaces/IPaymentProvider";
import type { PaymentProviderName } from "./types/payment.types";
import { WompiProvider } from "./providers/wompi/WompiProvider";
import { MercadoPagoProvider } from "./providers/mercadopago/MercadoPagoProvider";
import { PayPalProvider } from "./providers/paypal/PayPalProvider";

export class PaymentFactory {
  private static instances: Partial<Record<PaymentProviderName, IPaymentProvider>> = {};

  /** Devuelve la instancia (singleton) del proveedor solicitado. */
  static create(provider: PaymentProviderName): IPaymentProvider {
    if (!this.instances[provider]) {
      this.instances[provider] = this.build(provider);
    }
    return this.instances[provider] as IPaymentProvider;
  }

  private static build(provider: PaymentProviderName): IPaymentProvider {
    switch (provider) {
      case "wompi":
        return new WompiProvider();
      case "mercadopago":
        return new MercadoPagoProvider();
      case "paypal":
        return new PayPalProvider();
      default: {
        const exhaustiveCheck: never = provider;
        throw new Error(`PaymentFactory: proveedor no soportado (${exhaustiveCheck}).`);
      }
    }
  }
}