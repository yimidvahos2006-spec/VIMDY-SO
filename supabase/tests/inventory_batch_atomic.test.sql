-- Run after 20260930190000_atomic_inventory_batch.sql in a disposable DB.

DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_first_product_id uuid := gen_random_uuid();
  v_second_product_id uuid := gen_random_uuid();
  v_product_id_swap uuid;
  v_first_stock numeric := 10;
  v_second_stock numeric := 1;
  v_operation_id text;
  v_rejected boolean := false;
  v_stock numeric;
  v_movement_count integer;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO public.businesses (name, timezone)
  VALUES ('TEST Atomic Inventory Batch', 'America/Bogota')
  RETURNING id INTO v_business_id;

  INSERT INTO public.branches (business_id, name)
  VALUES (v_business_id, 'TEST Branch')
  RETURNING id INTO v_branch_id;

  IF v_first_product_id > v_second_product_id THEN
    v_product_id_swap := v_first_product_id;
    v_first_product_id := v_second_product_id;
    v_second_product_id := v_product_id_swap;
  END IF;

  INSERT INTO public.products (id, business_id, branch_id, version, data)
  VALUES
    (v_first_product_id, v_business_id, v_branch_id, 1,
      jsonb_build_object('id', v_first_product_id, 'name', 'TEST Flour', 'stock', v_first_stock)),
    (v_second_product_id, v_business_id, v_branch_id, 1,
      jsonb_build_object('id', v_second_product_id, 'name', 'TEST Cheese', 'stock', v_second_stock));

  v_operation_id := 'test-inventory-batch-' || v_business_id::text;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_rejected := false;
  BEGIN
    PERFORM public.adjust_stock_batch_with_kardex(v_operation_id, jsonb_build_array(
      jsonb_build_object('productId', v_first_product_id, 'delta', -1, 'reason', 'TEST_UNAUTHENTICATED', 'type', 'DECREASE', 'branchId', v_branch_id)
    ));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INVENTORY_BATCH_FORBIDDEN' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL: inventory batch accepted without an authenticated business role';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_rejected := false;
  BEGIN
    PERFORM public.adjust_stock_batch_with_kardex(v_operation_id, jsonb_build_array(
      jsonb_build_object('productId', v_first_product_id, 'delta', -2, 'reason', 'TEST_ATOMIC_BATCH', 'type', 'DECREASE', 'branchId', v_branch_id),
      jsonb_build_object('productId', v_second_product_id, 'delta', -2, 'reason', 'TEST_ATOMIC_BATCH', 'type', 'DECREASE', 'branchId', v_branch_id, 'allowNegative', true)
    ));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INSUFFICIENT_STOCK' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL: batch with an insufficient ingredient was accepted';
  END IF;

  SELECT (data->>'stock')::numeric INTO v_stock
  FROM public.products WHERE id = v_first_product_id;
  IF v_stock <> v_first_stock THEN
    RAISE EXCEPTION 'FAIL: stock changed before batch rollback';
  END IF;

  SELECT count(*) INTO v_movement_count
  FROM public.inventory_movements
  WHERE business_id = v_business_id;
  IF v_movement_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: failed batch left Kardex movements';
  END IF;
  SELECT count(*) INTO v_movement_count
  FROM public.inventory_batch_operations
  WHERE business_id = v_business_id;
  IF v_movement_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: failed batch left an idempotency ledger row';
  END IF;

  PERFORM public.adjust_stock_batch_with_kardex(v_operation_id, jsonb_build_array(
    jsonb_build_object('productId', v_first_product_id, 'delta', -1, 'reason', 'TEST_ATOMIC_BATCH', 'type', 'DECREASE', 'branchId', v_branch_id),
    jsonb_build_object('productId', v_second_product_id, 'delta', -1, 'reason', 'TEST_ATOMIC_BATCH', 'type', 'DECREASE', 'branchId', v_branch_id)
  ));

  PERFORM public.adjust_stock_batch_with_kardex(v_operation_id, jsonb_build_array(
    jsonb_build_object('productId', v_first_product_id, 'delta', -1, 'reason', 'TEST_ATOMIC_BATCH', 'type', 'DECREASE', 'branchId', v_branch_id),
    jsonb_build_object('productId', v_second_product_id, 'delta', -1, 'reason', 'TEST_ATOMIC_BATCH', 'type', 'DECREASE', 'branchId', v_branch_id)
  ));

  SELECT (data->>'stock')::numeric INTO v_stock
  FROM public.products WHERE id = v_first_product_id;
  IF v_stock <> v_first_stock - 1 THEN
    RAISE EXCEPTION 'FAIL: retry applied the same stock batch more than once';
  END IF;

  SELECT count(*) INTO v_movement_count
  FROM public.inventory_movements
  WHERE business_id = v_business_id;
  IF v_movement_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: retry duplicated Kardex movements';
  END IF;
  SELECT count(*) INTO v_movement_count
  FROM public.inventory_batch_operations
  WHERE business_id = v_business_id;
  IF v_movement_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: retry duplicated the idempotency ledger';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.adjust_stock_batch_with_kardex(v_operation_id, jsonb_build_array(
      jsonb_build_object('productId', v_first_product_id, 'delta', -2, 'reason', 'TEST_ATOMIC_BATCH', 'type', 'DECREASE', 'branchId', v_branch_id),
      jsonb_build_object('productId', v_second_product_id, 'delta', -1, 'reason', 'TEST_ATOMIC_BATCH', 'type', 'DECREASE', 'branchId', v_branch_id)
    ));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'IDEMPOTENCY_KEY_REUSED' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL: conflicting operation key reuse was accepted';
  END IF;

  DELETE FROM public.businesses WHERE id = v_business_id;
END;
$$;