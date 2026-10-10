-- VIMDY — hardening transaccional de Mesas + Pedidos + Cocina
-- Fecha: 2026-10-07
--
-- No crea table_sessions: la sesión actual ya vive en tables.orderId +
-- tables.openOperationId. Esta migration convierte esa identidad en una
-- invariante server-side y sincroniza estados críticos dentro de la misma
-- transacción que crea el Order o marca la Sale como PAID/CLOSED.
--
-- EFECTOS:
--   1) No más de un Order de mesa activo por mesa/sucursal.
--   2) No más de una kitchen_order con el mismo sendOperationId.
--   3) Un INSERT de un Order TABLE abre la mesa en la misma transacción.
--   4) Un cambio de Sale a PAID/CLOSED completa Order + libera Table en la
--      misma transacción del cobro.
--   5) Una mesa FREE pierde automáticamente identidad de sesión activa.
--   6) lastSaleId queda disponible para recuperar un cierre cuya respuesta
--      se perdió por una caída de red.
--
-- REQUISITO:
--   Ejecutar sobre el mismo Supabase donde ya están aplicadas las migrations
--   base de VIMDY. Si existen duplicados de Orders activos por mesa, el índice
--   único abortará deliberadamente para no mutar datos comerciales a ciegas.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preflight: no destruimos historial. Si ya existen duplicados que
-- impidan crear los UNIQUE, el script aborta con un diagnóstico claro.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_duplicate_groups integer;
BEGIN
  SELECT count(*)
  INTO v_duplicate_groups
  FROM (
    SELECT
      business_id,
      COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) AS branch_key,
      data->>'tableId' AS table_id,
      count(*) AS row_count
    FROM public.orders
    WHERE NULLIF(data->>'tableId', '') IS NOT NULL
      AND UPPER(COALESCE(data->>'source', '')) = 'TABLE'
      AND UPPER(COALESCE(data->>'status', '')) NOT IN ('COMPLETED', 'CANCELLED')
    GROUP BY business_id, branch_key, data->>'tableId'
    HAVING count(*) > 1
  ) duplicates;

  IF v_duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'TABLE_ACTIVE_ORDER_DUPLICATES: existen % grupos con más de un Order activo para la misma mesa. No se borró información; resuelve esos grupos antes de ejecutar el hardening.',
      v_duplicate_groups;
  END IF;

  SELECT count(*)
  INTO v_duplicate_groups
  FROM (
    SELECT
      business_id,
      COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) AS branch_key,
      data->>'sendOperationId' AS send_operation_id,
      count(*) AS row_count
    FROM public.kitchen_orders
    WHERE NULLIF(data->>'sendOperationId', '') IS NOT NULL
    GROUP BY business_id, branch_key, data->>'sendOperationId'
    HAVING count(*) > 1
  ) duplicates;

  IF v_duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'KITCHEN_SEND_OPERATION_DUPLICATES: existen % grupos con sendOperationId repetido. No se borró información; resuelve esos grupos antes de ejecutar el hardening.',
      v_duplicate_groups;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Índices de integridad / idempotencia
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS orders_business_branch_active_table_unique
ON public.orders (
  business_id,
  COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
  (data->>'tableId')
)
WHERE NULLIF(data->>'tableId', '') IS NOT NULL
  AND UPPER(COALESCE(data->>'source', '')) = 'TABLE'
  AND UPPER(COALESCE(data->>'status', '')) NOT IN ('COMPLETED', 'CANCELLED');

CREATE UNIQUE INDEX IF NOT EXISTS tables_business_branch_active_open_operation_unique
ON public.tables (
  business_id,
  COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
  (data->>'openOperationId')
)
WHERE NULLIF(data->>'openOperationId', '') IS NOT NULL
  AND UPPER(COALESCE(data->>'status', '')) NOT IN ('FREE', 'CLOSED');

