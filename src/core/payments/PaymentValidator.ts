/**
 * PaymentValidator.ts
 * ---------------------------------------------------------------------------
 * Valida la entrada ANTES de que llegue al GlobalPaymentRouter. Solo reglas
 * genéricas de negocio — nada de lógica de proveedores acá.
 */

import type { PaymentRoutingInput } from "./models/PaymentModels";

const ALLOWED_COUNTRIES = new Set(["CO", "MX", "PE", "CL", "AR", "ES", "EC", "PA", "US", "VE"]);

export class PaymentValidator {
  static validateRoutingInput(input: PaymentRoutingInput): void {
    if (!input.businessId) {
      throw new Error("PaymentValidator: businessId es obligatorio.");
    }
    if (!input.country) {
      throw new Error("PaymentValidator: el país es obligatorio.");
    }
    if (!ALLOWED_COUNTRIES.has(input.country)) {
      throw new Error(`PaymentValidator: país no soportado: ${input.country}. Solo se permite: ${Array.from(ALLOWED_COUNTRIES).join(", ")}.`);
    }
    if (!input.businessType) {
      throw new Error("PaymentValidator: el tipo de negocio es obligatorio.");
    }
    if (!input.plan) {
      throw new Error("PaymentValidator: el plan es obligatorio.");
    }
    if (typeof input.amount !== "number" || Number.isNaN(input.amount) || input.amount <= 0) {
      throw new Error("PaymentValidator: el monto debe ser un número mayor a 0.");
    }
  }
}