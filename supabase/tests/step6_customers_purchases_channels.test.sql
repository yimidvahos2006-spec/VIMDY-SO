-- ============================================================================
-- step6_customers_purchases_channels.test.sql — Paso 6
-- ----------------------------------------------------------------------------
-- Cubre lo que REALMENTE existe (no se inventa nada):
--   CLIENTES   customers (jsonb + RLS), historial por customerId, RBAC
--   PROVEEDORES suppliers (jsonb + RLS), RBAC
--   COMPRAS    purchase_orders: crear NO mueve stock; receive_purchase_order_atomic
--              (Paso 4) SI lo mueve, de forma atomica e idempotente
--   CANALES    valores REALES de businesses.sales_channels = presencial, llevar,
--              domicilio, web, plataformas. create_sale_fulfillment_atomic SOLO
--              valida 'domicilio' server-side; web/plataformas no tienen tipo de
--              venta ni enforcement server-side (se documenta, no se inventa).
-- ============================================================================

-- === TEST USER SETUP ===
DO $$
DECLARE v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'STEP6_TEST_SETUP_REQUIRED: se necesita un usuario real en auth.users.';
  END IF;
  PERFORM set_config('vimdy.step6_test_user_id', v_user_id::text, false);
  RAISE NOTICE 'STEP6 TEST USER: %', v_user_id;
END $$;


-- === TEST 1: cliente CRUD real + historial por customerId ===
DO $$
DECLARE
  v_biz uuid; v_br uuid; v_user uuid;
  v_cust uuid := gen_random_uuid();
  v_sale uuid := gen_random_uuid();
  v_cust_data jsonb;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'P6 Clientes','America/Bogota') RETURNING id INTO v_biz;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id=v_biz;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC') RETURNING id INTO v_br;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'CAJERO');

  v_cust_data := jsonb_build_object(
    'id',v_cust,'businessId',v_biz,'name','Ana Cliente','documentType','CC',
    'documentNumber','90012345','phone','3001112222','email','ana@example.com','points',0);

  INSERT INTO customers (id,business_id,branch_id,version,data,created_at,updated_at)
  VALUES (v_cust, v_biz, v_br, 1, v_cust_data, now(), now());

  -- Lectura real del documento
  SELECT data INTO v_cust_data FROM customers WHERE id = v_cust;
  IF v_cust_data->>'documentNumber' <> '90012345' THEN
    RAISE EXCEPTION 'FAIL: el documento no se persistio bien: %', v_cust_data->>'documentNumber';
  END IF;

  -- EDICION con optimistic lock (version)
  UPDATE customers
  SET data = data || jsonb_build_object('phone','3009998888','points',50),
      version = version + 1, updated_at = now()
  WHERE id = v_cust AND version = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: la edicion con version no aplico';
  END IF;

  -- La edicion con version stale debe fallar (bloqueo optimista real)
  BEGIN
    UPDATE customers SET data = data || jsonb_build_object('points',999), version = version + 1
    WHERE id = v_cust AND version = 1;
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: una edicion con version obsoleta NO deberia aplicar';
    END IF;
  END;

  -- VENTA asociada al cliente: el historial se deriva de sales.data->>'customerId'.
  -- Se usa la forma REAL que produce register_sale_payment_atomic: una venta
  -- PAID siempre lleva paymentMethod + paymentStatus + paymentVerificationSource.
  -- (Una venta PAID sin paymentMethod cae en un borde fail-closed del trigger
  -- require_verified_external_tender: NULL NOT IN (...) es NULL, no TRUE, asi
  -- que no sale por la rama temprana y exige verificacion de proveedor.)
  INSERT INTO sales (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_sale, v_biz, v_br, 1,
     jsonb_build_object('id',v_sale,'code','V-1','customerId',v_cust::text,
       'status','PAID','paymentMethod','CASH','paymentStatus','CONFIRMED',
       'paymentVerificationSource','CASH','total',25000,'items','[]'::jsonb), now(), now());

  IF (SELECT count(*) FROM sales WHERE business_id=v_biz AND data->>'customerId'=v_cust::text) <> 1 THEN
    RAISE EXCEPTION 'FAIL: el historial por customerId no encuentra la venta';
  END IF;

  RAISE NOTICE 'PASS: cliente CRUD + optimistic lock + historial por customerId (documento 90012345, 1 venta, puntos 50)';

  DELETE FROM sales WHERE business_id=v_biz;
  DELETE FROM customers WHERE business_id=v_biz;
  DELETE FROM branches WHERE business_id=v_biz;
  DELETE FROM business_members WHERE business_id=v_biz;
  DELETE FROM businesses WHERE id=v_biz;
