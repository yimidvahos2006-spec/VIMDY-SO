-- ============================================================================
-- inventory_masked_adjust.test.sql — Ajustes de stock durante un conteo ciego
-- ----------------------------------------------------------------------------
-- Requiere aplicadas:
--   - 20261107000000_inventory_masked_stock_during_blind_count.sql
--   - 20261108000000_mask_adjust_stock_results_during_blind_count.sql
--
-- Cubre:
--   1  sin conteo abierto nada cambia: resultado real e INSUFFICIENT_STOCK normal
--   2  con conteo ciego abierto (INVENTARIO enmascarado):
--        · adjust_stock_with_kardex devuelve la copia enmascarada (banda, sin costo)
--        · nunca responde INSUFFICIENT_STOCK (no es oráculo del stock real)
--        · el stock REAL sí se ajusta en la base
--        · adjust_stock_with_kardex_and_fields no falla y devuelve la copia enmascarada
--        · adjust_stock_batch_with_kardex enmascara todos los productos, también en el replay
--        · ninguna respuesta contiene la cifra real
--   3  ADMIN (no enmascarado) en el mismo negocio con el conteo abierto: stock real
--   4  al cerrar el conteo todo vuelve a la normalidad
--   5  los *_core no son ejecutables por authenticated
--   6  sin sesión (service_role / backend) la respuesta es la completa
--
-- Cada DO $$ limpia lo que crea. Usa el primer usuario de auth.users.
-- ============================================================================

