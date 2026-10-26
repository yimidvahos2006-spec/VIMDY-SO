-- ============================================================================
-- direct_purchase.test.sql — Compras: flujo B (compra directa) = mismo motor
-- ----------------------------------------------------------------------------
-- Cubre:
--   1  compra directa: stock, Kardex, precio de compra, orden DIRECTA, auditoria
--   2  reintento con la misma operacion: no duplica stock ni ordenes
--   3  misma factura del mismo proveedor con otra operacion: rechazada
--   4  atomicidad: si una linea falla no queda orden huerfana ni stock movido
--   5  validaciones (precio 0, producto repetido, proveedor ajeno/inexistente)
--   6  RBAC (rol sin permiso)
--   7  aislamiento de negocio/sucursal
--   8  PARIDAD A/B: mismo resultado por la orden previa que por la compra directa
--
-- Requiere aplicadas:
--   - 20261026000002_purchase_order_partial_receipt.sql
--   - 20261114000000_direct_purchase_atomic.sql
--
-- Cada DO $$ es una transaccion independiente y limpia lo que crea.
-- ============================================================================

-- === TEST 1/2/3: compra directa feliz, reintento idempotente, factura repetida ===
DO $$
DECLARE
  v_business_id uuid; v_branch_id uuid; v_user_id uuid;
  v_flour uuid := gen_random_uuid(); v_sugar uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_items jsonb; v_result jsonb; v_retry jsonb; v_order uuid;
  v_stock numeric; v_count integer; v_err text;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('DP Compra', 'America/Bogota', 'ingredientes') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');
  INSERT INTO suppliers (id, business_id, branch_id, version, data)
    VALUES (v_supplier, v_business_id, v_branch_id, 1, jsonb_build_object('id', v_supplier, 'name', 'Proveedor 1'));
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_flour, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_flour,'name','Harina','stock',10,'trackStock',true,'isIngredient',true)),
    (v_sugar, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_sugar,'name','Azucar','stock',20,'trackStock',true,'isIngredient',true));

  v_items := jsonb_build_array(
    jsonb_build_object('productId', v_flour, 'quantity', 30, 'unitPrice', 2500),
    jsonb_build_object('productId', v_sugar, 'quantity', 10, 'unitPrice', 3200));

  v_result := public.record_direct_purchase_atomic(
    'dp-op-01', v_business_id, v_branch_id, v_supplier::text, v_items, ' FE-100 ', 'llego completo', v_user_id::text);

  IF NOT COALESCE((v_result->>'success')::boolean, false) OR (v_result->>'idempotent')::boolean THEN
    RAISE EXCEPTION 'FAIL: la compra directa no fue exitosa: %', left(v_result::text, 200);
  END IF;
  IF v_result->>'source' <> 'DIRECTA' OR v_result->>'status' <> 'COMPRADO' THEN
    RAISE EXCEPTION 'FAIL: resultado inesperado: %', left(v_result::text, 200);
  END IF;
  v_order := (v_result->>'purchaseOrderId')::uuid;

  -- Stock exacto.
  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_flour;
  IF v_stock <> 40 THEN RAISE EXCEPTION 'FAIL: harina = % (esperado 40)', v_stock; END IF;
  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_sugar;
  IF v_stock <> 30 THEN RAISE EXCEPTION 'FAIL: azucar = % (esperado 30)', v_stock; END IF;

  -- Precio de compra actualizado por el motor de recepcion.
  SELECT (data->>'purchasePrice')::numeric INTO v_stock FROM products WHERE id = v_flour;
  IF v_stock <> 2500 THEN RAISE EXCEPTION 'FAIL: purchasePrice harina = % (esperado 2500)', v_stock; END IF;

  -- Kardex: un INCREASE por linea con la razon de compra.
  SELECT count(*) INTO v_count FROM inventory_movements
    WHERE business_id = v_business_id AND data->>'type' = 'INCREASE' AND data->>'reason' LIKE 'PURCHASE CD-%';
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL: movimientos de compra directa = % (esperado 2)', v_count; END IF;

  -- La orden queda en el historial como DIRECTA / COMPRADO con su factura.
  IF (SELECT data->>'source' FROM purchase_orders WHERE id = v_order) <> 'DIRECTA'
     OR (SELECT data->>'status' FROM purchase_orders WHERE id = v_order) <> 'COMPRADO'
     OR (SELECT data->>'invoiceNumber' FROM purchase_orders WHERE id = v_order) <> 'FE-100' THEN
    RAISE EXCEPTION 'FAIL: la orden no quedo DIRECTA/COMPRADO con factura FE-100';
  END IF;

  -- Auditoria de la recepcion (la escribe el motor compartido).
  SELECT count(*) INTO v_count FROM audit_logs
    WHERE business_id = v_business_id AND data->>'action' = 'PURCHASE_ORDER_RECEIVED' AND data->>'operationId' = 'dp-op-01';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: auditorias = % (esperado 1)', v_count; END IF;

  -- TEST 2: reintento con la misma operacion => idempotente, sin duplicar nada.
  v_retry := public.record_direct_purchase_atomic(
    'dp-op-01', v_business_id, v_branch_id, v_supplier::text, v_items, 'FE-100', 'llego completo', v_user_id::text);
  IF NOT COALESCE((v_retry->>'idempotent')::boolean, false) THEN
    RAISE EXCEPTION 'FAIL: el reintento no fue idempotente: %', left(v_retry::text, 200);
  END IF;
  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_flour;
  IF v_stock <> 40 THEN RAISE EXCEPTION 'FAIL: el reintento duplico stock (harina = %)', v_stock; END IF;
  SELECT count(*) INTO v_count FROM purchase_orders WHERE business_id = v_business_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: el reintento creo otra orden (% ordenes)', v_count; END IF;

  -- TEST 3: la misma factura del mismo proveedor con OTRA operacion se rechaza.
  BEGIN
    PERFORM public.record_direct_purchase_atomic(
      'dp-op-02', v_business_id, v_branch_id, v_supplier::text, v_items, 'fe-100', NULL, v_user_id::text);
    RAISE EXCEPTION 'FAIL: se registro dos veces la misma factura';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%PURCHASE_INVOICE_DUPLICATED%' THEN RAISE EXCEPTION 'FAIL (factura repetida): %', v_err; END IF;
  END;
  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_flour;
  IF v_stock <> 40 THEN RAISE EXCEPTION 'FAIL: la factura repetida movio stock (harina = %)', v_stock; END IF;

  RAISE NOTICE 'PASS: compra directa (stock 10->40 y 20->30, 2 INCREASE, orden DIRECTA/COMPRADO FE-100, 1 auditoria), reintento idempotente, factura repetida rechazada';

  DELETE FROM audit_logs WHERE business_id = v_business_id;
  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM purchase_orders WHERE business_id = v_business_id;
  DELETE FROM suppliers WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 4/5: atomicidad y validaciones ===