CREATE UNIQUE INDEX IF NOT EXISTS kitchen_orders_business_branch_send_operation_unique
ON public.kitchen_orders (
  business_id,
  COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
  (data->>'sendOperationId')
)
WHERE NULLIF(data->>'sendOperationId', '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS kitchen_orders_business_branch_order_idx
ON public.kitchen_orders (business_id, branch_id, (data->>'orderId'))
WHERE NULLIF(data->>'orderId', '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS kitchen_orders_business_branch_table_session_idx
ON public.kitchen_orders (
  business_id,
  branch_id,
  (data->>'tableId'),
  (data->>'tableSessionId')
)
WHERE NULLIF(data->>'tableId', '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_business_branch_table_status_idx
ON public.orders (
  business_id,
  branch_id,
  (data->>'tableId'),
  (data->>'status')
)
WHERE NULLIF(data->>'tableId', '') IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Normalización server-side de una mesa FREE
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_free_table_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF UPPER(COALESCE(NEW.data->>'status', '')) = 'FREE' THEN
    NEW.data := jsonb_strip_nulls(
      NEW.data
      || jsonb_build_object(
        'status', 'FREE',
        'peopleCount', 0,
        'waiterId', NULL,
        'customerId', NULL,
        'openedAt', NULL,
        'orderId', NULL,
        'openOperationId', NULL,
        'items', '[]'::jsonb,
        'subtotal', 0,
        'tax', 0,
        'discount', 0,
        'total', 0,
        'notes', NULL
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_free_table_state ON public.tables;

CREATE TRIGGER normalize_free_table_state
BEFORE INSERT OR UPDATE OF data
ON public.tables
FOR EACH ROW
EXECUTE FUNCTION public.normalize_free_table_state();

REVOKE ALL ON FUNCTION public.normalize_free_table_state() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Crear/abrir Order + Table de forma atómica
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_table_after_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_id uuid;
  v_table public.tables%ROWTYPE;
  v_current_status text;
  v_current_order_id uuid;
  v_operation_id text;
BEGIN
  IF UPPER(COALESCE(NEW.data->>'source', '')) <> 'TABLE' THEN
    RETURN NEW;
  END IF;

  v_table_id := NULLIF(NEW.data->>'tableId', '')::uuid;

  IF v_table_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_operation_id := NULLIF(NEW.data->>'openOperationId', '');
  IF v_operation_id IS NULL THEN
    v_operation_id := NEW.id::text;
  END IF;

  SELECT *
  INTO v_table
  FROM public.tables
  WHERE id = v_table_id
    AND business_id = NEW.business_id
    AND (
      branch_id = NEW.branch_id
      OR branch_id IS NULL
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TABLE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_current_status := UPPER(COALESCE(v_table.data->>'status', 'FREE'));
  v_current_order_id := NULLIF(v_table.data->>'orderId', '')::uuid;

  -- Un retry del mismo Order ya asociado a la misma mesa es idempotente.
  IF v_current_order_id = NEW.id THEN
    RETURN NEW;
  END IF;

  IF v_current_status NOT IN ('FREE', 'RESERVED') THEN
    RAISE EXCEPTION 'TABLE_NOT_AVAILABLE'
      USING ERRCODE = 'P0001',
            DETAIL = format(
              'Mesa %s está en estado %s y pertenece al orderId %s.',
              v_table.id,
              v_current_status,
              COALESCE(v_current_order_id::text, 'NULL')
            );
  END IF;

  UPDATE public.tables
  SET data = jsonb_strip_nulls(
        v_table.data
        || jsonb_strip_nulls(
          jsonb_build_object(
            'status', 'BUSY',
            'peopleCount', GREATEST(COALESCE((NEW.data->>'peopleCount')::integer, 0), 0),
            'waiterId', NEW.data->>'waiterId',
            'customerId', NEW.data->>'customerId',
            'notes', NEW.data->>'notes',
            'openedAt', to_jsonb(clock_timestamp()),
            'openOperationId', v_operation_id,
            'orderId', NEW.id::text,
            'lastSaleId', NULL
          )
        )
      ),
      version = v_table.version + 1,
      updated_at = clock_timestamp()
  WHERE id = v_table.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_table_after_order_insert ON public.orders;

CREATE TRIGGER sync_table_after_order_insert
AFTER INSERT
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_table_after_order_insert();

REVOKE ALL ON FUNCTION public.sync_table_after_order_insert() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Pago PAID/CLOSED => Order COMPLETED + Table FREE, dentro de la misma
--    transacción del pago.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_table_after_sale_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_id uuid;
  v_table public.tables%ROWTYPE;
  v_table_order_id uuid;
  v_status text;
BEGIN
  IF NOT (
    UPPER(COALESCE(NEW.data->>'status', '')) IN ('PAID', 'CLOSED')
    AND UPPER(COALESCE(OLD.data->>'status', '')) NOT IN ('PAID', 'CLOSED')
  ) THEN
    RETURN NEW;
  END IF;

  v_table_id := NULLIF(NEW.data->>'tableId', '')::uuid;

  IF v_table_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_table
  FROM public.tables
  WHERE id = v_table_id
    AND business_id = NEW.business_id
    AND (
      branch_id = NEW.branch_id
      OR branch_id IS NULL
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Una venta TABLE no debe perder el cobro solo porque una mesa legacy
    -- haya sido eliminada. El documento financiero ya existe; no inventamos
    -- una mesa para repararlo.
    RETURN NEW;
  END IF;

  v_table_order_id := NULLIF(v_table.data->>'orderId', '')::uuid;
  v_status := UPPER(COALESCE(v_table.data->>'status', 'FREE'));

  IF v_table_order_id IS NOT NULL THEN
    UPDATE public.orders
    SET data = jsonb_strip_nulls(
          data
          || jsonb_build_object(
            'status', 'COMPLETED',
            'saleId', NEW.id::text
          )
        ),
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = v_table_order_id
      AND business_id = NEW.business_id
      AND (
        branch_id = NEW.branch_id
        OR branch_id IS NULL
      )
      AND UPPER(COALESCE(data->>'status', 'DRAFT')) NOT IN ('COMPLETED', 'CANCELLED');
  END IF;

  -- Si la mesa ya fue liberada por un retry anterior, solo conservamos el
  -- último saleId para permitir recuperación del cierre. Nunca hacemos un
  -- segundo cambio de sesión.
  IF v_status = 'FREE' AND NULLIF(v_table.data->>'orderId', '') IS NULL THEN
    UPDATE public.tables
    SET data = jsonb_strip_nulls(
          v_table.data
          || jsonb_build_object(
            'status', 'FREE',
            'lastSaleId', NEW.id::text,
            'lastClosedAt', to_jsonb(clock_timestamp())
          )
        ),
        version = v_table.version + 1,
        updated_at = clock_timestamp()
    WHERE id = v_table.id;

    RETURN NEW;
  END IF;

  UPDATE public.tables
  SET data = jsonb_strip_nulls(
        v_table.data
        || jsonb_build_object(
          'status', 'FREE',
          'peopleCount', 0,
          'waiterId', NULL,
          'customerId', NULL,
          'notes', NULL,
          'items', '[]'::jsonb,
          'subtotal', 0,
          'tax', 0,
          'discount', 0,
          'total', 0,
          'openedAt', NULL,
          'orderId', NULL,
          'openOperationId', NULL,
          'lastSaleId', NEW.id::text,
          'lastClosedAt', to_jsonb(clock_timestamp())
        )
      ),
      version = v_table.version + 1,
      updated_at = clock_timestamp()
  WHERE id = v_table.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_table_after_sale_paid ON public.sales;

CREATE TRIGGER sync_table_after_sale_paid
AFTER UPDATE OF data
ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.sync_table_after_sale_paid();

REVOKE ALL ON FUNCTION public.sync_table_after_sale_paid() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Limpieza inmediata de basura de identidad en mesas ya FREE.
--    No cambia una mesa ocupada y es idempotente si se ejecuta varias veces.
-- ---------------------------------------------------------------------------

UPDATE public.tables
SET data = jsonb_strip_nulls(
      data
      || jsonb_build_object(
        'peopleCount', 0,
        'waiterId', NULL,
        'customerId', NULL,
        'openedAt', NULL,
        'orderId', NULL,
        'openOperationId', NULL,
        'items', '[]'::jsonb,
        'subtotal', 0,
        'tax', 0,
        'discount', 0,
        'total', 0,
        'notes', NULL
      )
    ),
    version = version + 1,
    updated_at = clock_timestamp()
WHERE UPPER(COALESCE(data->>'status', '')) = 'FREE'
  AND (
    NULLIF(data->>'orderId', '') IS NOT NULL
    OR NULLIF(data->>'openOperationId', '') IS NOT NULL
    OR NULLIF(data->>'waiterId', '') IS NOT NULL
    OR NULLIF(data->>'customerId', '') IS NOT NULL
    OR NULLIF(data->>'openedAt', '') IS NOT NULL
  );

COMMENT ON INDEX orders_business_branch_active_table_unique IS
  'Impide múltiples Orders TABLE activos para una misma mesa/branch/negocio.';

COMMENT ON INDEX tables_business_branch_active_open_operation_unique IS
  'Impide reutilizar una misma operación de apertura en más de una mesa activa.';

COMMENT ON INDEX kitchen_orders_business_branch_send_operation_unique IS
  'Idempotencia server-side de cada envío lógico de comanda a cocina.';

COMMIT;
