-- ============================================================================
-- inventory_masked_stock.test.sql — Stock enmascarado durante un conteo ciego
-- ----------------------------------------------------------------------------
-- Requiere aplicadas:
--   - 20261102000000_inventory_count_sessions.sql
--   - 20261023120000_inventory_count_blind_security.sql
--   - 20261107000000_inventory_masked_stock_during_blind_count.sql
--
-- Cubre:
--   1  sin conteo abierto nadie se enmascara (stock real)
--   2  con conteo ciego abierto, INVENTARIO queda enmascarado:
--        · products, inventory_movements y la auditoría de inventario no devuelven filas por la API
--        · inventory_products_read entrega banda + estado, sin cifra real ni costo
--   3  el servidor sella createdByUserId (no se puede falsear)
--   4  ADMIN y CAJERO nunca se enmascaran
--   5  otro contador que no abrió el conteo no se enmascara
--   6  si el cliente devuelve una copia enmascarada, no se pisa stock ni costo
--   7  al cerrar el conteo todo vuelve a la normalidad
--   8  conteo anterior sin createdByUserId: falla cerrado (se enmascara)
--
-- Cada DO $$ limpia lo que crea. Usa el primer usuario de auth.users (y el
-- segundo, si existe, para el caso 5).
-- ============================================================================

