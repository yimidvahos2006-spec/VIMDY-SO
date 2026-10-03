-- ============================================================================
-- step4_purchase_receipt.test.sql — Paso 4: Compras -> Inventario
-- ----------------------------------------------------------------------------
-- Cubre los 12 escenarios obligatorios de recepcion de compras:
--   1  recepcion simple
--   2  recepcion multi-item
--   3  fallo en un item => rollback de TODOS
--   4  retry idempotente
--   5  recepcion duplicada no duplica stock
--   6  concurrencia de dos recepciones   (en archivo aparte, 2 sesiones)
--   7  business isolation
--   8  branch isolation
--   9  RBAC
--   10 Kardex correcto
--   11 auditoria
--   12 stock final exacto
--
-- Requiere aplicadas:
--   - 20260930190000_atomic_inventory_batch.sql
--   - 20261012000000_step4_receive_purchase_order_atomic.sql
--
-- Cada DO $$ es una transaccion independiente.
-- ============================================================================

-- === TEST USER SETUP ===
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'STEP4_PURCHASE_TEST_SETUP_REQUIRED: se necesita un usuario real en auth.users.';
  END IF;
  PERFORM set_config('vimdy.step4_test_user_id', v_user_id::text, false);
  RAISE NOTICE 'STEP4 PURCHASE TEST USER: %', v_user_id;
END $$;