DO $$
DECLARE
  v_user_id uuid;
  v_business_id uuid;
  v_branch_id uuid;
  v_a uuid := gen_random_uuid();  -- stock 10.5  min 2  costo 3
  v_b uuid := gen_random_uuid();  -- stock 1     min 2  costo 2
  v_session_id text;
  v_res jsonb;
  v_arr jsonb;
  v_stock numeric;
  v_ok boolean;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY id ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'MASK_ADJ_SETUP_REQUIRED: se necesita un usuario real en auth.users.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('MASK ADJ', 'America/Bogota', 'productos') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'INVENTARIO');
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_a, v_business_id, v_branch_id, 1, jsonb_build_object('id', v_a, 'name', 'Harina', 'price', 5000, 'stock', 10.5, 'minStock', 2, 'purchasePrice', 3, 'trackStock', true)),
    (v_b, v_business_id, v_branch_id, 1, jsonb_build_object('id', v_b, 'name', 'Azucar', 'price', 4000, 'stock', 1, 'minStock', 2, 'purchasePrice', 2, 'trackStock', true));

  -- ---------------------------------------------------------------- TEST 1
  SET LOCAL ROLE authenticated;
  v_res := public.adjust_stock_with_kardex(v_a::text, -1, 'venta', 'DECREASE', NULL, NULL, NULL, NULL, gen_random_uuid()::text, v_branch_id, false);
  IF (v_res ->> 'stock')::numeric <> 9.5 OR v_res ? 'stockMasked' OR NOT (v_res ? 'purchasePrice') THEN
    RAISE EXCEPTION 'FAIL 1: sin conteo debe devolver el producto real, devolvió %', v_res;
  END IF;
  BEGIN
    PERFORM public.adjust_stock_with_kardex(v_b::text, -5, 'venta', 'DECREASE', NULL, NULL, NULL, NULL, gen_random_uuid()::text, v_branch_id, false);
    RAISE EXCEPTION 'FAIL 1: debía lanzar INSUFFICIENT_STOCK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'INSUFFICIENT_STOCK' THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- Abre un conteo ciego (el trigger del servidor sella createdByUserId).
  v_session_id := gen_random_uuid()::text;
  INSERT INTO inventory_count_sessions (id, business_id, branch_id, data)
  VALUES (v_session_id, v_business_id, v_branch_id, jsonb_build_object('status', 'OPEN', 'blind', true));

  -- ---------------------------------------------------------------- TEST 2
  SET LOCAL ROLE authenticated;
  IF NOT public.inventory_count_user_is_masked(v_business_id) THEN
    RAISE EXCEPTION 'FAIL 2: con el conteo abierto INVENTARIO debe estar enmascarado';
  END IF;

  -- 2a) devuelve la copia enmascarada
  v_res := public.adjust_stock_with_kardex(v_a::text, -1, 'venta', 'DECREASE', NULL, NULL, NULL, NULL, gen_random_uuid()::text, v_branch_id, false);
  IF (v_res -> 'stockMasked') IS DISTINCT FROM 'true'::jsonb
     OR v_res ? 'purchasePrice'
     OR (v_res ->> 'stockStatus') <> 'AVAILABLE'
     OR (v_res ->> 'stock')::numeric <> 3 THEN   -- banda AVAILABLE = minStock + 1
    RAISE EXCEPTION 'FAIL 2a: debe devolver la copia enmascarada, devolvió %', v_res;
  END IF;
  IF v_res::text LIKE '%8.5%' THEN
    RAISE EXCEPTION 'FAIL 2a: la respuesta contiene el stock real: %', v_res;
  END IF;

  -- 2b) nunca INSUFFICIENT_STOCK (pedir más de lo que hay NO falla ni revela nada)
  v_res := public.adjust_stock_with_kardex(v_b::text, -5, 'venta', 'DECREASE', NULL, NULL, NULL, NULL, gen_random_uuid()::text, v_branch_id, false);
  IF (v_res -> 'stockMasked') IS DISTINCT FROM 'true'::jsonb OR (v_res ->> 'stockStatus') <> 'OUT' OR (v_res ->> 'stock')::numeric <> 0 THEN
    RAISE EXCEPTION 'FAIL 2b: producto en negativo debe verse OUT con banda 0, devolvió %', v_res;
  END IF;

  -- 2c) _and_fields: no falla (su UPDATE directo no ve la fila) y devuelve la copia enmascarada
  v_res := public.adjust_stock_with_kardex_and_fields(v_a::text, -1, 'venta', 'DECREASE', NULL, NULL, NULL, NULL, gen_random_uuid()::text, v_branch_id, false, jsonb_build_object('lastUpdated', now()));
  IF (v_res -> 'stockMasked') IS DISTINCT FROM 'true'::jsonb OR v_res ? 'purchasePrice' THEN
    RAISE EXCEPTION 'FAIL 2c: _and_fields debe devolver la copia enmascarada, devolvió %', v_res;
  END IF;

  -- 2d) lote: todos enmascarados; y el replay idempotente también
  v_arr := public.adjust_stock_batch_with_kardex('op-mask-1', jsonb_build_array(
    jsonb_build_object('productId', v_a::text, 'delta', -1, 'reason', 'venta', 'type', 'DECREASE', 'branchId', v_branch_id::text, 'extraFields', jsonb_build_object('lastUpdated', now()))
  ));
  IF jsonb_array_length(v_arr) <> 1
     OR ((v_arr -> 0) -> 'stockMasked') IS DISTINCT FROM 'true'::jsonb
     OR (v_arr -> 0) ? 'purchasePrice' THEN
    RAISE EXCEPTION 'FAIL 2d: el lote debe devolver productos enmascarados, devolvió %', v_arr;
  END IF;
  v_arr := public.adjust_stock_batch_with_kardex('op-mask-1', jsonb_build_array(
    jsonb_build_object('productId', v_a::text, 'delta', -1, 'reason', 'venta', 'type', 'DECREASE', 'branchId', v_branch_id::text, 'extraFields', jsonb_build_object('lastUpdated', now()))
  ));
  IF ((v_arr -> 0) -> 'stockMasked') IS DISTINCT FROM 'true'::jsonb OR (v_arr -> 0) ? 'purchasePrice' THEN
    RAISE EXCEPTION 'FAIL 2d: el REPLAY del lote filtró el producto real: %', v_arr;
  END IF;
  RESET ROLE;

  -- 2e) el stock REAL sí se ajustó: 10.5 -1 (T1) -1 (2a) -1 (2c) -1 (2d) = 6.5 ; B: 1 - 5 = -4
  SELECT (data ->> 'stock')::numeric INTO v_stock FROM products WHERE id = v_a;
  IF v_stock <> 6.5 THEN RAISE EXCEPTION 'FAIL 2e: stock real de A esperado 6.5, es %', v_stock; END IF;
  SELECT (data ->> 'stock')::numeric INTO v_stock FROM products WHERE id = v_b;
  IF v_stock <> -4 THEN RAISE EXCEPTION 'FAIL 2e: stock real de B esperado -4, es %', v_stock; END IF;

  -- ---------------------------------------------------------------- TEST 3
  UPDATE business_members SET role = 'ADMIN' WHERE business_id = v_business_id AND user_id = v_user_id;
  SET LOCAL ROLE authenticated;
  IF public.inventory_count_user_is_masked(v_business_id) THEN
    RAISE EXCEPTION 'FAIL 3: ADMIN nunca se enmascara';
  END IF;
  v_res := public.adjust_stock_with_kardex(v_a::text, -1, 'merma', 'DECREASE', NULL, NULL, NULL, NULL, gen_random_uuid()::text, v_branch_id, false);
  IF (v_res ->> 'stock')::numeric <> 5.5 OR v_res ? 'stockMasked' OR NOT (v_res ? 'purchasePrice') THEN
    RAISE EXCEPTION 'FAIL 3: ADMIN debe ver el stock real (5.5), vio %', v_res;
  END IF;
  RESET ROLE;

  -- ---------------------------------------------------------------- TEST 4
  UPDATE business_members SET role = 'INVENTARIO' WHERE business_id = v_business_id AND user_id = v_user_id;
  UPDATE inventory_count_sessions SET data = data || jsonb_build_object('status', 'CLOSED') WHERE id = v_session_id;
  SET LOCAL ROLE authenticated;
  IF public.inventory_count_user_is_masked(v_business_id) THEN
    RAISE EXCEPTION 'FAIL 4: con el conteo cerrado no debe haber máscara';
  END IF;
  v_res := public.adjust_stock_with_kardex(v_a::text, -1, 'venta', 'DECREASE', NULL, NULL, NULL, NULL, gen_random_uuid()::text, v_branch_id, false);
  IF (v_res ->> 'stock')::numeric <> 4.5 OR v_res ? 'stockMasked' THEN
    RAISE EXCEPTION 'FAIL 4: cerrado el conteo debe volver al stock real (4.5), vio %', v_res;
  END IF;
  BEGIN
    PERFORM public.adjust_stock_with_kardex(v_b::text, -5, 'venta', 'DECREASE', NULL, NULL, NULL, NULL, gen_random_uuid()::text, v_branch_id, false);
    RAISE EXCEPTION 'FAIL 4: cerrado el conteo debe volver INSUFFICIENT_STOCK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'INSUFFICIENT_STOCK' THEN RAISE; END IF;
  END;

  -- ---------------------------------------------------------------- TEST 5
  v_ok := false;
  BEGIN
    PERFORM public.adjust_stock_with_kardex_core(v_a::text, -1, 'x', 'DECREASE', NULL, NULL, NULL, NULL, gen_random_uuid()::text, v_branch_id, false);
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 5: authenticated no debe poder ejecutar adjust_stock_with_kardex_core'; END IF;
  v_ok := false;
  BEGIN
    PERFORM public.adjust_stock_batch_with_kardex_core('op-x', '[]'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 5: authenticated no debe poder ejecutar adjust_stock_batch_with_kardex_core'; END IF;
  RESET ROLE;

  -- ---------------------------------------------------------------- TEST 6
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO inventory_count_sessions (id, business_id, branch_id, data)
  VALUES (gen_random_uuid()::text, v_business_id, v_branch_id, jsonb_build_object('status', 'OPEN', 'blind', true));
  SET LOCAL ROLE service_role;
  v_res := public.adjust_stock_with_kardex(v_a::text, -1, 'backend', 'DECREASE', NULL, NULL, NULL, NULL, gen_random_uuid()::text, v_branch_id, false);
  IF v_res ? 'stockMasked' OR (v_res ->> 'stock')::numeric <> 3.5 THEN
    RAISE EXCEPTION 'FAIL 6: service_role debe recibir el producto completo (3.5), recibió %', v_res;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', '', true);

  -- limpieza
  DELETE FROM inventory_count_sessions WHERE business_id = v_business_id;
  DELETE FROM inventory_batch_operations WHERE business_id = v_business_id;
  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;

  RAISE NOTICE 'inventory_masked_adjust.test.sql: todas las pruebas pasaron';
END;
$$;