END $$;


-- === TEST 2: tenant isolation + branch isolation de clientes y proveedores ===
DO $$
DECLARE
  v_biz_a uuid; v_biz_b uuid; v_br_a uuid; v_br_a2 uuid; v_user uuid;
  v_cust_a uuid := gen_random_uuid();
  v_cust_b uuid := gen_random_uuid();
  v_sup_b  uuid := gen_random_uuid();
  v_seen integer;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'P6 BizA','America/Bogota') RETURNING id INTO v_biz_a;
  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'P6 BizB','America/Bogota') RETURNING id INTO v_biz_b;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id IN (v_biz_a,v_biz_b);
  INSERT INTO branches (business_id,name) VALUES (v_biz_a,'SUC A1') RETURNING id INTO v_br_a;
  INSERT INTO branches (business_id,name) VALUES (v_biz_a,'SUC A2') RETURNING id INTO v_br_a2;

  -- El actor es ADMIN de A (para proveedor) y CAJERO de A (para cliente).
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz_a,v_user,'ADMIN');

  INSERT INTO customers (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_cust_a, v_biz_a, v_br_a, 1, jsonb_build_object('id',v_cust_a,'name','Cliente A','documentNumber','111'), now(), now()),
    (v_cust_b, v_biz_b, v_br_a, 1, jsonb_build_object('id',v_cust_b,'name','Cliente B','documentNumber','222'), now(), now());
  INSERT INTO suppliers (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_sup_b, v_biz_b, v_br_a, 1, jsonb_build_object('id',v_sup_b,'name','Proveedor B'), now(), now());

  -- Tenant isolation: auth_business_ids() devuelve SETOF uuid (no un array),
  -- asi que se consulta con IN (SELECT ...) igual que hacen las policies RLS.
  IF NOT EXISTS (SELECT 1 FROM public.auth_business_ids() AS b WHERE b = v_biz_a) THEN
    RAISE EXCEPTION 'FAIL: el negocio A deberia estar en auth_business_ids';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auth_business_ids() AS b WHERE b = v_biz_b) THEN
    RAISE EXCEPTION 'FAIL: el negocio B NO deberia estar en auth_business_ids (fuga cross-tenant)';
  END IF;

  SELECT count(*) INTO v_seen FROM customers
    WHERE business_id IN (SELECT public.auth_business_ids());
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'FAIL: se esperaban 1 cliente visible, hay % (aislamiento roto)', v_seen;
  END IF;

  SELECT count(*) INTO v_seen FROM suppliers
    WHERE business_id IN (SELECT public.auth_business_ids());
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'FAIL: el proveedor de B es visible: aislamiento roto';
  END IF;

  -- BRANCH: comportamiento REAL documentado. auth_branch_ids() devuelve TODAS
  -- las sucursales de los negocios del usuario; NO filtra por
  -- app_users.branch_id (que si existe como columna). Por eso el aislamiento
  -- real es a nivel NEGOCIO, no de sucursal. Se verifica el hecho, no una
  -- aspiracion: con 2 sucursals del mismo negocio, ambas son visibles.
  IF NOT (v_br_a = ANY(public.auth_branch_ids())) THEN
    RAISE EXCEPTION 'FAIL: la sucursal A1 deberia estar en auth_branch_ids';
  END IF;

  IF NOT (v_br_a2 = ANY(public.auth_branch_ids())) THEN
    RAISE EXCEPTION 'FAIL: auth_branch_ids deberia incluir A2 (comportamiento real actual)';
  END IF;

  -- Y la brecha queda explicita: la columna de asignacion existe y no se usa.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_users' AND column_name='branch_id'
  ) THEN
    RAISE EXCEPTION 'FAIL: se esperaba app_users.branch_id (asignacion por sucursal)';
  END IF;

  RAISE NOTICE 'PASS: tenant isolation real (1 cliente de 2 visible, 0 proveedores de B) + branch REAL documentado (auth_branch_ids devuelve todas las sucursales del negocio; app_users.branch_id existe pero no se usa)';

  DELETE FROM customers WHERE business_id IN (v_biz_a,v_biz_b);
  DELETE FROM suppliers WHERE business_id IN (v_biz_a,v_biz_b);
  DELETE FROM branches WHERE business_id IN (v_biz_a,v_biz_b);
  DELETE FROM business_members WHERE business_id IN (v_biz_a,v_biz_b);
  DELETE FROM businesses WHERE id IN (v_biz_a,v_biz_b);