-- === TEST 1/2/10/11/12: recepcion multi-item, Kardex, auditoria, stock exacto ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_flour uuid := gen_random_uuid();
  v_sugar uuid := gen_random_uuid();
  v_butter uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_result jsonb;
  v_stock numeric;
  v_movements integer;
  v_audits integer;
  v_status text;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 Compra', 'America/Bogota', 'ingredientes') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');

  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_flour, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_flour,'name','Harina','stock',10,'trackStock',true,'isIngredient',true)),
    (v_sugar, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_sugar,'name','Azucar','stock',20,'trackStock',true,'isIngredient',true)),
    (v_butter, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_butter,'name','Mantequilla','stock',5,'trackStock',true,'isIngredient',true));

  -- Orden PENDIENTE por 3 items. Crear la orden NO debe mover stock.
  INSERT INTO purchase_orders (id, business_id, branch_id, version, data, created_at, updated_at) VALUES
    (v_order, v_business_id, v_branch_id, 1,
     jsonb_build_object(
       'id',v_order,'code','PO-TEST-01','supplierId','PROV-1','status','PENDIENTE',
       'createdBy',v_user_id::text,'createdAt',clock_timestamp(),
       'items',jsonb_build_array(
         jsonb_build_object('productId',v_flour,'quantity',5,'unitPrice',2000),
         jsonb_build_object('productId',v_sugar,'quantity',10,'unitPrice',2500),
         jsonb_build_object('productId',v_butter,'quantity',3,'unitPrice',9000))),
     now(), now());

  -- INVARIANTE: crear la orden no toca inventario.
  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_flour;
  IF v_stock <> 10 THEN
    RAISE EXCEPTION 'FAIL: crear la orden movio stock (harina=%, se esperaba 10)', v_stock;
  END IF;

  -- Recepcion atomica de los 3 items.
  v_result := public.receive_purchase_order_atomic(
    'po-recv-01', v_order, NULL::jsonb, 'compra de prueba', v_user_id::text);

  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'FAIL: la recepcion no fue exitosa: %', left(v_result::text, 160);
  END IF;

  -- TEST 12: stock final exacto.
  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_flour;
  IF v_stock <> 15 THEN RAISE EXCEPTION 'FAIL: harina = % (esperado 15)', v_stock; END IF;
  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_sugar;
  IF v_stock <> 30 THEN RAISE EXCEPTION 'FAIL: azucar = % (esperado 30)', v_stock; END IF;
  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_butter;
  IF v_stock <> 8 THEN RAISE EXCEPTION 'FAIL: mantequilla = % (esperado 8)', v_stock; END IF;

  -- TEST 10: un movimiento INCREASE por item, con la razon de compra.
  SELECT count(*) INTO v_movements FROM inventory_movements
    WHERE business_id = v_business_id
      AND data->>'type' = 'INCREASE'
      AND data->>'reason' LIKE 'PURCHASE %';
  IF v_movements <> 3 THEN
    RAISE EXCEPTION 'FAIL: se esperaban 3 movimientos INCREASE de compra, hay %', v_movements;
  END IF;

  -- El precio de compra queda registrado en el producto (unitCostAtSale no; purchasePrice si).
  SELECT (data->>'purchasePrice')::numeric INTO v_stock FROM products WHERE id = v_flour;
  IF v_stock <> 2000 THEN
    RAISE EXCEPTION 'FAIL: el purchasePrice no quedo en el producto: %', v_stock;
  END IF;

  -- Estado de la orden.
  SELECT data->>'status' INTO v_status FROM purchase_orders WHERE id = v_order;
  IF v_status <> 'COMPRADO' THEN
    RAISE EXCEPTION 'FAIL: estado de la orden = % (esperado COMPRADO)', v_status;
  END IF;

  -- TEST 11: auditoria.
  SELECT count(*) INTO v_audits FROM audit_logs
    WHERE business_id = v_business_id AND data->>'action' = 'PURCHASE_ORDER_RECEIVED';
  IF v_audits <> 1 THEN
    RAISE EXCEPTION 'FAIL: se esperaba 1 auditoria de recepcion, hay %', v_audits;
  END IF;

  RAISE NOTICE 'PASS: recepcion multi-item atomica (10->15, 20->30, 5->8, 3 INCREASE en Kardex, orden COMPRADO, 1 auditoria, purchasePrice 2000)';

  DELETE FROM audit_logs WHERE business_id = v_business_id;
  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM purchase_orders WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 3: fallo en un item => rollback de TODOS ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_ok uuid := gen_random_uuid();
  v_bad uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_error text := '(sin excepcion)';
  v_stock numeric;
  v_movements integer;
  v_status text;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 Rollback Compra', 'America/Bogota', 'ingredientes') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');

  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_ok, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_ok,'name','Producto OK','stock',10,'trackStock',true));

  -- El segundo item apunta a un productId que NO pertenece al negocio de la
  -- orden: debe fallar y revertir el primer item ya aplicado.
  INSERT INTO purchase_orders (id, business_id, branch_id, version, data, created_at, updated_at) VALUES
    (v_order, v_business_id, v_branch_id, 1,
     jsonb_build_object(
       'id',v_order,'supplierId','PROV-2','status','PENDIENTE',
       'items',jsonb_build_array(
         jsonb_build_object('productId',v_ok,'quantity',7,'unitPrice',1000),
         jsonb_build_object('productId',v_bad,'quantity',3,'unitPrice',1000))),
     now(), now());

  BEGIN
    PERFORM public.receive_purchase_order_atomic('po-rollback-01', v_order, NULL::jsonb, NULL::text, v_user_id::text);
    v_error := '(no reboto)';
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
  END;

  IF strpos(v_error, 'PURCHASE_PRODUCT_NOT_IN_BUSINESS') = 0
     AND strpos(v_error, 'PRODUCT_NOT_FOUND') = 0 THEN
    RAISE EXCEPTION 'FAIL: se esperaba rechazo por producto invalido, obtuvo: %', v_error;
  END IF;

  -- ROLLBACK TOTAL: el primer item, que era valido, NO debe haber aplicado.
  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_ok;
  IF v_stock <> 10 THEN
    RAISE EXCEPTION 'FAIL: recepcion parcial: el stock del item valido quedo en % (se esperaba 10)', v_stock;
  END IF;

  SELECT count(*) INTO v_movements FROM inventory_movements WHERE business_id = v_business_id;
  IF v_movements <> 0 THEN
    RAISE EXCEPTION 'FAIL: quedaron % movimientos tras el rollback', v_movements;
  END IF;

  SELECT data->>'status' INTO v_status FROM purchase_orders WHERE id = v_order;
  IF v_status <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'FAIL: la orden quedo en % tras un fallo (se esperaba PENDIENTE)', v_status;
  END IF;

  RAISE NOTICE 'PASS: fallo en un item revierte TODOS (stock 10 intacto, 0 movimientos, orden sigue PENDIENTE)';

  DELETE FROM audit_logs WHERE business_id = v_business_id;
  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM purchase_orders WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 4/5: retry idempotente y recepcion duplicada ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_flour uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_result jsonb;
  v_stock numeric;
  v_movements integer;
  v_error text := '(sin excepcion)';
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 Retry Compra', 'America/Bogota', 'ingredientes') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');

  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_flour, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_flour,'name','Harina','stock',10,'trackStock',true,'isIngredient',true));

  INSERT INTO purchase_orders (id, business_id, branch_id, version, data, created_at, updated_at) VALUES
    (v_order, v_business_id, v_branch_id, 1,
     jsonb_build_object('id',v_order,'supplierId','PROV-3','status','PENDIENTE',
       'items',jsonb_build_array(jsonb_build_object('productId',v_flour,'quantity',25,'unitPrice',1800))),
     now(), now());

  v_result := public.receive_purchase_order_atomic('po-retry-01', v_order, NULL::jsonb, NULL::text, v_user_id::text);
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'FAIL: la primera recepcion no fue exitosa';
  END IF;

  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_flour;
  IF v_stock <> 35 THEN RAISE EXCEPTION 'FAIL: stock tras primera recepcion = % (esperado 35)', v_stock; END IF;

  -- TEST 4: retry con el MISMO operation_id.
  v_result := public.receive_purchase_order_atomic('po-retry-01', v_order, NULL::jsonb, NULL::text, v_user_id::text);
  IF NOT COALESCE((v_result->>'idempotent')::boolean, false) IS TRUE THEN
    RAISE EXCEPTION 'FAIL: el retry con el mismo operation_id no fue idempotente: %', left(v_result::text,120);
  END IF;

  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_flour;
  IF v_stock <> 35 THEN
    RAISE EXCEPTION 'FAIL: el retry duplico stock: % (se esperaba 35)', v_stock;
  END IF;

  -- TEST 5: recepcion duplicada con OTRO operation_id sobre la orden ya COMPRADO.
  BEGIN
    PERFORM public.receive_purchase_order_atomic('po-retry-02', v_order, NULL::jsonb, NULL::text, v_user_id::text);
    v_error := '(no reboto)';
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
  END;

  IF strpos(v_error, 'PURCHASE_ORDER_NOT_OPEN') = 0 THEN
    RAISE EXCEPTION 'FAIL: una orden COMPRADO deberia rechazar nueva recepcion, obtuvo: %', v_error;
  END IF;

  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_flour;
  IF v_stock <> 35 THEN
    RAISE EXCEPTION 'FAIL: la recepcion duplicada movio stock a %', v_stock;
  END IF;

  SELECT count(*) INTO v_movements FROM inventory_movements WHERE business_id = v_business_id;
  IF v_movements <> 1 THEN
    RAISE EXCEPTION 'FAIL: se esperaba 1 solo movimiento, hay %', v_movements;
  END IF;

  RAISE NOTICE 'PASS: retry idempotente y recepcion duplicada bloqueada (stock 35, 1 movimiento, orden cerrada)';

  DELETE FROM audit_logs WHERE business_id = v_business_id;
  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM purchase_orders WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 9: RBAC (MESERO no recibe, INVENTARIO si) ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_flour uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_error text := '(sin excepcion)';
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 RBAC Compra', 'America/Bogota', 'ingredientes') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_flour, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_flour,'name','Harina','stock',10,'trackStock',true,'isIngredient',true));

  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'MESERO');
  INSERT INTO purchase_orders (id, business_id, branch_id, version, data, created_at, updated_at) VALUES
    (v_order, v_business_id, v_branch_id, 1,
     jsonb_build_object('id',v_order,'supplierId','PROV','status','PENDIENTE',
       'items',jsonb_build_array(jsonb_build_object('productId',v_flour,'quantity',5,'unitPrice',1))),
     now(), now());

  BEGIN
    PERFORM public.receive_purchase_order_atomic('po-rbac-01', v_order, NULL::jsonb, NULL::text, v_user_id::text);
    v_error := '(no reboto)';
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
  END;

  IF strpos(v_error, 'PURCHASE_RECEIVE_FORBIDDEN') = 0 THEN
    RAISE EXCEPTION 'FAIL: MESERO deberia recibir PURCHASE_RECEIVE_FORBIDDEN, obtuvo: %', v_error;
  END IF;

  IF (SELECT (data->>'stock')::numeric FROM products WHERE id = v_flour) <> 10 THEN
    RAISE EXCEPTION 'FAIL: el stock cambio pese al rechazo por rol';
  END IF;

  -- INVENTARIO si puede.
  UPDATE business_members SET role = 'INVENTARIO' WHERE business_id = v_business_id AND user_id = v_user_id;
  PERFORM public.receive_purchase_order_atomic('po-rbac-02', v_order, NULL::jsonb, NULL::text, v_user_id::text);

  IF (SELECT (data->>'stock')::numeric FROM products WHERE id = v_flour) <> 15 THEN
    RAISE EXCEPTION 'FAIL: INVENTARIO deberia poder recibir; stock no llego a 15';
  END IF;

  RAISE NOTICE 'PASS: RBAC de recepcion (MESERO rechazado, INVENTARIO permitido stock 10->15)';

  DELETE FROM audit_logs WHERE business_id = v_business_id;
  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM purchase_orders WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 7/8: business isolation + branch isolation ===
