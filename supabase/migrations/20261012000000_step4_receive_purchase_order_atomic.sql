-- ============================================================================
-- 20261012000000_step4_receive_purchase_order_atomic.sql
-- ----------------------------------------------------------------------------
-- Cierra el gap de COMPRAS -> INVENTARIO (alcance D del Paso 4).
--
-- Problema
-- --------
-- PurchaseOrderEngine.markAsPurchased() era un bucle en el cliente:
--
--   for (const item of finalItems) {
--     await this.inventoryEngine.increaseStock(item.productId, item.quantity, ...);
--   }
--   await this.repository.update({ ...order, status: "COMPRADO", receivedAt });
--
-- Cada increaseStock era su propia escritura. Si el item 3 fallaba (producto
-- inexistente, stock inconsistente, error de red), los items 1 y 2 YA habian
-- movido stock y la orden seguia PENDIENTE: recepcion parcial, imposible de
-- reconciliar. No habia forma de deshacerla porque cada aumento era un commit.
--
-- Decision de diseño
-- -----------------
-- No se reimplementa la logica de stock. Se delega en
-- public.adjust_stock_batch_with_kardex(), que YA es atomica, idempotente por
-- operation_id, valida RBAC y scope de sucursal, y escribe producto + Kardex
-- en la misma transaccion (ver 20260930190000_atomic_inventory_batch.sql).
--
-- Lo NUEVO y propio de esta migracion es la verdad de la orden de compra:
-- la transicion de estado PENDIENTE/POSPUESTO -> COMPRADO, atómica y ligada a
-- la misma transaccion que mueve el stock. Gracias a esto:
--
--   * todos los items se aplican, o ninguno (una sola transaccion);
--   * el retry con el mismo operation_id no vuelve a mover stock;
--   * una recepcion concurrente de la misma orden se serializa con
--     pg_advisory_xact_lock sobre el id de la orden;
--   * el negocio y la sucursal se derivan de la ORDEN y de los PRODUCTOS,
--     nunca de un parametro libre del caller;
--   * crear una orden NO mueve stock: solo receive_purchase_order_atomic lo hace.
--
-- Migracion NUEVA: no se modifica ninguna migracion historica.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.receive_purchase_order_atomic(
  p_operation_id text,
  p_purchase_order_id uuid,
  p_received_items jsonb DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_performed_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.purchase_orders%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_actor_role text := auth.role();
  v_business_id uuid;
  v_branch_id uuid;
  v_status text;
  v_supplier_id text;
  v_items jsonb;
  v_item jsonb;
  v_movements jsonb := '[]'::jsonb;
  v_price_updates jsonb := '[]'::jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_product_branch_id uuid;
  v_now timestamptz := clock_timestamp();
  v_results jsonb;
  v_operation_branch_id uuid;
  v_audit_id uuid;
  v_lock_key text;
BEGIN
  IF NULLIF(btrim(p_operation_id), '') IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_OPERATION_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_purchase_order_id IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_ORDER_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  -- Serializa recepciones concurrentes de la MISMA orden. Es la misma tecnica
  -- que usa adjust_stock_batch_with_kardex, aplicada a la identidad de la orden.
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

  -- Idempotencia por operacion: si esta orden ya se recibio con este
  -- operation_id, se devuelve el resultado sin volver a mover stock.
  IF v_order.data->>'receivedOperationId' IS NOT DISTINCT FROM p_operation_id
     AND v_status = 'COMPRADO' THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'idempotent', true,
      'operationId', p_operation_id,
      'purchaseOrderId', p_purchase_order_id,
      'status', 'COMPRADO',
      'receivedAt', v_order.data->>'receivedAt'
    );
  END IF;

  IF v_status NOT IN ('PENDIENTE', 'POSPUESTO') THEN
    RAISE EXCEPTION 'PURCHASE_ORDER_NOT_OPEN: la orden ya esta en estado %', v_status
      USING ERRCODE = 'P0001';
  END IF;

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

  -- Los items recibidos por defecto son los de la orden. p_received_items
  -- permite reception parcial (llego menos de lo pedido), nunca inventar
  -- productos fuera de la orden.
  v_items := COALESCE(
    NULLIF(p_received_items, 'null'::jsonb),
    COALESCE(v_order.data->'items', '[]'::jsonb)
  );
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'PURCHASE_ITEMS_INVALID' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN
    SELECT entry.value
    FROM pg_catalog.jsonb_array_elements(v_items) AS entry(value)
  LOOP
    v_product_id := NULLIF(v_item->>'productId', '')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := NULLIF(v_item->>'unitPrice', '')::numeric;

    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'PURCHASE_ITEM_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- El producto debe pertenecer al negocio de la orden y a su sucursal.
    -- No se acepta un producto de otro negocio ni de otra sucursal.
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

    IF v_unit_price IS NOT NULL THEN
      -- Postgres no tiene isfinite() para numeric. NaN se detecta por texto:
      -- en numeric 'NaN' = 'NaN' es TRUE, asi que una comparacion normal no lo
      -- detectaria y dejaria pasar un precio basura.
      IF v_unit_price < 0 OR v_unit_price::text IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'PURCHASE_UNIT_PRICE_INVALID' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    v_operation_branch_id := v_branch_id;

    -- adjust_stock_batch_with_kardex solo admite 'lastUpdated' dentro de
    -- extraFields, asi que el precio de compra pactado NO puede viajar por ahi
    -- (daria INVALID_INVENTORY_BATCH_ITEM). Se registra en el producto justo
    -- despues, dentro de la MISMA transaccion, para no perder atomicidad.
    v_movements := v_movements || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'productId', v_product_id::text,
        'delta', v_quantity,
        'type', 'INCREASE',
        'branchId', v_operation_branch_id::text,
        'reason', format('PURCHASE %s', COALESCE(v_order.data->>'code', p_purchase_order_id::text)),
        'extraFields', pg_catalog.jsonb_build_object('lastUpdated', v_now)
      )
    );

    IF v_unit_price IS NOT NULL THEN
      v_price_updates := v_price_updates || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'productId', v_product_id::text,
          'purchasePrice', v_unit_price
        )
      );
    END IF;
  END LOOP;

  -- Punto de no retorno: una sola transaccion para TODO lo siguiente.
  -- Si cualquier item falla, el rollback deshace los ya aplicados.
  v_results := public.adjust_stock_batch_with_kardex(p_operation_id, v_movements);

  -- Precio de compra pactado en cada producto recibido, misma transaccion.
  FOR v_item IN
    SELECT entry.value
    FROM pg_catalog.jsonb_array_elements(v_price_updates) AS entry(value)
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

  UPDATE public.purchase_orders AS purchase_order
  SET data = purchase_order.data || pg_catalog.jsonb_build_object(
        'status', 'COMPRADO',
        'receivedAt', v_now,
        'receivedOperationId', p_operation_id,
        'receivedBy', COALESCE(p_performed_by, v_actor_id::text),
        'supplierId', v_supplier_id
      ),
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
      'description', format('Recepcion de compra %s aplicada al inventario', p_purchase_order_id::text),
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
    'status', 'COMPRADO',
    'receivedAt', v_now,
    'products', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.receive_purchase_order_atomic(text, uuid, jsonb, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order_atomic(text, uuid, jsonb, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.receive_purchase_order_atomic(text, uuid, jsonb, text, text) IS
  'Server-authoritative and atomic purchase receipt. Transitions the order to COMPRADO and increases stock + Kardex in the SAME transaction. All items apply or none do. Idempotent per operationId; concurrent receipts of the same order serialize.';

COMMIT;