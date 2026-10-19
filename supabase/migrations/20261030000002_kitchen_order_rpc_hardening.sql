BEGIN;

-- Cocina: quitar escrituras directas del cliente. La RPC de creación deriva
-- la comanda de la venta/pedido canónico; la app no puede inventar líneas.
CREATE OR REPLACE FUNCTION public.create_kitchen_order_atomic(
  p_business_id uuid,
  p_branch_id uuid,
  p_order jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order_id uuid;
  v_source_order_id uuid;
  v_source_sale_id uuid;
  v_source_data jsonb;
  v_source_status text;
  v_source_kind text;
  v_order_data jsonb;
  v_existing public.kitchen_orders%ROWTYPE;
  v_item record;
  v_requested_quantity numeric;
  v_allowed_quantity numeric;
  v_already_sent_quantity numeric;
  v_now timestamptz := clock_timestamp();
  v_send_operation_id text;
  v_priority text;
  v_table_id uuid;
  v_waiter_id text;
  v_audit_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'KITCHEN_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'KITCHEN_BUSINESS_BRANCH_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_order) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'KITCHEN_ORDER_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.business_members AS member
    WHERE member.business_id = p_business_id
      AND member.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'KITCHEN_NOT_A_MEMBER' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_business_role(
    p_business_id,
    ARRAY['ADMIN', 'GERENTE', 'CAJERO', 'MESERO', 'COCINA']::text[]
  ) THEN
    RAISE EXCEPTION 'KITCHEN_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_business_subscription_active(p_business_id) THEN
    RAISE EXCEPTION 'KITCHEN_SUBSCRIPTION_INACTIVE' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.branches AS branch
    WHERE branch.id = p_branch_id
      AND branch.business_id = p_business_id
      AND branch.active = true
      AND branch.id = ANY (public.auth_branch_ids())
  ) THEN
    RAISE EXCEPTION 'KITCHEN_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  v_order_id := NULLIF(p_order->>'id', '')::uuid;
  v_source_order_id := NULLIF(p_order->>'orderId', '')::uuid;
  v_send_operation_id := NULLIF(btrim(p_order->>'sendOperationId'), '');
  v_priority := upper(COALESCE(NULLIF(p_order->>'priority', ''), 'NORMAL'));
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'KITCHEN_ORDER_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF v_priority NOT IN ('NORMAL', 'HIGH', 'URGENT') THEN
    RAISE EXCEPTION 'KITCHEN_PRIORITY_INVALID' USING ERRCODE = '22023';
  END IF;
  IF v_send_operation_id IS NOT NULL AND length(v_send_operation_id) > 200 THEN
    RAISE EXCEPTION 'KITCHEN_SEND_OPERATION_ID_INVALID' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_order->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'KITCHEN_ITEMS_INVALID' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_order->'items') < 1 OR jsonb_array_length(p_order->'items') > 100 THEN
    RAISE EXCEPTION 'KITCHEN_ITEMS_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Idempotencia por ID: create_sale_fulfillment_atomic ya puede haber creado
  -- esta comanda dentro de la transacción de la venta.
  SELECT *
    INTO v_existing
  FROM public.kitchen_orders AS kitchen_order
  WHERE kitchen_order.id = v_order_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.business_id <> p_business_id
       OR v_existing.branch_id IS DISTINCT FROM p_branch_id THEN
      RAISE EXCEPTION 'KITCHEN_ORDER_ID_CONFLICT' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'order', v_existing.data,
      'version', v_existing.version
    );
  END IF;

  -- Idempotencia por envío desde Pedidos/Mesas.
  IF v_send_operation_id IS NOT NULL THEN
    SELECT *
      INTO v_existing
    FROM public.kitchen_orders AS kitchen_order
    WHERE kitchen_order.business_id = p_business_id
      AND kitchen_order.branch_id = p_branch_id
      AND kitchen_order.data->>'sendOperationId' = v_send_operation_id
    FOR UPDATE;
    IF FOUND THEN
      IF NULLIF(v_existing.data->>'orderId', '') IS DISTINCT FROM v_source_order_id::text THEN
        RAISE EXCEPTION 'KITCHEN_SEND_OPERATION_REUSED' USING ERRCODE = 'P0001';
      END IF;
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'order', v_existing.data,
        'version', v_existing.version
      );
    END IF;
  END IF;

  -- Leer y bloquear la fuente canónica. Las líneas recibidas del navegador
  -- solo se aceptan si pertenecen a un pedido/venta real de esta sucursal.
  IF v_source_order_id IS NOT NULL THEN
    SELECT order_row.data
      INTO v_source_data
    FROM public.orders AS order_row
    WHERE order_row.id = v_source_order_id
      AND order_row.business_id = p_business_id
      AND order_row.branch_id = p_branch_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'KITCHEN_SOURCE_ORDER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_source_kind := 'ORDER';
    v_source_status := upper(COALESCE(v_source_data->>'status', 'DRAFT'));
    IF v_source_status IN ('COMPLETED', 'CANCELLED') THEN
      RAISE EXCEPTION 'KITCHEN_SOURCE_ORDER_LOCKED' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT sale.data
      INTO v_source_data
    FROM public.sales AS sale
    WHERE sale.id = v_order_id
      AND sale.business_id = p_business_id
      AND sale.branch_id = p_branch_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'KITCHEN_SOURCE_SALE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_source_kind := 'SALE';
    v_source_sale_id := v_order_id;
    v_source_status := upper(COALESCE(v_source_data->>'status', ''));
    IF v_source_status IN ('CANCELLED', 'REFUNDED') THEN
      RAISE EXCEPTION 'KITCHEN_SOURCE_SALE_CANCELLED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF jsonb_typeof(v_source_data->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'KITCHEN_SOURCE_ITEMS_INVALID' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_order->'items') AS requested(value)
    WHERE NULLIF(requested.value->>'productId', '') IS NULL
       OR NULLIF(requested.value->>'quantity', '') IS NULL
       OR (requested.value->>'quantity')::numeric <= 0
       OR (requested.value->>'quantity')::numeric > 10000
  ) THEN
    RAISE EXCEPTION 'KITCHEN_ITEM_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Sumar por productId antes de validar: dos líneas del mismo producto no
  -- pueden superar la cantidad que realmente está en el pedido canónico.
  FOR v_item IN
    SELECT
      requested.value->>'productId' AS product_id,
      sum((requested.value->>'quantity')::numeric) AS quantity
    FROM jsonb_array_elements(p_order->'items') AS requested(value)
    GROUP BY requested.value->>'productId'
  LOOP
    v_requested_quantity := v_item.quantity;

    SELECT COALESCE(sum((source_item.value->>'quantity')::numeric), 0)
      INTO v_allowed_quantity
    FROM jsonb_array_elements(v_source_data->'items') AS source_item(value)
    WHERE source_item.value->>'productId' = v_item.product_id
      AND (
        COALESCE(NULLIF(source_item.value->>'requiresKitchen', '')::boolean, false)
        OR EXISTS (
          SELECT 1
          FROM public.products AS product
          WHERE product.id::text = v_item.product_id
            AND product.business_id = p_business_id
            AND (product.branch_id = p_branch_id OR product.branch_id IS NULL)
            AND COALESCE((product.data->>'requiresKitchen')::boolean, false)
            AND NOT COALESCE((product.data->>'isIngredient')::boolean, false)
        )
      );

    IF v_allowed_quantity <= 0 THEN
      RAISE EXCEPTION 'KITCHEN_ITEM_NOT_IN_SOURCE_ORDER' USING ERRCODE = '42501';
    END IF;

    IF v_source_kind = 'ORDER' THEN
      SELECT COALESCE(sum((sent_item.value->>'quantity')::numeric), 0)
        INTO v_already_sent_quantity
      FROM public.kitchen_orders AS prior_order
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(prior_order.data->'items', '[]'::jsonb)) AS sent_item(value)
      WHERE prior_order.business_id = p_business_id
        AND prior_order.branch_id = p_branch_id
        AND prior_order.data->>'orderId' = v_source_order_id::text
        AND upper(COALESCE(prior_order.data->>'status', '')) <> 'CANCELADO'
        AND sent_item.value->>'productId' = v_item.product_id;

      IF v_requested_quantity > GREATEST(v_allowed_quantity - v_already_sent_quantity, 0) THEN
        RAISE EXCEPTION 'KITCHEN_QUANTITY_ALREADY_SENT' USING ERRCODE = 'P0001';
      END IF;
    ELSIF v_requested_quantity > v_allowed_quantity THEN
      RAISE EXCEPTION 'KITCHEN_QUANTITY_EXCEEDS_SALE' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  v_table_id := NULLIF(v_source_data->>'tableId', '')::uuid;
  v_waiter_id := NULLIF(v_source_data->>'waiterId', '');
  v_order_data := jsonb_strip_nulls(jsonb_build_object(
    'id', v_order_id::text,
    'businessId', p_business_id::text,
    'branchId', p_branch_id::text,
    'orderId', v_source_order_id::text,
    'saleId', v_source_sale_id::text,
    'tableId', v_table_id::text,
    'tableSessionId', COALESCE(NULLIF(p_order->>'tableSessionId', ''), NULLIF(v_source_data->>'openOperationId', '')),
    'waiterId', v_waiter_id,
    'orderNumber', COALESCE(NULLIF(v_source_data->>'orderNumber', '')::integer, NULLIF(p_order->>'orderNumber', '')::integer),
    'origin', left(COALESCE(NULLIF(btrim(p_order->>'origin'), ''), 'Pedido'), 160),
    'notes', left(COALESCE(v_source_data->>'notes', p_order->>'notes', ''), 500),
    'priority', v_priority,
    'sendOperationId', v_send_operation_id,
    'sendSequence', COALESCE(NULLIF(p_order->>'sendSequence', '')::integer, 1),
    'items', p_order->'items',
    'status', 'PENDIENTE',
    'createdAt', v_now,
    'updatedAt', v_now
  ));

  INSERT INTO public.kitchen_orders (
    id, business_id, branch_id, version, data, created_at, updated_at
  ) VALUES (
    v_order_id, p_business_id, p_branch_id, 1, v_order_data, v_now, v_now
  );

  -- Si son líneas ya materializadas de una venta, crea solo los registros
  -- auxiliares que tengan saleItemId real. Las comandas de Orders no inventan
  -- sale_items inexistentes.
  IF v_source_kind = 'SALE' THEN
    INSERT INTO public.kitchen_order_items (kitchen_order_id, sale_item_id, status, notes)
    SELECT
      v_order_id,
      NULLIF(item.value->>'saleItemId', '')::uuid,
      'pending',
      NULLIF(item.value->>'note', '')
    FROM jsonb_array_elements(v_order_data->'items') AS item(value)
    JOIN public.sale_items AS sale_item
      ON sale_item.id = NULLIF(item.value->>'saleItemId', '')::uuid
     AND sale_item.sale_id = v_source_sale_id
     AND sale_item.product_id::text = item.value->>'productId'
    WHERE NULLIF(item.value->>'saleItemId', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.kitchen_order_items AS existing_item
        WHERE existing_item.kitchen_order_id = v_order_id
          AND existing_item.sale_item_id = sale_item.id
      );
  END IF;

  v_audit_id := gen_random_uuid();
  INSERT INTO public.audit_logs (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (
    v_audit_id, p_business_id, p_branch_id, 1,
    jsonb_build_object(
      'id', v_audit_id::text,
      'actorId', v_actor_id::text,
      'action', 'KITCHEN_ORDER_CREATED',
      'module', 'kitchen',
      'entityId', v_order_id::text,
      'description', 'Comanda creada mediante RPC atómica.',
      'date', v_now,
      'result', 'SUCCESS'
    ), v_now, v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'order', v_order_data,
    'version', 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_kitchen_order_status_atomic(
  p_business_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_expected_version integer,
  p_new_status text,
  p_cancel_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.kitchen_orders%ROWTYPE;
  v_current_status text;
  v_new_status text := upper(btrim(COALESCE(p_new_status, '')));
  v_item_status text;
  v_now timestamptz := clock_timestamp();
  v_new_data jsonb;
  v_description text;
  v_audit_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'KITCHEN_AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF p_business_id IS NULL OR p_branch_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'KITCHEN_CONTEXT_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_members bm WHERE bm.business_id = p_business_id AND bm.user_id = v_actor_id) THEN
    RAISE EXCEPTION 'KITCHEN_NOT_A_MEMBER' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','GERENTE','CAJERO','MESERO','COCINA']::text[]) THEN
    RAISE EXCEPTION 'KITCHEN_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_business_subscription_active(p_business_id) THEN
    RAISE EXCEPTION 'KITCHEN_SUBSCRIPTION_INACTIVE' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches branch
    WHERE branch.id = p_branch_id AND branch.business_id = p_business_id
      AND branch.active = true AND branch.id = ANY(public.auth_branch_ids())
  ) THEN RAISE EXCEPTION 'KITCHEN_BRANCH_FORBIDDEN' USING ERRCODE = '42501'; END IF;

  IF v_new_status NOT IN ('PENDIENTE','EN_PREPARACION','LISTO','ENTREGADO','CANCELADO') THEN
    RAISE EXCEPTION 'KITCHEN_STATUS_INVALID' USING ERRCODE = '22023';
  END IF;
  IF v_new_status = 'CANCELADO' AND NULLIF(btrim(p_cancel_reason), '') IS NULL THEN
    RAISE EXCEPTION 'KITCHEN_CANCEL_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF v_new_status = 'CANCELADO' AND length(btrim(p_cancel_reason)) > 500 THEN
    RAISE EXCEPTION 'KITCHEN_CANCEL_REASON_TOO_LONG' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order
  FROM public.kitchen_orders kitchen_order
  WHERE kitchen_order.id = p_order_id
    AND kitchen_order.business_id = p_business_id
    AND kitchen_order.branch_id = p_branch_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KITCHEN_ORDER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  v_current_status := upper(COALESCE(v_order.data->>'status', 'PENDIENTE'));
  IF v_current_status = v_new_status THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'order', v_order.data, 'version', v_order.version);
  END IF;
  IF v_order.version <> p_expected_version THEN
    RAISE EXCEPTION 'OPTIMISTIC_LOCK_ERROR' USING ERRCODE = '40001';
  END IF;

  IF NOT (
    (v_current_status = 'PENDIENTE' AND v_new_status IN ('EN_PREPARACION','CANCELADO'))
    OR (v_current_status = 'EN_PREPARACION' AND v_new_status IN ('LISTO','CANCELADO'))
    OR (v_current_status = 'LISTO' AND v_new_status IN ('ENTREGADO','CANCELADO'))
  ) THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: % -> %', v_current_status, v_new_status USING ERRCODE = 'P0001';
  END IF;

  v_new_data := v_order.data || jsonb_build_object('status', v_new_status, 'updatedAt', v_now);
  IF v_new_status = 'ENTREGADO' THEN
    v_new_data := v_new_data || jsonb_build_object('deliveredAt', COALESCE(NULLIF(v_order.data->>'deliveredAt', '')::timestamptz, v_now));
  END IF;
  IF v_new_status = 'CANCELADO' AND NULLIF(btrim(p_cancel_reason), '') IS NOT NULL THEN
    v_new_data := v_new_data || jsonb_build_object('cancelReason', left(btrim(p_cancel_reason), 500));
  END IF;

  UPDATE public.kitchen_orders
  SET data = v_new_data,
      version = version + 1,
      updated_at = v_now
  WHERE id = p_order_id
    AND business_id = p_business_id
    AND branch_id = p_branch_id
    AND version = p_expected_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPTIMISTIC_LOCK_ERROR' USING ERRCODE = '40001'; END IF;

  v_item_status := CASE v_new_status
    WHEN 'PENDIENTE' THEN 'pending'
    WHEN 'EN_PREPARACION' THEN 'preparing'
    WHEN 'LISTO' THEN 'ready'
    WHEN 'ENTREGADO' THEN 'delivered'
    WHEN 'CANCELADO' THEN 'cancelled'
  END;
  UPDATE public.kitchen_order_items
  SET status = v_item_status
  WHERE kitchen_order_id = p_order_id;

  IF v_new_status = 'CANCELADO' THEN
    UPDATE public.kitchen_printer_jobs
    SET status = 'FAILED',
        data = data || jsonb_build_object(
          'status', 'CANCELLED',
          'cancelReason', NULLIF(left(btrim(COALESCE(p_cancel_reason, '')), 500), ''),
          'cancelledAt', v_now
        ),
        updated_at = v_now
    WHERE business_id = p_business_id
      AND branch_id = p_branch_id
      AND kitchen_order_id = p_order_id
      AND status IN ('PENDING', 'PRINTING');
  END IF;

  v_description := CASE
    WHEN v_new_status = 'CANCELADO' THEN 'Comanda cancelada' || COALESCE(': ' || NULLIF(left(btrim(p_cancel_reason), 500), ''), '.')
    ELSE 'Estado de comanda actualizado a ' || v_new_status || '.'
  END;
  v_audit_id := gen_random_uuid();
  INSERT INTO public.audit_logs (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (
    v_audit_id, p_business_id, p_branch_id, 1,
    jsonb_build_object(
      'id', v_audit_id::text,
      'actorId', v_actor_id::text,
      'action', CASE WHEN v_new_status = 'CANCELADO' THEN 'KITCHEN_ORDER_CANCELLED' ELSE 'KITCHEN_ORDER_STATUS_UPDATED' END,
      'module', 'kitchen',
      'entityId', p_order_id::text,
      'description', v_description,
      'date', v_now,
      'previousStatus', v_current_status,
      'status', v_new_status,
      'result', 'SUCCESS'
    ), v_now, v_now
  );

  RETURN jsonb_build_object('success', true, 'idempotent', false, 'order', v_new_data, 'version', p_expected_version + 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.move_kitchen_order_atomic(
  p_business_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_expected_version integer,
  p_target_table_id uuid,
  p_target_order_id uuid DEFAULT NULL,
  p_target_origin text DEFAULT NULL,
  p_target_table_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_order public.kitchen_orders%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_new_data jsonb;
  v_audit_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'KITCHEN_AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF p_business_id IS NULL OR p_branch_id IS NULL OR p_order_id IS NULL OR p_target_table_id IS NULL THEN
    RAISE EXCEPTION 'KITCHEN_CONTEXT_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_members bm WHERE bm.business_id = p_business_id AND bm.user_id = v_actor_id) THEN
    RAISE EXCEPTION 'KITCHEN_NOT_A_MEMBER' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','GERENTE','CAJERO','MESERO','COCINA']::text[]) THEN
    RAISE EXCEPTION 'KITCHEN_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_business_subscription_active(p_business_id) THEN
    RAISE EXCEPTION 'KITCHEN_SUBSCRIPTION_INACTIVE' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches branch
    WHERE branch.id = p_branch_id AND branch.business_id = p_business_id
      AND branch.active = true AND branch.id = ANY(public.auth_branch_ids())
  ) THEN RAISE EXCEPTION 'KITCHEN_BRANCH_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tables table_row
    WHERE table_row.id = p_target_table_id
      AND table_row.business_id = p_business_id
      AND table_row.branch_id = p_branch_id
      AND upper(COALESCE(table_row.data->>'status', '')) <> 'CLOSED'
  ) THEN RAISE EXCEPTION 'KITCHEN_TARGET_TABLE_INVALID' USING ERRCODE = '42501'; END IF;
  IF p_target_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.orders order_row
    WHERE order_row.id = p_target_order_id
      AND order_row.business_id = p_business_id
      AND order_row.branch_id = p_branch_id
      AND upper(COALESCE(order_row.data->>'status', '')) NOT IN ('COMPLETED','CANCELLED')
  ) THEN RAISE EXCEPTION 'KITCHEN_TARGET_ORDER_INVALID' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_order
  FROM public.kitchen_orders kitchen_order
  WHERE kitchen_order.id = p_order_id
    AND kitchen_order.business_id = p_business_id
    AND kitchen_order.branch_id = p_branch_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KITCHEN_ORDER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  IF v_order.data->>'tableId' IS NOT DISTINCT FROM p_target_table_id::text
     AND v_order.data->>'orderId' IS NOT DISTINCT FROM p_target_order_id::text
     AND v_order.data->>'origin' IS NOT DISTINCT FROM NULLIF(left(p_target_origin, 160), '')
     AND v_order.data->>'tableSessionId' IS NOT DISTINCT FROM NULLIF(p_target_table_session_id, '') THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'order', v_order.data, 'version', v_order.version);
  END IF;
  IF v_order.version <> p_expected_version THEN
    RAISE EXCEPTION 'OPTIMISTIC_LOCK_ERROR' USING ERRCODE = '40001';
  END IF;

  v_new_data := jsonb_strip_nulls(
    v_order.data || jsonb_build_object(
      'tableId', p_target_table_id::text,
      'orderId', p_target_order_id::text,
      'origin', NULLIF(left(btrim(COALESCE(p_target_origin, '')), 160), ''),
      'tableSessionId', NULLIF(btrim(COALESCE(p_target_table_session_id, '')), ''),
      'updatedAt', v_now
    )
  );

  UPDATE public.kitchen_orders
  SET data = v_new_data,
      version = version + 1,
      updated_at = v_now
  WHERE id = p_order_id
    AND business_id = p_business_id
    AND branch_id = p_branch_id
    AND version = p_expected_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPTIMISTIC_LOCK_ERROR' USING ERRCODE = '40001'; END IF;

  v_audit_id := gen_random_uuid();
  INSERT INTO public.audit_logs (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (
    v_audit_id, p_business_id, p_branch_id, 1,
    jsonb_build_object(
      'id', v_audit_id::text,
      'actorId', v_actor_id::text,
      'action', 'KITCHEN_ORDER_MOVED',
      'module', 'kitchen',
      'entityId', p_order_id::text,
      'description', 'Comanda reasignada a ' || COALESCE(NULLIF(p_target_origin, ''), 'otra mesa') || '.',
      'date', v_now,
      'tableId', p_target_table_id::text,
      'result', 'SUCCESS'
    ), v_now, v_now
  );

  RETURN jsonb_build_object('success', true, 'idempotent', false, 'order', v_new_data, 'version', p_expected_version + 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_kitchen_order_atomic(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_kitchen_order_atomic(uuid, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.update_kitchen_order_status_atomic(uuid, uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_kitchen_order_status_atomic(uuid, uuid, uuid, integer, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.move_kitchen_order_atomic(uuid, uuid, uuid, integer, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_kitchen_order_atomic(uuid, uuid, uuid, integer, uuid, uuid, text, text) TO authenticated;

COMMIT;
