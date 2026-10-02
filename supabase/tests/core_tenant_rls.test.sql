-- Run against a disposable Supabase database after 20261001000000_restore_core_tenant_rls.sql.
-- The test user must exist in auth.users; pass its UUID in vimdy.caja_test_user_id.
BEGIN;

DO $$
DECLARE
  v_user_id uuid := NULLIF(current_setting('vimdy.caja_test_user_id', true), '')::uuid;
  v_business_id uuid := gen_random_uuid();
  v_branch_id uuid := gen_random_uuid();
  v_foreign_business_id uuid := gen_random_uuid();
  v_foreign_branch_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_foreign_product_id uuid := gen_random_uuid();
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'Configure vimdy.caja_test_user_id with an existing auth.users UUID';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.kitchen_settings'::regclass) THEN
    RAISE EXCEPTION 'FAIL kitchen_settings RLS is disabled';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
  INSERT INTO public.businesses (id, name, plan, trial_ends_at, timezone, subscription_status, currency, tax_rate, inventory_type)
  VALUES
    (v_business_id, 'RLS tenant test', 'trial', now() + interval '30 days', 'America/Bogota', 'trial', 'COP', 0, 'productos'),
    (v_foreign_business_id, 'RLS foreign tenant test', 'trial', now() + interval '30 days', 'America/Bogota', 'trial', 'COP', 0, 'productos');
  INSERT INTO public.branches (id, business_id, name, active)
  VALUES
    (v_branch_id, v_business_id, 'RLS branch', true),
    (v_foreign_branch_id, v_foreign_business_id, 'RLS foreign branch', true);
  INSERT INTO public.business_members (business_id, user_id, role)
  VALUES (v_business_id, v_user_id, 'CAJERO');
  INSERT INTO public.products (id, business_id, branch_id, version, data)
  VALUES
    (v_product_id, v_business_id, v_branch_id, 1,
      jsonb_build_object('id', v_product_id, 'name', 'RLS product', 'price', 1000, 'stock', 1,
        'trackStock', true, 'active', true, 'isIngredient', false, 'requiresKitchen', false)),
    (v_foreign_product_id, v_foreign_business_id, v_foreign_branch_id, 1,
      jsonb_build_object('id', v_foreign_product_id, 'name', 'Foreign RLS product', 'price', 1000,
        'stock', 1, 'trackStock', true, 'active', true, 'isIngredient', false, 'requiresKitchen', false));
  PERFORM set_config('vimdy.rls_business_id', v_business_id::text, true);
  PERFORM set_config('vimdy.rls_branch_id', v_branch_id::text, true);
  PERFORM set_config('vimdy.rls_product_id', v_product_id::text, true);
  PERFORM set_config('vimdy.rls_foreign_product_id', v_foreign_product_id::text, true);
END;
$$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_user_id uuid := NULLIF(current_setting('vimdy.caja_test_user_id', true), '')::uuid;
  v_business_id uuid := current_setting('vimdy.rls_business_id')::uuid;
  v_branch_id uuid := current_setting('vimdy.rls_branch_id')::uuid;
  v_product_id uuid := current_setting('vimdy.rls_product_id')::uuid;
  v_foreign_product_id uuid := current_setting('vimdy.rls_foreign_product_id')::uuid;
  v_sale_id uuid := gen_random_uuid();
  v_direct_sale_id uuid := gen_random_uuid();
  v_result jsonb;
  v_visible_products integer;
  v_rows_updated integer;
  v_direct_sale_denied boolean := false;
BEGIN
  SELECT count(*) INTO v_visible_products
  FROM public.products
  WHERE business_id = v_business_id;
  IF v_visible_products <> 1 THEN
    RAISE EXCEPTION 'FAIL tenant isolation: authenticated user sees % products in own business, expected 1', v_visible_products;
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE id = v_foreign_product_id) THEN
    RAISE EXCEPTION 'FAIL tenant isolation: authenticated user can see a foreign business product';
  END IF;

  UPDATE public.products SET data = jsonb_set(data, '{stock}', '0'::jsonb) WHERE id = v_product_id;
  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 0 THEN
    RAISE EXCEPTION 'FAIL CAJERO updated stock through direct table access';
  END IF;

  BEGIN
    INSERT INTO public.sales (id, business_id, branch_id, version, data, created_at, updated_at)
    VALUES (v_direct_sale_id, v_business_id, v_branch_id, 1, '{"status":"OPEN"}'::jsonb, now(), now());
  EXCEPTION WHEN insufficient_privilege THEN
    v_direct_sale_denied := true;
  END;
  IF NOT v_direct_sale_denied THEN
    RAISE EXCEPTION 'FAIL direct sales INSERT bypassed the atomic sale RPC';
  END IF;

  v_result := public.create_sale_fulfillment_atomic(
    v_business_id,
    v_branch_id,
    'gate1-authenticated-rls-' || v_sale_id::text,
    jsonb_build_object(
      'id', v_sale_id,
      'type', 'QUICK',
      'items', jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1))
    )
  );
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'FAIL authenticated CAJERO could not create sale through atomic RPC: %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales WHERE id = v_sale_id) THEN
    RAISE EXCEPTION 'FAIL authenticated tenant cannot read its persisted sale';
  END IF;

  RAISE NOTICE 'PASS core tenant RLS: own product/sale visible, foreign product hidden, CAJERO direct stock update denied, sale RPC allowed';
END;
$$;

ROLLBACK;