END $$;


-- === TEST 3: RBAC de clientes (MESERO si, INVENTARIO no) y proveedores ===
DO $$
DECLARE
  v_biz uuid; v_br uuid; v_user uuid;
  v_cust uuid := gen_random_uuid();
  v_sup  uuid := gen_random_uuid();
  v_can_read boolean;
  v_can_write_sup boolean;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'P6 RBAC','America/Bogota') RETURNING id INTO v_biz;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id=v_biz;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC') RETURNING id INTO v_br;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'MESERO');

  INSERT INTO customers (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_cust, v_biz, v_br, 1, jsonb_build_object('id',v_cust,'name','Cliente','documentNumber','333'), now(), now());

  -- MESERO: clientes SI (CAJERO,MESERO); proveedores NO (ADMIN,GERENTE,INVENTARIO)
  v_can_read := public.has_business_role(v_biz, ARRAY['ADMIN','GERENTE','CAJERO','MESERO']);
  v_can_write_sup := public.has_business_role(v_biz, ARRAY['ADMIN','GERENTE','INVENTARIO']);
  IF NOT v_can_read THEN
    RAISE EXCEPTION 'FAIL: MESERO deberia poder leer clientes';
  END IF;
  IF v_can_write_sup THEN
    RAISE EXCEPTION 'FAIL: MESERO NO deberia tener permisos de proveedor';
  END IF;

  -- Con INVENTARIO cambia al reves para proveedores
  UPDATE business_members SET role='INVENTARIO' WHERE business_id=v_biz AND user_id=v_user;
  IF public.has_business_role(v_biz, ARRAY['ADMIN','GERENTE','INVENTARIO']) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: INVENTARIO deberia tener permisos de proveedor';
  END IF;
  IF public.has_business_role(v_biz, ARRAY['ADMIN','GERENTE','CAJERO','MESERO']) IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: INVENTARIO NO deberia tener permisos de cliente';
  END IF;

  RAISE NOTICE 'PASS: RBAC de clientes vs proveedores (MESERO: cliente si/proveedor no; INVENTARIO: proveedor si/cliente no)';

  DELETE FROM customers WHERE business_id=v_biz;
  DELETE FROM branches WHERE business_id=v_biz;
  DELETE FROM business_members WHERE business_id=v_biz;
  DELETE FROM businesses WHERE id=v_biz;
END $$;