-- === TEST 1-4, 6-8: flujo completo con un usuario que cambia de rol ===
DO $$
DECLARE
  v_user_id uuid;
  v_business_id uuid;
  v_branch_id uuid;
  v_a text := gen_random_uuid()::text;  -- stock 10.5  min 2  -> AVAILABLE
  v_b text := gen_random_uuid()::text;  -- stock 1     min 2  -> LOW
  v_c text := gen_random_uuid()::text;  -- stock 0     min 2  -> OUT
  v_session jsonb;
  v_session_id text;
  v_rows jsonb;
  v_row jsonb;
  v_count integer;
  v_flag boolean;
  v_stock numeric;
  v_cost numeric;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'MASK_TEST_SETUP_REQUIRED: se necesita un usuario real en auth.users.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('MASK T1', 'America/Bogota', 'productos') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'INVENTARIO');
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_a, v_business_id, v_branch_id, 1, jsonb_build_object('id', v_a, 'name', 'Harina', 'price', 5000, 'stock', 10.5, 'minStock', 2, 'purchasePrice', 3, 'trackStock', true, 'unit', 'kg')),
    (v_b, v_business_id, v_branch_id, 1, jsonb_build_object('id', v_b, 'name', 'Azucar', 'price', 4000, 'stock', 1, 'minStock', 2, 'purchasePrice', 2, 'trackStock', true, 'unit', 'kg')),
    (v_c, v_business_id, v_branch_id, 1, jsonb_build_object('id', v_c, 'name', 'Sal', 'price', 1000, 'stock', 0, 'minStock', 2, 'purchasePrice', 1, 'trackStock', true, 'unit', 'kg'));
  INSERT INTO inventory_movements (id, business_id, branch_id, version, data) VALUES
    (gen_random_uuid()::text, v_business_id, v_branch_id, 1, jsonb_build_object('productId', v_a, 'stockBefore', 8, 'stockAfter', 10.5));
  INSERT INTO audit_logs (id, business_id, branch_id, version, data) VALUES
    (gen_random_uuid()::text, v_business_id, v_branch_id, 1, jsonb_build_object('module', 'inventario', 'description', 'Editaste "Harina": costo: $3.000 → $3.500')),
    (gen_random_uuid()::text, v_business_id, v_branch_id, 1, jsonb_build_object('module', 'ventas', 'description', 'Venta #1'));

  -- ---------------------------------------------------------------- TEST 1
  SET LOCAL ROLE authenticated;
  IF public.inventory_count_user_is_masked(v_business_id) THEN
    RAISE EXCEPTION 'FAIL 1: sin conteo abierto no debe haber enmascaramiento';
  END IF;
  SELECT count(*) INTO v_count FROM public.products WHERE business_id = v_business_id;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'FAIL 1: sin conteo debe ver 3 productos, vio %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_logs WHERE business_id = v_business_id;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL 1: sin conteo debe ver las 2 filas de auditoría, vio %', v_count;
  END IF;
  SELECT jsonb_agg(r.data ORDER BY r.id) INTO v_rows FROM public.inventory_products_read(v_business_id, v_branch_id) r;
  IF jsonb_array_length(v_rows) <> 3 OR NOT (v_rows::text LIKE '%10.5%') THEN
    RAISE EXCEPTION 'FAIL 1: inventory_products_read debe traer stock real sin conteo: %', v_rows;
  END IF;
  IF v_rows::text LIKE '%stockMasked%' THEN
    RAISE EXCEPTION 'FAIL 1: sin conteo no debe haber stockMasked';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS 1: sin conteo abierto el stock sale real';

  -- ---------------------------------------------------------------- TEST 2
  SET LOCAL ROLE authenticated;
  v_session := public.inventory_count_start(
    v_business_id, v_branch_id, 'todo', '{"mode":"all"}'::jsonb, 'Todo', true, 'Pepito');
  v_session_id := v_session ->> 'id';
  RESET ROLE;

  -- ---------------------------------------------------------------- TEST 3
  IF (SELECT data ->> 'createdByUserId' FROM inventory_count_sessions WHERE id = v_session_id) IS DISTINCT FROM v_user_id::text THEN
    RAISE EXCEPTION 'FAIL 3: el servidor debe sellar createdByUserId = auth.uid()';
  END IF;
  -- El contador no recibe createdByUserId en lo que devuelve el servidor.
  IF v_session::text LIKE '%createdByUserId%' THEN
    RAISE EXCEPTION 'FAIL 3: createdByUserId no debe salir hacia quien cuenta: %', v_session;
  END IF;
  RAISE NOTICE 'PASS 3: createdByUserId lo pone el servidor y no se entrega al contador';

  SET LOCAL ROLE authenticated;
  IF NOT public.inventory_count_user_is_masked(v_business_id) THEN
    RAISE EXCEPTION 'FAIL 2: con su conteo ciego abierto debe quedar enmascarado';
  END IF;
  SELECT count(*) INTO v_count FROM public.products WHERE business_id = v_business_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL 2: la API directa de products no debe devolver filas, devolvió %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.inventory_movements WHERE business_id = v_business_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL 2: el Kardex no debe devolver filas (trae stockAfter exacto), devolvió %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.audit_logs WHERE business_id = v_business_id;
  IF v_count <> 1 OR EXISTS (SELECT 1 FROM public.audit_logs WHERE business_id = v_business_id AND data ->> 'module' = 'inventario') THEN
    RAISE EXCEPTION 'FAIL 2: la auditoría de inventario (trae costos) debe ocultarse; el resto no. Filas visibles: %', v_count;
  END IF;

  SELECT jsonb_agg(r.data ORDER BY r.id) INTO v_rows FROM public.inventory_products_read(v_business_id, v_branch_id) r;
  IF jsonb_array_length(v_rows) <> 3 THEN
    RAISE EXCEPTION 'FAIL 2: el POS debe seguir viendo el catálogo (3 productos), vio %', v_rows;
  END IF;
  IF v_rows::text LIKE '%10.5%' OR v_rows::text LIKE '%purchasePrice%' THEN
    RAISE EXCEPTION 'FAIL 2: se filtró stock real o costo: %', v_rows;
  END IF;
  SELECT x INTO v_row FROM jsonb_array_elements(v_rows) x WHERE x ->> 'name' = 'Harina';
  IF v_row ->> 'stockStatus' <> 'AVAILABLE' OR (v_row ->> 'stock')::numeric <> 3 OR (v_row -> 'stockMasked') <> 'true'::jsonb THEN
    RAISE EXCEPTION 'FAIL 2: Harina debe salir AVAILABLE con banda 3: %', v_row;
  END IF;
  SELECT x INTO v_row FROM jsonb_array_elements(v_rows) x WHERE x ->> 'name' = 'Azucar';
  IF v_row ->> 'stockStatus' <> 'LOW' OR (v_row ->> 'stock')::numeric <> 2 THEN
    RAISE EXCEPTION 'FAIL 2: Azucar debe salir LOW con banda 2: %', v_row;
  END IF;
  SELECT x INTO v_row FROM jsonb_array_elements(v_rows) x WHERE x ->> 'name' = 'Sal';
  IF v_row ->> 'stockStatus' <> 'OUT' OR (v_row ->> 'stock')::numeric <> 0 THEN
    RAISE EXCEPTION 'FAIL 2: Sal debe salir OUT con banda 0: %', v_row;
  END IF;
  -- Pedir un producto puntual y paginar también va enmascarado.
  SELECT jsonb_agg(r.data) INTO v_rows FROM public.inventory_products_read(v_business_id, v_branch_id, ARRAY[v_a]) r;
  IF jsonb_array_length(v_rows) <> 1 OR v_rows::text LIKE '%10.5%' THEN
    RAISE EXCEPTION 'FAIL 2: la lectura puntual debe ir enmascarada: %', v_rows;
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS 2: contador enmascarado (API directa vacía, lectura segura con banda y estado, sin costo)';

  -- ---------------------------------------------------------------- TEST 6
  UPDATE products
     SET data = (data - 'purchasePrice') || jsonb_build_object('stockMasked', true, 'stock', 3, 'name', 'Harina fina')
   WHERE id = v_a;
  SELECT (data ->> 'stock')::numeric, (data ->> 'purchasePrice')::numeric, (data -> 'stockMasked') IS NOT NULL
    INTO v_stock, v_cost, v_flag
    FROM products WHERE id = v_a;
  IF v_stock <> 10.5 OR v_cost <> 3 OR v_flag THEN
    RAISE EXCEPTION 'FAIL 6: una copia enmascarada no debe pisar stock/costo (stock=%, costo=%, bandera=%)', v_stock, v_cost, v_flag;
  END IF;
  IF (SELECT data ->> 'name' FROM products WHERE id = v_a) <> 'Harina fina' THEN
    RAISE EXCEPTION 'FAIL 6: el resto de la edición (nombre) sí debe guardarse';
  END IF;
  -- Un cambio legítimo de stock (RPC de inventario) no se revierte.
  UPDATE products SET data = jsonb_set(data, '{stock}', '7') WHERE id = v_a;
  IF (SELECT (data ->> 'stock')::numeric FROM products WHERE id = v_a) <> 7 THEN
    RAISE EXCEPTION 'FAIL 6: un ajuste real de stock no debe revertirse';
  END IF;
  UPDATE products SET data = jsonb_set(data, '{stock}', '10.5') WHERE id = v_a;
  RAISE NOTICE 'PASS 6: el trigger conserva stock y costo reales y no frena ajustes legítimos';

  -- ---------------------------------------------------------------- TEST 4
  UPDATE business_members SET role = 'ADMIN' WHERE business_id = v_business_id AND user_id = v_user_id;
  SET LOCAL ROLE authenticated;
  IF public.inventory_count_user_is_masked(v_business_id) THEN
    RAISE EXCEPTION 'FAIL 4: ADMIN nunca se enmascara';
  END IF;
  SELECT count(*) INTO v_count FROM public.products WHERE business_id = v_business_id;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'FAIL 4: ADMIN debe ver los 3 productos reales, vio %', v_count;
  END IF;
  SELECT jsonb_agg(r.data) INTO v_rows FROM public.inventory_products_read(v_business_id, v_branch_id) r;
  IF NOT (v_rows::text LIKE '%10.5%') OR v_rows::text LIKE '%stockMasked%' THEN
    RAISE EXCEPTION 'FAIL 4: ADMIN debe recibir stock real';
  END IF;
  RESET ROLE;

  UPDATE business_members SET role = 'CAJERO' WHERE business_id = v_business_id AND user_id = v_user_id;
  SET LOCAL ROLE authenticated;
  IF public.inventory_count_user_is_masked(v_business_id) THEN
    RAISE EXCEPTION 'FAIL 4: CAJERO no cuenta, no se enmascara';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS 4: ADMIN y CAJERO no se enmascaran';

  -- ---------------------------------------------------------------- TEST 7
  UPDATE business_members SET role = 'INVENTARIO' WHERE business_id = v_business_id AND user_id = v_user_id;
  UPDATE inventory_count_sessions
     SET data = data || '{"status":"CLOSED"}'::jsonb
   WHERE id = v_session_id;
  SET LOCAL ROLE authenticated;
  IF public.inventory_count_user_is_masked(v_business_id) THEN
    RAISE EXCEPTION 'FAIL 7: al cerrar el conteo debe dejar de estar enmascarado';
  END IF;
  SELECT count(*) INTO v_count FROM public.products WHERE business_id = v_business_id;
  SELECT jsonb_agg(r.data) INTO v_rows FROM public.inventory_products_read(v_business_id, v_branch_id) r;
  IF v_count <> 3 OR NOT (v_rows::text LIKE '%10.5%') THEN
    RAISE EXCEPTION 'FAIL 7: tras cerrar debe ver stock real otra vez';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS 7: al cerrar el conteo se levanta la máscara';

  -- ---------------------------------------------------------------- TEST 8
  PERFORM set_config('request.jwt.claim.sub', '', true);  -- sin uid: el trigger no sella
  INSERT INTO inventory_count_sessions (id, business_id, branch_id, version, data)
  VALUES (gen_random_uuid()::text, v_business_id, v_branch_id, 1,
          jsonb_build_object('status', 'OPEN', 'blind', true, 'lines', '[]'::jsonb, 'createdAt', now()));
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
  SET LOCAL ROLE authenticated;
  IF NOT public.inventory_count_user_is_masked(v_business_id) THEN
    RAISE EXCEPTION 'FAIL 8: un conteo abierto sin createdByUserId debe enmascarar (falla cerrado)';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS 8: conteos anteriores sin createdByUserId fallan cerrado';

  -- Limpieza
  DELETE FROM inventory_count_sessions WHERE business_id = v_business_id;
  DELETE FROM audit_logs WHERE business_id = v_business_id;
  DELETE FROM inventory_movements WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 5: otro contador que NO abrió el conteo no se enmascara ===
