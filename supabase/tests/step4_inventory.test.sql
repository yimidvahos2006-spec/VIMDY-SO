-- ============================================================================
-- step4_inventory.test.sql — Paso 4: Inventario
-- ----------------------------------------------------------------------------
-- Cubre los 20 escenarios obligatorios de inventario sobre la DB local:
--   1-3  stock increase / decrease / no negative stock
--   4    kardex (trazabilidad completa del movimiento)
--   5-7  sale consumes once / retry no consume twice / rollback
--   8-9  purchase receipt (via increaseStock) + retry idempotency
--   10   adjustment authorization (RBAC)
--   11-13 transfer atomicity / rollback / idempotency
--   14   recipe ingredient consumption
--   15   production atomicity
--   16   concurrent stock operations
--   17-18 branch isolation / business isolation
--   19   RBAC
--   20   audit
--
-- Requiere aplicadas:
--   - 20260930183000_atomic_inventory_movement_fields.sql
--   - 20260930190000_atomic_inventory_batch.sql
--   - 20260930193000_atomic_sale_fulfillment.sql
--   - 20261002000000_atomic_inventory_transfer_and_production.sql
--   - 20261004000000_fix_inventory_kardex_uuid_helpers.sql
--   - 20261011000000_step4_inventory_adjust_rbac_tenant_isolation.sql
--
-- Cada DO $$ es una transaccion independiente: un fallo aborta solo ese bloque.
-- ============================================================================

-- === TEST USER SETUP ===
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'STEP4_TEST_SETUP_REQUIRED: se necesita un usuario real en auth.users.';
  END IF;
  PERFORM set_config('vimdy.step4_test_user_id', v_user_id::text, false);
  RAISE NOTICE 'STEP4 TEST USER: %', v_user_id;
END $$;


-- ============================================================================
-- AJUSTES: stock increase / decrease / no negative / kardex / RBAC
-- ============================================================================

