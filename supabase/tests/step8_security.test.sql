-- ============================================================================
-- step8_security.test.sql — Paso 8: Seguridad + Hardening (REGRESION)
-- ----------------------------------------------------------------------------
-- Ataques reales ejecutados con el rol `authenticated` (NO superusuario), porque
-- postgres BYPASEA RLS y no probaria nada.
--
-- Cubre:
--   1. Tenant isolation por tabla: SELECT/UPDATE/DELETE/INSERT cross-business
--   2. IDOR financiero: marcar PAID una venta de otro negocio
--   3. IDOR por parametro en RPC: ajustar stock, cobrar, reembolsar, recibir
--      compra y crear venta pasando el contexto del negocio ajeno
--   4. Auth helpers: un usuario sin membresia no obtiene negocios ni sucursales
--
-- Endurecimiento verificado en 20261014000000_step8_security_hardening.sql:
--   - `anon` sin EXECUTE sobre RPCs financieras
--   - todas las SECURITY DEFINER con search_path fijo
-- ============================================================================
-- ===== ATAQUES REALES COMO ROL authenticated =====
-- Usuario U es ADMIN del negocio A. El negocio B es ajeno.
DO $$
DECLARE
  u uuid; v_a uuid; v_b uuid; v_br_a uuid; v_br_b uuid;
  v_prod_a uuid := gen_random_uuid(); v_prod_b uuid := gen_random_uuid();
  v_sale_b uuid := gen_random_uuid(); v_cust_b uuid := gen_random_uuid(); v_sup_b uuid := gen_random_uuid();
  v_ok integer := 0; v_msg text := '';