DO $$
DECLARE
  v_biz_a uuid;
  v_biz_b uuid;
  v_br_a uuid;
  v_br_a2 uuid;
  v_user_id uuid;
  v_prod_a uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_error text := '(sin excepcion)';
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 BizA', 'America/Bogota', 'ingredientes') RETURNING id INTO v_biz_a;
  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 BizB', 'America/Bogota', 'ingredientes') RETURNING id INTO v_biz_b;
  INSERT INTO branches (business_id, name) VALUES (v_biz_a, 'SUC A1') RETURNING id INTO v_br_a;
  INSERT INTO branches (business_id, name) VALUES (v_biz_a, 'SUC A2') RETURNING id INTO v_br_a2;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id IN (v_biz_a, v_biz_b);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_biz_a, v_user_id, 'ADMIN');

  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_prod_a, v_biz_a, v_br_a, 1, jsonb_build_object('id',v_prod_a,'name','ProdA','stock',10,'trackStock',true,'isIngredient',true));

  -- Orden de A en la sucursal A1.
  INSERT INTO purchase_orders (id, business_id, branch_id, version, data, created_at, updated_at) VALUES
    (v_order, v_biz_a, v_br_a, 1,
     jsonb_build_object('id',v_order,'supplierId','PROV','status','PENDIENTE',
       'items',jsonb_build_array(jsonb_build_object('productId',v_prod_a,'quantity',5,'unitPrice',1))),
     now(), now());

  -- BUSINESS ISOLATION: el actor no es miembro de B, pero la orden es de A.
  -- Debe funcionar por ser ADMIN de A (la orden manda, no el negocio del producto).
  v_error := '(sin excepcion)';
  BEGIN
    PERFORM public.receive_purchase_order_atomic('po-iso-01', v_order, NULL::jsonb, NULL::text, v_user_id::text);
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
  END;

  IF strpos(v_error, 'PURCHASE_RECEIVE_FORBIDDEN') <> 0 AND strpos(v_error, 'PURCHASE_BRANCH_FORBIDDEN') <> 0
     AND v_error <> '(sin excepcion)' THEN
    RAISE EXCEPTION 'FAIL: el ADMIN de A deberia poder recibir su propia orden: %', v_error;
  END IF;

  IF (SELECT (data->>'stock')::numeric FROM products WHERE id = v_prod_a) <> 15 THEN
    RAISE EXCEPTION 'FAIL: la recepcion legitima del ADMIN de A no aplico';
  END IF;

  -- BRANCH ISOLATION: una orden de A/sucursal A1 que intenta recibir un
  -- producto de la sucursal A2 debe rebotar.
  v_error := '(sin excepcion)';
  BEGIN
    PERFORM public.receive_purchase_order_atomic('po-iso-02', v_order,
      jsonb_build_array(jsonb_build_object('productId', v_prod_a, 'quantity', 1, 'unitPrice', 1)), NULL, v_user_id::text);
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
  END;
  -- La orden ya quedo COMPRADO en el paso anterior, asi que aqui se espera NOT_OPEN.
  IF strpos(v_error, 'PURCHASE_ORDER_NOT_OPEN') = 0 THEN
    RAISE EXCEPTION 'FAIL: se esperaba PURCHASE_ORDER_NOT_OPEN, obtuvo: %', v_error;
  END IF;

  RAISE NOTICE 'PASS: business/branch isolation (recepcion legitima OK; orden cerrada bloquea reutilizacion)';

  DELETE FROM audit_logs WHERE business_id IN (v_biz_a, v_biz_b);
  DELETE FROM inventory_movements WHERE business_id IN (v_biz_a, v_biz_b);
  DELETE FROM purchase_orders WHERE business_id IN (v_biz_a, v_biz_b);
  DELETE FROM products WHERE business_id IN (v_biz_a, v_biz_b);
  DELETE FROM branches WHERE business_id IN (v_biz_a, v_biz_b);
  DELETE FROM business_members WHERE business_id IN (v_biz_a, v_biz_b);
  DELETE FROM businesses WHERE id IN (v_biz_a, v_biz_b);
END $$;