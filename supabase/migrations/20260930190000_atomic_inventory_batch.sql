BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_batch_operations (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  operation_id text NOT NULL,
  payload_hash text NOT NULL,
  movement_count integer NOT NULL CHECK (movement_count BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, operation_id)
);

ALTER TABLE public.inventory_batch_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_batch_operations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.inventory_batch_operations TO service_role;

DROP POLICY IF EXISTS inventory_batch_operations_select_member
  ON public.inventory_batch_operations;
CREATE POLICY inventory_batch_operations_select_member
  ON public.inventory_batch_operations
  FOR SELECT TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (
      branch_id IS NULL
      OR branch_id = ANY (public.auth_branch_ids())
    )
  );

DROP POLICY IF EXISTS inventory_batch_operations_insert_member
  ON public.inventory_batch_operations;
CREATE POLICY inventory_batch_operations_insert_member
  ON public.inventory_batch_operations
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND (
      branch_id IS NULL
      OR branch_id = ANY (public.auth_branch_ids())
    )
    AND public.is_business_subscription_active(business_id)
  );

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
        false,
        v_extra_fields
      );
      UPDATE public.inventory_movements AS movement
      SET data = movement.data || jsonb_build_object(
        'operationId', p_operation_id,
        'payloadHash', v_payload_hash
      )
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

COMMENT ON FUNCTION public.adjust_stock_batch_with_kardex(text, jsonb) IS
  'Applies a bounded set of stock and Kardex changes in one transaction. Stable operation/product/type movement IDs make retries idempotent; conflicting payload reuse is rejected.';

COMMIT;