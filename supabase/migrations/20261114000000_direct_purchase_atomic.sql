-- ============================================================================
-- 20261114000000_direct_purchase_atomic.sql
-- ----------------------------------------------------------------------------
-- Compras: FLUJO DUAL A/B con el MISMO motor transaccional del servidor.
--
--   A) Compra vinculada a una orden previa  -> receive_purchase_order_atomic
--      (ya existe; NO se modifica en esta migracion).
--   B) Compra directa (factura / nota de entrega rapida, sin orden previa)
--      -> record_direct_purchase_atomic  (NUEVA, esta migracion).
--
-- Como se garantiza "exactamente el mismo motor":
--   record_direct_purchase_atomic NO reimplementa nada de inventario. En UNA
--   sola transaccion:
--     1. valida permisos, sucursal, proveedor y lineas;
--     2. crea la orden de compra (origen DIRECTA) con lo facturado;
--     3. llama a public.receive_purchase_order_atomic() sobre esa orden.
--   Stock, Kardex, precio de compra, estado COMPRADO, auditoria, bloqueo por
--   concurrencia e idempotencia salen TODOS de esa misma funcion. Si algo
--   falla, se revierte todo (tampoco queda la orden creada).
--
-- Garantias:
--   * Idempotente: el mismo p_operation_id nunca suma stock dos veces ni crea
--     dos ordenes (el id de la orden se deriva del negocio + operacion).
--   * Una factura (proveedor + numero) no se puede registrar dos veces.
--   * Mismos roles que recibir una orden: ADMIN, GERENTE, INVENTARIO.
--   * La compra directa queda en el historial como cualquier otra (COMPRADO).
--
-- No toca datos existentes. Es seguro correrlo mas de una vez.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.record_direct_purchase_atomic(
  p_operation_id text,
  p_business_id uuid,
  p_branch_id uuid,
  p_supplier_id text,
  p_items jsonb,
  p_invoice_number text DEFAULT NULL::text,
  p_note text DEFAULT NULL::text,
  p_performed_by text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth.role();
  v_order_id uuid;
  v_supplier_uuid uuid;
  v_invoice text := NULLIF(pg_catalog.btrim(COALESCE(p_invoice_number, '')), '');
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_seen text[] := ARRAY[]::text[];
  v_product_key text;
  v_quantity numeric;
  v_unit_price numeric;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_code text;
  v_result jsonb;
BEGIN
  IF NULLIF(pg_catalog.btrim(COALESCE(p_operation_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_OPERATION_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_business_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_SCOPE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  -- Permisos ANTES de revelar o escribir cualquier cosa (misma regla que recibir una orden).
  IF v_actor_role IS DISTINCT FROM 'service_role' THEN
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'PURCHASE_AUTH_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN', 'GERENTE', 'INVENTARIO']) THEN
      RAISE EXCEPTION 'PURCHASE_RECEIVE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_business_subscription_active(p_business_id) THEN
      RAISE EXCEPTION 'PURCHASE_SUBSCRIPTION_INACTIVE' USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(p_branch_id = ANY (public.auth_branch_ids()), false) THEN
      RAISE EXCEPTION 'PURCHASE_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- La sucursal debe ser de este negocio.
  IF NOT EXISTS (
    SELECT 1 FROM public.branches AS branch
    WHERE branch.id = p_branch_id AND branch.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'PURCHASE_BRANCH_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- El proveedor debe existir y ser de este negocio.
  BEGIN
    v_supplier_uuid := NULLIF(pg_catalog.btrim(COALESCE(p_supplier_id, '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_supplier_uuid := NULL;
  END;
  IF v_supplier_uuid IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_SUPPLIER_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers AS supplier
    WHERE supplier.id = v_supplier_uuid AND supplier.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'PURCHASE_SUPPLIER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Lineas: una por producto, con cantidad y precio unitario reales de la factura.
  IF p_items IS NULL
     OR pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_items) = 0
     OR pg_catalog.jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'PURCHASE_ITEMS_INVALID' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN
    SELECT entry.value FROM pg_catalog.jsonb_array_elements(p_items) AS entry(value)
  LOOP
    v_product_key := NULLIF(pg_catalog.btrim(COALESCE(v_item->>'productId', '')), '');
    v_quantity := NULLIF(v_item->>'quantity', '')::numeric;
    v_unit_price := NULLIF(v_item->>'unitPrice', '')::numeric;

    IF v_product_key IS NULL
       OR v_quantity IS NULL OR v_quantity <= 0
       OR v_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'PURCHASE_ITEM_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- En una factura el precio es obligatorio: un 0 pisaria el costo del producto.
    IF v_unit_price IS NULL OR v_unit_price <= 0
       OR v_unit_price::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'PURCHASE_UNIT_PRICE_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    IF v_product_key = ANY (v_seen) THEN
      RAISE EXCEPTION 'PURCHASE_ITEM_DUPLICATED' USING ERRCODE = 'P0001';
    END IF;
    v_seen := v_seen || v_product_key;

    v_items := v_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'productId', v_product_key,
        'quantity', v_quantity,
        'unitPrice', v_unit_price
      )
    );
  END LOOP;

  -- Id de la orden determinista: reintentar la misma operacion reutiliza la misma fila.
  v_order_id := pg_catalog.md5(
    'direct-purchase:' || p_business_id::text || ':' || pg_catalog.btrim(p_operation_id)
  )::uuid;

  -- Una misma factura de un proveedor no se registra dos veces (se serializa
  -- por factura para que dos pestañas a la vez tampoco la dupliquen).
  IF v_invoice IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'direct-purchase-invoice:' || p_business_id::text || ':' || v_supplier_uuid::text || ':' || pg_catalog.lower(v_invoice),
        0
      )
    );
    IF EXISTS (
      SELECT 1
      FROM public.purchase_orders AS purchase_order
      WHERE purchase_order.business_id = p_business_id
        AND purchase_order.id <> v_order_id
        AND purchase_order.data->>'source' = 'DIRECTA'
        AND purchase_order.data->>'supplierId' = v_supplier_uuid::text
        AND pg_catalog.lower(purchase_order.data->>'invoiceNumber') = pg_catalog.lower(v_invoice)
        AND purchase_order.data->>'status' IS DISTINCT FROM 'CANCELADO'
    ) THEN
      RAISE EXCEPTION 'PURCHASE_INVOICE_DUPLICATED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_code := 'CD-' || pg_catalog.upper(pg_catalog.substr(v_order_id::text, 1, 8));

  -- Paso 1: la orden (origen DIRECTA) con exactamente lo facturado.
  -- Si es un reintento, la fila ya existe y no se toca.
  INSERT INTO public.purchase_orders (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (
    v_order_id, p_business_id, p_branch_id, 1,
    pg_catalog.jsonb_build_object(
      'id', v_order_id::text,
      'code', v_code,
      'source', 'DIRECTA',
      'supplierId', v_supplier_uuid::text,
      'status', 'PENDIENTE',
      'items', v_items,
      'invoiceNumber', v_invoice,
      'statusNote', NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), ''),
      'createdBy', COALESCE(p_performed_by, v_actor_id::text),
      'createdAt', v_now
    ),
    v_now, v_now
  )
  ON CONFLICT (id) DO NOTHING;

  -- Paso 2: el MISMO motor de recepcion que usa el flujo A. Recibe todo lo
  -- facturado: stock + Kardex + precio de compra + estado + auditoria.
  v_result := public.receive_purchase_order_atomic(
    p_operation_id,
    v_order_id,
    v_items,
    p_note,
    p_performed_by
  );

  RETURN v_result || pg_catalog.jsonb_build_object(
    'source', 'DIRECTA',
    'purchaseOrderId', v_order_id,
    'code', v_code
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_direct_purchase_atomic(text, uuid, uuid, text, jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_direct_purchase_atomic(text, uuid, uuid, text, jsonb, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_direct_purchase_atomic(text, uuid, uuid, text, jsonb, text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_direct_purchase_atomic(text, uuid, uuid, text, jsonb, text, text, text) IS
  'Compra directa (factura/nota de entrega) sin orden previa. Crea la orden origen DIRECTA y la recibe llamando a receive_purchase_order_atomic en la MISMA transaccion: mismo motor que el flujo con orden. Idempotente por p_operation_id; rechaza facturas repetidas del mismo proveedor.';

COMMIT;