-- ============================================================================
-- 20261018000000_step8_customer_purchase_stats.sql
-- ----------------------------------------------------------------------------
-- Paso 6 · A7.4-B — Restaura public.get_customer_purchase_stats(uuid) sobre el
-- esquema REAL de ventas (documental jsonb), que es lo que consume
-- SaleRepository.getCustomerPurchaseStats() -> useCustomers.ts (pantalla
-- Clientes) y SalesEngine.
--
-- POR QUE NO EXISTIA
-- ------------------
-- La version historica vivia en supabase/customer_stats_aggregate_migration.sql,
-- FUERA de supabase/migrations/, y se perdio al reorganizar la cadena de
-- migraciones (commit 3d6b3c60). Ese archivo ademas referenciaba columnas
-- generadas que el esquema actual ya no tiene: sale_customer_id, sale_total y
-- sale_date. Por eso NO se restaura literalmente: se reimplementa contra
-- public.sales (id, business_id, branch_id, version, data jsonb, created_at).
--
-- CORRECCION DE SEGURIDAD (IDOR latente del original)
-- -----------------------------------------------------
-- La version historica solo comparaba business_id = p_business_id, sin validar
-- que el caller perteneciera a ese negocio: cualquier usuario autenticado
-- podia pasar el uuid de OTRO negocio y leer sus LTV/clientes. Aqui el acceso
-- se acota a los negocios del usuario autenticado. Si p_business_id no esta
-- autorizado, la funcion no devuelve filas (0 filas, no error), igual que el
-- resto de lecturas tenant-scoped del proyecto.
--
-- CRITERIOS
-- ----------
--   * Fecha de negocio  -> sales.created_at (no existe data.date en el flujo
--     autoritativo; create_sale_fulfillment_atomic escribe data->>'createdAt').
--   * Estados contados  -> solo 'PAID' y 'CLOSED', replicando el criterio del
--     motor de cobro. Se excluyen PENDING_PAYMENT, OPEN, CANCELLED, REFUNDED.
--     A diferencia del historico NO se acepta status IS NULL: el esquema actual
--     tiene estados explicitos.
--   * Monto             -> data->>'total' con conversion SEGURA. Un total sucio
--     ("1.000,50", "NaN", objeto) suma 0 y NO aborta la consulta completa.
--   * customerId        -> solo no nulo/no vacio tras btrim.
--
-- Migracion NUEVA: no modifica ninguna migracion historica.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_customer_purchase_stats(p_business_id uuid)
RETURNS TABLE (
  customer_id text,
  purchase_count bigint,
  ltv numeric,
  last_purchase_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT
    nullif(btrim(s.data->>'customerId'), '') AS customer_id,
    count(*) AS purchase_count,
    COALESCE(
      sum(
        CASE
          WHEN s.data->>'total' ~ '^[0-9]+([.][0-9]+)?$'
            THEN (s.data->>'total')::numeric
          ELSE NULL
        END
      ),
      0
    ) AS ltv,
    max(s.created_at) AS last_purchase_at
  FROM public.sales AS s
  WHERE s.business_id = p_business_id
    -- Tenant: solo los negocios a los que pertenece el usuario autenticado.
    -- Si no esta autorizado, la funcion devuelve 0 filas en vez de datos ajenos.
    AND p_business_id IN (SELECT public.auth_business_ids())
    AND s.data->>'status' IN ('PAID', 'CLOSED')
    AND nullif(btrim(s.data->>'customerId'), '') IS NOT NULL
  GROUP BY nullif(btrim(s.data->>'customerId'), '');
$function$;

COMMENT ON FUNCTION public.get_customer_purchase_stats(uuid) IS
  'Agregados de compra (LTV, numero de compras, ultima compra) por cliente del negocio, calculados en Postgres sobre el esquema documental de public.sales. Solo cuenta ventas PAID/CLOSED, excluye estados no cobrados, convierte el total de forma segura y restringe el acceso a los negocios del usuario autenticado (p_business_id debe estar en auth_business_ids). A7.4-B: reemplaza a la version historica perdida, que leia columnas inexistentes y no validaba tenant.';

REVOKE ALL ON FUNCTION public.get_customer_purchase_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_purchase_stats(uuid) TO authenticated;

COMMIT;