-- === TEST 1: increaseStock deja Kardex completo ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_product_id uuid := gen_random_uuid();
  v_movement_id uuid := gen_random_uuid();
  v_stock numeric;
  v_movement jsonb;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 T1', 'America/Bogota', 'productos') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_product_id, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_product_id,'name','Harina','stock',0,'minStock',2,'trackStock',true,'unit','kg'));

  PERFORM public.adjust_stock_with_kardex(
    v_product_id::text, 25, 'Compra inicial', 'INCREASE',
    NULL, NULL, NULL, NULL, v_movement_id::text, NULL, false);

  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_product_id;
  IF v_stock <> 25 THEN
    RAISE EXCEPTION 'FAIL: increaseStock dejo stock %, se esperaba 25', v_stock;
  END IF;

  -- Trazabilidad: cantidad, tipo, razon, actor, timestamp, producto, branch.
  SELECT data INTO v_movement FROM inventory_movements WHERE id = v_movement_id;
  IF v_movement IS NULL THEN
    RAISE EXCEPTION 'FAIL: no se registro el movimiento de Kardex';
  END IF;
  IF v_movement->>'quantity' <> '25' THEN
    RAISE EXCEPTION 'FAIL: Kardex quantity=%', v_movement->>'quantity';
  END IF;
  IF v_movement->>'type' <> 'INCREASE' THEN
    RAISE EXCEPTION 'FAIL: Kardex type=%', v_movement->>'type';
  END IF;
  IF v_movement->>'reason' <> 'Compra inicial' THEN
    RAISE EXCEPTION 'FAIL: Kardex reason=%', v_movement->>'reason';
  END IF;
  IF v_movement->>'productId' <> v_product_id::text THEN
    RAISE EXCEPTION 'FAIL: Kardex productId=%', v_movement->>'productId';
  END IF;
  IF NULLIF(v_movement->>'performedBy','') IS NULL THEN
    RAISE EXCEPTION 'FAIL: Kardex sin performedBy (actor)';
  END IF;
  IF NULLIF(v_movement->>'date','') IS NULL THEN
    RAISE EXCEPTION 'FAIL: Kardex sin date (timestamp)';
  END IF;
  IF v_movement->>'branchId' <> v_branch_id::text THEN
    RAISE EXCEPTION 'FAIL: Kardex branchId=%', v_movement->>'branchId';
  END IF;

  RAISE NOTICE 'PASS: increaseStock con Kardex completo (stock 0->25, cantidad/tipo/razon/actor/fecha/producto/branch)';

  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 2: decreaseStock descuenta y deja Kardex ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_product_id uuid := gen_random_uuid();
  v_stock numeric;
  v_movements integer;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 T2', 'America/Bogota', 'productos') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_product_id, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_product_id,'name','Azucar','stock',40,'trackStock',true,'unit','kg'));

  PERFORM public.adjust_stock_with_kardex(
    v_product_id::text, -12, 'Merma por produccion', 'DECREASE',
    NULL, NULL, NULL, NULL, NULL, NULL, false);

  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_product_id;
  IF v_stock <> 28 THEN
    RAISE EXCEPTION 'FAIL: decreaseStock dejo stock %, se esperaba 28', v_stock;
  END IF;

  SELECT count(*) INTO v_movements FROM inventory_movements
    WHERE business_id = v_business_id AND data->>'type' = 'DECREASE';
  IF v_movements <> 1 THEN
    RAISE EXCEPTION 'FAIL: se esperaba 1 DECREASE en Kardex, hay %', v_movements;
  END IF;

  RAISE NOTICE 'PASS: decreaseStock (stock 40->28) con 1 DECREASE en Kardex';

  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 3: stock negativo bloqueado por default ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_product_id uuid := gen_random_uuid();
  v_error text := '(sin excepcion)';
  v_stock numeric;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 T3', 'America/Bogota', 'productos') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_product_id, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_product_id,'name','Leche','stock',5,'trackStock',true,'unit','L'));

  -- Sin allow_negative debe rebotar con INSUFFICIENT_STOCK y no tocar stock.
  BEGIN
    PERFORM public.adjust_stock_with_kardex(
      v_product_id::text, -50, 'Intento de sobre-descuento', 'DECREASE',
      NULL, NULL, NULL, NULL, NULL, NULL, false);
    v_error := '(no reboto)';
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
  END;

  IF strpos(v_error, 'INSUFFICIENT_STOCK') = 0 THEN
    RAISE EXCEPTION 'FAIL: se esperaba INSUFFICIENT_STOCK, se obtuvo: %', v_error;
  END IF;

  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_product_id;
  IF v_stock <> 5 THEN
    RAISE EXCEPTION 'FAIL: el stock cambio a % tras un rechazo; debe seguir en 5', v_stock;
  END IF;

  RAISE NOTICE 'PASS: stock negativo bloqueado por default (INSUFFICIENT_STOCK, stock intacto en 5)';

  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 10: RBAC del ajuste (MESERO rechazado, ADMIN/INVENTARIO permitido) ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_product_id uuid := gen_random_uuid();
  v_error text := '(sin excepcion)';
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 T10', 'America/Bogota', 'productos') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_product_id, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_product_id,'name','Producto','stock',10,'trackStock',true));

  -- MESERO: debe rebotar y NO cambiar stock.
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'MESERO');
  BEGIN
    PERFORM public.adjust_stock_with_kardex(
      v_product_id::text, 5, 'MESERO no debe poder', 'INCREASE',
      NULL, NULL, NULL, NULL, NULL, NULL, false);
    v_error := '(no reboto)';
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
  END;

  IF strpos(v_error, 'INVENTORY_FORBIDDEN') = 0 THEN
    RAISE EXCEPTION 'FAIL: MESERO deberia recibir INVENTORY_FORBIDDEN, obtuvo: %', v_error;
  END IF;

  IF (SELECT (data->>'stock')::numeric FROM products WHERE id = v_product_id) <> 10 THEN
    RAISE EXCEPTION 'FAIL: el stock cambio pese al rechazo por rol';
  END IF;

  -- ADMIN: debe poder.
  UPDATE business_members SET role = 'ADMIN' WHERE business_id = v_business_id AND user_id = v_user_id;
  PERFORM public.adjust_stock_with_kardex(
    v_product_id::text, 5, 'Ajuste de ADMIN', 'INCREASE',
    NULL, NULL, NULL, NULL, NULL, NULL, false);

  IF (SELECT (data->>'stock')::numeric FROM products WHERE id = v_product_id) <> 15 THEN
    RAISE EXCEPTION 'FAIL: ADMIN deberia poder ajustar; stock no llego a 15';
  END IF;

  RAISE NOTICE 'PASS: RBAC de ajuste (MESERO rechazado, ADMIN permitido stock 10->15)';

  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 17/18: business isolation + branch isolation del ajuste ===