DO $$
DECLARE
  v_user1 uuid;
  v_user2 uuid;
  v_business_id uuid;
  v_branch_id uuid;
  v_a text := gen_random_uuid()::text;
BEGIN
  SELECT id INTO v_user1 FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  SELECT id INTO v_user2 FROM auth.users ORDER BY created_at ASC, id ASC OFFSET 1 LIMIT 1;
  IF v_user2 IS NULL THEN
    RAISE NOTICE 'SKIP 5: se necesita un segundo usuario en auth.users';
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_user1::text, true);

  INSERT INTO businesses (name, timezone, inventory_type) VALUES ('MASK T5', 'America/Bogota', 'productos') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'SUC') RETURNING id INTO v_branch_id;
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id = v_business_id;
  INSERT INTO business_members (business_id, user_id, role) VALUES
    (v_business_id, v_user1, 'INVENTARIO'),
    (v_business_id, v_user2, 'GERENTE');
  INSERT INTO products (id, business_id, branch_id, version, data) VALUES
    (v_a, v_business_id, v_branch_id, 1, jsonb_build_object('id', v_a, 'name', 'Harina', 'price', 5000, 'stock', 10.5, 'minStock', 2, 'trackStock', true));

  SET LOCAL ROLE authenticated;
  PERFORM public.inventory_count_start(v_business_id, v_branch_id, 'todo', '{"mode":"all"}'::jsonb, 'Todo', true, 'Pepito');
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_user2::text, true);
  SET LOCAL ROLE authenticated;
  IF public.inventory_count_user_is_masked(v_business_id) THEN
    RAISE EXCEPTION 'FAIL 5: quien no abrió ni tiene asignado el conteo no debe enmascararse';
  END IF;
  RESET ROLE;

  -- Si se le asigna el conteo, sí.
  UPDATE inventory_count_sessions
     SET data = data || jsonb_build_object('assignedTo', jsonb_build_array(v_user2::text))
   WHERE business_id = v_business_id;
  SET LOCAL ROLE authenticated;
  IF NOT public.inventory_count_user_is_masked(v_business_id) THEN
    RAISE EXCEPTION 'FAIL 5: con el conteo asignado (assignedTo) debe enmascararse';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS 5: solo se enmascara a quien abrió el conteo o lo tiene asignado';

  DELETE FROM inventory_count_sessions WHERE business_id = v_business_id;
  DELETE FROM products WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;