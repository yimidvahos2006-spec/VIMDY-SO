-- ============================================================================
-- 20261026000002_purchase_order_partial_receipt.sql
-- ----------------------------------------------------------------------------
-- Recibir una orden de compra POR PARTES, sin duplicar stock.
--
-- Antes: al recibir una orden (aunque llegara menos de lo pedido) quedaba
-- cerrada como COMPRADO, y lo que faltaba ya no se podía registrar.
--
-- Ahora:
--   * Se guarda cuánto se ha recibido de cada producto (receivedQuantities).
--   * Si falta mercancía, la orden queda en PARCIAL y se puede seguir
--     recibiendo hasta completar lo pedido. Al completarse pasa a COMPRADO.
--   * No se puede recibir más de lo que falta por recibir.
--   * Repetir la misma operación (mismo operation_id) no vuelve a sumar stock.
--   * Si no se indican cantidades, se recibe todo lo pendiente.
--
-- Misma firma, mismos permisos, misma transaccion atomica con el kardex.
-- Es seguro correrlo mas de una vez.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.receive_purchase_order_atomic(
  p_operation_id text,
  p_purchase_order_id uuid,
  p_received_items jsonb DEFAULT NULL::jsonb,
  p_note text DEFAULT NULL::text,
  p_performed_by text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order public.purchase_orders%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth.role();
  v_business_id uuid;
  v_branch_id uuid;
  v_status text;
  v_supplier_id text;
  v_ordered jsonb;
  v_ordered_item jsonb;
  v_items jsonb;
  v_item jsonb;
  v_movements jsonb := '[]'::jsonb;
  v_price_updates jsonb := '[]'::jsonb;
  v_received jsonb;
  v_new_received jsonb;
  v_ops jsonb;
  v_product_id uuid;
  v_product_key text;
  v_quantity numeric;
  v_unit_price numeric;
  v_ordered_qty numeric;
  v_already numeric;
  v_product_branch_id uuid;
  v_now timestamptz := clock_timestamp();
  v_results jsonb;
  v_audit_id uuid;
  v_lock_key text;
  v_all_done boolean := true;
  v_new_status text;
  v_remaining_json jsonb := '{}'::jsonb;
BEGIN
  IF NULLIF(btrim(p_operation_id), '') IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_OPERATION_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_purchase_order_id IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_ORDER_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  -- Serializa recepciones concurrentes de la MISMA orden.
  v_lock_key := 'purchase-order:' || p_purchase_order_id::text;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_lock_key, 0)
  );

  SELECT purchase_order.*
    INTO v_order
  FROM public.purchase_orders AS purchase_order
  WHERE purchase_order.id = p_purchase_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PURCHASE_ORDER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_business_id := v_order.business_id;
  v_branch_id := v_order.branch_id;
  v_status := v_order.data->>'status';
  v_supplier_id := v_order.data->>'supplierId';

  -- Permisos (antes de revelar cualquier dato de la orden).
  IF v_actor_role IS DISTINCT FROM 'service_role' THEN
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'PURCHASE_AUTH_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF NOT public.has_business_role(
      v_business_id, ARRAY['ADMIN', 'GERENTE', 'INVENTARIO']
    ) THEN
      RAISE EXCEPTION 'PURCHASE_RECEIVE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_business_subscription_active(v_business_id) THEN
      RAISE EXCEPTION 'PURCHASE_SUBSCRIPTION_INACTIVE' USING ERRCODE = '42501';
    END IF;
    IF v_branch_id IS NOT NULL
       AND NOT COALESCE(v_branch_id = ANY (public.auth_branch_ids()), false) THEN
      RAISE EXCEPTION 'PURCHASE_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_ops := COALESCE(NULLIF(v_order.data->'receivedOperationIds', 'null'::jsonb), '[]'::jsonb);
  IF jsonb_typeof(v_ops) IS DISTINCT FROM 'array' THEN
    v_ops := '[]'::jsonb;
  END IF;

  -- Idempotencia por operacion: si esta operacion ya se aplico, se devuelve
  -- el resultado sin volver a mover stock.
  IF v_ops @> pg_catalog.jsonb_build_array(p_operation_id)
     OR (
       v_order.data->>'receivedOperationId' IS NOT DISTINCT FROM p_operation_id
       AND v_status IN ('COMPRADO', 'PARCIAL')
     ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'idempotent', true,
      'operationId', p_operation_id,
      'purchaseOrderId', p_purchase_order_id,
      'status', v_status,
      'receivedAt', v_order.data->>'receivedAt'
    );
  END IF;

  IF v_status NOT IN ('PENDIENTE', 'POSPUESTO', 'PARCIAL') THEN
    RAISE EXCEPTION 'PURCHASE_ORDER_NOT_OPEN: la orden ya esta en estado %', v_status
      USING ERRCODE = 'P0001';
  END IF;

  v_ordered := COALESCE(NULLIF(v_order.data->'items', 'null'::jsonb), '[]'::jsonb);
  IF jsonb_typeof(v_ordered) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_ordered) = 0 THEN
    RAISE EXCEPTION 'PURCHASE_ITEMS_INVALID' USING ERRCODE = 'P0001';
  END IF;

  v_received := COALESCE(NULLIF(v_order.data->'receivedQuantities', 'null'::jsonb), '{}'::jsonb);
  IF jsonb_typeof(v_received) IS DISTINCT FROM 'object' THEN
    v_received := '{}'::jsonb;
  END IF;
  v_new_received := v_received;

  -- Si no se indican cantidades, se recibe todo lo que falta.
  IF p_received_items IS NULL OR p_received_items = 'null'::jsonb THEN
    v_items := '[]'::jsonb;
    FOR v_ordered_item IN
      SELECT entry.value FROM pg_catalog.jsonb_array_elements(v_ordered) AS entry(value)
    LOOP
      v_ordered_qty := (v_ordered_item->>'quantity')::numeric;
      v_already := COALESCE((v_received->>(v_ordered_item->>'productId'))::numeric, 0);
      IF v_ordered_qty - v_already > 0.000001 THEN
        v_items := v_items || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'productId', v_ordered_item->>'productId',
            'quantity', v_ordered_qty - v_already,
            'unitPrice', v_ordered_item->'unitPrice'
          )
        );
      END IF;
    END LOOP;
  ELSE
    v_items := p_received_items;
  END IF;

  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'PURCHASE_ITEMS_INVALID' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN
    SELECT entry.value FROM pg_catalog.jsonb_array_elements(v_items) AS entry(value)
  LOOP
    v_product_key := NULLIF(v_item->>'productId', '');
    v_product_id := v_product_key::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := NULLIF(v_item->>'unitPrice', '')::numeric;

    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0
       OR v_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'PURCHASE_ITEM_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- El producto debe estar en la orden: nunca se aceptan productos ajenos.
    SELECT entry.value
      INTO v_ordered_item
    FROM pg_catalog.jsonb_array_elements(v_ordered) AS entry(value)
    WHERE entry.value->>'productId' = v_product_key
    LIMIT 1;
    IF v_ordered_item IS NULL THEN
      RAISE EXCEPTION 'PURCHASE_ITEM_NOT_IN_ORDER' USING ERRCODE = 'P0001';
    END IF;

    v_ordered_qty := (v_ordered_item->>'quantity')::numeric;
    v_already := COALESCE((v_new_received->>v_product_key)::numeric, 0);
    IF v_already + v_quantity - v_ordered_qty > 0.000001 THEN
      RAISE EXCEPTION 'PURCHASE_RECEIVED_EXCEEDS_ORDERED' USING ERRCODE = 'P0001';
    END IF;
    v_new_received := v_new_received || pg_catalog.jsonb_build_object(
      v_product_key, v_already + v_quantity
    );

    -- El producto debe pertenecer al negocio y a la sucursal de la orden.
    SELECT product.branch_id
      INTO v_product_branch_id
    FROM public.products AS product
    WHERE product.id = v_product_id
      AND product.business_id = v_business_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PURCHASE_PRODUCT_NOT_IN_BUSINESS' USING ERRCODE = 'P0001';
    END IF;
    IF v_product_branch_id IS DISTINCT FROM v_branch_id THEN
      RAISE EXCEPTION 'PURCHASE_BRANCH_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

    -- Precio: el indicado al recibir, o el pactado en la orden.
    IF v_unit_price IS NULL THEN
      v_unit_price := NULLIF(v_ordered_item->>'unitPrice', '')::numeric;
    END IF;
    IF v_unit_price IS NOT NULL THEN
      IF v_unit_price < 0 OR v_unit_price::text IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'PURCHASE_UNIT_PRICE_INVALID' USING ERRCODE = 'P0001';
      END IF;
      v_price_updates := v_price_updates || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'productId', v_product_id::text,
          'purchasePrice', v_unit_price
        )
      );
    END IF;

    v_movements := v_movements || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'productId', v_product_id::text,
        'delta', v_quantity,
        'type', 'INCREASE',
        'branchId', v_branch_id::text,
        'reason', format('PURCHASE %s', COALESCE(v_order.data->>'code', p_purchase_order_id::text)),
        'extraFields', pg_catalog.jsonb_build_object('lastUpdated', v_now)
      )
    );
  END LOOP;

  -- Punto de no retorno: una sola transaccion para TODO lo siguiente.
  v_results := public.adjust_stock_batch_with_kardex(p_operation_id, v_movements);

  FOR v_item IN
    SELECT entry.value FROM pg_catalog.jsonb_array_elements(v_price_updates) AS entry(value)
  LOOP
    UPDATE public.products AS product
    SET data = product.data || pg_catalog.jsonb_build_object(
          'purchasePrice', (v_item->>'purchasePrice')::numeric,
          'lastPurchaseDate', v_now,
          'lastUpdated', v_now
        ),
        version = product.version + 1,
        updated_at = v_now
    WHERE product.id = (v_item->>'productId')::uuid
      AND product.business_id = v_business_id;
  END LOOP;

  -- Lo pedido vs lo recibido: decide si queda PARCIAL o COMPRADO.
  FOR v_ordered_item IN
    SELECT entry.value FROM pg_catalog.jsonb_array_elements(v_ordered) AS entry(value)
  LOOP
    v_ordered_qty := (v_ordered_item->>'quantity')::numeric;
    v_already := COALESCE((v_new_received->>(v_ordered_item->>'productId'))::numeric, 0);
    IF v_ordered_qty - v_already > 0.000001 THEN
      v_all_done := false;
      v_remaining_json := v_remaining_json || pg_catalog.jsonb_build_object(
        v_ordered_item->>'productId', v_ordered_qty - v_already
      );
    END IF;
  END LOOP;
  v_new_status := CASE WHEN v_all_done THEN 'COMPRADO' ELSE 'PARCIAL' END;

  UPDATE public.purchase_orders AS purchase_order
  SET data = purchase_order.data || pg_catalog.jsonb_build_object(
        'status', v_new_status,
        'receivedQuantities', v_new_received,
        'receivedOperationIds', v_ops || pg_catalog.jsonb_build_array(p_operation_id),
        'receivedOperationId', p_operation_id,
        'lastReceivedAt', v_now,
        'receivedBy', COALESCE(p_performed_by, v_actor_id::text),
        'supplierId', v_supplier_id
      ) || CASE
        WHEN v_all_done THEN pg_catalog.jsonb_build_object('receivedAt', v_now)
        ELSE '{}'::jsonb
      END,
      version = purchase_order.version + 1,
      updated_at = v_now
  WHERE purchase_order.id = p_purchase_order_id
    AND purchase_order.business_id = v_business_id
    AND purchase_order.version = v_order.version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PURCHASE_ORDER_UPDATE_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  v_audit_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.audit_logs (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (
    v_audit_id, v_business_id, v_branch_id, 1,
    pg_catalog.jsonb_build_object(
      'id', v_audit_id::text,
      'actorId', COALESCE(p_performed_by, v_actor_id::text),
      'action', 'PURCHASE_ORDER_RECEIVED',
      'module', 'inventory',
      'entityId', p_purchase_order_id::text,
      'description', CASE WHEN v_all_done
        THEN format('Recepcion completa de la compra %s aplicada al inventario', p_purchase_order_id::text)
        ELSE format('Recepcion parcial de la compra %s aplicada al inventario', p_purchase_order_id::text)
      END,
      'date', v_now,
      'operationId', p_operation_id,
      'idempotencyKey', p_operation_id,
      'note', NULLIF(btrim(COALESCE(p_note, '')), ''),
      'result', 'SUCCESS'
    ),
    v_now, v_now
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'idempotent', false,
    'operationId', p_operation_id,
    'purchaseOrderId', p_purchase_order_id,
    'status', v_new_status,
    'receivedAt', v_now,
    'receivedQuantities', v_new_received,
    'remaining', v_remaining_json,
    'products', v_results
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.receive_purchase_order_atomic(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.receive_purchase_order_atomic(text, uuid, jsonb, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order_atomic(text, uuid, jsonb, text, text) TO authenticated, service_role;

COMMIT;