DO $$
DECLARE
  v_business_id uuid; v_other_business uuid; v_branch_id uuid; v_user_id uuid;
  v_ok uuid := gen_random_uuid(); v_ghost uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid(); v_foreign_supplier uuid := gen_random_uuid();
  v_stock numeric; v_count integer; v_err text;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('DP Atomic', 'America/Bogota', 'ingredientes') RETURNING id INTO v_business_id;
  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('DP Otro', 'America/Bogota', 'ingredientes') RETURNING id INTO v_other_business;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id IN (v_business_id, v_other_business);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');
  INSERT INTO suppliers (id, business_id, branch_id, version, data) VALUES
    (v_supplier, v_business_id, v_branch_id, 1, jsonb_build_object('id', v_supplier, 'name', 'Mio')),
    (v_foreign_supplier, v_other_business, NULL, 1, jsonb_build_object('id', v_foreign_supplier, 'name', 'Ajeno'));
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_ok, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_ok,'name','Bueno','stock',10,'trackStock',true));

  -- TEST 4: la segunda linea es de un producto inexistente => se revierte TODO.
  BEGIN
    PERFORM public.record_direct_purchase_atomic(
      'dp-atomic-1', v_business_id, v_branch_id, v_supplier::text,
      jsonb_build_array(
        jsonb_build_object('productId', v_ok, 'quantity', 5, 'unitPrice', 1000),
        jsonb_build_object('productId', v_ghost, 'quantity', 5, 'unitPrice', 1000)),
      'FE-ATOM', NULL, v_user_id::text);
    RAISE EXCEPTION 'FAIL: acepto un producto inexistente';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%PURCHASE_PRODUCT_NOT_IN_BUSINESS%' THEN RAISE EXCEPTION 'FAIL (atomicidad): %', v_err; END IF;
  END;
  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_ok;
  IF v_stock <> 10 THEN RAISE EXCEPTION 'FAIL: stock movido pese al error (% en vez de 10)', v_stock; END IF;
  SELECT count(*) INTO v_count FROM purchase_orders WHERE business_id = v_business_id;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: quedo una orden huerfana (%)', v_count; END IF;

  -- TEST 5: validaciones.
  BEGIN
    PERFORM public.record_direct_purchase_atomic('dp-val-1', v_business_id, v_branch_id, v_supplier::text,
      jsonb_build_array(jsonb_build_object('productId', v_ok, 'quantity', 5, 'unitPrice', 0)), NULL, NULL, NULL);
    RAISE EXCEPTION 'FAIL: acepto precio 0';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%PURCHASE_UNIT_PRICE_REQUIRED%' THEN RAISE EXCEPTION 'FAIL (precio 0): %', v_err; END IF;
  END;
  BEGIN
    PERFORM public.record_direct_purchase_atomic('dp-val-2', v_business_id, v_branch_id, v_supplier::text,
      jsonb_build_array(
        jsonb_build_object('productId', v_ok, 'quantity', 1, 'unitPrice', 10),
        jsonb_build_object('productId', v_ok, 'quantity', 2, 'unitPrice', 10)), NULL, NULL, NULL);
    RAISE EXCEPTION 'FAIL: acepto producto repetido';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%PURCHASE_ITEM_DUPLICATED%' THEN RAISE EXCEPTION 'FAIL (repetido): %', v_err; END IF;
  END;
  BEGIN
    PERFORM public.record_direct_purchase_atomic('dp-val-3', v_business_id, v_branch_id, v_foreign_supplier::text,
      jsonb_build_array(jsonb_build_object('productId', v_ok, 'quantity', 1, 'unitPrice', 10)), NULL, NULL, NULL);
    RAISE EXCEPTION 'FAIL: acepto proveedor de otro negocio';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%PURCHASE_SUPPLIER_NOT_FOUND%' THEN RAISE EXCEPTION 'FAIL (proveedor ajeno): %', v_err; END IF;
  END;
  BEGIN
    PERFORM public.record_direct_purchase_atomic('dp-val-4', v_business_id, v_branch_id, 'no-es-uuid',
      jsonb_build_array(jsonb_build_object('productId', v_ok, 'quantity', 1, 'unitPrice', 10)), NULL, NULL, NULL);
    RAISE EXCEPTION 'FAIL: acepto proveedor invalido';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%PURCHASE_SUPPLIER_REQUIRED%' THEN RAISE EXCEPTION 'FAIL (proveedor invalido): %', v_err; END IF;
  END;

  RAISE NOTICE 'PASS: atomicidad (sin orden huerfana ni stock movido) y validaciones (precio 0, repetido, proveedor ajeno, proveedor invalido)';

  DELETE FROM audit_logs WHERE business_id = v_business_id;
  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM purchase_orders WHERE business_id = v_business_id;
  DELETE FROM suppliers WHERE business_id IN (v_business_id, v_other_business);
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id IN (v_business_id, v_other_business);
END $$;


