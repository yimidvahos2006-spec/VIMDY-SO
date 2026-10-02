BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_operation_ledger (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('TRANSFER', 'BATCH_PRODUCTION')),
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, operation_id)
);

ALTER TABLE public.inventory_operation_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_operation_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.inventory_operation_ledger TO service_role;

CREATE OR REPLACE FUNCTION public.apply_inventory_operation_delta(
  p_operation_id text,
  p_product_id uuid,
  p_branch_id uuid,
  p_delta numeric,
  p_reason text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_old_stock numeric;
  v_new_stock numeric;
  v_now timestamptz := clock_timestamp();
  v_movement_id uuid;
  v_movement_type text;
BEGIN
  IF p_delta = 0 OR p_delta::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'INVALID_INVENTORY_DELTA' USING ERRCODE = 'P0001';
  END IF;

  SELECT product.*
    INTO v_product
  FROM public.products AS product
  WHERE product.id = p_product_id
    AND product.branch_id IS NOT DISTINCT FROM p_branch_id
    AND product.data->>'trackStock' IS DISTINCT FROM 'false'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_STOCK_DISABLED' USING ERRCODE = 'P0002';
  END IF;

  v_old_stock := COALESCE(NULLIF(v_product.data->>'stock', '')::numeric, 0);
  v_new_stock := v_old_stock + p_delta;
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'P0001';
  END IF;

  v_movement_type := CASE WHEN p_delta < 0 THEN 'DECREASE' ELSE 'INCREASE' END;
  v_movement_id := pg_catalog.substr(
    pg_catalog.encode(
      extensions.digest(
        p_operation_id || ':' || p_product_id::text || ':' ||
        COALESCE(p_branch_id::text, 'null') || ':' || v_movement_type,
        'sha256'
      ),
      'hex'
    ),
    1,
    32
  )::uuid;

  UPDATE public.products
  SET data = v_product.data || pg_catalog.jsonb_build_object(
        'stock', v_new_stock,
        'lastUpdated', v_now
      ),
      version = v_product.version + 1,
      updated_at = v_now
  WHERE id = p_product_id;

  INSERT INTO public.inventory_movements (
    id, business_id, branch_id, version, data, created_at, updated_at
  )
  VALUES (
    v_movement_id,
    v_product.business_id,
    p_branch_id,
    1,
    pg_catalog.jsonb_build_object(
      'id', v_movement_id::text,
      'productId', p_product_id::text,
      'productName', v_product.data->>'name',
      'quantity', abs(p_delta),
      'date', v_now,
      'type', v_movement_type,
      'reason', p_reason,
      'performedBy', COALESCE(p_actor_id::text, 'Sistema'),
      'branchId', p_branch_id::text,
      'operationId', p_operation_id
    ),
    v_now,
    v_now
  );

  RETURN v_product.data || pg_catalog.jsonb_build_object(
    'id', p_product_id::text,
    'businessId', v_product.business_id::text,
    'branchId', p_branch_id::text,
    'version', v_product.version + 1,
    'stock', v_new_stock,
    'lastUpdated', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_inventory_operation_delta(
  text, uuid, uuid, numeric, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_inventory_operation_delta(
  text, uuid, uuid, numeric, text, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.transfer_stock_atomic(
  p_operation_id text,
  p_product_id uuid,
  p_from_branch_id uuid,
  p_to_branch_id uuid,
  p_quantity numeric,
  p_performed_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_business_id uuid;
  v_source public.products%ROWTYPE;
  v_target public.products%ROWTYPE;
  v_target_count integer;
  v_target_product_id uuid;
  v_payload jsonb;
  v_payload_hash text;
  v_existing_type text;
  v_existing_hash text;
  v_existing_result jsonb;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
  v_audit_id uuid;
BEGIN
  IF NULLIF(pg_catalog.btrim(p_operation_id), '') IS NULL
     OR p_operation_id IS NULL
     OR pg_catalog.length(p_operation_id) > 200
     OR p_product_id IS NULL
     OR p_from_branch_id IS NULL
     OR p_to_branch_id IS NULL
     OR p_from_branch_id = p_to_branch_id
     OR p_quantity IS NULL
     OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_STOCK_TRANSFER' USING ERRCODE = 'P0001';
  END IF;

  SELECT product.*
    INTO v_source
  FROM public.products AS product
  WHERE product.id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  v_business_id := v_source.business_id;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_actor_id IS NULL
       OR NOT public.has_business_role(v_business_id, ARRAY['ADMIN', 'GERENTE', 'INVENTARIO'])
       OR NOT public.is_business_subscription_active(v_business_id)
       OR NOT COALESCE(p_from_branch_id = ANY (public.auth_branch_ids()), false)
       OR NOT COALESCE(p_to_branch_id = ANY (public.auth_branch_ids()), false) THEN
      RAISE EXCEPTION 'INVENTORY_TRANSFER_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_source.branch_id IS DISTINCT FROM p_from_branch_id
     OR v_source.data->>'trackStock' = 'false'
     OR NULLIF(pg_catalog.btrim(v_source.data->>'sku'), '') IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_SOURCE_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches AS branch
    WHERE branch.id = p_from_branch_id AND branch.business_id = v_business_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.branches AS branch
    WHERE branch.id = p_to_branch_id AND branch.business_id = v_business_id
  ) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_VIOLATION' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), (pg_catalog.array_agg(product.id ORDER BY product.id))[1]
    INTO v_target_count, v_target_product_id
  FROM public.products AS product
  WHERE product.business_id = v_business_id
    AND product.branch_id = p_to_branch_id
    AND product.data->>'sku' = v_source.data->>'sku';
  IF v_target_count <> 1 THEN
    RAISE EXCEPTION 'TRANSFER_TARGET_PRODUCT_NOT_FOUND_OR_AMBIGUOUS' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_business_id::text || ':' || p_operation_id, 0)
  );
  v_payload := pg_catalog.jsonb_build_object(
    'operationType', 'TRANSFER',
    'productId', p_product_id,
    'targetProductId', v_target_product_id,
    'fromBranchId', p_from_branch_id,
    'toBranchId', p_to_branch_id,
    'quantity', p_quantity
  );
  v_payload_hash := pg_catalog.encode(extensions.digest(v_payload::text, 'sha256'), 'hex');

  SELECT ledger.operation_type, ledger.payload_hash, ledger.result
    INTO v_existing_type, v_existing_hash, v_existing_result
  FROM public.inventory_operation_ledger AS ledger
  WHERE ledger.business_id = v_business_id
    AND ledger.operation_id = p_operation_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_type <> 'TRANSFER' OR v_existing_hash <> v_payload_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existing_result;
  END IF;

  PERFORM product.id
  FROM public.products AS product
  WHERE product.id IN (p_product_id, v_target_product_id)
  ORDER BY product.id
  FOR UPDATE;

  SELECT product.* INTO v_source
  FROM public.products AS product
  WHERE product.id = p_product_id;
  SELECT product.* INTO v_target
  FROM public.products AS product
  WHERE product.id = v_target_product_id;
  IF v_source.business_id <> v_business_id
     OR v_target.business_id <> v_business_id
     OR v_source.branch_id <> p_from_branch_id
     OR v_target.branch_id <> p_to_branch_id
     OR v_target.data->>'trackStock' = 'false' THEN
    RAISE EXCEPTION 'TRANSFER_BRANCH_SCOPE_MISMATCH' USING ERRCODE = '42501';
  END IF;

  v_result := pg_catalog.jsonb_build_array(
    public.apply_inventory_operation_delta(
      p_operation_id, p_product_id, p_from_branch_id, -p_quantity, 'TRANSFER_OUT', v_actor_id
    ),
    public.apply_inventory_operation_delta(
      p_operation_id, v_target_product_id, p_to_branch_id, p_quantity, 'TRANSFER_IN', v_actor_id
    )
  );

  INSERT INTO public.audit_logs (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_business_id, p_from_branch_id, 1,
    pg_catalog.jsonb_build_object(
      'id', v_audit_id::text,
      'actorId', v_actor_id::text,
      'action', 'INVENTORY_STOCK_TRANSFERRED',
      'module', 'inventory',
      'entityId', p_product_id::text,
      'description', 'Transferencia de inventario entre sucursales.',
      'date', v_now,
      'operationId', p_operation_id,
      'fromBranchId', p_from_branch_id::text,
      'toBranchId', p_to_branch_id::text,
      'quantity', p_quantity,
      'result', 'SUCCESS'
    ),
    v_now, v_now
  );

  INSERT INTO public.inventory_operation_ledger (
    business_id, operation_id, operation_type, payload_hash, result
  )
  VALUES (v_business_id, p_operation_id, 'TRANSFER', v_payload_hash, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.produce_batch_atomic(
  p_operation_id text,
  p_product_id uuid,
  p_branch_id uuid,
  p_quantity numeric,
  p_performed_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_business_id uuid;
  v_product public.products%ROWTYPE;
  v_recipe jsonb;
  v_payload jsonb;
  v_payload_hash text;
  v_existing_type text;
  v_existing_hash text;
  v_existing_result jsonb;
  v_consumption jsonb;
  v_product_ids uuid[];
  v_item jsonb;
  v_result jsonb := '[]'::jsonb;
  v_product_result jsonb;
  v_audit_id uuid;
  v_now timestamptz := clock_timestamp();
  v_has_cycle boolean;
BEGIN
  IF NULLIF(pg_catalog.btrim(p_operation_id), '') IS NULL
     OR p_operation_id IS NULL
     OR pg_catalog.length(p_operation_id) > 200
     OR p_product_id IS NULL
     OR p_branch_id IS NULL
     OR p_quantity IS NULL
     OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_BATCH_PRODUCTION' USING ERRCODE = 'P0001';
  END IF;

  SELECT product.*
    INTO v_product
  FROM public.products AS product
  WHERE product.id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  v_business_id := v_product.business_id;
  v_recipe := v_product.data->'recipe';

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_actor_id IS NULL
       OR NOT public.has_business_role(v_business_id, ARRAY['ADMIN', 'GERENTE', 'INVENTARIO'])
       OR NOT public.is_business_subscription_active(v_business_id)
       OR NOT COALESCE(p_branch_id = ANY (public.auth_branch_ids()), false) THEN
      RAISE EXCEPTION 'BATCH_PRODUCTION_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_product.branch_id IS DISTINCT FROM p_branch_id
     OR v_product.data->>'productionMode' IS DISTINCT FROM 'BATCH'
     OR v_product.data->>'trackStock' = 'false'
     OR pg_catalog.jsonb_typeof(v_recipe) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(v_recipe) = 0 THEN
    RAISE EXCEPTION 'BATCH_PRODUCT_OR_RECIPE_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches AS branch
    WHERE branch.id = p_branch_id AND branch.business_id = v_business_id
  ) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_VIOLATION' USING ERRCODE = '42501';
  END IF;

  v_payload := pg_catalog.jsonb_build_object(
    'operationType', 'BATCH_PRODUCTION',
    'productId', p_product_id,
    'branchId', p_branch_id,
    'quantity', p_quantity
  );
  v_payload_hash := pg_catalog.encode(extensions.digest(v_payload::text, 'sha256'), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_business_id::text || ':' || p_operation_id, 0)
  );

  SELECT ledger.operation_type, ledger.payload_hash, ledger.result
    INTO v_existing_type, v_existing_hash, v_existing_result
  FROM public.inventory_operation_ledger AS ledger
  WHERE ledger.business_id = v_business_id
    AND ledger.operation_id = p_operation_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_type <> 'BATCH_PRODUCTION' OR v_existing_hash <> v_payload_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existing_result;
  END IF;

  WITH RECURSIVE expanded(product_id, amount, path, is_cycle) AS (
    SELECT (ingredient.value->>'productId')::uuid,
           (ingredient.value->>'quantity')::numeric * p_quantity,
           ARRAY[p_product_id, (ingredient.value->>'productId')::uuid],
           (ingredient.value->>'productId')::uuid = p_product_id
    FROM pg_catalog.jsonb_array_elements(v_recipe) AS ingredient(value)
    WHERE NULLIF(ingredient.value->>'productId', '') IS NOT NULL
      AND (ingredient.value->>'quantity')::numeric > 0
    UNION ALL
    SELECT (ingredient.value->>'productId')::uuid,
           expanded.amount * (ingredient.value->>'quantity')::numeric,
           expanded.path || (ingredient.value->>'productId')::uuid,
           (ingredient.value->>'productId')::uuid = ANY(expanded.path)
    FROM expanded
    JOIN public.products AS parent ON parent.id = expanded.product_id
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      CASE
        WHEN pg_catalog.jsonb_typeof(parent.data->'recipe') = 'array' THEN parent.data->'recipe'
        ELSE '[]'::jsonb
      END
    ) AS ingredient(value)
    WHERE NOT expanded.is_cycle
      AND parent.data->>'productionMode' IS DISTINCT FROM 'BATCH'
      AND CASE
        WHEN pg_catalog.jsonb_typeof(parent.data->'recipe') = 'array'
          THEN pg_catalog.jsonb_array_length(parent.data->'recipe') > 0
        ELSE false
      END
      AND NULLIF(ingredient.value->>'productId', '') IS NOT NULL
      AND (ingredient.value->>'quantity')::numeric > 0
  )
  SELECT COALESCE(bool_or(expanded.is_cycle), false)
    INTO v_has_cycle
  FROM expanded;
  IF v_has_cycle THEN
    RAISE EXCEPTION 'RECIPE_CYCLE' USING ERRCODE = 'P0001';
  END IF;

  WITH RECURSIVE expanded(product_id, amount, path, is_cycle) AS (
    SELECT (ingredient.value->>'productId')::uuid,
           (ingredient.value->>'quantity')::numeric * p_quantity,
           ARRAY[p_product_id, (ingredient.value->>'productId')::uuid],
           (ingredient.value->>'productId')::uuid = p_product_id
    FROM pg_catalog.jsonb_array_elements(v_recipe) AS ingredient(value)
    WHERE NULLIF(ingredient.value->>'productId', '') IS NOT NULL
      AND (ingredient.value->>'quantity')::numeric > 0
    UNION ALL
    SELECT (ingredient.value->>'productId')::uuid,
           expanded.amount * (ingredient.value->>'quantity')::numeric,
           expanded.path || (ingredient.value->>'productId')::uuid,
           (ingredient.value->>'productId')::uuid = ANY(expanded.path)
    FROM expanded
    JOIN public.products AS parent ON parent.id = expanded.product_id
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      CASE
        WHEN pg_catalog.jsonb_typeof(parent.data->'recipe') = 'array' THEN parent.data->'recipe'
        ELSE '[]'::jsonb
      END
    ) AS ingredient(value)
    WHERE NOT expanded.is_cycle
      AND parent.data->>'productionMode' IS DISTINCT FROM 'BATCH'
      AND CASE
        WHEN pg_catalog.jsonb_typeof(parent.data->'recipe') = 'array'
          THEN pg_catalog.jsonb_array_length(parent.data->'recipe') > 0
        ELSE false
      END
      AND NULLIF(ingredient.value->>'productId', '') IS NOT NULL
      AND (ingredient.value->>'quantity')::numeric > 0
  ),
  leaves AS (
    SELECT expanded.product_id, sum(expanded.amount) AS amount
    FROM expanded
    JOIN public.products AS leaf ON leaf.id = expanded.product_id
    WHERE NOT expanded.is_cycle
      AND NOT COALESCE((
        leaf.data->>'productionMode' IS DISTINCT FROM 'BATCH'
        AND pg_catalog.jsonb_typeof(leaf.data->'recipe') = 'array'
        AND pg_catalog.jsonb_array_length(leaf.data->'recipe') > 0
      ), false)
    GROUP BY expanded.product_id
  )
  SELECT pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('productId', leaves.product_id, 'quantity', leaves.amount)
           ORDER BY leaves.product_id
         ),
         pg_catalog.array_agg(leaves.product_id ORDER BY leaves.product_id)
    INTO v_consumption, v_product_ids
  FROM leaves;
  IF v_consumption IS NULL OR pg_catalog.jsonb_array_length(v_consumption) = 0 THEN
    RAISE EXCEPTION 'BATCH_RECIPE_HAS_NO_STOCKED_INPUTS' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_product_ids) AS ids(id)
    LEFT JOIN public.products AS ingredient ON ingredient.id = ids.id
    WHERE ingredient.id IS NULL
       OR ingredient.business_id <> v_business_id
       OR ingredient.branch_id IS DISTINCT FROM p_branch_id
       OR ingredient.data->>'trackStock' = 'false'
  ) THEN
    RAISE EXCEPTION 'BATCH_INGREDIENT_SCOPE_OR_STOCK_INVALID' USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.array_agg(product_id ORDER BY product_id)
    INTO v_product_ids
  FROM (
    SELECT unnest(v_product_ids) AS product_id
    UNION
    SELECT p_product_id
  ) AS locked_products;
  PERFORM product.id
  FROM public.products AS product
  WHERE product.id = ANY(v_product_ids)
  ORDER BY product.id
  FOR UPDATE;

  FOR v_item IN
    SELECT item.value
    FROM pg_catalog.jsonb_array_elements(v_consumption) AS item(value)
    ORDER BY item.value->>'productId'
  LOOP
    v_product_result := public.apply_inventory_operation_delta(
      p_operation_id,
      (v_item->>'productId')::uuid,
      p_branch_id,
      -((v_item->>'quantity')::numeric),
      'PRODUCTION_CONSUMPTION',
      v_actor_id
    );
    v_result := v_result || pg_catalog.jsonb_build_array(v_product_result);
  END LOOP;

  v_product_result := public.apply_inventory_operation_delta(
    p_operation_id, p_product_id, p_branch_id, p_quantity, 'BATCH_PRODUCTION', v_actor_id
  );
  v_result := v_result || pg_catalog.jsonb_build_array(v_product_result);

  v_audit_id := gen_random_uuid();
  INSERT INTO public.audit_logs (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (
    v_audit_id, v_business_id, p_branch_id, 1,
    pg_catalog.jsonb_build_object(
      'id', v_audit_id::text,
      'actorId', v_actor_id::text,
      'action', 'INVENTORY_BATCH_PRODUCED',
      'module', 'inventory',
      'entityId', p_product_id::text,
      'description', 'Lote de producción registrado con consumo de receta.',
      'date', v_now,
      'operationId', p_operation_id,
      'quantity', p_quantity,
      'result', 'SUCCESS'
    ),
    v_now, v_now
  );

  INSERT INTO public.inventory_operation_ledger (
    business_id, operation_id, operation_type, payload_hash, result
  )
  VALUES (v_business_id, p_operation_id, 'BATCH_PRODUCTION', v_payload_hash, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_stock_atomic(text, uuid, uuid, uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_stock_atomic(text, uuid, uuid, uuid, numeric, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.produce_batch_atomic(text, uuid, uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.produce_batch_atomic(text, uuid, uuid, numeric, text)
  TO authenticated, service_role;

COMMIT;
