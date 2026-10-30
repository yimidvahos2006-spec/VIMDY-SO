-- ============================================================================
-- 20261116000000_inventory_movements_expires_at.sql
-- ----------------------------------------------------------------------------
-- Centro de Perdidas: fecha de vencimiento en las ENTRADAS de inventario.
--
--   1. public.immutable_date(text)        helper IMMUTABLE text -> date (NULL si es
--                                         invalida; nunca rompe un INSERT).
--   2. public.normalize_expires_at(jsonb) validador del RPC: formato YYYY-MM-DD,
--                                         fecha real, entre 2000-01-01 y hoy + 20 anios.
--   3. inventory_movements.expires_at     date NULL, columna GENERADA desde
--                                         data->>'expiresAt' (mismo patron que
--                                         movement_date / movement_product_id: una sola
--                                         fuente de verdad, imposible que diverjan).
--                                         Indice parcial para el Centro de Perdidas.
--   4. RPCs (misma firma, mismos permisos; CREATE OR REPLACE):
--        adjust_stock_batch_with_kardex   item.expiresAt (solo INCREASE)
--        receive_purchase_order_atomic    item.expiresAt por linea recibida
--        record_direct_purchase_atomic    item.expiresAt por linea facturada
--
-- Compatibilidad: expiresAt es opcional. Sin el, todo funciona igual que antes
-- y expires_at queda NULL. Los movimientos historicos quedan NULL (no se inventa
-- un vencimiento). El valor viaja dentro del payload, asi que ya entra al hash
-- de idempotencia (mismo operation_id con otra fecha => IDEMPOTENCY_KEY_REUSED).
--
-- Nota operativa: ADD COLUMN ... GENERATED STORED reescribe la tabla y toma
-- ACCESS EXCLUSIVE un momento (igual que formalize_hot_columns). Correr fuera de
-- hora pico si inventory_movements es grande.
--
-- Migracion NUEVA: no se modifican las historicas 20261112/20261114/20261115.
-- ============================================================================

BEGIN;

