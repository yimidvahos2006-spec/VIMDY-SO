import { supabase } from "./supabaseClient";
import {
  BUSINESS_FISCAL_IDENTITY_SELECT_COLUMNS,
  fiscalIdentityFromRow,
  fiscalIdentityToUpdate,
  type BusinessFiscalIdentity,
  type BusinessFiscalIdentityUpdate
} from "../../core/invoicing/types/fiscal.types";
import { prepareFiscalIdentity } from "../../core/invoicing/fiscalValidation";

/**
 * Datos fiscales del negocio (NIT, razón social, dirección, etc.).
 *
 * Lee y escribe SOLO las columnas fiscales de `businesses`. No toca el
 * switch/proveedor (businessSettings.ts) ni el consecutivo, así que guardar
 * este formulario nunca puede apagar la facturación ni reiniciar la numeración.
 * Las columnas `dian_*` (secretas) nunca se piden: authenticated no puede leerlas.
 */

/** Lee la identidad fiscal guardada. Lanza si no se puede leer (el formulario lo muestra y deja reintentar). */
export async function fetchBusinessFiscalIdentity(businessId: string): Promise<BusinessFiscalIdentity> {
  const { data, error } = await supabase
    .from("businesses")
    .select(BUSINESS_FISCAL_IDENTITY_SELECT_COLUMNS)
    .eq("id", businessId)
    .maybeSingle();

  if (error) throw new Error(error.message || "No se pudieron leer los datos fiscales.");
  if (!data) throw new Error("No se encontró el negocio o no tienes permiso para verlo.");
  return fiscalIdentityFromRow(data as Partial<BusinessFiscalIdentityUpdate>);
}

/**
 * Valida y guarda. Devuelve lo que quedó guardado (ya normalizado) para que la
 * pantalla muestre exactamente eso. Lanza un mensaje claro si algo falla: nunca
 * falla en silencio.
 */
export async function saveBusinessFiscalIdentity(
  businessId: string,
  input: BusinessFiscalIdentity
): Promise<BusinessFiscalIdentity> {
  const { identity, errors } = prepareFiscalIdentity(input);
  const firstError = Object.values(errors)[0];
  if (firstError) throw new Error(firstError);

  const { data, error } = await supabase
    .from("businesses")
    .update(fiscalIdentityToUpdate(identity))
    .eq("id", businessId)
    .select("id");

  if (error) throw new Error(error.message || "No se pudieron guardar los datos fiscales.");

  // RLS: si el usuario no es administrador o el plan venció, Supabase responde
  // sin error pero con 0 filas. Eso NO es "guardado".
  if (!data || data.length === 0) {
    throw new Error(
      "No se guardó. Solo el administrador puede cambiar los datos fiscales y el plan debe estar activo."
    );
  }
  return identity;
}