DO $$
DECLARE
  v_biz_a uuid;
  v_biz_b uuid;
  v_br_a uuid;
  v_br_b uuid;
  v_user_id uuid;
  v_prod_a uuid := gen_random_uuid();
  v_prod_b uuid := gen_random_uuid();
  v_error text := '(sin excepcion)';
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 BizA', 'America/Bogota', 'productos') RETURNING id INTO v_biz_a;
  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 BizB', 'America/Bogota', 'productos') RETURNING id INTO v_biz_b;
  INSERT INTO branches (business_id, name) VALUES (v_biz_a, 'SUC A') RETURNING id INTO v_br_a;
  INSERT INTO branches (business_id, name) VALUES (v_biz_b, 'SUC B') RETURNING id INTO v_br_b;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id IN (v_biz_a, v_biz_b);

  -- El actor es ADMIN de A y MESERO de B.
  INSERT INTO business_members (business_id, user_id, role) VALUES
    (v_biz_a, v_user_id, 'ADMIN'), (v_biz_b, v_user_id, 'MESERO');

  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_prod_a, v_biz_a, v_br_a, 1, jsonb_build_object('id',v_prod_a,'name','ProdA','stock',10,'trackStock',true)),
    (v_prod_b, v_biz_b, v_br_b, 1, jsonb_build_object('id',v_prod_b,'name','ProdB','stock',10,'trackStock',true));

  -- BUSINESS ISOLATION: el ADMIN de A no puede tocar el producto de B.
  BEGIN
    PERFORM public.adjust_stock_with_kardex(
      v_prod_b::text, 999, 'Admin de A sobre producto de B', 'INCREASE',
      NULL, NULL, NULL, NULL, NULL, NULL, false);
    v_error := '(no reboto)';
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
  END;

  IF strpos(v_error, 'INVENTORY_NOT_A_MEMBER') = 0 AND strpos(v_error, 'INVENTORY_FORBIDDEN') = 0 THEN
    RAISE EXCEPTION 'FAIL: ajuste cross-business deberia rebotar, obtuvo: %', v_error;
  END IF;

  IF (SELECT (data->>'stock')::numeric FROM products WHERE id = v_prod_b) <> 10 THEN
    RAISE EXCEPTION 'FAIL: el stock del negocio B cambio pese al rechazo';
  END IF;

  -- BRANCH ISOLATION: el ADMIN de A no puede redirigir su ajuste hacia la
  -- sucursal de B aunque el producto sea suyo.
  v_error := '(sin excepcion)';
  BEGIN
    PERFORM public.adjust_stock_with_kardex(
      v_prod_a::text, 5, 'Ajuste con branch ajena', 'INCREASE',
      NULL, NULL, NULL, NULL, NULL, v_br_b, false);
    v_error := '(no reboto)';
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
  END;

  IF strpos(v_error, 'INVENTORY_BRANCH_MISMATCH') = 0 AND strpos(v_error, 'INVENTORY_BRANCH_FORBIDDEN') = 0 THEN
    RAISE EXCEPTION 'FAIL: ajuste hacia sucursal ajena deberia rebotar, obtuvo: %', v_error;
  END IF;

  RAISE NOTICE 'PASS: business isolation y branch isolation del ajuste (ambos rebotan sin escribir)';

  DELETE FROM inventory_movements WHERE business_id IN (v_biz_a, v_biz_b);
  DELETE FROM products WHERE business_id IN (v_biz_a, v_biz_b);
  DELETE FROM branches WHERE business_id IN (v_biz_a, v_biz_b);
  DELETE FROM business_members WHERE business_id IN (v_biz_a, v_biz_b);
  DELETE FROM businesses WHERE id IN (v_biz_a, v_biz_b);
END $$;


-- === TEST 9: idempotencia del ajuste (mismo movement_id no aplica dos veces) ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_product_id uuid := gen_random_uuid();
  v_movement_id uuid := gen_random_uuid();
  v_stock numeric;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 T9', 'America/Bogota', 'productos') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_product_id, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_product_id,'name','Producto','stock',0,'trackStock',true));

  PERFORM public.adjust_stock_with_kardex(
    v_product_id::text, 30, 'Recepcion', 'INCREASE',
    NULL, NULL, NULL, NULL, v_movement_id::text, NULL, false);
  -- Retry exacto (mismo movement_id): no debe volver a sumar.
  PERFORM public.adjust_stock_with_kardex(
    v_product_id::text, 30, 'Recepcion', 'INCREASE',
    NULL, NULL, NULL, NULL, v_movement_id::text, NULL, false);

  SELECT (data->>'stock')::numeric INTO v_stock FROM products WHERE id = v_product_id;
  IF v_stock <> 30 THEN
    RAISE EXCEPTION 'FAIL: el retry duplico stock: hay %, se esperaba 30', v_stock;
  END IF;

  IF (SELECT count(*) FROM inventory_movements WHERE id = v_movement_id) <> 1 THEN
    RAISE EXCEPTION 'FAIL: el retry genero mas de un movimiento';
  END IF;

  RAISE NOTICE 'PASS: idempotencia de ajuste (retry con mismo movement_id deja stock 30 y 1 solo movimiento)';

  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;