-- 1) Helper IMMUTABLE (requerido por la columna generada) -------------------
CREATE OR REPLACE FUNCTION public.immutable_date(p_text text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_text IS NULL OR p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN pg_catalog.make_date(
    pg_catalog.substr(p_text, 1, 4)::int,
    pg_catalog.substr(p_text, 6, 2)::int,
    pg_catalog.substr(p_text, 9, 2)::int
  );
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;  -- p.ej. 2026-02-31: la columna queda NULL, el RPC ya lo rechaza antes
END;
$$;

-- 2) Validador usado por los RPCs ---------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_expires_at(p_value jsonb)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_date date;
BEGIN
  IF p_value IS NULL OR pg_catalog.jsonb_typeof(p_value) = 'null' THEN
    RETURN NULL;
  END IF;
  IF pg_catalog.jsonb_typeof(p_value) <> 'string' THEN
    RAISE EXCEPTION 'INVALID_EXPIRES_AT' USING ERRCODE = 'P0001';
  END IF;

  v_date := public.immutable_date(p_value #>> '{}');
  IF v_date IS NULL
     OR v_date < DATE '2000-01-01'
     OR v_date > (CURRENT_DATE + INTERVAL '20 years')::date THEN
    RAISE EXCEPTION 'INVALID_EXPIRES_AT' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_date;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_expires_at(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_expires_at(jsonb) TO authenticated, service_role;

-- 3) Columna generada + indice ---------------------------------------------------
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS expires_at date
    GENERATED ALWAYS AS (public.immutable_date(data->>'expiresAt')) STORED;

COMMENT ON COLUMN public.inventory_movements.expires_at IS
  'Vencimiento del lote que entra (solo INCREASE). Generada desde data->>''expiresAt'' (YYYY-MM-DD). NULL = sin fecha informada.';

-- Centro de Perdidas: "que entradas vencen pronto" por negocio/sucursal.
CREATE INDEX IF NOT EXISTS inventory_movements_expiry_idx
  ON public.inventory_movements (business_id, branch_id, expires_at)
  WHERE expires_at IS NOT NULL;

-- 4) RPCs ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.adjust_stock_batch_with_kardex(
  p_operation_id text,
  p_movements jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_product_id text;
  v_delta numeric;
  v_reason text;
  v_type text;
  v_branch_id uuid;
  v_extra_fields jsonb;
  v_allow_negative boolean;
  v_expires_at date;
  v_product_data jsonb;
  v_product_name text;
  v_product_business_id uuid;
  v_operation_business_id uuid;
  v_product_branch_id uuid;
  v_operation_branch_id uuid;
  v_payload_hash text;
  v_existing_payload_hash text;
  v_existing_movement_count integer;
  v_rows_inserted integer;
  v_actor_role text := auth.role();
  v_movement_id uuid;
  v_existing_movement jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF NULLIF(btrim(p_operation_id), '') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_OPERATION_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_movements) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_movements) = 0
     OR jsonb_array_length(p_movements) > 500 THEN
    RAISE EXCEPTION 'INVALID_INVENTORY_BATCH' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_movements) AS entry(value)
    GROUP BY entry.value->>'productId', entry.value->>'type'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_INVENTORY_BATCH_ITEM' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id, 0)
  );

  v_product_id := NULLIF(p_movements->0->>'productId', '');
  v_operation_branch_id := NULLIF(p_movements->0->>'branchId', '')::uuid;
  SELECT product.business_id
    INTO v_operation_business_id
  FROM public.products AS product
  WHERE product.id = v_product_id::uuid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_operation_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.branches AS branch
    WHERE branch.id = v_operation_branch_id
      AND branch.business_id = v_operation_business_id
  ) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_VIOLATION' USING ERRCODE = '42501';
  END IF;

  IF v_actor_role IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL
       OR NOT public.has_business_role(
         v_operation_business_id,
         ARRAY['ADMIN', 'GERENTE', 'INVENTARIO']
       )
       OR NOT public.is_business_subscription_active(v_operation_business_id) THEN
      RAISE EXCEPTION 'INVENTORY_BATCH_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF v_operation_branch_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         WHERE v_operation_branch_id = ANY (public.auth_branch_ids())
       ) THEN
      RAISE EXCEPTION 'BRANCH_SCOPE_VIOLATION' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT pg_catalog.encode(extensions.digest(ordered_movements.value::text, 'sha256'), 'hex')
    INTO v_payload_hash
  FROM (
    SELECT pg_catalog.jsonb_agg(
      entry.value ORDER BY entry.value->>'productId', entry.value->>'type'
    ) AS value
    FROM pg_catalog.jsonb_array_elements(p_movements) AS entry(value)
  ) AS ordered_movements;

  INSERT INTO public.inventory_batch_operations (
    business_id, branch_id, operation_id, payload_hash, movement_count
  )
  VALUES (
    v_operation_business_id, v_operation_branch_id, p_operation_id,
    v_payload_hash, jsonb_array_length(p_movements)
  )
  ON CONFLICT (business_id, operation_id) DO NOTHING;
  GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

  IF v_rows_inserted = 0 THEN
    SELECT operation.payload_hash, operation.movement_count
      INTO v_existing_payload_hash, v_existing_movement_count
    FROM public.inventory_batch_operations AS operation
    WHERE operation.business_id = v_operation_business_id
      AND operation.operation_id = p_operation_id
      AND operation.branch_id IS NOT DISTINCT FROM v_operation_branch_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_existing_payload_hash IS DISTINCT FROM v_payload_hash
       OR v_existing_movement_count <> jsonb_array_length(p_movements) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN
      SELECT entry.value
      FROM pg_catalog.jsonb_array_elements(p_movements) AS entry(value)
      ORDER BY entry.value->>'productId', entry.value->>'type'
    LOOP
      SELECT product.data INTO v_result
      FROM public.products AS product
      WHERE product.id = (v_item->>'productId')::uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
      END IF;
      v_results := v_results || pg_catalog.jsonb_build_array(v_result);
    END LOOP;
    RETURN v_results;
  END IF;

  FOR v_item IN
    SELECT entry.value
    FROM pg_catalog.jsonb_array_elements(p_movements) AS entry(value)
    ORDER BY entry.value->>'productId', entry.value->>'type'
  LOOP
    v_product_id := NULLIF(v_item->>'productId', '');
    v_delta := (v_item->>'delta')::numeric;
    v_reason := NULLIF(btrim(v_item->>'reason'), '');
    v_type := v_item->>'type';
    v_branch_id := NULLIF(v_item->>'branchId', '')::uuid;
    v_extra_fields := COALESCE(v_item->'extraFields', '{}'::jsonb);

    -- Opcion B: SOLO el descuento por venta puede dejar el stock en negativo.
    -- El flag es opcional; si viene debe ser booleano y solo con DECREASE.
    -- Sin flag (o false) el comportamiento es el de siempre: INSUFFICIENT_STOCK.
    IF jsonb_typeof(v_item->'allowNegative') IS NOT NULL
       AND jsonb_typeof(v_item->'allowNegative') <> 'boolean' THEN
      RAISE EXCEPTION 'INVALID_INVENTORY_BATCH_ITEM' USING ERRCODE = 'P0001';
    END IF;
    v_allow_negative := COALESCE((v_item->>'allowNegative')::boolean, false);
    IF v_allow_negative AND v_type IS DISTINCT FROM 'DECREASE' THEN
      RAISE EXCEPTION 'INVALID_INVENTORY_BATCH_ITEM' USING ERRCODE = 'P0001';
    END IF;

    -- Vencimiento del lote que entra (Centro de Perdidas). Opcional, solo en
    -- entradas (INCREASE). Formato estricto YYYY-MM-DD; si no, INVALID_EXPIRES_AT.
    v_expires_at := public.normalize_expires_at(v_item->'expiresAt');
    IF v_expires_at IS NOT NULL AND v_type IS DISTINCT FROM 'INCREASE' THEN
      RAISE EXCEPTION 'INVALID_INVENTORY_BATCH_ITEM' USING ERRCODE = 'P0001';
    END IF;

     IF v_product_id IS NULL OR v_reason IS NULL OR v_delta IS NULL OR v_delta = 0
       OR v_type IS NULL OR v_type NOT IN ('INCREASE', 'DECREASE')
       OR (v_type = 'DECREASE' AND v_delta >= 0)
       OR (v_type = 'INCREASE' AND v_delta <= 0)
       OR jsonb_typeof(v_extra_fields) IS DISTINCT FROM 'object'
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.jsonb_object_keys(v_extra_fields) AS fields(key)
         WHERE fields.key <> 'lastUpdated'
       ) THEN
      RAISE EXCEPTION 'INVALID_INVENTORY_BATCH_ITEM' USING ERRCODE = 'P0001';
    END IF;

    v_movement_id := pg_catalog.substr(
      pg_catalog.encode(
        extensions.digest(p_operation_id || ':' || v_product_id || ':' || v_type, 'sha256'),
        'hex'
      ),
      1,
      32
    )::uuid;

    SELECT product.data, product.business_id, product.branch_id,
           product.data->>'name'
      INTO v_product_data, v_product_business_id, v_product_branch_id,
           v_product_name
    FROM public.products AS product
    WHERE product.id = v_product_id::uuid
    FOR UPDATE;

    IF NOT FOUND OR v_product_name IS NULL THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF v_branch_id IS DISTINCT FROM v_product_branch_id THEN
      RAISE EXCEPTION 'BRANCH_SCOPE_VIOLATION' USING ERRCODE = '42501';
    END IF;
     IF v_branch_id IS DISTINCT FROM v_operation_branch_id
       OR v_product_business_id IS DISTINCT FROM v_operation_business_id THEN
      RAISE EXCEPTION 'INVENTORY_BATCH_SCOPE_MISMATCH' USING ERRCODE = '42501';
    END IF;
    IF v_branch_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.branches AS branch
      WHERE branch.id = v_branch_id
        AND branch.business_id = v_product_business_id
    ) THEN
      RAISE EXCEPTION 'BRANCH_SCOPE_VIOLATION' USING ERRCODE = '42501';
    END IF;

    SELECT movement.data
      INTO v_existing_movement
    FROM public.inventory_movements AS movement
    WHERE movement.id = v_movement_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing_movement->>'productId' IS DISTINCT FROM v_product_id
         OR (v_existing_movement->>'quantity')::numeric IS DISTINCT FROM abs(v_delta)
         OR v_existing_movement->>'type' IS DISTINCT FROM v_type
         OR v_existing_movement->>'reason' IS DISTINCT FROM v_reason
         OR v_existing_movement->>'branchId' IS DISTINCT FROM v_branch_id::text THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001';
      END IF;
      v_result := v_product_data;
    ELSE
      v_result := public.adjust_stock_with_kardex_and_fields(
        v_product_id,
        v_delta,
        v_reason,
        v_type,
        NULL,
        NULL,
        NULL,
        NULL,
        v_movement_id::text,
        v_branch_id,
        v_allow_negative,
        v_extra_fields
      );
      UPDATE public.inventory_movements AS movement
      SET data = movement.data || jsonb_build_object(
        'operationId', p_operation_id,
        'payloadHash', v_payload_hash
      ) || CASE
        -- Trazabilidad Opcion B: stock antes/despues y marca de negativo, igual
        -- que create_sale_fulfillment_atomic. adjust_stock_with_kardex no los escribe.
        WHEN v_result->>'stock' IS NOT NULL THEN pg_catalog.jsonb_build_object(
          'stockBefore', (v_result->>'stock')::numeric - v_delta,
          'stockAfter', (v_result->>'stock')::numeric,
          'negative', (v_result->>'stock')::numeric < 0
        )
        ELSE '{}'::jsonb
      END || CASE
        -- Fecha de vencimiento: queda en data->>'expiresAt' y la columna generada
        -- inventory_movements.expires_at la expone indexada.
        WHEN v_expires_at IS NOT NULL
          THEN pg_catalog.jsonb_build_object('expiresAt', v_expires_at)
        ELSE '{}'::jsonb
      END
      WHERE movement.id = v_movement_id
        AND movement.business_id = v_product_business_id;
    END IF;

    v_results := v_results || pg_catalog.jsonb_build_array(v_result);
  END LOOP;

  RETURN v_results;