BEGIN
  SELECT id INTO u FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', u::text, true);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'ATK BizA','America/Bogota') RETURNING id INTO v_a;
  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'ATK BizB','America/Bogota') RETURNING id INTO v_b;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id IN (v_a,v_b);
  INSERT INTO branches (business_id,name) VALUES (v_a,'BR A') RETURNING id INTO v_br_a;
  INSERT INTO branches (business_id,name) VALUES (v_b,'BR B') RETURNING id INTO v_br_b;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_a,u,'ADMIN');

  INSERT INTO products (id,business_id,branch_id,version,data) VALUES
    (v_prod_a, v_a, v_br_a, 1, jsonb_build_object('id',v_prod_a::text,'name','ProdA','stock',10,'trackStock',true)),
    (v_prod_b, v_b, v_br_b, 1, jsonb_build_object('id',v_prod_b::text,'name','ProdB','stock',10,'trackStock',true));
  INSERT INTO customers (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_cust_b, v_b, v_br_b, 1, jsonb_build_object('id',v_cust_b::text,'name','ClienteB'), now(), now());
  INSERT INTO suppliers (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_sup_b, v_b, v_br_b, 1, jsonb_build_object('id',v_sup_b::text,'name','ProvB'), now(), now());
  INSERT INTO sales (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_sale_b, v_b, v_br_b, 1,
      jsonb_build_object('id',v_sale_b::text,'status','PENDING_PAYMENT','paymentMethod','CASH',
        'paymentStatus','CONFIRMED','paymentVerificationSource','CASH','total',50000,'items','[]'::jsonb), now(), now());

  SET LOCAL ROLE authenticated;

  -- === SELECT cross-business ===
  SELECT count(*) INTO v_ok FROM products  WHERE business_id = v_b;
  IF v_ok > 0 THEN RAISE EXCEPTION 'FUGA SELECT products: %', v_ok; END IF;
  SELECT count(*) INTO v_ok FROM customers WHERE business_id = v_b;
  IF v_ok > 0 THEN RAISE EXCEPTION 'FUGA SELECT customers: %', v_ok; END IF;
  SELECT count(*) INTO v_ok FROM suppliers WHERE business_id = v_b;
  IF v_ok > 0 THEN RAISE EXCEPTION 'FUGA SELECT suppliers: %', v_ok; END IF;
  SELECT count(*) INTO v_ok FROM sales     WHERE business_id = v_b;
  IF v_ok > 0 THEN RAISE EXCEPTION 'FUGA SELECT sales: %', v_ok; END IF;

  -- === UPDATE cross-business ===
  BEGIN
    UPDATE products SET data = data || jsonb_build_object('stock',999) WHERE id = v_prod_b;
    IF FOUND THEN RAISE EXCEPTION 'FUGA UPDATE product ajeno'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE customers SET data = data || jsonb_build_object('name','hacked') WHERE id = v_cust_b;
    IF FOUND THEN RAISE EXCEPTION 'FUGA UPDATE customer ajeno'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE sales SET data = data || jsonb_build_object('notes','hacked') WHERE id = v_sale_b;
    IF FOUND THEN RAISE EXCEPTION 'FUGA UPDATE sale ajena'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- === DELETE cross-business ===
  BEGIN
    DELETE FROM customers WHERE id = v_cust_b;
    IF FOUND THEN RAISE EXCEPTION 'FUGA DELETE customer ajeno'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- === INSERT con business_id ajeno (suplantar tenant) ===
  BEGIN
    INSERT INTO customers (id,business_id,branch_id,version,data,created_at,updated_at)
    VALUES (gen_random_uuid(), v_b, v_br_b, 1, jsonb_build_object('name','inyectado'), now(), now());
    RAISE EXCEPTION 'FUGA INSERT customer en negocio ajeno';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
            WHEN check_violation THEN NULL;
            WHEN foreign_key_violation THEN NULL;
  END;

  -- === Marcar PAID una venta ajena directamente (IDOR financiero) ===
  BEGIN
    UPDATE sales SET data = data || jsonb_build_object('status','PAID') WHERE id = v_sale_b;
    IF FOUND THEN RAISE EXCEPTION 'FUGA: marcar PAID venta ajena'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  RESET ROLE;

  -- Verificacion post-ataque (como postgres): nada fue modificado.
  IF (SELECT (data->>'stock')::numeric FROM products WHERE id=v_prod_b) <> 10 THEN
    RAISE EXCEPTION 'FUGA CONFIRMADA: stock del producto ajeno cambio';
  END IF;
  IF (SELECT data->>'name' FROM customers WHERE id=v_cust_b) <> 'ClienteB' THEN
    RAISE EXCEPTION 'FUGA CONFIRMADA: cliente ajeno fue modificado';
  END IF;
  IF (SELECT data->>'status' FROM sales WHERE id=v_sale_b) <> 'PENDING_PAYMENT' THEN
    RAISE EXCEPTION 'FUGA CONFIRMADA: venta ajena cambio de estado';
  END IF;

  RAISE NOTICE 'PASS 1: SELECT/UPDATE/DELETE/INSERT/IDOR-PAGAR cross-business BLOQUEADOS (4 SELECT, 3 UPDATE, 1 DELETE, 1 INSERT, 1 marcado PAID)';

  -- limpieza
  DELETE FROM sales WHERE business_id IN (v_a,v_b);
  DELETE FROM customers WHERE business_id IN (v_a,v_b);
  DELETE FROM suppliers WHERE business_id IN (v_a,v_b);
  DELETE FROM products WHERE business_id IN (v_a,v_b);
  DELETE FROM branches WHERE business_id IN (v_a,v_b);
  DELETE FROM business_members WHERE business_id IN (v_a,v_b);
  DELETE FROM businesses WHERE id IN (v_a,v_b);
END $$;
-- ===== ATAQUES A RPCs: IDOR por parametros + escalacion =====
DO $$
DECLARE
  u uuid; v_a uuid; v_b uuid; v_br_a uuid; v_br_b uuid;
  v_prod_a uuid := gen_random_uuid();
  v_prod_b uuid := gen_random_uuid();
  v_sale_b uuid := gen_random_uuid();
  v_ord_b  uuid := gen_random_uuid();
  v_reg uuid := gen_random_uuid();
  v_res jsonb; v_err text := ''; v_blocked integer := 0;