-- === TEST 6/7: RBAC y aislamiento de negocio/sucursal ===
DO $$
DECLARE
  v_business_a uuid; v_business_b uuid; v_branch_a uuid; v_branch_b uuid; v_user_id uuid;
  v_prod uuid := gen_random_uuid(); v_supplier uuid := gen_random_uuid();
  v_items jsonb; v_err text; v_stock numeric;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('DP A', 'America/Bogota', 'ingredientes') RETURNING id INTO v_business_a;
  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('DP B', 'America/Bogota', 'ingredientes') RETURNING id INTO v_business_b;
  INSERT INTO branches (business_id, name) VALUES (v_business_a, 'A1') RETURNING id INTO v_branch_a;
  INSERT INTO branches (business_id, name) VALUES (v_business_b, 'B1') RETURNING id INTO v_branch_b;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id IN (v_business_a, v_business_b);
  -- Es ADMIN solo del negocio A, y CAJERO (sin permiso de compras) en el B.
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_a, v_user_id, 'ADMIN'), (v_business_b, v_user_id, 'CAJERO');
  INSERT INTO suppliers (id, business_id, branch_id, version, data) VALUES
    (v_supplier, v_business_a, v_branch_a, 1, jsonb_build_object('id', v_supplier, 'name', 'P'));
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_prod, v_business_a, v_branch_a, 1, jsonb_build_object('id',v_prod,'name','X','stock',1,'trackStock',true));
  v_items := jsonb_build_array(jsonb_build_object('productId', v_prod, 'quantity', 1, 'unitPrice', 10));

  -- TEST 6: rol sin permiso en el negocio B.
  BEGIN
    PERFORM public.record_direct_purchase_atomic('dp-rbac-1', v_business_b, v_branch_b, v_supplier::text, v_items, NULL, NULL, NULL);
    RAISE EXCEPTION 'FAIL: un CAJERO pudo registrar una compra';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%PURCHASE_RECEIVE_FORBIDDEN%' THEN RAISE EXCEPTION 'FAIL (RBAC): %', v_err; END IF;
  END;

  -- TEST 7: ADMIN de A usando la sucursal de B => rechazado (sucursal ajena).
  BEGIN
    PERFORM public.record_direct_purchase_atomic('dp-iso-1', v_business_a, v_branch_b, v_supplier::text, v_items, NULL, NULL, NULL);
    RAISE EXCEPTION 'FAIL: acepto una sucursal de otro negocio';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%PURCHASE_BRANCH_FORBIDDEN%' AND v_err NOT LIKE '%PURCHASE_BRANCH_MISMATCH%' THEN
      RAISE EXCEPTION 'FAIL (aislamiento): %', v_err;
    END IF;
  END;

  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_prod;
  IF v_stock <> 1 THEN RAISE EXCEPTION 'FAIL: stock movido por una operacion rechazada (%)', v_stock; END IF;
  IF EXISTS (SELECT 1 FROM purchase_orders WHERE business_id IN (v_business_a, v_business_b)) THEN
    RAISE EXCEPTION 'FAIL: quedaron ordenes de operaciones rechazadas';
  END IF;

  RAISE NOTICE 'PASS: RBAC (CAJERO rechazado) y aislamiento de sucursal ajena, sin efectos secundarios';

  DELETE FROM suppliers WHERE business_id IN (v_business_a, v_business_b);
  DELETE FROM products WHERE business_id IN (v_business_a, v_business_b);
  DELETE FROM branches WHERE business_id IN (v_business_a, v_business_b);
  DELETE FROM business_members WHERE business_id IN (v_business_a, v_business_b);
  DELETE FROM businesses WHERE id IN (v_business_a, v_business_b);
