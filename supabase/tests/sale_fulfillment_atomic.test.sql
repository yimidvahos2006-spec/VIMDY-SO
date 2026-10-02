-- Gate 1 integration checks. Run after 20260930193000_atomic_sale_fulfillment.sql
-- in a disposable Supabase database. Configure the existing authenticated test
-- user's UUID first:
--   SELECT set_config('vimdy.caja_test_user_id', '<auth.users UUID>', false);
--
-- This script checks transactional rollback paths and sequential idempotency.
-- True simultaneous requests are covered by sale_fulfillment.concurrent.test.ts.

BEGIN;

DO $$
DECLARE
  v_user_id uuid;
  v_business_id uuid;
  v_branch_id uuid;
  v_foreign_business_id uuid;
  v_foreign_branch_id uuid;
  v_product_id uuid := gen_random_uuid();
  v_ingredient_id uuid := gen_random_uuid();
  v_recipe_product_id uuid := gen_random_uuid();
  v_kitchen_product_id uuid := gen_random_uuid();
  v_sale_id uuid;
  v_idempotency_key text;
  v_sale_payload jsonb;
  v_result jsonb;
  v_sale_data jsonb;
  v_stock numeric;
  v_count integer;
  v_rejected boolean;
  v_role text;
BEGIN
  IF NOT has_function_privilege(
       'authenticated',
       'public.create_sale_fulfillment_atomic(uuid,uuid,text,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.create_sale_fulfillment_atomic(uuid,uuid,text,jsonb)',
       'EXECUTE'
     )
     OR has_table_privilege('authenticated', 'public.sale_fulfillment_operations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.sale_fulfillment_operations', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL Gate 1 RPC/ledger grants are not least-privilege';
  END IF;

  v_user_id := NULLIF(current_setting('vimdy.caja_test_user_id', true), '')::uuid;
  IF v_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'Configure vimdy.caja_test_user_id with an existing auth.users UUID before running this test';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO public.businesses (
    name, plan, trial_ends_at, timezone, subscription_status, currency, tax_rate, inventory_type
  )
  VALUES (
    'GATE1 Atomic Sale Test', 'trial', now() + interval '30 days',
    'America/Bogota', 'trial', 'COP', 0, 'productos'
  )
  RETURNING id INTO v_business_id;

  INSERT INTO public.branches (business_id, name, active)
  VALUES (v_business_id, 'GATE1 Branch', true)
  RETURNING id INTO v_branch_id;

  INSERT INTO public.business_members (business_id, user_id, role)
  VALUES (v_business_id, v_user_id, 'CAJERO');

  INSERT INTO public.products (id, business_id, branch_id, version, data)
  VALUES (v_product_id, v_business_id, v_branch_id, 1,
    jsonb_build_object(
      'id', v_product_id, 'name', 'GATE1 No-stock item', 'price', 1000,
      'taxRate', 0, 'stock', 0, 'trackStock', false, 'active', true,
      'isIngredient', false, 'requiresKitchen', false
    ));

  -- Server price is authoritative; forged price/total/cashier/business fields
  -- are ignored. Product has trackStock=false, so no stock or Kardex mutation.
  v_sale_id := gen_random_uuid();
  v_idempotency_key := 'gate1-simple-' || v_sale_id::text;
  v_sale_payload := jsonb_build_object(
    'id', v_sale_id, 'type', 'QUICK', 'price', 0, 'total', 0,
    'cashierId', gen_random_uuid(), 'businessId', gen_random_uuid(),
    'branchId', gen_random_uuid(),
    'items', jsonb_build_array(jsonb_build_object(
      'productId', v_product_id, 'quantity', 1, 'price', 0
    ))
  );
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, v_idempotency_key, v_sale_payload
  );
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'FAIL simple sale: %', v_result;
  END IF;
  v_sale_data := v_result->'sale';
  IF (v_sale_data->>'total')::numeric <> 1000
     OR v_sale_data->>'cashierId' IS DISTINCT FROM v_user_id::text THEN
    RAISE EXCEPTION 'FAIL server did not authoritatively set price/actor: %', v_sale_data;
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_movements WHERE data->>'saleId' = v_sale_id::text)
     OR EXISTS (SELECT 1 FROM public.kitchen_orders WHERE id = v_sale_id) THEN
    RAISE EXCEPTION 'FAIL no-stock/no-kitchen sale wrote inventory or kitchen rows';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sale_items WHERE sale_id = v_sale_id AND product_id = v_product_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.audit_logs WHERE business_id = v_business_id
      AND data->>'entityId' = v_sale_id::text AND data->>'action' = 'SALE_CREATED'
  ) THEN
    RAISE EXCEPTION 'FAIL sale detail or success audit missing';
  END IF;
  IF (SELECT business_id FROM public.sales WHERE id = v_sale_id) <> v_business_id
     OR (SELECT branch_id FROM public.sales WHERE id = v_sale_id) <> v_branch_id THEN
    RAISE EXCEPTION 'FAIL client supplied business/branch was trusted';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.adjust_stock_batch_with_kardex(
      'gate1-cashier-must-not-adjust-' || v_sale_id::text,
      jsonb_build_array(jsonb_build_object(
        'productId', v_product_id, 'delta', -1, 'type', 'DECREASE',
        'reason', 'GATE1_ROLE_SEPARATION', 'branchId', v_branch_id
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INVENTORY_BATCH_FORBIDDEN' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL cashier received general inventory adjustment authority';
  END IF;

  -- Same key+payload returns prior result and creates no second side effect.
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, v_idempotency_key, v_sale_payload
  );
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR v_result->>'idempotent' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'FAIL idempotent retry: %', v_result;
  END IF;
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, v_idempotency_key,
    jsonb_build_object(
      'id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 2))
    )
  );
  IF v_result->>'success' IS DISTINCT FROM 'false'
     OR v_result->>'error' NOT LIKE '%SALE_IDEMPOTENCY_KEY_REUSED%' THEN
    RAISE EXCEPTION 'FAIL changed payload reused idempotency key: %', v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public.sales WHERE id = v_sale_id AND business_id = v_business_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL idempotency left % sales', v_count; END IF;

  -- Recipe ingredient consumption and Kardex are part of sale transaction.
  UPDATE public.businesses SET inventory_type = 'ingredientes' WHERE id = v_business_id;
  INSERT INTO public.products (id, business_id, branch_id, version, data)
  VALUES
    (v_ingredient_id, v_business_id, v_branch_id, 1,
      jsonb_build_object('id', v_ingredient_id, 'name', 'GATE1 Flour', 'price', 0,
        'stock', 1, 'trackStock', true, 'active', true, 'isIngredient', true)),
    (v_recipe_product_id, v_business_id, v_branch_id, 1,
      jsonb_build_object('id', v_recipe_product_id, 'name', 'GATE1 Bread', 'price', 2000,
        'taxRate', 0, 'stock', 0, 'trackStock', false, 'active', true,
        'isIngredient', false, 'requiresKitchen', false,
        'recipe', jsonb_build_array(jsonb_build_object('productId', v_ingredient_id, 'quantity', 1))));

  v_sale_id := gen_random_uuid();
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'gate1-recipe-' || v_sale_id::text,
    jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_recipe_product_id, 'quantity', 1)))
  );
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FAIL recipe sale: %', v_result; END IF;
  SELECT (data->>'stock')::numeric INTO v_stock FROM public.products WHERE id = v_ingredient_id;
  IF v_stock <> 0 OR NOT EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE business_id = v_business_id AND data->>'saleId' = v_sale_id::text
      AND data->>'productId' = v_ingredient_id::text AND (data->>'delta')::numeric = -1
  ) THEN RAISE EXCEPTION 'FAIL recipe inventory/Kardex was not consumed exactly once'; END IF;

  -- Insufficient stock must roll back sale, details, ledger, and all Kardex.
  v_sale_id := gen_random_uuid();
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'gate1-insufficient-' || v_sale_id::text,
    jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_recipe_product_id, 'quantity', 1)))
  );
  IF v_result->>'success' IS DISTINCT FROM 'false' OR v_result->>'error' NOT LIKE '%INSUFFICIENT_STOCK%' THEN
    RAISE EXCEPTION 'FAIL insufficient stock was not rejected: %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.sales WHERE id = v_sale_id)
     OR EXISTS (SELECT 1 FROM public.sale_items WHERE sale_id = v_sale_id)
     OR EXISTS (SELECT 1 FROM public.sale_fulfillment_operations WHERE sale_id = v_sale_id)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE data->>'saleId' = v_sale_id::text) THEN
    RAISE EXCEPTION 'FAIL insufficient stock left partial sale side effects';
  END IF;

  -- Malformed recipe is a validation error, not an untracked successful sale.
  UPDATE public.products SET data = jsonb_set(data, '{recipe}', '{"bad":"recipe"}'::jsonb)
  WHERE id = v_recipe_product_id;
  v_sale_id := gen_random_uuid();
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'gate1-invalid-recipe-' || v_sale_id::text,
    jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_recipe_product_id, 'quantity', 1)))
  );
  IF v_result->>'success' IS DISTINCT FROM 'false'
     OR EXISTS (SELECT 1 FROM public.sales WHERE id = v_sale_id) THEN
    RAISE EXCEPTION 'FAIL malformed recipe was not rejected atomically: %', v_result;
  END IF;

  -- Kitchen disabled means no kitchen dependency/rows even for a prep item.
  INSERT INTO public.products (id, business_id, branch_id, version, data)
  VALUES (v_kitchen_product_id, v_business_id, v_branch_id, 1,
    jsonb_build_object('id', v_kitchen_product_id, 'name', 'GATE1 Kitchen item',
      'price', 3000, 'taxRate', 0, 'stock', 0, 'trackStock', false,
      'active', true, 'isIngredient', false, 'requiresKitchen', true));

  v_sale_id := gen_random_uuid();
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'gate1-no-kitchen-' || v_sale_id::text,
    jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_kitchen_product_id, 'quantity', 1)))
  );
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR EXISTS (SELECT 1 FROM public.kitchen_orders WHERE id = v_sale_id)
     OR EXISTS (SELECT 1 FROM public.kitchen_printer_jobs WHERE sale_id = v_sale_id) THEN
    RAISE EXCEPTION 'FAIL kitchen-disabled sale created kitchen output: %', v_result;
  END IF;

  -- KDS output and printer outbox are generated from persisted operation config.
  UPDATE public.businesses SET
    kitchen_enabled = true, kitchen_output_mode = 'kds',
    kds_enabled = true, printer_enabled = false,
    inventory_type = NULL
  WHERE id = v_business_id;
  v_sale_id := gen_random_uuid();
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'gate1-kds-' || v_sale_id::text,
    jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_kitchen_product_id, 'quantity', 1)))
  );
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR NOT EXISTS (SELECT 1 FROM public.kitchen_orders WHERE id = v_sale_id)
     OR EXISTS (SELECT 1 FROM public.kitchen_printer_jobs WHERE sale_id = v_sale_id) THEN
    RAISE EXCEPTION 'FAIL KDS-only kitchen output: %', v_result;
  END IF;

  UPDATE public.businesses SET
    kitchen_output_mode = 'printer', kds_enabled = false, printer_enabled = true
  WHERE id = v_business_id;
  v_sale_id := gen_random_uuid();
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'gate1-printer-only-' || v_sale_id::text,
    jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_kitchen_product_id, 'quantity', 1)))
  );
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR NOT EXISTS (SELECT 1 FROM public.kitchen_orders WHERE id = v_sale_id)
     OR NOT EXISTS (SELECT 1 FROM public.kitchen_printer_jobs WHERE sale_id = v_sale_id) THEN
    RAISE EXCEPTION 'FAIL printer-only kitchen output: %', v_result;
  END IF;

  UPDATE public.businesses SET kitchen_output_mode = 'both', kds_enabled = true, printer_enabled = true
  WHERE id = v_business_id;
  v_sale_id := gen_random_uuid();
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'gate1-printer-' || v_sale_id::text,
    jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_kitchen_product_id, 'quantity', 1)))
  );
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR NOT EXISTS (SELECT 1 FROM public.kitchen_orders WHERE id = v_sale_id)
     OR NOT EXISTS (SELECT 1 FROM public.kitchen_printer_jobs WHERE sale_id = v_sale_id) THEN
    RAISE EXCEPTION 'FAIL KDS+printer output: %', v_result;
  END IF;

  -- Simulated downstream insert failure must roll back every success write.
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.vimdy_gate1_fail_kitchen_insert()
    RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      IF current_setting('vimdy.gate1_failure', true) = 'kitchen' THEN
        RAISE EXCEPTION 'GATE1_TEST_KITCHEN_FAILURE';
      END IF;
      RETURN NEW;
    END
    $body$
  $fn$;
  EXECUTE 'CREATE TRIGGER vimdy_gate1_fail_kitchen_insert BEFORE INSERT ON public.kitchen_orders
    FOR EACH ROW EXECUTE FUNCTION public.vimdy_gate1_fail_kitchen_insert()';
  PERFORM set_config('vimdy.gate1_failure', 'kitchen', true);
  v_sale_id := gen_random_uuid();
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'gate1-kitchen-rollback-' || v_sale_id::text,
    jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_kitchen_product_id, 'quantity', 1)))
  );
  PERFORM set_config('vimdy.gate1_failure', '', true);
  DROP TRIGGER vimdy_gate1_fail_kitchen_insert ON public.kitchen_orders;
  DROP FUNCTION public.vimdy_gate1_fail_kitchen_insert();
  IF v_result->>'success' IS DISTINCT FROM 'false'
     OR EXISTS (SELECT 1 FROM public.sales WHERE id = v_sale_id)
     OR EXISTS (SELECT 1 FROM public.sale_items WHERE sale_id = v_sale_id)
     OR EXISTS (SELECT 1 FROM public.sale_fulfillment_operations WHERE sale_id = v_sale_id)
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE data->>'saleId' = v_sale_id::text)
     OR EXISTS (SELECT 1 FROM public.kitchen_orders WHERE id = v_sale_id) THEN
    RAISE EXCEPTION 'FAIL kitchen failure left partial fulfillment: %', v_result;
  END IF;

  -- Simulated success-audit failure must also roll back all success writes.
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.vimdy_gate1_fail_success_audit()
    RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      IF current_setting('vimdy.gate1_failure', true) = 'audit'
         AND NEW.data->>'action' = 'SALE_CREATED' THEN
        RAISE EXCEPTION 'GATE1_TEST_AUDIT_FAILURE';
      END IF;
      RETURN NEW;
    END
    $body$
  $fn$;
  EXECUTE 'CREATE TRIGGER vimdy_gate1_fail_success_audit BEFORE INSERT ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.vimdy_gate1_fail_success_audit()';
  PERFORM set_config('vimdy.gate1_failure', 'audit', true);
  v_sale_id := gen_random_uuid();
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'gate1-audit-rollback-' || v_sale_id::text,
    jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)))
  );
  PERFORM set_config('vimdy.gate1_failure', '', true);
  DROP TRIGGER vimdy_gate1_fail_success_audit ON public.audit_logs;
  DROP FUNCTION public.vimdy_gate1_fail_success_audit();
  IF v_result->>'success' IS DISTINCT FROM 'false'
     OR EXISTS (SELECT 1 FROM public.sales WHERE id = v_sale_id)
     OR EXISTS (SELECT 1 FROM public.sale_items WHERE sale_id = v_sale_id)
     OR EXISTS (SELECT 1 FROM public.sale_fulfillment_operations WHERE sale_id = v_sale_id) THEN
    RAISE EXCEPTION 'FAIL audit failure left partial fulfillment: %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE business_id = v_business_id
    AND data->>'idempotencyKey' = 'gate1-audit-rollback-' || v_sale_id::text
    AND data->>'result' = 'FAILED') THEN
    RAISE EXCEPTION 'FAIL audit failure was not recorded as failed operation';
  END IF;

  -- Role checks are independent of frontend claims; CAJERO can sell, MESERO cannot.
  UPDATE public.business_members SET role = 'MESERO'
  WHERE business_id = v_business_id AND user_id = v_user_id;
  v_sale_id := gen_random_uuid();
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'gate1-role-denied-' || v_sale_id::text,
    jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)))
  );
  IF v_result->>'success' IS DISTINCT FROM 'false'
     OR v_result->>'error' NOT LIKE '%SALE_FORBIDDEN%'
     OR EXISTS (SELECT 1 FROM public.sales WHERE id = v_sale_id) THEN
    RAISE EXCEPTION 'FAIL unauthorized role was not rejected: %', v_result;
  END IF;
  UPDATE public.business_members SET role = 'CAJERO'
  WHERE business_id = v_business_id AND user_id = v_user_id;

  FOREACH v_role IN ARRAY ARRAY['GERENTE', 'ADMIN'] LOOP
    UPDATE public.business_members SET role = v_role
    WHERE business_id = v_business_id AND user_id = v_user_id;
    v_sale_id := gen_random_uuid();
    v_result := public.create_sale_fulfillment_atomic(
      v_business_id, v_branch_id, 'gate1-role-allowed-' || lower(v_role) || '-' || v_sale_id::text,
      jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
        'items', jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)))
    );
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'FAIL % was rejected from sale RPC: %', v_role, v_result;
    END IF;
  END LOOP;
  UPDATE public.business_members SET role = 'CAJERO'
  WHERE business_id = v_business_id AND user_id = v_user_id;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  v_sale_id := gen_random_uuid();
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'gate1-anon-denied-' || v_sale_id::text,
    jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)))
  );
  IF v_result->>'success' IS DISTINCT FROM 'false'
     OR v_result->>'error' NOT LIKE '%SALE_AUTH_REQUIRED%'
     OR EXISTS (SELECT 1 FROM public.sales WHERE id = v_sale_id) THEN
    RAISE EXCEPTION 'FAIL anonymous sale was not rejected: %', v_result;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.branches (business_id, name, active)
  VALUES (v_business_id, 'GATE1 Other Branch', true)
  RETURNING id INTO v_branch_id;
  v_sale_id := gen_random_uuid();
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'gate1-branch-product-mismatch-' || v_sale_id::text,
    jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)))
  );
  IF v_result->>'success' IS DISTINCT FROM 'false'
     OR EXISTS (SELECT 1 FROM public.sales WHERE id = v_sale_id) THEN
    RAISE EXCEPTION 'FAIL sale used a product from a different branch: %', v_result;
  END IF;
  v_branch_id := (SELECT id FROM public.branches
    WHERE business_id = v_business_id AND name = 'GATE1 Branch');

  INSERT INTO public.businesses (name, plan, trial_ends_at, timezone, subscription_status, currency, tax_rate)
  VALUES ('GATE1 Foreign Tenant', 'trial', now() + interval '30 days', 'America/Bogota', 'trial', 'COP', 0)
  RETURNING id INTO v_foreign_business_id;
  INSERT INTO public.branches (business_id, name, active)
  VALUES (v_foreign_business_id, 'Foreign Branch', true)
  RETURNING id INTO v_foreign_branch_id;
  v_sale_id := gen_random_uuid();
  v_result := public.create_sale_fulfillment_atomic(
    v_foreign_business_id, v_foreign_branch_id, 'gate1-foreign-' || v_sale_id::text,
    jsonb_build_object('id', v_sale_id, 'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)))
  );
  IF v_result->>'success' IS DISTINCT FROM 'false'
     OR EXISTS (SELECT 1 FROM public.sales WHERE id = v_sale_id) THEN
    RAISE EXCEPTION 'FAIL cross-tenant sale was accepted: %', v_result;
  END IF;

  DELETE FROM public.businesses WHERE id IN (v_business_id, v_foreign_business_id);
  RAISE NOTICE 'PASS Gate 1 sale atomicity, server price, inventory, kitchen, audit, idempotency, authorization, tenant isolation, and rollback';
END
$$;

ROLLBACK;
