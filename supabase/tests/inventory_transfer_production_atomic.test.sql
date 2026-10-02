-- Run after 20261002000000_atomic_inventory_transfer_and_production.sql
-- in a disposable local database.
DO $$
DECLARE
  v_business_id uuid;
  v_source_branch_id uuid;
  v_target_branch_id uuid;
  v_source_product_id uuid := gen_random_uuid();
  v_target_product_id uuid := gen_random_uuid();
  v_flour_id uuid := gen_random_uuid();
  v_sugar_id uuid := gen_random_uuid();
  v_butter_id uuid := gen_random_uuid();
  v_dough_id uuid := gen_random_uuid();
  v_batch_product_id uuid := gen_random_uuid();
  v_result jsonb;
  v_rejected boolean;
  v_source_stock numeric;
  v_target_stock numeric;
  v_kardex_count integer;
  v_audit_count integer;
  v_ledger_count integer;
  v_flour_before_failure numeric;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO public.businesses (name, timezone)
  VALUES ('TEST Atomic Branch Transfer and Batch Production', 'America/Bogota')
  RETURNING id INTO v_business_id;

  INSERT INTO public.branches (business_id, name)
  VALUES (v_business_id, 'TEST Origin')
  RETURNING id INTO v_source_branch_id;
  INSERT INTO public.branches (business_id, name)
  VALUES (v_business_id, 'TEST Destination')
  RETURNING id INTO v_target_branch_id;

  INSERT INTO public.products (id, business_id, branch_id, version, data)
  VALUES
    (v_source_product_id, v_business_id, v_source_branch_id, 1,
      jsonb_build_object('id',v_source_product_id,'name','TEST Transfer Flour','sku','TEST-FLOUR','stock',10,'trackStock',true,'unit','kg')),
    (v_target_product_id, v_business_id, v_target_branch_id, 1,
      jsonb_build_object('id',v_target_product_id,'name','TEST Transfer Flour','sku','TEST-FLOUR','stock',2,'trackStock',true,'unit','kg')),
    (v_flour_id, v_business_id, v_source_branch_id, 1,
      jsonb_build_object('id',v_flour_id,'name','TEST Flour','stock',100,'trackStock',true,'unit','kg')),
    (v_sugar_id, v_business_id, v_source_branch_id, 1,
      jsonb_build_object('id',v_sugar_id,'name','TEST Sugar','stock',100,'trackStock',true,'unit','kg')),
    (v_butter_id, v_business_id, v_source_branch_id, 1,
      jsonb_build_object('id',v_butter_id,'name','TEST Butter','stock',100,'trackStock',true,'unit','kg')),
    (v_dough_id, v_business_id, v_source_branch_id, 1,
      jsonb_build_object(
        'id',v_dough_id,'name','TEST Dough','stock',0,'trackStock',false,'productionMode','ON_DEMAND',
        'recipe',jsonb_build_array(
          jsonb_build_object('productId',v_flour_id,'quantity',0.5),
          jsonb_build_object('productId',v_sugar_id,'quantity',0.1)
        )
      )),
    (v_batch_product_id, v_business_id, v_source_branch_id, 1,
      jsonb_build_object(
        'id',v_batch_product_id,'name','TEST Baked Loaf','stock',0,'trackStock',true,'productionMode','BATCH',
        'recipe',jsonb_build_array(
          jsonb_build_object('productId',v_dough_id,'quantity',2),
          jsonb_build_object('productId',v_butter_id,'quantity',0.5)
        )
      ));

  v_result := public.transfer_stock_atomic(
    'transfer-' || v_business_id::text,
    v_source_product_id,
    v_source_branch_id,
    v_target_branch_id,
    3,
    'test actor'
  );
  IF jsonb_array_length(v_result) <> 2 THEN
    RAISE EXCEPTION 'FAIL: transfer did not return both branch product snapshots';
  END IF;

  SELECT (data->>'stock')::numeric INTO v_source_stock
  FROM public.products WHERE id = v_source_product_id;
  SELECT (data->>'stock')::numeric INTO v_target_stock
  FROM public.products WHERE id = v_target_product_id;
  IF v_source_stock <> 7 OR v_target_stock <> 5 THEN
    RAISE EXCEPTION 'FAIL: transfer stock totals are incorrect: source %, target %', v_source_stock, v_target_stock;
  END IF;

  PERFORM public.transfer_stock_atomic(
    'transfer-' || v_business_id::text,
    v_source_product_id,
    v_source_branch_id,
    v_target_branch_id,
    3,
    'test actor'
  );
  SELECT (data->>'stock')::numeric INTO v_source_stock
  FROM public.products WHERE id = v_source_product_id;
  IF v_source_stock <> 7 THEN
    RAISE EXCEPTION 'FAIL: transfer retry applied stock more than once';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.transfer_stock_atomic(
      'transfer-' || v_business_id::text,
      v_source_product_id,
      v_source_branch_id,
      v_target_branch_id,
      4,
      'test actor'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'IDEMPOTENCY_KEY_REUSED' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL: transfer idempotency key accepted a different payload';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.transfer_stock_atomic(
      'transfer-insufficient-' || v_business_id::text,
      v_source_product_id,
      v_source_branch_id,
      v_target_branch_id,
      1000,
      'test actor'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INSUFFICIENT_STOCK' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL: transfer with insufficient source stock was accepted';
  END IF;
  SELECT count(*) INTO v_ledger_count
  FROM public.inventory_operation_ledger
  WHERE business_id = v_business_id
    AND operation_id = 'transfer-insufficient-' || v_business_id::text;
  IF v_ledger_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: failed transfer left an idempotency ledger row';
  END IF;

  v_result := public.produce_batch_atomic(
    'production-' || v_business_id::text,
    v_batch_product_id,
    v_source_branch_id,
    3,
    'test actor'
  );
  IF jsonb_array_length(v_result) <> 4 THEN
    RAISE EXCEPTION 'FAIL: batch production did not account for subrecipe leaves and output';
  END IF;

  PERFORM public.produce_batch_atomic(
    'production-' || v_business_id::text,
    v_batch_product_id,
    v_source_branch_id,
    3,
    'test actor'
  );
  SELECT (data->>'stock')::numeric INTO v_source_stock
  FROM public.products WHERE id = v_flour_id;
  SELECT (data->>'stock')::numeric INTO v_target_stock
  FROM public.products WHERE id = v_batch_product_id;
  IF v_source_stock <> 97 OR v_target_stock <> 3 THEN
    RAISE EXCEPTION 'FAIL: production consumption or finished stock is incorrect';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.produce_batch_atomic(
      'production-' || v_business_id::text,
      v_batch_product_id,
      v_source_branch_id,
      4,
      'test actor'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'IDEMPOTENCY_KEY_REUSED' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL: production idempotency key accepted a different payload';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.produce_batch_atomic(
      'production-insufficient-' || v_business_id::text,
      v_batch_product_id,
      v_source_branch_id,
      1000,
      'test actor'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INSUFFICIENT_STOCK' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL: production with insufficient inputs was accepted';
  END IF;

  SELECT (data->>'stock')::numeric INTO v_flour_before_failure
  FROM public.products WHERE id = v_flour_id;
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.vimdy_test_fail_inventory_audit()
    RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      IF current_setting('vimdy.inventory_test_failure', true) = NEW.data->>'action' THEN
        RAISE EXCEPTION 'INVENTORY_TEST_AUDIT_FAILURE';
      END IF;
      RETURN NEW;
    END
    $body$
  $fn$;
  EXECUTE 'CREATE TRIGGER vimdy_test_fail_inventory_audit BEFORE INSERT ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.vimdy_test_fail_inventory_audit()';
  PERFORM set_config('vimdy.inventory_test_failure', 'INVENTORY_BATCH_PRODUCED', true);
  v_rejected := false;
  BEGIN
    PERFORM public.produce_batch_atomic(
      'production-audit-failure-' || v_business_id::text,
      v_batch_product_id,
      v_source_branch_id,
      1,
      'test actor'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INVENTORY_TEST_AUDIT_FAILURE' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  PERFORM set_config('vimdy.inventory_test_failure', '', true);
  DROP TRIGGER vimdy_test_fail_inventory_audit ON public.audit_logs;
  DROP FUNCTION public.vimdy_test_fail_inventory_audit();
  IF NOT v_rejected
     OR EXISTS (
       SELECT 1 FROM public.inventory_operation_ledger
       WHERE business_id = v_business_id
         AND operation_id = 'production-audit-failure-' || v_business_id::text
     )
     OR EXISTS (
       SELECT 1 FROM public.inventory_movements
       WHERE business_id = v_business_id AND data->>'operationId' = 'production-audit-failure-' || v_business_id::text
     ) THEN
    RAISE EXCEPTION 'FAIL: audit failure did not roll back production writes';
  END IF;
  SELECT (data->>'stock')::numeric INTO v_source_stock
  FROM public.products WHERE id = v_flour_id;
  IF v_source_stock <> v_flour_before_failure THEN
    RAISE EXCEPTION 'FAIL: audit failure left a partial ingredient deduction';
  END IF;

  SELECT count(*) INTO v_kardex_count
  FROM public.inventory_movements
  WHERE business_id = v_business_id;
  IF v_kardex_count <> 6 THEN
    RAISE EXCEPTION 'FAIL: expected 6 unique transfer/production Kardex movements, got %', v_kardex_count;
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_logs
  WHERE business_id = v_business_id
    AND data->>'action' IN ('INVENTORY_STOCK_TRANSFERRED', 'INVENTORY_BATCH_PRODUCED');
  IF v_audit_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected one audit record for each successful operation, got %', v_audit_count;
  END IF;

  SELECT count(*) INTO v_ledger_count
  FROM public.inventory_operation_ledger
  WHERE business_id = v_business_id;
  IF v_ledger_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: failed/retried operations changed inventory operation ledger count';
  END IF;

  DELETE FROM public.businesses WHERE id = v_business_id;
END;
$$;
