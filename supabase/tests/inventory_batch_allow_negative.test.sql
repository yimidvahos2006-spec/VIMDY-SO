-- Opcion B en el lote atomico. Correr DESPUES de
-- 20261112000000_inventory_batch_allow_negative_for_sale.sql en una BD desechable
-- (SQL Editor de Supabase de un proyecto de PRUEBA, no produccion).

DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_product_id uuid := gen_random_uuid();
  v_rejected boolean;
  v_stock numeric;
  v_movement jsonb;
  v_count integer;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO public.businesses (name, timezone)
  VALUES ('TEST Batch Allow Negative', 'America/Bogota')
  RETURNING id INTO v_business_id;

  INSERT INTO public.branches (business_id, name)
  VALUES (v_business_id, 'TEST Branch')
  RETURNING id INTO v_branch_id;

  INSERT INTO public.products (id, business_id, branch_id, version, data)
  VALUES (v_product_id, v_business_id, v_branch_id, 1,
    jsonb_build_object('id', v_product_id, 'name', 'TEST Cafe molido', 'stock', 1));

  -- 1) Sin flag: sigue estricto (INSUFFICIENT_STOCK) y no toca nada.
  v_rejected := false;
  BEGIN
    PERFORM public.adjust_stock_batch_with_kardex('test-neg-1-' || v_business_id::text, jsonb_build_array(
      jsonb_build_object('productId', v_product_id, 'delta', -3, 'reason', 'TEST_STRICT', 'type', 'DECREASE', 'branchId', v_branch_id)
    ));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INSUFFICIENT_STOCK' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL: descuento sin allowNegative dejo pasar stock insuficiente';
  END IF;
  SELECT (data->>'stock')::numeric INTO v_stock FROM public.products WHERE id = v_product_id;
  IF v_stock <> 1 THEN RAISE EXCEPTION 'FAIL: el rechazo estricto cambio el stock (%)', v_stock; END IF;

  -- 2) allowNegative=false explicito: igual de estricto.
  v_rejected := false;
  BEGIN
    PERFORM public.adjust_stock_batch_with_kardex('test-neg-2-' || v_business_id::text, jsonb_build_array(
      jsonb_build_object('productId', v_product_id, 'delta', -3, 'reason', 'TEST_STRICT', 'type', 'DECREASE', 'branchId', v_branch_id, 'allowNegative', false)
    ));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INSUFFICIENT_STOCK' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'FAIL: allowNegative=false no fue estricto'; END IF;

  -- 3) Venta (allowNegative=true): pasa, stock 1 - 3 = -2, Kardex marcado.
  PERFORM public.adjust_stock_batch_with_kardex('test-neg-3-' || v_business_id::text, jsonb_build_array(
    jsonb_build_object('productId', v_product_id, 'delta', -3, 'reason', 'Venta TEST', 'type', 'DECREASE', 'branchId', v_branch_id, 'allowNegative', true)
  ));
  SELECT (data->>'stock')::numeric INTO v_stock FROM public.products WHERE id = v_product_id;
  IF v_stock <> -2 THEN RAISE EXCEPTION 'FAIL: la venta por lote no dejo el stock en -2 (%)', v_stock; END IF;

  SELECT data INTO v_movement FROM public.inventory_movements
  WHERE business_id = v_business_id AND data->>'reason' = 'Venta TEST';
  IF v_movement IS NULL
     OR (v_movement->>'stockBefore')::numeric <> 1
     OR (v_movement->>'stockAfter')::numeric <> -2
     OR (v_movement->>'negative')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: Kardex sin stockBefore/stockAfter/negative correctos: %', v_movement;
  END IF;

  -- 4) Reintento idempotente: no descuenta dos veces.
  PERFORM public.adjust_stock_batch_with_kardex('test-neg-3-' || v_business_id::text, jsonb_build_array(
    jsonb_build_object('productId', v_product_id, 'delta', -3, 'reason', 'Venta TEST', 'type', 'DECREASE', 'branchId', v_branch_id, 'allowNegative', true)
  ));
  SELECT (data->>'stock')::numeric INTO v_stock FROM public.products WHERE id = v_product_id;
  IF v_stock <> -2 THEN RAISE EXCEPTION 'FAIL: el reintento desconto otra vez (%)', v_stock; END IF;
  SELECT count(*) INTO v_count FROM public.inventory_movements WHERE business_id = v_business_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: el reintento duplico el Kardex (%)', v_count; END IF;

  -- 5) allowNegative solo vale para DECREASE.
  v_rejected := false;
  BEGIN
    PERFORM public.adjust_stock_batch_with_kardex('test-neg-5-' || v_business_id::text, jsonb_build_array(
      jsonb_build_object('productId', v_product_id, 'delta', 2, 'reason', 'TEST_INC', 'type', 'INCREASE', 'branchId', v_branch_id, 'allowNegative', true)
    ));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INVALID_INVENTORY_BATCH_ITEM' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'FAIL: allowNegative se acepto en un INCREASE'; END IF;

  -- 6) allowNegative no booleano se rechaza (nada de "true" como texto).
  v_rejected := false;
  BEGIN
    PERFORM public.adjust_stock_batch_with_kardex('test-neg-6-' || v_business_id::text, jsonb_build_array(
      jsonb_build_object('productId', v_product_id, 'delta', -1, 'reason', 'TEST_BAD', 'type', 'DECREASE', 'branchId', v_branch_id, 'allowNegative', 'true')
    ));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INVALID_INVENTORY_BATCH_ITEM' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'FAIL: allowNegative no booleano fue aceptado'; END IF;

  SELECT (data->>'stock')::numeric INTO v_stock FROM public.products WHERE id = v_product_id;
  IF v_stock <> -2 THEN RAISE EXCEPTION 'FAIL: un rechazo cambio el stock (%)', v_stock; END IF;

  RAISE NOTICE 'PASS: lote con allowNegative (venta) + estricto sin flag + Kardex + idempotencia';
  DELETE FROM public.businesses WHERE id = v_business_id;
END;
$$;