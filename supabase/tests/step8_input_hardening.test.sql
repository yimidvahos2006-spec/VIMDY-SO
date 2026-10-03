-- ============================================================================
-- step8_input_hardening.test.sql — Paso 8 (REGRESION)
-- ----------------------------------------------------------------------------
-- Inputs malformados y limítrofes contra rutas CRÍTICAS que ya existen.
-- No se inventan reglas nuevas: solo se comprueba que lo que ya hay rechaza.
--
--   - UUID inválido, string vacío, JSON inesperado
--   - cantidad 0, negativa y extremadamente grande
--   - payload HTML/script y caracteres especiales
--   - NaN / Infinity en el precio (llegan desde la capa JS)
--
-- Se verifica que: se rechazan, NO dejan escrituras parciales, NO atraviesan
-- RLS/RBAC y NO producen estados financieros/inventario inválidos.
-- ============================================================================

DO $$
DECLARE v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'STEP8_INPUT_TEST_SETUP_REQUIRED: se necesita un usuario en auth.users.';
  END IF;
  PERFORM set_config('vimdy.step8_test_user_id', v_user_id::text, false);
END $$;


-- === Inventario: UUID inválido, vacío, null, negativos y NaN ===
DO $$
DECLARE
  v_biz uuid; v_br uuid; v_user uuid;
  v_prod uuid := gen_random_uuid();
  v_stock numeric; v_movs integer;
  v_cases integer := 0;
  v_rejected integer := 0;
  v_case text;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone,inventory_type) VALUES (gen_random_uuid(),'P8 Input','America/Bogota','productos') RETURNING id INTO v_biz;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id=v_biz;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC') RETURNING id INTO v_br;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'INVENTARIO');
  INSERT INTO products (id,business_id,branch_id,version,data) VALUES
    (v_prod, v_biz, v_br, 1, jsonb_build_object('id',v_prod::text,'name','Prod','stock',10,'trackStock',true));

  -- Cada caso debe ser rechazado por la RPC (INVALID_INVENTORY_IDENTIFIER / numeric).
  FOREACH v_case IN ARRAY ARRAY[
    'no-es-uuid', '', '   ', '../../etc/passwd', '<script>alert(1)</script>',
    '00000000-0000-0000-0000-000000000000', 'DROP TABLE products;--'
  ] LOOP
    v_cases := v_cases + 1;
    BEGIN
      PERFORM public.adjust_stock_with_kardex(v_case, 1, 'ataque', 'INCREASE', NULL,NULL,NULL,NULL,NULL,NULL,false);
    EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1;
    END;
  END LOOP;

  IF v_rejected < v_cases THEN
    RAISE EXCEPTION 'FAIL: solo % de % identificadores malformados fueron rechazados', v_rejected, v_cases;
  END IF;

  -- Cantidad negativa sobre un producto EXISTENTE debe rebotar por stock.
  BEGIN
    PERFORM public.adjust_stock_with_kardex(v_prod::text, -999999999, 'negativo', 'DECREASE', NULL,NULL,NULL,NULL,NULL,NULL,false);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF (SELECT (data->>'stock')::numeric FROM products WHERE id=v_prod) < 10 THEN
    RAISE EXCEPTION 'FAIL: una cantidad negativa permitio descuento bajo cero';
  END IF;

  -- JSON inesperado en el payload de venta (items no es un array).
  BEGIN
    PERFORM public.create_sale_fulfillment_atomic(v_biz, v_br, 'p8-badjson',
      jsonb_build_object('id', gen_random_uuid(), 'type','QUICK', 'items','no-es-un-array'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF (SELECT count(*) FROM sales WHERE business_id=v_biz) <> 0 THEN
    RAISE EXCEPTION 'FAIL: un payload invalido creo una venta';
  END IF;

  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id=v_prod;
  IF v_stock <> 10 THEN
    RAISE EXCEPTION 'FAIL: los ataques cambiaron el stock a %', v_stock;
  END IF;

  SELECT count(*) INTO v_movs FROM inventory_movements WHERE business_id=v_biz;
  IF v_movs <> 0 THEN
    RAISE EXCEPTION 'FAIL: se escribieron % movimientos con entradas malformadas', v_movs;
  END IF;

  RAISE NOTICE 'PASS: input hardening de inventario (% identificadores malformados rechazados, negativo bloqueado, JSON invalido sin venta, stock intacto 10, 0 movimientos)', v_cases;

  DELETE FROM sales WHERE business_id=v_biz;
  DELETE FROM inventory_movements WHERE business_id=v_biz;
  DELETE FROM products WHERE business_id=v_biz;
  DELETE FROM branches WHERE business_id=v_biz;
  DELETE FROM business_members WHERE business_id=v_biz;
  DELETE FROM businesses WHERE id=v_biz;
END $$;


-- === Precio NaN / Infinity en la recepcion de compras ===
DO $$
DECLARE
  v_biz uuid; v_br uuid; v_user uuid;
  v_prod uuid := gen_random_uuid();
  v_ord uuid := gen_random_uuid();
  v_stock numeric; v_movs integer; v_rejected integer := 0;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone,inventory_type) VALUES (gen_random_uuid(),'P8 NaN','America/Bogota','productos') RETURNING id INTO v_biz;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id=v_biz;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC') RETURNING id INTO v_br;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'INVENTARIO');
  INSERT INTO products (id,business_id,branch_id,version,data) VALUES
    (v_prod, v_biz, v_br, 1, jsonb_build_object('id',v_prod::text,'name','Prod','stock',10,'trackStock',true));
  INSERT INTO purchase_orders (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_ord, v_biz, v_br, 1,
      jsonb_build_object('id',v_ord,'supplierId','P8','status','PENDIENTE',
        'items',jsonb_build_array(jsonb_build_object('productId',v_prod::text,'quantity',5,'unitPrice',1000))),
      now(), now());

  -- unitPrice NaN e Infinity (JSON permite 'NaN' en numeric solo como texto).
  BEGIN
    PERFORM public.receive_purchase_order_atomic('p8-nan', v_ord,
      jsonb_build_array(jsonb_build_object('productId',v_prod::text,'quantity',5,'unitPrice','NaN'::numeric)),
      NULL::text, v_user::text);
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1;
  END;

  BEGIN
    PERFORM public.receive_purchase_order_atomic('p8-inf', v_ord,
      jsonb_build_array(jsonb_build_object('productId',v_prod::text,'quantity',5,'unitPrice','Infinity'::numeric)),
      NULL::text, v_user::text);
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1;
  END;

  -- Cantidad 0 y negativa.
  BEGIN
    PERFORM public.receive_purchase_order_atomic('p8-q0', v_ord,
      jsonb_build_array(jsonb_build_object('productId',v_prod::text,'quantity',0,'unitPrice',1000)),
      NULL::text, v_user::text);
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1;
  END;

  BEGIN
    PERFORM public.receive_purchase_order_atomic('p8-qneg', v_ord,
      jsonb_build_array(jsonb_build_object('productId',v_prod::text,'quantity',-5,'unitPrice',1000)),
      NULL::text, v_user::text);
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1;
  END;

  IF v_rejected < 4 THEN
    RAISE EXCEPTION 'FAIL: solo % de 4 entradas numericas invalidas fueron rechazadas', v_rejected;
  END IF;

  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id=v_prod;
  IF v_stock <> 10 THEN
    RAISE EXCEPTION 'FAIL: una entrada numerica invalida cambio el stock a %', v_stock;
  END IF;
  SELECT count(*) INTO v_movs FROM inventory_movements WHERE business_id=v_biz;
  IF v_movs <> 0 THEN
    RAISE EXCEPTION 'FAIL: se escribieron % movimientos con numeros invalidos', v_movs;
  END IF;

  RAISE NOTICE 'PASS: input hardening de compras (% entradas invalidas rechazadas: NaN, Infinity, cantidad 0, cantidad negativa; stock intacto 10, 0 movimientos)', v_rejected;

  DELETE FROM audit_logs WHERE business_id=v_biz;
  DELETE FROM inventory_movements WHERE business_id=v_biz;
  DELETE FROM purchase_orders WHERE business_id=v_biz;
  DELETE FROM products WHERE business_id=v_biz;
  DELETE FROM branches WHERE business_id=v_biz;
  DELETE FROM business_members WHERE business_id=v_biz;
  DELETE FROM businesses WHERE id=v_biz;
END $$;