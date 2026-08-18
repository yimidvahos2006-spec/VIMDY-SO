import { Sale } from "../../../core/entities/Entities";
import { SupabaseRepository, reviveDates } from "./SupabaseRepository";
import { supabase, getCurrentBusinessId, getCurrentBranchId } from "../../supabase/supabaseClient";

/**
 * SaleRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "sales" ya no viven solo en el navegador, viven
 * en la tabla `sales` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 */
export class SaleRepository extends SupabaseRepository<Sale> {
  protected tableName = "sales" as const;

  /**
   * CRÍTICO #3 del checklist de lanzamiento: ventas de un rango de fechas,
   * filtradas y ordenadas por la base de datos usando la columna generada
   * `sale_date` (ver hot_columns_migration.sql) en vez de traer TODAS las
   * ventas del negocio con findAll() y filtrar en JavaScript.
   */
  public async findByDateRange(start: Date, end: Date): Promise<Sale[]> {
    const { data, error } = await supabase
      .from("sales")
      .select("data")
      .eq("business_id", getCurrentBusinessId())
      .eq("branch_id", getCurrentBranchId())
      .gte("sale_date", start.toISOString())
      .lte("sale_date", end.toISOString())
      .order("sale_date", { ascending: false });

    if (error) throw new Error(`SUPABASE_FIND_BY_DATE_RANGE_FAILED (sales): ${error.message}`);

    return (data ?? []).map((row) => reviveDates(row.data as Sale));
  }

  /**
   * Suma el total de ventas de un rango de fechas SIN traer el jsonb
   * completo de cada venta a JavaScript — solo pide la columna numérica
   * `sale_total` (ya indexada) y suma. Pensado para tarjetas de resumen
   * del Dashboard ("ventas de hoy", "ventas del mes").
   */
  public async getTotalRevenue(start: Date, end: Date): Promise<number> {
    const { data, error } = await supabase
      .from("sales")
      .select("sale_total")
      .eq("business_id", getCurrentBusinessId())
      .eq("branch_id", getCurrentBranchId())
      .gte("sale_date", start.toISOString())
      .lte("sale_date", end.toISOString());

    if (error) throw new Error(`SUPABASE_GET_TOTAL_REVENUE_FAILED (sales): ${error.message}`);

    return (data ?? []).reduce((sum, row) => sum + (Number(row.sale_total) || 0), 0);
  }

  /**
   * FASE 3 (Optimización) — historial de compras de UN cliente, filtrado y
   * ordenado por la base de datos usando la columna generada
   * `sale_customer_id` (ver customer_purchase_history_migration.sql) en vez
   * de traer TODAS las ventas del negocio con findAll() y filtrar en
   * JavaScript. Lo usa CustomerEngine.getCustomerProfile(), que antes era
   * el cuello de botella más notorio en Caja (se llama cada vez que se
   * elige un cliente en PosCustomer.tsx, justo en hora pico).
   */
  public async findByCustomer(customerId: string): Promise<Sale[]> {
    const { data, error } = await supabase
      .from("sales")
      .select("data")
      .eq("business_id", getCurrentBusinessId())
      .eq("branch_id", getCurrentBranchId())
      .eq("sale_customer_id", customerId)
      .order("sale_date", { ascending: false });

    if (error) throw new Error(`SUPABASE_FIND_BY_CUSTOMER_FAILED (sales): ${error.message}`);

    return (data ?? []).map((row) => reviveDates(row.data as Sale));
  }

  /**
   * FASE 3 (Optimización) — agregados de compra (LTV, cantidad de compras,
   * última compra) de TODOS los clientes del negocio, calculados en
   * Postgres via get_customer_purchase_stats() (ver
   * customer_stats_aggregate_migration.sql) en vez de traer cada venta con
   * findAll()/getAllSales() y sumar en JavaScript. Lo usa useCustomers.ts
   * para poblar la pantalla de Clientes completa: antes era la carga que
   * más crecía con los años de historial del negocio, porque a diferencia
   * del historial de un cliente (findByCustomer) esta sí necesita datos de
   * todos los clientes a la vez.
   */
  public async getCustomerPurchaseStats(): Promise<
    Map<string, { purchaseCount: number; ltv: number; lastPurchaseAt: Date | null }>
  > {
    const { data, error } = await supabase.rpc("get_customer_purchase_stats", {
      p_business_id: getCurrentBusinessId(),
    });

    if (error) throw new Error(`SUPABASE_GET_CUSTOMER_PURCHASE_STATS_FAILED: ${error.message}`);

    const map = new Map<
      string,
      { purchaseCount: number; ltv: number; lastPurchaseAt: Date | null }
    >();

    for (const row of data ?? []) {
      map.set(row.customer_id, {
        purchaseCount: Number(row.purchase_count) || 0,
        ltv: Number(row.ltv) || 0,
        lastPurchaseAt: row.last_purchase_at ? new Date(row.last_purchase_at) : null,
      });
    }

    return map;
  }
}