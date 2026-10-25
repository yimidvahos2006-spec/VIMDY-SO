-- Opcion B en el lote atomico de inventario.
--
-- Problema: adjust_stock_batch_with_kardex pasaba p_allow_negative = false FIJO a
-- adjust_stock_with_kardex_and_fields. Cualquier descuento por venta que entrara
-- por el lote (venta con cumplimiento diferido / PENDING, o repositorio sin RPC
-- atomico de venta) rebotaba con INSUFFICIENT_STOCK y rompia la regla "la venta
-- nunca se bloquea por stock".
--
-- Correccion: cada movimiento del lote puede traer "allowNegative": true.
--   * Solo se acepta con type = DECREASE y debe ser booleano; si no, se rechaza
--     con INVALID_INVENTORY_BATCH_ITEM.
--   * Sin el flag (o false) todo sigue estricto: ajustes manuales, recepcion de
--     ordenes de compra y demas usuarios del lote no cambian.
--   * El Kardex del movimiento queda con stockBefore, stockAfter y negative (igual que
--     create_sale_fulfillment_atomic), porque adjust_stock_with_kardex no los escribe.
--   * El flag viaja dentro del payload, asi que ya entra en el hash de
--     idempotencia (mismo operation_id con distinto flag => IDEMPOTENCY_KEY_REUSED).
-- Misma firma (text, jsonb): CREATE OR REPLACE, sin overloads. Migracion nueva; la
-- historica 20260930190000 no se modifica. Lo demas de la funcion es identico.
BEGIN;

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
      END
      WHERE movement.id = v_movement_id
        AND movement.business_id = v_product_business_id;
    END IF;

    v_results := v_results || pg_catalog.jsonb_build_array(v_result);
  END LOOP;

  RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock_batch_with_kardex(text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock_batch_with_kardex(text, jsonb)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.adjust_stock_batch_with_kardex(text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock_batch_with_kardex(text, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.adjust_stock_batch_with_kardex(text, jsonb) IS
  'Applies a bounded set of stock and Kardex changes in one transaction. Stable operation/product/type movement IDs make retries idempotent; conflicting payload reuse is rejected. A DECREASE item may carry allowNegative=true (sale discount only, Option B); otherwise INSUFFICIENT_STOCK applies.';

COMMIT;