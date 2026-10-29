// src/core/domain/customers/quickCreate.ts
/* ===========================================================================
   Alta ultrarrápida de clientes — dominio puro (sin I/O).
   ---------------------------------------------------------------------------
   UNA sola definición de qué es obligatorio al crear un cliente, compartida
   por el panel de Clientes y por Caja para que no puedan divergir:

     OBLIGATORIO  ->  nombre y teléfono. Nada más.
     OPCIONAL     ->  correo, tipo y número de documento (fiscal), dirección,
                      notas/preferencias. Vacío = simplemente no se guarda.

   Por qué importa: en hora pico cada campo obligatorio extra es una fila que
   se detiene. Si mañana alguien agrega "correo obligatorio" en un modal, este
   archivo (y su test) es lo que se rompe, no la caja en producción.

   El teléfono se valida de forma PERMISIVA a propósito (solo que tenga al
   menos 7 dígitos, la misma regla que ya usaba Caja). La normalización
   estricta a E.164 de phone.ts no se aplica aquí: rechazaría números que el
   cajero ya está dictando y frenaría la fila.
=========================================================================== */

import type { Customer } from "../../entities/Entities";
import { phoneDigits } from "./search";

export const MIN_CUSTOMER_NAME_LENGTH = 2;
export const MIN_CUSTOMER_PHONE_DIGITS = 7;

/** Lo que captura un formulario de cliente. Todo es texto crudo del teclado. */
export interface CustomerFormValues {
  readonly name: string;
  readonly phone?: string;
  readonly email?: string;
  readonly documentType?: Customer["documentType"];
  readonly documentNumber?: string;
  readonly address?: string;
  readonly notes?: string;
}

export type CustomerFieldError =
  | "NAME_REQUIRED"
  | "PHONE_REQUIRED"
  | "PHONE_TOO_SHORT";

export type CustomerValidation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Campo que debe recibir el cursor. */
      readonly field: "name" | "phone";
      readonly error: CustomerFieldError;
    };

export interface ValidateOptions {
  /**
   * true (por defecto) = el teléfono es obligatorio: así es toda alta nueva.
   * false = solo al EDITAR un cliente antiguo que nunca tuvo teléfono, para no
   * dejarlo sin poder corregir ni sus notas hasta conseguir un número.
   */
  readonly requirePhone?: boolean;
}

/**
 * Valida únicamente lo obligatorio. Nunca mira correo, documento, dirección
 * ni notas: esos campos no pueden bloquear un guardado.
 */
export function validateCustomerRequired(
  values: Pick<CustomerFormValues, "name" | "phone">,
  options: ValidateOptions = {}
): CustomerValidation {
  const requirePhone = options.requirePhone ?? true;

  if ((values.name ?? "").trim().length < MIN_CUSTOMER_NAME_LENGTH) {
    return { ok: false, field: "name", error: "NAME_REQUIRED" };
  }

  const phone = (values.phone ?? "").trim();

  if (phone === "") {
    return requirePhone
      ? { ok: false, field: "phone", error: "PHONE_REQUIRED" }
      : { ok: true };
  }

  // Si se escribió algo, tiene que parecer un teléfono (aunque sea opcional al editar).
  if (phoneDigits(phone).length < MIN_CUSTOMER_PHONE_DIGITS) {
    return { ok: false, field: "phone", error: "PHONE_TOO_SHORT" };
  }

  return { ok: true };
}

/** Texto recortado, o undefined si quedó vacío (así el campo no se guarda). */
function optionalText(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Normaliza los valores del formulario a los campos de `Customer`.
 * - Recorta espacios y convierte "" en undefined.
 * - `documentType` solo se conserva si hay `documentNumber` (un tipo suelto,
 *   como el "CC" que viene preseleccionado en el formulario, no es un dato).
 * No valida: llamar antes a validateCustomerRequired().
 */
export function normalizeCustomerFields(
  values: CustomerFormValues
): Pick<
  Customer,
  "name" | "phone" | "email" | "documentType" | "documentNumber" | "address" | "notes"
> {
  const documentNumber = optionalText(values.documentNumber);

  return {
    name: values.name.trim(),
    phone: optionalText(values.phone),
    email: optionalText(values.email),
    documentType: documentNumber ? values.documentType ?? "CC" : undefined,
    documentNumber,
    address: optionalText(values.address),
    notes: optionalText(values.notes)
  };
}

/** Cliente nuevo listo para guardar (puntos en 0, id y fecha los pone el llamador). */
export function buildNewCustomer(
  values: CustomerFormValues,
  meta: { readonly id: string; readonly createdAt: Date }
): Customer {
  return {
    id: meta.id,
    ...normalizeCustomerFields(values),
    points: 0,
    createdAt: meta.createdAt
  };
}