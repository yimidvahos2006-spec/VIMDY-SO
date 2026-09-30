-- ============================================================================
-- customer_stats_aggregate_migration.sql
-- ----------------------------------------------------------------------------
-- FASE 3 (Optimización) — continuación de customer_purchase_history_migration.sql.
-- Esa migración arregló CustomerEngine.getCustomerProfile() (el historial de
-- UN cliente, en Caja) para que filtre por SQL en vez de traer toda la tabla
-- de ventas. Pero quedó sin tocar el caso más pesado: la pantalla de
-- Clientes completa (useCustomers.ts), que necesita LTV + cantidad de
-- compras + última compra de TODOS los clientes a la vez para armar la
-- lista y las tarjetas de KPIs (total LTV, mejor cliente). Como necesita
-- agregados de todos los clientes, findByCustomer() (que trae las ventas de
-- UNO) no alcanza — sigue trayendo la tabla completa con getAllSales().
--
-- Esta función calcula los agregados directamente en Postgres (un GROUP BY
-- sobre las columnas ya indexadas por hot_columns_migration.sql y
-- customer_purchase_history_migration.sql) y devuelve solo un puñado de
-- números por cliente, no las ventas completas. `security invoker` para que
-- las políticas RLS de la tabla `sales` sigan aplicando: cada negocio solo
-- ve sus propios agregados, igual que con cualquier select normal.
--
-- Aplicar con: pega TODO este archivo en el SQL Editor de Supabase y dale
-- "Run". Requiere que ya se haya corrido hot_columns_migration.sql y
-- customer_purchase_history_migration.sql antes (usa sus columnas).
-- Re-corrible (create or replace).
-- ============================================================================

create or replace function public.get_customer_purchase_stats(p_business_id uuid)
returns table (
  customer_id text,
  purchase_count bigint,
  ltv numeric,
  last_purchase_at timestamptz
)
language sql
stable
security invoker
as $$
  select
    sale_customer_id as customer_id,
    count(*) as purchase_count,
    sum(sale_total) as ltv,
    max(sale_date) as last_purchase_at
  from sales
  where business_id = p_business_id
    and sale_customer_id is not null
    -- Mismo criterio que useCustomers.ts: cuenta ventas PAID/CLOSED, o sin
    -- status (ventas viejas anteriores a que existiera el campo).
    and (
      data->>'status' in ('PAID', 'CLOSED')
      or data->>'status' is null
    )
  group by sale_customer_id;
$$;

revoke all on function public.get_customer_purchase_stats(uuid) from public, anon;
grant execute on function public.get_customer_purchase_stats(uuid) to authenticated;

-- ============================================================================
-- Verificación rápida después de correr esto (reemplaza el uuid por tu
-- business_id real, el mismo que ya usás en getCurrentBusinessId()):
--
--   select * from get_customer_purchase_stats('00000000-0000-0000-0000-000000000000');
--
-- Debe devolver una fila por cliente con compras, no una fila por venta.
-- ============================================================================