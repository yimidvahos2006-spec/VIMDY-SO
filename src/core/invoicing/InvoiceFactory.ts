/**
 * InvoiceFactory.ts
 * ---------------------------------------------------------------------------
 * Punto único de resolución de proveedores de facturación electrónica.
 *
 * Regla arquitectónica:
 * - La factoría NO conoce implementaciones concretas (FactusProvider/DianProvider).
 * - Las implementaciones son construidas exclusivamente por CompositionRoot.
 * - CompositionRoot inyecta un resolver lazy mediante configureInvoiceProviderResolver().
 * - Los resultados expuestos por esta factoría al frontend pasan por una whitelist DTO
 *   que elimina cualquier dato crudo del proveedor (`raw`, `raw_response`, etc.).
 */

import type { CountryCode } from "../config/globalization";
import { companyConfigStore } from "../store/companyConfigStore";
import type { IInvoiceProvider } from "./interfaces/IInvoiceProvider";
import type { InvoiceResult } from "./models/InvoiceModels";
import type { InvoiceProviderName } from "./types/invoice.types";

type RealInvoiceProviderName = Exclude<InvoiceProviderName, "none">;

type RuntimeElectronicInvoicing = {
  enabled: boolean;
  provider?: unknown;
};

export type FrontendInvoiceDTO = Omit<InvoiceResult, "raw">;

export type InvoiceProviderResolver = (
  provider: RealInvoiceProviderName
) => IInvoiceProvider;

const PROVIDER_COUNTRIES: Record<RealInvoiceProviderName, CountryCode[]> = {
  factus: ["CO"],
  dian: ["CO"]
};

let providerResolver: InvoiceProviderResolver | null = null;

function normalizeCountry(country: CountryCode): CountryCode {
  return country.trim().toUpperCase() as CountryCode;
}

function normalizeProvider(value: unknown): InvoiceProviderName {
  if (value === "factus" || value === "dian") {
    return value;
  }

  return "none";
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/**
 * CompositionRoot llama esta función durante su inicialización para inyectar
 * el resolver que conoce las implementaciones reales. La construcción queda
 * fuera de esta capa y permanece lazy.
 */
export function configureInvoiceProviderResolver(
  resolver: InvoiceProviderResolver
): void {
  providerResolver = resolver;
}

function requireProviderResolver(): InvoiceProviderResolver {
  if (!providerResolver) {
    throw new Error(
      "INVOICE_FACTORY_NOT_CONFIGURED: CompositionRoot aún no registró el resolver fiscal."
    );
  }

  return providerResolver;
}

/**
 * Whitelist estricta de datos autorizados a cruzar hacia el frontend.
 *
 * Nunca se hace spread de InvoiceResult porque ese objeto puede contener `raw`
 * con la respuesta original del proveedor fiscal. Todo campo retornado se
 * enumera explícitamente en este DTO.
 */
export function frontendInvoice(
  result: InvoiceResult
): FrontendInvoiceDTO {
  const id = result.id.trim();

  if (!id) {
    throw new Error("INVOICE_FRONTEND_DTO_ID_REQUIRED");
  }

  const createdAt = result.createdAt.trim();

  if (!createdAt) {
    throw new Error("INVOICE_FRONTEND_DTO_CREATED_AT_REQUIRED");
  }

  return {
    id,
    provider: result.provider,
    status: result.status,
    number: optionalText(result.number),
    trackingCode: optionalText(result.trackingCode),
    pdfUrl: optionalText(result.pdfUrl),
    xmlUrl: optionalText(result.xmlUrl),
    qrCode: optionalText(result.qrCode),
    createdAt,
    errorMessage: optionalText(result.errorMessage)
  };
}

/**
 * Decorador local que garantiza que ningún InvoiceResult crudo se entregue al
 * consumidor de la factoría. El provider real sigue siendo propiedad del
 * CompositionRoot; este adaptador solo controla el DTO de salida.
 */
function frontendSafeProvider(
  provider: IInvoiceProvider
): IInvoiceProvider {
  return {
    name: provider.name,

    async createInvoice(request) {
      const result = await provider.createInvoice(request);
      return frontendInvoice(result);
    },

    async getInvoice(invoiceId) {
      const result = await provider.getInvoice(invoiceId);
      return frontendInvoice(result);
    },

    async cancelInvoice(invoiceId, reason) {
      const result = await provider.cancelInvoice(invoiceId, reason);
      return frontendInvoice(result);
    },

    supportsCountry(country) {
      return provider.supportsCountry(country);
    },

    validateResponse(payload, signature) {
      return provider.validateResponse(payload, signature);
    }
  };
}

export class InvoiceFactory {
  /**
   * Resuelve el proveedor usando la configuración viva actual.
   *
   * Los argumentos legacy permanecen por compatibilidad con callers existentes,
   * pero no sustituyen la configuración del negocio almacenada en el store.
   */
  static resolve(
    _electronicInvoicing?: {
      enabled: boolean;
      provider: InvoiceProviderName;
    },
    _country?: CountryCode
  ): IInvoiceProvider | null {
    const currentConfig = companyConfigStore.get();
    const electronicInvoicing =
      currentConfig.electronicInvoicing as RuntimeElectronicInvoicing;

    if (!electronicInvoicing.enabled) {
      return null;
    }

    const provider = normalizeProvider(electronicInvoicing.provider);

    if (provider === "none") {
      return null;
    }

    const country = normalizeCountry(currentConfig.country);
    const supportedCountries = PROVIDER_COUNTRIES[provider];

    if (!supportedCountries.includes(country)) {
      return null;
    }

    return InvoiceFactory.create(provider);
  }

  /**
   * Obtiene la implementación concreta exclusivamente a través del resolver
   * inyectado por CompositionRoot. La construcción de Factus/Dian nunca ocurre
   * dentro de esta factoría.
   */
  static create(provider: RealInvoiceProviderName): IInvoiceProvider {
    const resolver = requireProviderResolver();
    return frontendSafeProvider(resolver(provider));
  }

  /**
   * Normaliza un resultado fiscal para cualquier superficie de frontend.
   * Expuesto como método estático para conservar un punto único de uso en
   * consumers existentes que ya trabajan con InvoiceFactory.
   */
  static frontendInvoice(result: InvoiceResult): FrontendInvoiceDTO {
    return frontendInvoice(result);
  }
}
