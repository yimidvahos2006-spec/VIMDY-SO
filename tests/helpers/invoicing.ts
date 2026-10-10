import { InvoiceFactory, configureInvoiceProviderResolver } from "../../src/core/invoicing/InvoiceFactory";
import { DianProvider } from "../../src/core/invoicing/providers/dian/DianProvider";
import { FactusProvider } from "../../src/core/invoicing/providers/factus/FactusProvider";
import type { CountryCode } from "../../src/core/config/globalization";
import type { IInvoiceProvider } from "../../src/core/invoicing/interfaces/IInvoiceProvider";
import type { InvoiceProviderName } from "../../src/core/invoicing/types/invoice.types";
import { companyConfigStore } from "../../src/core/store/companyConfigStore";

/**
 * InvoiceFactory ya no recibe configuración por argumento: lee el store vivo
 * y obtiene los providers del resolver que registra CompositionRoot. Este
 * helper reproduce ese cableado para los tests, sin importar CompositionRoot
 * (que arrastra Supabase e IndexedDB).
 */
export function registerTestInvoiceProviders(): void {
  const dian = new DianProvider();
  const factus = new FactusProvider();

  configureInvoiceProviderResolver((provider) =>
    provider === "dian" ? dian : factus
  );
}

export function setInvoicingConfig(config: {
  enabled: boolean;
  provider: InvoiceProviderName;
  country: CountryCode;
}): void {
  companyConfigStore.update({
    country: config.country,
    electronicInvoicing: {
      enabled: config.enabled,
      provider: config.provider
    }
  });
}

/**
 * InvoiceFactory.resolve() ignora sus argumentos y lee companyConfigStore.
 * Fija la configuración en el store y resuelve con ella.
 */
export function resolveInvoiceProvider(
  electronicInvoicing: { enabled: boolean; provider: InvoiceProviderName },
  country: CountryCode
): IInvoiceProvider | null {
  setInvoicingConfig({ ...electronicInvoicing, country });
  return InvoiceFactory.resolve();
}