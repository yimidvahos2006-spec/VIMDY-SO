-- ============================================================================
-- step4_inventory_sale_recipe.test.sql — Paso 4: venta, recetas y produccion
-- ----------------------------------------------------------------------------
-- Cubre:
--   5   create_sale_fulfillment_atomic consume stock exactamente una vez
--   6   retry de la misma venta NO vuelve a consumir (idempotencia de venta)
--   7   rollback transaccional: pago/insuficiencia no deja stock consumido
--   14  receta: consume ingredientes definidos, respeta stock, no de mas
--   15  produccion por lotes: atomicidad e idempotencia
--   20  auditoria de movimientos
--
-- Requiere aplicadas:
--   - 20260930190000_atomic_inventory_batch.sql
--   - 20260930193000_atomic_sale_fulfillment.sql
--   - 20261002000000_atomic_inventory_transfer_and_production.sql
--   - 20261011000000_step4_inventory_adjust_rbac_tenant_isolation.sql
-- ============================================================================

-- === TEST USER SETUP ===
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'STEP4_SALE_TEST_SETUP_REQUIRED: se necesita un usuario real en auth.users.';
  END IF;
  PERFORM set_config('vimdy.step4_test_user_id', v_user_id::text, false);
  RAISE NOTICE 'STEP4 SALE TEST USER: %', v_user_id;
END $$;


