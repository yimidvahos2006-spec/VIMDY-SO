/**
 * InvoiceFactory.ts
 * ---------------------------------------------------------------------------
 * Único lugar de todo VIMDY que sabe instanciar un proveedor concreto de
 * facturación electrónica. Agregar un proveedor nuevo en el futuro (Alegra,
 * Plemsi, u otro para México/Perú) es: crear su carpeta en providers/,
 * implementar IInvoiceProvider, y registrarlo en el switch de abajo. Ningún
 * otro archivo del sistema necesita cambiar.
 *
 * Mismo patrón que payments/PaymentFactory.ts, con una diferencia a
 * propósito: `resolve()` puede devolver `null`. Para pagos, todo negocio
 * SIEMPRE necesita un proveedor (no puede vender sin cobrar); para
 * facturación electrónica, `null` es el estado correcto y esperado para la
 * mayoría de los negocios de VIMDY — el resto del sistema (ReceiptEngine,
 * SalesEngine) debe tratar `null` como "sigue con el recibo normal, no
 * hagas nada más", nunca como un error.
 */

import type { IInvoiceProvider } from "./interfaces/IInvoiceProvider";
import type { InvoiceProviderName } from "./types/invoice.types";
import { FactusProvider } from "./providers/factus/FactusProvider";

/** Proveedores reales, es decir, todo InvoiceProviderName salvo "none". */
type RealInvoiceProviderName = Exclude<InvoiceProviderName, "none">;

export class InvoiceFactory {
  private static instances: Partial<Record<RealInvoiceProviderName, IInvoiceProvider>> = {};

  /**
   * Punto de entrada real: dado lo que el negocio configuró en
   * companyConfigStore (electronicInvoicing), devuelve el proveedor a usar
   * o `null` si el negocio no factura electrónicamente. Nadie debe llamar
   * a `create()` directamente sin pasar antes por acá.
   */
  static resolve(electronicInvoicing: { enabled: boolean; provider: InvoiceProviderName }): IInvoiceProvider | null {
    if (!electronicInvoicing.enabled || electronicInvoicing.provider === "none") {
      return null;
    }
    return this.create(electronicInvoicing.provider as RealInvoiceProviderName);
  }

  /** Devuelve la instancia (singleton) del proveedor solicitado. */
  static create(provider: RealInvoiceProviderName): IInvoiceProvider {
    if (!this.instances[provider]) {
      this.instances[provider] = this.build(provider);
    }
    return this.instances[provider] as IInvoiceProvider;
  }

  private static build(provider: RealInvoiceProviderName): IInvoiceProvider {
    switch (provider) {
      case "factus":
        return new FactusProvider();
      default: {
        const exhaustiveCheck: never = provider;
        throw new Error(`InvoiceFactory: proveedor no soportado (${exhaustiveCheck}).`);
      }
    }
  }
}