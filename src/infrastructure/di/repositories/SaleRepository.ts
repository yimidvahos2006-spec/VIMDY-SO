import { Sale } from "../../../core/entities/Entities";
import { SupabaseRepository, reviveDates } from "./SupabaseRepository";
import { supabase, getCurrentBusinessId, getCurrentBranchId } from "../../supabase/supabaseClient";
import type {
  CreateSaleFulfillmentRequest,
  CreateSaleFulfillmentResult,
  ISaleFulfillmentRepository,
} from "./ISaleFulfillmentRepository";

/**
 * SaleRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "sales" ya no viven solo en el navegador, viven
 * en la tabla `sales` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 */
export class SaleRepository extends SupabaseRepository<Sale> implements ISaleFulfillmentRepository {
  protected tableName = "sales" as const;

  public async createSaleFulfillmentAtomic(
    request: CreateSaleFulfillmentRequest
  ): Promise<CreateSaleFulfillmentResult> {
    const { data, error } = await supabase.rpc("create_sale_fulfillment_atomic", {
      p_business_id: request.businessId,
      p_branch_id: request.branchId,
      p_idempotency_key: request.idempotencyKey,
      p_sale: {
        id: request.input.id ?? null,
        type: request.input.type,
        items: request.input.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          note: item.note ?? null,
          selectedSizeId: item.selectedSizeId ?? null,
          selectedExtraIds: item.selectedExtraIds ?? []
        })),
        customerId: request.input.customerId ?? null,
        tableId: request.input.tableId ?? null,
        deliveryAddress: request.input.deliveryAddress ?? null,
        deliveryFee: request.input.deliveryFee ?? 0,
        notes: request.input.notes ?? null,
        waiterId: request.input.waiterId ?? null,
        priority: request.input.priority ?? "NORMAL",
        discount: request.input.discount ?? null,
        tip: request.input.tip ?? null
      }
    });

    if (error) {
      throw new Error(`SALE_FULFILLMENT_RPC_FAILED: ${error.message}`);
    }

    const result = data as {
      success?: boolean;
      idempotent?: boolean;
      idempotencyKey?: string;
      sale?: Sale;
      kitchenOrder?: import("../../../core/entities/Entities").KitchenOrder | null;
      printerJobId?: string | null;
      code?: string;
      error?: string;
    } | null;

    if (!result?.success || !result.sale) {
      throw new Error(`${result?.code ?? "SALE_FULFILLMENT_REJECTED"}: ${result?.error ?? "No se creó la venta."}`);
    }

    return {
      sale: reviveDates(result.sale),
      kitchenOrder: result.kitchenOrder ? reviveDates(result.kitchenOrder) : null,
      printerJobId: result.printerJobId ?? null,
      idempotent: result.idempotent ?? false
    };
  }

  /**
   * CRÍTICO #3 del checklist de lanzamiento: ventas de un rango de fechas,
   * filtradas y ordenadas por la base de datos usando `sales.created_at` en vez
   * de traer TODAS las ventas del negocio con findAll() y filtrar en JavaScript.
   *
   * A7.4-A: antes usaba la columna plana `sale_date`, que ya NO existe (el
   * esquema es documental: `sales.data` jsonb + created_at/updated_at). Esa
   * columna era una "hot column" de una migracion que vivia fuera de
   * `supabase/migrations/` y se perdio. La fecha canonica de venta es
   * `created_at`, que `create_sale_fulfillment_atomic` refleja como
   * `data->>'createdAt'` y que PostgREST si indexa.
   */
  public async findByDateRange(start: Date, end: Date): Promise<Sale[]> {
    const { data, error } = await supabase
      .from("sales")
      .select("data")
      .eq("business_id", getCurrentBusinessId())
      .eq("branch_id", getCurrentBranchId())
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: false });

    if (error) throw new Error(`SUPABASE_FIND_BY_DATE_RANGE_FAILED (sales): ${error.message}`);

    return (data ?? []).map((row) => reviveDates(row.data as Sale));
  }

  /**
   * Suma el total de ventas COBRADAS de un rango de fechas.
   *
   * A7.4-A: antes leia `sale_total` y filtraba por `sale_date` (columnas
   * inexistentes). Ahora:
   *   - fecha  -> `sales.created_at`
   *   - monto  -> `data->>'total'`, con conversion SEGURA (solo acepta el
   *     formato numerico plano; cualquier otra cosa suma 0 en vez de lanzar).
   *   - status -> se replica el criterio del motor de cobro: una venta cuenta
   *     solo si esta `PAID` o `CLOSED`. Se excluyen PENDING_PAYMENT, OPEN,
   *     CANCELLED, REFUNDED y cualquier otro estado no cobrado.
   */
  public async getTotalRevenue(start: Date, end: Date): Promise<number> {
    const { data, error } = await supabase
      .from("sales")
      .select("data")
      .eq("business_id", getCurrentBusinessId())
      .eq("branch_id", getCurrentBranchId())
      .in("data->>status", ["PAID", "CLOSED"])
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());

    if (error) throw new Error(`SUPABASE_GET_TOTAL_REVENUE_FAILED (sales): ${error.message}`);

    return (data ?? []).reduce((sum, row) => {
      const rawTotal = (row.data as Sale | undefined)?.total;
      // Solo `numero plano`: evita que un total sucio lance la consulta completa.
      const safeTotal =
        typeof rawTotal === "number"
          ? rawTotal
          : typeof rawTotal === "string" && /^[0-9]+([.][0-9]+)?$/.test(rawTotal)
            ? Number(rawTotal)
            : 0;
      return sum + (Number.isFinite(safeTotal) ? safeTotal : 0);
    }, 0);
  }

  /**
   * FASE 3 (Optimización) — historial de compras de UN cliente, filtrado y
   * ordenado por la base de datos en vez de traer TODAS las ventas del negocio
   * con findAll() y filtrar en JavaScript. Lo usa
   * CustomerEngine.getCustomerProfile(), que antes era el cuello de botella más
   * notorio en Caja (se llama cada vez que se elige un cliente en
   * PosCustomer.tsx, justo en hora pico).
   *
   * A7.4-A: antes filtraba por la columna plana `sale_customer_id` y ordenaba
   * por `sale_date` (ambas inexistentes). Ahora el cliente vive en el jsonb
   * (`data->>'customerId'`) y el orden usa `created_at`.
   */
  public async findByCustomer(customerId: string): Promise<Sale[]> {
    const { data, error } = await supabase
      .from("sales")
      .select("data")
      .eq("business_id", getCurrentBusinessId())
      .eq("branch_id", getCurrentBranchId())
      .eq("data->>customerId", customerId)
      .order("created_at", { ascending: false });

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