BEGIN
  SELECT id INTO u FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', u::text, true);

  INSERT INTO businesses (id,name,timezone,inventory_type)
    VALUES (gen_random_uuid(),'ATK2 A','America/Bogota','productos'),
           (gen_random_uuid(),'ATK2 B','America/Bogota','productos');
  SELECT id INTO v_a FROM businesses WHERE name='ATK2 A';
  SELECT id INTO v_b FROM businesses WHERE name='ATK2 B';
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id IN (v_a,v_b);
  INSERT INTO branches (business_id,name) VALUES (v_a,'BR A'),(v_b,'BR B');
  SELECT id INTO v_br_a FROM branches WHERE business_id=v_a;
  SELECT id INTO v_br_b FROM branches WHERE business_id=v_b;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_a,u,'ADMIN');

  INSERT INTO products (id,business_id,branch_id,version,data) VALUES
    (v_prod_a, v_a, v_br_a, 1, jsonb_build_object('id',v_prod_a::text,'name','ProdA','stock',10,'trackStock',true)),
    (v_prod_b, v_b, v_br_b, 1, jsonb_build_object('id',v_prod_b::text,'name','ProdB','stock',10,'trackStock',true));

  INSERT INTO sales (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_sale_b, v_b, v_br_b, 1,
      jsonb_build_object('id',v_sale_b::text,'status','PAID','paymentMethod','CASH',
        'paymentStatus','CONFIRMED','paymentVerificationSource','CASH','total',50000,
        'subtotal',50000,'tax',0,'discount',0,'items','[]'::jsonb), now(), now());

  INSERT INTO orders (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_ord_b, v_b, v_br_b, 1,
      jsonb_build_object('id',v_ord_b::text,'source','QUICK','status','PENDING','orderNumber',1,'items','[]'::jsonb), now(), now());

  INSERT INTO cash_registers (id,business_id,branch_id,code,name,active,status,data)
  VALUES (v_reg, v_b, v_br_b, 'ATK2-B','Registro B',true,'ACTIVE','{}'::jsonb);

  SET LOCAL ROLE authenticated;

  -- ATAQUE 1: ajustar stock de un producto del negocio B, pasando SU business.
  BEGIN
    PERFORM adjust_stock_with_kardex(v_prod_b::text, 999,'ataque','INCREASE',NULL,NULL,NULL,NULL,NULL,NULL,false);
  EXCEPTION WHEN OTHERS THEN v_err := sqlerrm; v_blocked := v_blocked+1;
  END;
  IF v_blocked = 0 THEN RAISE EXCEPTION 'FUGA: adjust_stock sobre producto del negocio B'; END IF;

  -- ATAQUE 2: batch adjust同理.
  v_blocked := 0; v_err := '';
  BEGIN
    PERFORM adjust_stock_batch_with_kardex('atk2-batch',
      jsonb_build_array(jsonb_build_object('productId',v_prod_b::text,'delta',999,'type','INCREASE','branchId',v_br_b::text,'reason','ataque')));
  EXCEPTION WHEN OTHERS THEN v_err := sqlerrm; v_blocked := v_blocked+1;
  END;
  IF v_blocked = 0 THEN RAISE EXCEPTION 'FUGA: adjust batch sobre producto ajeno'; END IF;

  -- ATAQUE 3: crear venta en el negocio B.
  v_res := create_sale_fulfillment_atomic(v_b, v_br_b, 'atk2-sale',
    jsonb_build_object('id',gen_random_uuid(),'type','QUICK','items','[]'::jsonb));
  IF COALESCE((v_res->>'success')::boolean, true) IS TRUE THEN
    RAISE EXCEPTION 'FUGA: crear venta en negocio ajeno (success=true)';
  END IF;

  -- ATAQUE 4: cobrar una venta del negocio B pasando su contexto.
  v_blocked := 0; v_err := '';
  BEGIN
    PERFORM register_sale_payment_atomic(v_sale_b::text, v_b, v_br_b, 'atk2-pay', NULL,
      'CASH', 50000, 50000, 50000, 0, NULL, NULL, 'CASH', NULL);
  EXCEPTION WHEN OTHERS THEN v_err := sqlerrm; v_blocked := v_blocked+1;
  END;
  IF v_blocked = 0 THEN RAISE EXCEPTION 'FUGA: cobrar venta ajena'; END IF;

  -- ATAQUE 5: reembolsar una venta del negocio B.
  v_blocked := 0; v_err := '';
  BEGIN
    PERFORM refund_sale_cash_atomic(v_b, v_br_b, v_sale_b::text, 'atk2-refund',
      jsonb_build_array(), 'ataque', v_reg);
  EXCEPTION WHEN OTHERS THEN v_err := sqlerrm; v_blocked := v_blocked+1;
  END;
  IF v_blocked = 0 THEN RAISE EXCEPTION 'FUGA: reembolsar venta ajena'; END IF;

  -- ATAQUE 6: recibir una orden de compra del negocio B.
  v_blocked := 0; v_err := '';
  BEGIN
    PERFORM receive_purchase_order_atomic('atk2-po', gen_random_uuid(), NULL::jsonb, NULL::text, u::text);
  EXCEPTION WHEN OTHERS THEN v_err := sqlerrm; v_blocked := v_blocked+1;
  END;
  IF v_blocked = 0 THEN RAISE EXCEPTION 'FUGA: recibir compra ajena'; END IF;

  RESET ROLE;

  -- Verificacion: nada cambio en B.
  IF (SELECT (data->>'stock')::numeric FROM products WHERE id=v_prod_b) <> 10 THEN
    RAISE EXCEPTION 'FUGA CONFIRMADA: stock de B cambio';
  END IF;
  IF (SELECT count(*) FROM sales WHERE business_id=v_b AND data->>'status'='PENDING_PAYMENT') <> 0 THEN
    RAISE EXCEPTION 'FUGA CONFIRMADA: se creo venta en B';
  END IF;

  RAISE NOTICE 'PASS 2: 6 ataques RPC cross-business BLOQUEADOS (adjust simple, batch, create_sale, register_payment, refund, purchase receipt)';

  DELETE FROM sales WHERE business_id IN (v_a,v_b);
  DELETE FROM orders WHERE business_id IN (v_a,v_b);
  DELETE FROM cash_movements WHERE business_id IN (v_a,v_b);
  DELETE FROM products WHERE business_id IN (v_a,v_b);
  DELETE FROM purchase_orders WHERE business_id IN (v_a,v_b);
  DELETE FROM cash_registers WHERE business_id IN (v_a,v_b);
  DELETE FROM branches WHERE business_id IN (v_a,v_b);
  DELETE FROM business_members WHERE business_id IN (v_a,v_b);
  DELETE FROM businesses WHERE id IN (v_a,v_b);