END $$;


-- === TEST 8: PARIDAD A/B — el mismo resultado por orden previa que por compra directa ===
DO $$
DECLARE
  v_business_id uuid; v_branch_id uuid; v_user_id uuid;
  v_pa uuid := gen_random_uuid(); v_pb uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid(); v_order uuid := gen_random_uuid();
  v_a jsonb; v_b jsonb;
  v_stock_a numeric; v_stock_b numeric; v_price_a numeric; v_price_b numeric;
  v_reason_a text; v_reason_b text; v_audit_a text; v_audit_b text;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('DP Paridad', 'America/Bogota', 'ingredientes') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');
  INSERT INTO suppliers (id, business_id, branch_id, version, data) VALUES
    (v_supplier, v_business_id, v_branch_id, 1, jsonb_build_object('id', v_supplier, 'name', 'P'));
  -- Dos productos identicos: uno se compra por el flujo A y el otro por el B.
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_pa, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_pa,'name','PA','stock',7,'trackStock',true)),
    (v_pb, v_business_id, v_branch_id, 1, jsonb_build_object('id',v_pb,'name','PB','stock',7,'trackStock',true));

  -- Flujo A: orden previa + recepcion.
  INSERT INTO purchase_orders (id, business_id, branch_id, version, data, created_at, updated_at) VALUES
    (v_order, v_business_id, v_branch_id, 1,
     jsonb_build_object('id',v_order,'code','PO-PAR','supplierId',v_supplier::text,'status','PENDIENTE',
       'createdAt',clock_timestamp(),
       'items',jsonb_build_array(jsonb_build_object('productId',v_pa,'quantity',12,'unitPrice',4100))),
     now(), now());
  v_a := public.receive_purchase_order_atomic('par-a', v_order, NULL::jsonb, NULL, v_user_id::text);

  -- Flujo B: compra directa de lo mismo.
  v_b := public.record_direct_purchase_atomic('par-b', v_business_id, v_branch_id, v_supplier::text,
    jsonb_build_array(jsonb_build_object('productId', v_pb, 'quantity', 12, 'unitPrice', 4100)), NULL, NULL, v_user_id::text);

  SELECT (data->>'stock')::numeric, (data->>'purchasePrice')::numeric INTO v_stock_a, v_price_a FROM products WHERE id = v_pa;
  SELECT (data->>'stock')::numeric, (data->>'purchasePrice')::numeric INTO v_stock_b, v_price_b FROM products WHERE id = v_pb;
  IF v_stock_a <> v_stock_b OR v_stock_a <> 19 THEN RAISE EXCEPTION 'FAIL paridad stock: A=% B=%', v_stock_a, v_stock_b; END IF;
  IF v_price_a <> v_price_b OR v_price_a <> 4100 THEN RAISE EXCEPTION 'FAIL paridad precio: A=% B=%', v_price_a, v_price_b; END IF;
  IF v_a->>'status' <> v_b->>'status' OR v_b->>'status' <> 'COMPRADO' THEN
    RAISE EXCEPTION 'FAIL paridad estado: A=% B=%', v_a->>'status', v_b->>'status';
  END IF;

  -- Mismo formato de Kardex (razon "PURCHASE <codigo>") y misma auditoria.
  SELECT split_part(data->>'reason', ' ', 1) INTO v_reason_a FROM inventory_movements WHERE business_id = v_business_id AND data->>'operationId' = 'par-a' LIMIT 1;
  SELECT split_part(data->>'reason', ' ', 1) INTO v_reason_b FROM inventory_movements WHERE business_id = v_business_id AND data->>'operationId' = 'par-b' LIMIT 1;
  IF v_reason_a IS DISTINCT FROM v_reason_b OR v_reason_a <> 'PURCHASE' THEN
    RAISE EXCEPTION 'FAIL paridad Kardex: A=% B=%', v_reason_a, v_reason_b;
  END IF;
  SELECT data->>'action' INTO v_audit_a FROM audit_logs WHERE data->>'operationId' = 'par-a';
  SELECT data->>'action' INTO v_audit_b FROM audit_logs WHERE data->>'operationId' = 'par-b';
  IF v_audit_a IS DISTINCT FROM v_audit_b OR v_audit_a <> 'PURCHASE_ORDER_RECEIVED' THEN
    RAISE EXCEPTION 'FAIL paridad auditoria: A=% B=%', v_audit_a, v_audit_b;
  END IF;

  RAISE NOTICE 'PASS: paridad A/B (mismo stock 7->19, mismo purchasePrice 4100, mismo estado COMPRADO, mismo formato de Kardex y auditoria)';

  DELETE FROM audit_logs WHERE business_id = v_business_id;
  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM purchase_orders WHERE business_id = v_business_id;
  DELETE FROM suppliers WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;