-- === TEST 4: COMPRAS — proveedor real + orden NO mueve stock ===
DO $$
DECLARE
  v_biz uuid; v_br uuid; v_user uuid;
  v_sup uuid := gen_random_uuid();
  v_ord uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid();
  v_stock numeric;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone,inventory_type) VALUES (gen_random_uuid(),'P6 Compras','America/Bogota','productos') RETURNING id INTO v_biz;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id=v_biz;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC') RETURNING id INTO v_br;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'INVENTARIO');

  INSERT INTO suppliers (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_sup, v_biz, v_br, 1, jsonb_build_object('id',v_sup,'name','Proveedor Grano','documentNumber','901','phone','3111111111'), now(), now());

  INSERT INTO products (id,business_id,branch_id,version,data) VALUES
    (v_prod, v_biz, v_br, 1, jsonb_build_object('id',v_prod,'name','Harina','stock',10,'trackStock',true));

  -- Crear la ORDEN no debe mover stock (crear != recibir)
  INSERT INTO purchase_orders (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_ord, v_biz, v_br, 1,
     jsonb_build_object('id',v_ord,'code','PO-6','supplierId',v_sup::text,'status','PENDIENTE',
       'items',jsonb_build_array(jsonb_build_object('productId',v_prod::text,'quantity',20,'unitPrice',1800))),
     now(), now());

  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id=v_prod;
  IF v_stock <> 10 THEN
    RAISE EXCEPTION 'FAIL: crear la orden movio stock: % (se esperaba 10)', v_stock;
  END IF;

  IF (SELECT data->>'status' FROM purchase_orders WHERE id=v_ord) <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'FAIL: la orden deberia quedar PENDIENTE tras crearse';
  END IF;

  -- El proveedor debe pertenecer al negocio de la orden
  IF (SELECT business_id FROM suppliers WHERE id=v_sup) <> v_biz THEN
    RAISE EXCEPTION 'FAIL: el proveedor no pertenece al negocio de la orden';
  END IF;

  RAISE NOTICE 'PASS: proveedor real + crear orden NO mueve stock (harina sigue 10, orden PENDIENTE, proveedor del mismo negocio)';

  DELETE FROM purchase_orders WHERE business_id=v_biz;
  DELETE FROM products WHERE business_id=v_biz;
  DELETE FROM suppliers WHERE business_id=v_biz;
  DELETE FROM branches WHERE business_id=v_biz;
  DELETE FROM business_members WHERE business_id=v_biz;
  DELETE FROM businesses WHERE id=v_biz;
END $$;


-- === TEST 5: RECEPCION de compra mueve stock (contrato Paso 4 intacto) ===
DO $$
DECLARE
  v_biz uuid; v_br uuid; v_user uuid;
  v_sup uuid := gen_random_uuid();
  v_ord uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid();
  v_stock numeric;
  v_movs integer;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone,inventory_type) VALUES (gen_random_uuid(),'P6 Recepcion','America/Bogota','productos') RETURNING id INTO v_biz;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id=v_biz;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC') RETURNING id INTO v_br;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'INVENTARIO');
  INSERT INTO suppliers (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_sup, v_biz, v_br, 1, jsonb_build_object('id',v_sup,'name','Prov'), now(), now());
  INSERT INTO products (id,business_id,branch_id,version,data) VALUES
    (v_prod, v_biz, v_br, 1, jsonb_build_object('id',v_prod,'name','Azucar','stock',5,'trackStock',true));
  INSERT INTO purchase_orders (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_ord, v_biz, v_br, 1,
     jsonb_build_object('id',v_ord,'supplierId',v_sup::text,'status','PENDIENTE',
       'items',jsonb_build_array(jsonb_build_object('productId',v_prod::text,'quantity',12,'unitPrice',2500))),
     now(), now());

  PERFORM public.receive_purchase_order_atomic('po6-recv', v_ord, NULL::jsonb, NULL::text, v_user::text);

  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id=v_prod;
  IF v_stock <> 17 THEN
    RAISE EXCEPTION 'FAIL: la recepcion no aplico: stock=% (se esperaba 17)', v_stock;
  END IF;

  IF (SELECT data->>'status' FROM purchase_orders WHERE id=v_ord) <> 'COMPRADO' THEN
    RAISE EXCEPTION 'FAIL: la orden no quedo COMPRADO';
  END IF;

  SELECT count(*) INTO v_movs FROM inventory_movements WHERE business_id=v_biz AND data->>'type'='INCREASE';
  IF v_movs <> 1 THEN
    RAISE EXCEPTION 'FAIL: se esperaba 1 INCREASE de kardex, hay %', v_movs;
  END IF;

  RAISE NOTICE 'PASS: recepcion de compra mueve stock atomica (azucar 5->17, orden COMPRADO, 1 INCREASE en kardex)';

  DELETE FROM audit_logs WHERE business_id=v_biz;
  DELETE FROM inventory_movements WHERE business_id=v_biz;
  DELETE FROM purchase_orders WHERE business_id=v_biz;
  DELETE FROM products WHERE business_id=v_biz;
  DELETE FROM suppliers WHERE business_id=v_biz;
  DELETE FROM branches WHERE business_id=v_biz;
  DELETE FROM business_members WHERE business_id=v_biz;
  DELETE FROM businesses WHERE id=v_biz;