END $$;
-- ===== search_path: prueba de shadowing + exposicion anon =====
DO $$
DECLARE
  v_user uuid; v_biz uuid; v_br uuid; v_probe integer; v_err text := ''; v_blocked integer := 0;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'ATK3 Path','America/Bogota') RETURNING id INTO v_biz;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id=v_biz;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC') RETURNING id INTO v_br;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'ADMIN');

  SET LOCAL ROLE authenticated;

  -- Un usuario SIN membresia no debe ver businesses ajenas via auth_business_ids.
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  SELECT count(*) INTO v_probe FROM public.auth_business_ids();
  IF v_probe <> 0 THEN
    RAISE EXCEPTION 'FUGA: auth_business_ids devolvio % negocios para un usuario sin membresia', v_probe;
  END IF;

  -- Y tampoco branches.
  SELECT coalesce(array_length(public.auth_branch_ids(),1),0) INTO v_probe;
  IF v_probe <> 0 THEN
    RAISE EXCEPTION 'FUGA: auth_branch_ids devolvio % sucursales para usuario sin membresia', v_probe;
  END IF;

  -- Volvemos a nuestro usuario: debe ver exactamente 1.
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  SELECT count(*) INTO v_probe FROM public.auth_business_ids();
  IF v_probe <> 1 THEN
    RAISE EXCEPTION 'FAIL esperado: auth_business_ids = %, se esperaba 1', v_probe;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS 3: auth_business_ids/auth_branch_ids no filtran para usuario sin membresia (0/0) y acotan al miembro (1)';

  DELETE FROM branches WHERE business_id=v_biz;
  DELETE FROM business_members WHERE business_id=v_biz;
  DELETE FROM businesses WHERE id=v_biz;
END $$;

\echo '== anon puede ejecutar funciones sensibles? =='
SELECT p.proname, p.proacl::text
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proacl::text LIKE '%anon=X%'
  AND p.proname IN ('close_shift_with_cash_count_atomic','register_cash_movement_enterprise',
                    'get_next_invoice_consecutive','can_start_trial','mark_trial_used',
                    'ensure_default_cash_register','claim_daily_report_jobs')
ORDER BY 1;