END;
$$;

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
  v_cost_lines jsonb := '[]'::jsonb;
  v_stock_before numeric;
  v_old_avg numeric;
  v_new_avg numeric;
  v_expires_at date;
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

  -- Orden estable por productId: dos compras simultaneas que tocan los mismos
  -- productos bloquean las filas en el mismo orden y no pueden hacer deadlock.
  SELECT COALESCE(pg_catalog.jsonb_agg(entry.value ORDER BY entry.value->>'productId'), '[]'::jsonb)
    INTO v_items
  FROM pg_catalog.jsonb_array_elements(v_items) AS entry(value);

  FOR v_item IN
    SELECT entry.value FROM pg_catalog.jsonb_array_elements(v_items) AS entry(value)
  LOOP
    v_product_key := NULLIF(v_item->>'productId', '');
    v_product_id := v_product_key::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := NULLIF(v_item->>'unitPrice', '')::numeric;
    -- Vencimiento del lote recibido (opcional, YYYY-MM-DD). Una fecha por
    -- producto y recepcion: otro lote con otra fecha entra en otra recepcion.
    v_expires_at := public.normalize_expires_at(v_item->'expiresAt');

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
    SELECT product.branch_id,
           COALESCE(NULLIF(product.data->>'stock', '')::numeric, 0),
           COALESCE(NULLIF(product.data->>'averageCost', '')::numeric,
                    NULLIF(product.data->>'purchasePrice', '')::numeric)
      INTO v_product_branch_id, v_stock_before, v_old_avg
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
      -- Costo promedio ponderado: (stock*promedio + compra*precio) / (stock+compra).
      -- Sin stock previo o sin costo previo, el promedio es el precio de esta compra.
      IF v_stock_before <= 0 OR v_old_avg IS NULL THEN
        v_new_avg := v_unit_price;
      ELSE
        v_new_avg := round(
          (v_stock_before * v_old_avg + v_quantity * v_unit_price)
          / (v_stock_before + v_quantity), 4);
      END IF;
      v_price_updates := v_price_updates || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'productId', v_product_id::text,
          'purchasePrice', v_unit_price,
          'averageCost', v_new_avg
        )
      );
      v_cost_lines := v_cost_lines || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'productId', v_product_id::text,
          'unitCost', v_unit_price,
          'totalCost', round(v_quantity * v_unit_price, 4),
          'averageCostAfter', v_new_avg
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
      ) || CASE
        WHEN v_expires_at IS NOT NULL
          THEN pg_catalog.jsonb_build_object('expiresAt', v_expires_at)
        ELSE '{}'::jsonb
      END
    );
  END LOOP;

  -- Punto de no retorno: una sola transaccion para TODO lo siguiente.
  v_results := public.adjust_stock_batch_with_kardex(p_operation_id, v_movements);

  -- Costo en el Kardex: cada INCREASE de esta operacion guarda a que costo entro.
  FOR v_item IN
    SELECT entry.value FROM pg_catalog.jsonb_array_elements(v_cost_lines) AS entry(value)
  LOOP
    UPDATE public.inventory_movements AS movement
    SET data = movement.data || pg_catalog.jsonb_build_object(
      'unitCost', (v_item->>'unitCost')::numeric,
      'totalCost', (v_item->>'totalCost')::numeric,
      'averageCostAfter', (v_item->>'averageCostAfter')::numeric
    )
    WHERE movement.business_id = v_business_id
      AND movement.data->>'operationId' = p_operation_id
      AND movement.data->>'productId' = v_item->>'productId'
      AND movement.data->>'type' = 'INCREASE';
  END LOOP;

  FOR v_item IN
    SELECT entry.value FROM pg_catalog.jsonb_array_elements(v_price_updates) AS entry(value)
  LOOP
    UPDATE public.products AS product
    SET data = product.data || pg_catalog.jsonb_build_object(
          'purchasePrice', (v_item->>'purchasePrice')::numeric,
          'averageCost', (v_item->>'averageCost')::numeric,
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
  v_expires_at date;
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
    v_expires_at := public.normalize_expires_at(v_item->'expiresAt');

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
      ) || CASE
        WHEN v_expires_at IS NOT NULL
          THEN pg_catalog.jsonb_build_object('expiresAt', v_expires_at)
        ELSE '{}'::jsonb
      END
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

-- Grants: identicos a los de las versiones anteriores (CREATE OR REPLACE los conserva;
-- se repiten para que la migracion sea autosuficiente).
REVOKE ALL ON FUNCTION public.adjust_stock_batch_with_kardex(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock_batch_with_kardex(text, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.receive_purchase_order_atomic(text, uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order_atomic(text, uuid, jsonb, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_direct_purchase_atomic(text, uuid, uuid, text, jsonb, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_direct_purchase_atomic(text, uuid, uuid, text, jsonb, text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.adjust_stock_batch_with_kardex(text, jsonb) IS
  'Applies a bounded set of stock and Kardex changes in one transaction. Stable operation/product/type movement IDs make retries idempotent; conflicting payload reuse is rejected. A DECREASE item may carry allowNegative=true (sale discount only, Option B); an INCREASE item may carry expiresAt (YYYY-MM-DD) stored in the Kardex.';

COMMIT;