-- === TEST 5/6: la venta consume una vez; el retry no vuelve a consumir ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_flour uuid := gen_random_uuid();
  v_bread uuid := gen_random_uuid();
  v_stock_flour numeric;
  v_movements integer;
  v_sale_id uuid;
  v_result jsonb;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 Venta', 'America/Bogota', 'ingredientes') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');

  -- Harina: 100 kg. Pan: producto con receta ON_DEMAND que usa 0.5 kg por unidad.
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_flour, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_flour,'name','Harina','price',3000,'stock',100,'trackStock',true,'isIngredient',true,'unit','kg')),
    (v_bread, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_bread,'name','Pan','price',4000,'stock',0,'trackStock',false,
        'productionMode','ON_DEMAND','requiresKitchen',true,
        'recipe',jsonb_build_array(jsonb_build_object('productId',v_flour,'quantity',0.5))));

  v_sale_id := gen_random_uuid();

  -- Venta de 4 panes => debe consumir 2 kg de harina (100 -> 98).
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'p4-sale-idem-01',
    jsonb_build_object('id',v_sale_id,'type','QUICK',
      'items',jsonb_build_array(jsonb_build_object('productId',v_bread,'quantity',4))));

  SELECT (data->>'stock')::numeric INTO v_stock_flour FROM products WHERE id = v_flour;
  IF v_stock_flour <> 98 THEN
    RAISE EXCEPTION 'FAIL: la venta no consumio 2 kg; harina = % (se esperaba 98)', v_stock_flour;
  END IF;

  -- Retry EXACTO de la misma venta: la RPC es idempotente y no debe volver a descontar.
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'p4-sale-idem-01',
    jsonb_build_object('id',v_sale_id,'type','QUICK',
      'items',jsonb_build_array(jsonb_build_object('productId',v_bread,'quantity',4))));

  SELECT (data->>'stock')::numeric INTO v_stock_flour FROM products WHERE id = v_flour;
  IF v_stock_flour <> 98 THEN
    RAISE EXCEPTION 'FAIL: el retry de la venta consumio de nuevo; harina = % (se esperaba 98)', v_stock_flour;
  END IF;

  IF COALESCE((v_result->>'idempotent')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: el retry de la venta no fue reportado como idempotente';
  END IF;

  SELECT count(*) INTO v_movements FROM inventory_movements
    WHERE business_id = v_business_id AND data->>'reason' LIKE 'SALE %';
  IF v_movements <> 1 THEN
    RAISE EXCEPTION 'FAIL: se esperaba 1 solo movimiento de venta en Kardex, hay %', v_movements;
  END IF;

  RAISE NOTICE 'PASS: venta consume una vez (harina 100->98) y el retry NO vuelve a consumir (sigue 98, 1 movimiento)';

  DELETE FROM kitchen_orders WHERE business_id = v_business_id;
  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE business_id = v_business_id);
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM sale_fulfillment_operations WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 7/14: rollback por stock insuficiente + receta no consume de mas ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_flour uuid := gen_random_uuid();
  v_sugar uuid := gen_random_uuid();
  v_cake uuid := gen_random_uuid();
  v_flour_stock numeric;
  v_sugar_stock numeric;
  v_sales integer;
  v_movements integer;
  v_result jsonb;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 Rollback', 'America/Bogota', 'ingredientes') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');

  -- Harina abundante, azucar insuficiente: la receta exige ambos.
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_flour, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_flour,'name','Harina','price',3000,'stock',100,'trackStock',true,'isIngredient',true)),
    (v_sugar, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_sugar,'name','Azucar','price',4000,'stock',1,'trackStock',true,'isIngredient',true)),
    (v_cake, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_cake,'name','Pastel','price',9000,'stock',0,'trackStock',false,
        'productionMode','ON_DEMAND','requiresKitchen',true,
        'recipe',jsonb_build_array(
          jsonb_build_object('productId',v_flour,'quantity',0.5),
          jsonb_build_object('productId',v_sugar,'quantity',0.2))));

  -- 10 pasteles piden 2 kg de azucar pero hay 1: la RPC debe rechazarse.
  -- create_sale_fulfillment_atomic NO lanza excepcion: captura el error y lo
  -- devuelve como { success:false, code, error }. Por eso se verifica el
  -- resultado devuelto, no un sqlerrm.
  v_result := public.create_sale_fulfillment_atomic(
    v_business_id, v_branch_id, 'p4-rollback-01',
    jsonb_build_object('id',gen_random_uuid(),'type','QUICK',
      'items',jsonb_build_array(jsonb_build_object('productId',v_cake,'quantity',10))));

  IF COALESCE((v_result->>'success')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: la venta debio rechazarse por stock insuficiente; resultado: %', v_result::text;
  END IF;

  IF strpos(COALESCE(v_result->>'error',''), 'INSUFFICIENT_STOCK') = 0 THEN
    RAISE EXCEPTION 'FAIL: se esperaba INSUFFICIENT_STOCK, resultado: %', v_result::text;
  END IF;

  -- ROLLBACK: ni la harina (que era suficiente) debe haber consumido, ni la
  -- venta debe existir. Este es el punto clave de atomicidad.
  SELECT (data->>'stock')::numeric INTO v_flour_stock FROM products WHERE id = v_flour;
  IF v_flour_stock <> 100 THEN
    RAISE EXCEPTION 'FAIL: rollback incompleto: la harina se desconto a % pese al fallo', v_flour_stock;
  END IF;

  SELECT (data->>'stock')::numeric INTO v_sugar_stock FROM products WHERE id = v_sugar;
  IF v_sugar_stock <> 1 THEN
    RAISE EXCEPTION 'FAIL: rollback incompleto: el azucar quedo en %', v_sugar_stock;
  END IF;

  SELECT count(*) INTO v_sales FROM sales WHERE business_id = v_business_id;
  IF v_sales <> 0 THEN
    RAISE EXCEPTION 'FAIL: la venta fallida quedo persistida (% ventas)', v_sales;
  END IF;

  SELECT count(*) INTO v_movements FROM inventory_movements WHERE business_id = v_business_id;
  IF v_movements <> 0 THEN
    RAISE EXCEPTION 'FAIL: rollback incompleto: quedaron % movimientos de Kardex', v_movements;
  END IF;

  RAISE NOTICE 'PASS: rollback por stock insuficiente (harina intacta 100, azucar 1, 0 ventas, 0 movimientos)';

  DELETE FROM kitchen_orders WHERE business_id = v_business_id;
  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE business_id = v_business_id);
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM sale_fulfillment_operations WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 15: produccion por lotes consume insumos e ingresa el producto ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_flour uuid := gen_random_uuid();
  v_sugar uuid := gen_random_uuid();
  v_butter uuid := gen_random_uuid();
  v_dough uuid := gen_random_uuid();
  v_loaf uuid := gen_random_uuid();
  v_flour_stock numeric;
  v_sugar_stock numeric;
  v_butter_stock numeric;
  v_dough_stock numeric;
  v_loaf_stock numeric;
  v_result jsonb;
  v_audits integer;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('P4 Produccion', 'America/Bogota', 'ingredientes') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');

  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_flour, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_flour,'name','Harina','price',2000,'stock',100,'trackStock',true,'isIngredient',true)),
    (v_sugar, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_sugar,'name','Azucar','price',2500,'stock',100,'trackStock',true,'isIngredient',true)),
    (v_butter, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_butter,'name','Mantequilla','price',9000,'stock',100,'trackStock',true,'isIngredient',true)),
    (v_dough, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_dough,'name','Masa','price',0,'stock',0,'trackStock',false,
        'productionMode','ON_DEMAND','isIngredient',true,
        'recipe',jsonb_build_array(
          jsonb_build_object('productId',v_flour,'quantity',0.5),
          jsonb_build_object('productId',v_sugar,'quantity',0.1)))),
    (v_loaf, v_business_id, v_branch_id, 1,
      jsonb_build_object('id',v_loaf,'name','Pan BATCH','price',6000,'stock',0,'trackStock',true,
        'productionMode','BATCH',
        'recipe',jsonb_build_array(
          jsonb_build_object('productId',v_dough,'quantity',1),
          jsonb_build_object('productId',v_butter,'quantity',0.2))));

  -- Producir 10 panes: usa 10 de masa -> cada masa consume 0.5 harina y 0.1 azucar
  -- => 5 harina, 1 azucar, 2 mantequilla. Debeingressar 10 de Pan BATCH.
  -- La firma real es (operation_id, product_id, branch_id, quantity, performed_by):
  -- el negocio NO se pasa, la RPC lo deriva del producto. Eso es justamente lo
  -- que impide que un caller redirija la operacion a otro negocio.
  v_result := public.produce_batch_atomic(
    'p4-produce-01', v_loaf, v_branch_id, 10, v_user_id::text);

  -- produce_batch_atomic devuelve el SNAPSHOT jsonb de los productos afectados
  -- (array), no un objeto {success}. El exito se verifica por el efecto real
  -- sobre el stock, que es lo que importa.
  IF jsonb_typeof(v_result) <> 'array' THEN
    RAISE EXCEPTION 'FAIL: se esperaba un array de productos, se obtuvo: %', left(v_result::text, 120);
  END IF;

  SELECT (data->>'stock')::numeric INTO v_flour_stock FROM products WHERE id = v_flour;
  SELECT (data->>'stock')::numeric INTO v_sugar_stock FROM products WHERE id = v_sugar;
  SELECT (data->>'stock')::numeric INTO v_butter_stock FROM products WHERE id = v_butter;
  SELECT (data->>'stock')::numeric INTO v_loaf_stock FROM products WHERE id = v_loaf;

  IF v_flour_stock <> 95 THEN RAISE EXCEPTION 'FAIL: harina = % (esperado 95)', v_flour_stock; END IF;
  IF v_sugar_stock <> 99 THEN RAISE EXCEPTION 'FAIL: azucar = % (esperado 99)', v_sugar_stock; END IF;
  IF v_butter_stock <> 98 THEN RAISE EXCEPTION 'FAIL: mantequilla = % (esperado 98)', v_butter_stock; END IF;
  IF v_loaf_stock <> 10 THEN RAISE EXCEPTION 'FAIL: pan BATCH = % (esperado 10)', v_loaf_stock; END IF;

  -- Idempotencia de produccion: mismo operation_id no debe volver a consumir.
  v_result := public.produce_batch_atomic('p4-produce-01', v_loaf, v_branch_id, 10, v_user_id::text);
  IF jsonb_typeof(v_result) <> 'array' THEN
    RAISE EXCEPTION 'FAIL: el retry de produccion no devolvio el snapshot esperado: %', left(v_result::text,120);
  END IF;

  SELECT (data->>'stock')::numeric INTO v_flour_stock FROM products WHERE id = v_flour;
  SELECT (data->>'stock')::numeric INTO v_loaf_stock FROM products WHERE id = v_loaf;
  IF v_flour_stock <> 95 OR v_loaf_stock <> 10 THEN
    RAISE EXCEPTION 'FAIL: el retry de produccion duplico efectos (harina=%, pan=%)', v_flour_stock, v_loaf_stock;
  END IF;

  -- TEST 20: auditoria de la produccion.
  SELECT count(*) INTO v_audits FROM audit_logs
    WHERE business_id = v_business_id
      AND data->>'action' = 'INVENTORY_BATCH_PRODUCED';
  IF v_audits <> 1 THEN
    RAISE EXCEPTION 'FAIL: se esperaba 1 auditoria de produccion, hay %', v_audits;
  END IF;

  RAISE NOTICE 'PASS: produccion batch atomica e idempotente (harina 100->95, azucar 100->99, mantequilla 100->98, pan 0->10, retry sin efecto, 1 auditoria)';

  DELETE FROM audit_logs WHERE business_id = v_business_id;
  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;