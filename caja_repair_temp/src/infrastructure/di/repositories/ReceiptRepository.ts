import { Receipt } from "../../../core/engines/ReceiptEngine";
import { SupabaseRepository } from "./SupabaseRepository";

/**
 * ReceiptRepository
 * ---------------------------------------------------------------------------
 * Persiste los recibos en la tabla `receipts` de Supabase (ver
 * supabase/schema.sql), aislados por negocio mediante Row Level Security
 * y disponibles en cualquier dispositivo donde el mismo negocio inicie
 * sesión. Mismo patrón que SaleRepository, CustomerRepository, etc: solo
 * define `tableName`, toda la lógica de business_id/RLS vive en
 * SupabaseRepository.
 *
 * Antes de esto, ReceiptEngine guardaba los recibos SOLO en un array en
 * memoria (`private history: Receipt[]`) — se perdían al recargar la
 * página, cerrar el navegador o cambiar de dispositivo.
 */
export class ReceiptRepository extends SupabaseRepository<Receipt> {
  protected tableName = "receipts" as const;
}