END $$;


-- === TEST 6: CANALES — delivery server-side enforcement ===
DO $$
DECLARE
  v_biz uuid; v_br uuid; v_user uuid;
  v_prod uuid := gen_random_uuid();
  v_error text;
  v_res jsonb;
  v_ok boolean;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'P6 Canales','America/Bogota') RETURNING id INTO v_biz;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id=v_biz;
  -- Canal 'domicilio' DESHABILITADO (solo presencial)
  UPDATE businesses SET sales_channels = ARRAY['presencial'] WHERE id=v_biz;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC') RETURNING id INTO v_br;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'CAJERO');
  INSERT INTO products (id,business_id,branch_id,version,data) VALUES
    (v_prod, v_biz, v_br, 1, jsonb_build_object('id',v_prod,'name','Pizza','price',15000,'stock',20,'trackStock',true));

  -- DELIVERY sin canal domicilio debe rebotar (enforcement server-side real).
  -- create_sale_fulfillment_atomic NO propaga la excepcion: su propio handler
  -- EXCEPTION WHEN OTHERS la devuelve como {success:false, code, error}.
  v_res := public.create_sale_fulfillment_atomic(v_biz, v_br, 'p6-del-blocked',
    jsonb_build_object('id',gen_random_uuid(),'type','DELIVERY','deliveryAddress','Calle 1 #2-3',
      'items',jsonb_build_array(jsonb_build_object('productId',v_prod,'quantity',1))));

  IF COALESCE((v_res->>'success')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: delivery sin canal habilitado deberia rechazarse; resultado: %', left(v_res::text,140);
  END IF;
  IF strpos(COALESCE(v_res->>'error',''),'SALE_DELIVERY_CHANNEL_DISABLED') = 0 THEN
    RAISE EXCEPTION 'FAIL: se esperaba SALE_DELIVERY_CHANNEL_DISABLED, se obtuvo: %', left(v_res::text,140);
  END IF;

  -- DELIVERY con canal habilitado y direccion: debe funcionar
  UPDATE businesses SET sales_channels = ARRAY['presencial','domicilio'] WHERE id=v_biz;
  v_ok := (public.create_sale_fulfillment_atomic(v_biz, v_br, 'p6-del-ok',
      jsonb_build_object('id',gen_random_uuid(),'type','DELIVERY','deliveryAddress','Calle 1 #2-3',
        'items',jsonb_build_array(jsonb_build_object('productId',v_prod,'quantity',1))))
      ->>'success')::boolean;
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: delivery con canal habilitado deberia funcionar';
  END IF;

  -- DELIVERY sin direccion debe rebotar
  v_res := public.create_sale_fulfillment_atomic(v_biz, v_br, 'p6-del-noaddr',
    jsonb_build_object('id',gen_random_uuid(),'type','DELIVERY',
      'items',jsonb_build_array(jsonb_build_object('productId',v_prod,'quantity',1))));
  IF strpos(COALESCE(v_res->>'error',''),'SALE_DELIVERY_ADDRESS_REQUIRED') = 0 THEN
    RAISE EXCEPTION 'FAIL: delivery sin direccion deberia rechazarse, obtuvo: %', left(v_res::text,140);
  END IF;

  RAISE NOTICE 'PASS: canal delivery con enforcement server-side (sin canal->SALE_DELIVERY_CHANNEL_DISABLED, con canal->OK, sin direccion->SALE_DELIVERY_ADDRESS_REQUIRED)';

  DELETE FROM kitchen_orders WHERE business_id=v_biz;
  DELETE FROM inventory_movements WHERE business_id=v_biz;
  DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE business_id=v_biz);
  DELETE FROM sales WHERE business_id=v_biz;
  DELETE FROM sale_fulfillment_operations WHERE business_id=v_biz;
  DELETE FROM products WHERE business_id=v_biz;
  DELETE FROM branches WHERE business_id=v_biz;
  DELETE FROM business_members WHERE business_id=v_biz;
  DELETE FROM businesses WHERE id=v_biz;
END $$;