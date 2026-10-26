-- ============================================================================
-- purchase_average_cost.test.sql — Compras: costo promedio + costo en Kardex
-- ----------------------------------------------------------------------------
-- Cubre:
--   1  promedio ponderado con costo previo (purchasePrice) y luego con averageCost
--   2  purchasePrice sigue siendo el ULTIMO precio
--   3  Kardex: unitCost, totalCost y averageCostAfter en cada INCREASE
--   4  sin stock o sin costo previo: el promedio es el precio de la compra
--   5  lineas en cualquier orden (se procesan ordenadas) y compra por orden previa (flujo A)
--
-- Requiere aplicada: 20261115000000_purchase_average_cost_and_kardex_cost.sql
-- Cada DO $$ es una transaccion independiente y limpia lo que crea.
-- ============================================================================

DO $$
DECLARE
  v_business_id uuid; v_branch_id uuid; v_user_id uuid;
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_c uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid(); v_order uuid := gen_random_uuid();
  v_avg numeric; v_last numeric; v_stock numeric;
  v_mov jsonb; v_count integer;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('AVG Compra', 'America/Bogota', 'ingredientes') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');
  INSERT INTO suppliers (id, business_id, branch_id, version, data)
    VALUES (v_supplier, v_business_id, v_branch_id, 1, jsonb_build_object('id', v_supplier, 'name', 'P'));
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    -- A: 10 en stock a 2000 (solo purchasePrice, sin averageCost)
    (v_a, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_a,'name','A','stock',10,'trackStock',true,'purchasePrice',2000)),
    -- B: 5 en stock sin ningun costo previo
    (v_b, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_b,'name','B','stock',5,'trackStock',true)),
    -- C: stock 0 con un costo viejo
    (v_c, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_c,'name','C','stock',0,'trackStock',true,'purchasePrice',9999));

  -- Compra 1 (directa): A 30 @ 2600, B 10 @ 700, C 4 @ 500 (lineas en desorden a proposito).
  PERFORM public.record_direct_purchase_atomic('avg-op-1', v_business_id, v_branch_id, v_supplier::text,
    jsonb_build_array(
      jsonb_build_object('productId', v_c, 'quantity', 4,  'unitPrice', 500),
      jsonb_build_object('productId', v_a, 'quantity', 30, 'unitPrice', 2600),
      jsonb_build_object('productId', v_b, 'quantity', 10, 'unitPrice', 700)),
    NULL, NULL, v_user_id::text);

  -- TEST 1: A = (10*2000 + 30*2600)/40 = 2450
  SELECT (data->>'averageCost')::numeric, (data->>'purchasePrice')::numeric, (data->>'stock')::numeric
    INTO v_avg, v_last, v_stock FROM products WHERE id = v_a;
  IF v_avg <> 2450 THEN RAISE EXCEPTION 'FAIL: promedio A = % (esperado 2450)', v_avg; END IF;
  IF v_last <> 2600 THEN RAISE EXCEPTION 'FAIL: purchasePrice A = % (esperado 2600, el ultimo)', v_last; END IF;
  IF v_stock <> 40 THEN RAISE EXCEPTION 'FAIL: stock A = % (esperado 40)', v_stock; END IF;

  -- TEST 4: B sin costo previo => promedio = 700; C sin stock => promedio = 500 (no 9999).
  SELECT (data->>'averageCost')::numeric INTO v_avg FROM products WHERE id = v_b;
  IF v_avg <> 700 THEN RAISE EXCEPTION 'FAIL: promedio B = % (esperado 700)', v_avg; END IF;
  SELECT (data->>'averageCost')::numeric INTO v_avg FROM products WHERE id = v_c;
  IF v_avg <> 500 THEN RAISE EXCEPTION 'FAIL: promedio C = % (esperado 500)', v_avg; END IF;

  -- TEST 3: Kardex de A con el costo de la entrada.
  SELECT data INTO v_mov FROM inventory_movements
    WHERE business_id = v_business_id AND data->>'operationId' = 'avg-op-1' AND data->>'productId' = v_a::text;
  IF (v_mov->>'unitCost')::numeric <> 2600 OR (v_mov->>'totalCost')::numeric <> 78000
     OR (v_mov->>'averageCostAfter')::numeric <> 2450 THEN
    RAISE EXCEPTION 'FAIL: costo en Kardex incorrecto: %', v_mov;
  END IF;
  SELECT count(*) INTO v_count FROM inventory_movements
    WHERE business_id = v_business_id AND data->>'operationId' = 'avg-op-1' AND data ? 'unitCost';
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL: % movimientos con costo (esperado 3)', v_count; END IF;

  -- TEST 1 (cont.): segunda compra, A 10 @ 3000 => (40*2450 + 10*3000)/50 = 2560.
  PERFORM public.record_direct_purchase_atomic('avg-op-2', v_business_id, v_branch_id, v_supplier::text,
    jsonb_build_array(jsonb_build_object('productId', v_a, 'quantity', 10, 'unitPrice', 3000)),
    NULL, NULL, v_user_id::text);
  SELECT (data->>'averageCost')::numeric, (data->>'purchasePrice')::numeric INTO v_avg, v_last FROM products WHERE id = v_a;
  IF v_avg <> 2560 THEN RAISE EXCEPTION 'FAIL: promedio A tras 2a compra = % (esperado 2560)', v_avg; END IF;
  IF v_last <> 3000 THEN RAISE EXCEPTION 'FAIL: purchasePrice A tras 2a compra = % (esperado 3000)', v_last; END IF;

  -- TEST 5 (flujo A): orden previa de B 10 @ 1000 con stock 15 => (15*700 + 10*1000)/25 = 820.
  INSERT INTO purchase_orders (id, business_id, branch_id, version, data, created_at, updated_at) VALUES
    (v_order, v_business_id, v_branch_id, 1,
     jsonb_build_object('id',v_order,'code','PO-AVG','supplierId',v_supplier::text,'status','PENDIENTE',
       'createdAt',clock_timestamp(),
       'items',jsonb_build_array(jsonb_build_object('productId',v_b,'quantity',10,'unitPrice',1000))),
     now(), now());
  PERFORM public.receive_purchase_order_atomic('avg-op-3', v_order, NULL::jsonb, NULL, v_user_id::text);
  SELECT (data->>'averageCost')::numeric INTO v_avg FROM products WHERE id = v_b;
  IF v_avg <> 820 THEN RAISE EXCEPTION 'FAIL: promedio B por orden previa = % (esperado 820)', v_avg; END IF;

  RAISE NOTICE 'PASS: costo promedio ponderado (A 2450 -> 2560, B 700 -> 820, C 500), purchasePrice = ultimo precio, costo en Kardex, lineas en desorden, flujo A y B';

  DELETE FROM audit_logs WHERE business_id = v_business_id;
  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM purchase_orders WHERE business_id = v_business_id;
  DELETE FROM suppliers WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;