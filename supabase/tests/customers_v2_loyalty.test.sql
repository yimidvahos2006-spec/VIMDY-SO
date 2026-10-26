-- ============================================================================
-- customers_v2_loyalty.test.sql — Fase 1 de fidelización
-- ----------------------------------------------------------------------------
-- Verifica contra el esquema real (public.sales documental):
--   1) métricas de por vida (gasto neto, compras, primera/última compra);
--   2) nivel (columna generada) en los bordes 149/150 y 499/500 puntos;
--   3) reembolsos, estados que no cuentan, valores sucios, cliente genérico;
--   4) idempotencia del recálculo y reasignación/borrado de ventas;
--   5) la versión (bloqueo optimista) NO sube por un recálculo de métricas;
--   6) el trigger de sales nunca bloquea una venta;
--   7) privilegios por columna, RLS multi-negocio y rol para borrar;
--   8) unicidad de teléfono (E.164) y documento por negocio.
--
-- Requiere un usuario real en auth.users (mismo patrón que step6/step8).
-- Corre dentro de una transacción y hace ROLLBACK: no deja datos.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_biz_a constant uuid := 'c2000000-0000-4000-8000-00000000000a';
  v_biz_b constant uuid := 'c2000000-0000-4000-8000-00000000000b';
  v_biz_c constant uuid := 'c2000000-0000-4000-8000-00000000000c';
  v_branch_a uuid;
  c1 constant uuid := 'c2000000-0000-4000-8000-000000000101';
  c2 constant uuid := 'c2000000-0000-4000-8000-000000000102';
  c3 constant uuid := 'c2000000-0000-4000-8000-000000000103';
  r customers_v2%ROWTYPE;
  v_n integer;
  v_ver integer;
  v_upd timestamptz;
  v_code text;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'CUSTOMERS_V2_TEST_SETUP_REQUIRED: se necesita un usuario real en auth.users.';
  END IF;

  INSERT INTO businesses (id, name) VALUES (v_biz_a, 'Fid A'), (v_biz_b, 'Fid B'), (v_biz_c, 'Fid C');
  INSERT INTO branches (business_id, name) VALUES (v_biz_a, 'SUC A');
  SELECT id INTO v_branch_a FROM branches WHERE business_id = v_biz_a LIMIT 1;
  -- ADMIN en A, CAJERO en C, sin membresía en B.
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (v_biz_a, v_user, 'ADMIN'), (v_biz_c, v_user, 'CAJERO');

  INSERT INTO customers_v2 (id, business_id, name) VALUES
    (c1, v_biz_a, 'Cliente Uno'), (c2, v_biz_a, 'Cliente Dos'), (c3, v_biz_a, 'Cliente Tres');

  -- CASO 1: sin compras -> todo en cero, nivel bronce
  SELECT * INTO r FROM customers_v2 WHERE id = c1;
  IF r.lifetime_spent <> 0 OR r.lifetime_purchase_count <> 0 OR r.lifetime_points <> 0
     OR r.loyalty_tier <> 'bronce' OR r.last_purchase_at IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL caso 1: cliente sin compras debe estar en cero/bronce';
  END IF;

  -- CASO 2: una venta PAID con total numérico y otra CLOSED con total texto
  INSERT INTO sales (business_id, branch_id, data, created_at) VALUES
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', c1, 'status', 'PAID', 'total', 100000), '2026-03-01T10:00:00Z'),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', c1, 'status', 'CLOSED', 'total', '50000.50'), '2026-03-05T10:00:00Z');
  SELECT * INTO r FROM customers_v2 WHERE id = c1;
  IF r.lifetime_spent <> 150000.50 THEN RAISE EXCEPTION 'FAIL caso 2: gasto esperado 150000.50, obtenido %', r.lifetime_spent; END IF;
  IF r.lifetime_purchase_count <> 2 THEN RAISE EXCEPTION 'FAIL caso 2: compras esperadas 2, obtenido %', r.lifetime_purchase_count; END IF;
  IF r.lifetime_points <> 150 OR r.loyalty_tier <> 'plata' THEN
    RAISE EXCEPTION 'FAIL caso 2: esperado 150 puntos / plata, obtenido % / %', r.lifetime_points, r.loyalty_tier;
  END IF;
  IF r.first_purchase_at <> '2026-03-01T10:00:00Z' OR r.last_purchase_at <> '2026-03-05T10:00:00Z' THEN
    RAISE EXCEPTION 'FAIL caso 2: primera/última compra incorrectas (% / %)', r.first_purchase_at, r.last_purchase_at;
  END IF;

  -- CASO 3: bordes de nivel. 149.999,99 -> 149 pts bronce; 150.000 -> 150 pts plata
  INSERT INTO sales (id, business_id, branch_id, data) VALUES
    ('c2000000-0000-4000-8000-000000000201', v_biz_a, v_branch_a,
     jsonb_build_object('customerId', c2, 'status', 'PAID', 'total', 149999.99));
  SELECT * INTO r FROM customers_v2 WHERE id = c2;
  IF r.lifetime_points <> 149 OR r.loyalty_tier <> 'bronce' THEN
    RAISE EXCEPTION 'FAIL caso 3a: 149999.99 debe dar 149 pts bronce, obtenido % / %', r.lifetime_points, r.loyalty_tier;
  END IF;
  UPDATE sales SET data = jsonb_set(data, '{total}', '150000') WHERE id = 'c2000000-0000-4000-8000-000000000201';
  SELECT * INTO r FROM customers_v2 WHERE id = c2;
  IF r.lifetime_points <> 150 OR r.loyalty_tier <> 'plata' THEN
    RAISE EXCEPTION 'FAIL caso 3b: 150000 debe dar 150 pts plata, obtenido % / %', r.lifetime_points, r.loyalty_tier;
  END IF;
  UPDATE sales SET data = jsonb_set(data, '{total}', '499999.99') WHERE id = 'c2000000-0000-4000-8000-000000000201';
  SELECT * INTO r FROM customers_v2 WHERE id = c2;
  IF r.lifetime_points <> 499 OR r.loyalty_tier <> 'plata' THEN
    RAISE EXCEPTION 'FAIL caso 3c: 499999.99 debe dar 499 pts plata, obtenido % / %', r.lifetime_points, r.loyalty_tier;
  END IF;
  UPDATE sales SET data = jsonb_set(data, '{total}', '500000') WHERE id = 'c2000000-0000-4000-8000-000000000201';
  SELECT * INTO r FROM customers_v2 WHERE id = c2;
  IF r.lifetime_points <> 500 OR r.loyalty_tier <> 'oro' THEN
    RAISE EXCEPTION 'FAIL caso 3d: 500000 debe dar 500 pts oro, obtenido % / %', r.lifetime_points, r.loyalty_tier;
  END IF;

  -- CASO 4: reembolsos. Parcial (número + texto) resta; reembolso total por
  -- parciales deja la venta en 0 y NO cuenta como compra.
  INSERT INTO sales (id, business_id, branch_id, data) VALUES
    ('c2000000-0000-4000-8000-000000000301', v_biz_a, v_branch_a,
     jsonb_build_object('customerId', c3, 'status', 'PAID', 'total', 100000,
       'refunds', jsonb_build_array(jsonb_build_object('amount', 30000), jsonb_build_object('amount', '20000'))));
  SELECT * INTO r FROM customers_v2 WHERE id = c3;
  IF r.lifetime_spent <> 50000 OR r.lifetime_purchase_count <> 1 THEN
    RAISE EXCEPTION 'FAIL caso 4a: neto esperado 50000 / 1 compra, obtenido % / %', r.lifetime_spent, r.lifetime_purchase_count;
  END IF;
  UPDATE sales SET data = jsonb_set(data, '{refunds}',
      jsonb_build_array(jsonb_build_object('amount', 60000), jsonb_build_object('amount', 40000)))
   WHERE id = 'c2000000-0000-4000-8000-000000000301';
  SELECT * INTO r FROM customers_v2 WHERE id = c3;
  IF r.lifetime_spent <> 0 OR r.lifetime_purchase_count <> 0 OR r.last_purchase_at IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL caso 4b: venta devuelta por completo no debe contar (spent %, compras %)', r.lifetime_spent, r.lifetime_purchase_count;
  END IF;
  -- Reembolsos por encima del total: piso en 0, nunca negativo.
  UPDATE sales SET data = jsonb_set(data, '{refunds}', jsonb_build_array(jsonb_build_object('amount', 999999)))
   WHERE id = 'c2000000-0000-4000-8000-000000000301';
  SELECT * INTO r FROM customers_v2 WHERE id = c3;
  IF r.lifetime_spent <> 0 THEN RAISE EXCEPTION 'FAIL caso 4c: gasto nunca negativo, obtenido %', r.lifetime_spent; END IF;

  -- CASO 5: estados/ids que NO cuentan y valores sucios que NO rompen nada
  INSERT INTO sales (business_id, branch_id, data) VALUES
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', c3, 'status', 'PENDING_PAYMENT', 'total', 999)),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', c3, 'status', 'OPEN', 'total', 888)),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', c3, 'status', 'CANCELLED', 'total', 777)),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', c3, 'status', 'REFUNDED', 'total', 666)),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', c3, 'total', 555)),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', 'CLIENTE_GENERAL', 'status', 'PAID', 'total', 444)),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', '', 'status', 'PAID', 'total', 333)),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', 'cli-legacy-texto', 'status', 'PAID', 'total', 222)),
    (v_biz_a, v_branch_a, jsonb_build_object('status', 'PAID', 'total', 111)),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', c3, 'status', 'PAID', 'total', '1.000,50')),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', c3, 'status', 'PAID', 'total', 'NaN')),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', c3, 'status', 'PAID', 'total', jsonb_build_object('x', 1))),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', c3, 'status', 'PAID', 'total', -500)),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', c3, 'status', 'PAID', 'total', 1000, 'refunds', 'no-es-arreglo')),
    (v_biz_a, v_branch_a, jsonb_build_object('customerId', c3, 'status', 'PAID', 'total', 2000,
        'refunds', jsonb_build_array(jsonb_build_object('amount', -5), jsonb_build_object('amount', 'abc'), 7)));
  SELECT * INTO r FROM customers_v2 WHERE id = c3;
  -- Solo cuentan: 1000 (refunds no-arreglo se ignora) + 2000 (refunds sucios valen 0) = 3000, 2 compras.
  IF r.lifetime_spent <> 3000 OR r.lifetime_purchase_count <> 2 THEN
    RAISE EXCEPTION 'FAIL caso 5: esperado 3000 / 2 compras, obtenido % / %', r.lifetime_spent, r.lifetime_purchase_count;
  END IF;
  -- status en minúsculas/espacios cuenta igual (misma normalización que el dominio TS)
  INSERT INTO sales (business_id, branch_id, data)
  VALUES (v_biz_a, v_branch_a, jsonb_build_object('customerId', c3, 'status', '  paid ', 'total', 1000));
  SELECT * INTO r FROM customers_v2 WHERE id = c3;
  IF r.lifetime_spent <> 4000 THEN RAISE EXCEPTION 'FAIL caso 5b: status " paid " debe contar, gasto %', r.lifetime_spent; END IF;

  -- CASO 6: venta que pasa a REFUNDED / se reasigna / se borra
  UPDATE sales SET data = jsonb_set(data, '{status}', '"REFUNDED"')
   WHERE id = 'c2000000-0000-4000-8000-000000000201';
  SELECT * INTO r FROM customers_v2 WHERE id = c2;
  IF r.lifetime_spent <> 0 OR r.loyalty_tier <> 'bronce' THEN
    RAISE EXCEPTION 'FAIL caso 6a: venta REFUNDED debe salir del gasto (gasto %, nivel %)', r.lifetime_spent, r.loyalty_tier;
  END IF;
  UPDATE sales SET data = jsonb_set(jsonb_set(data, '{status}', '"PAID"'), '{customerId}', to_jsonb(c1::text))
   WHERE id = 'c2000000-0000-4000-8000-000000000201';
  SELECT * INTO r FROM customers_v2 WHERE id = c2;
  IF r.lifetime_spent <> 0 THEN RAISE EXCEPTION 'FAIL caso 6b: c2 ya no es dueño de la venta, gasto %', r.lifetime_spent; END IF;
  SELECT * INTO r FROM customers_v2 WHERE id = c1;
  IF r.lifetime_spent <> 150000.50 + 499999.99 + 0.01 THEN
    RAISE EXCEPTION 'FAIL caso 6b: c1 debe recibir la venta reasignada, gasto %', r.lifetime_spent;
  END IF;
  DELETE FROM sales WHERE id = 'c2000000-0000-4000-8000-000000000201';
  SELECT * INTO r FROM customers_v2 WHERE id = c1;
  IF r.lifetime_spent <> 150000.50 THEN RAISE EXCEPTION 'FAIL caso 6c: al borrar la venta c1 vuelve a 150000.50, obtenido %', r.lifetime_spent; END IF;

  -- CASO 7: idempotencia. Recalcular de nuevo no cambia nada (0 filas) ni valores.
  IF public.refresh_customers_v2_metrics(NULL) <> 0 THEN
    RAISE EXCEPTION 'FAIL caso 7: un segundo recálculo no debe cambiar ninguna fila';
  END IF;
  SELECT * INTO r FROM customers_v2 WHERE id = c1;
  IF r.lifetime_spent <> 150000.50 THEN RAISE EXCEPTION 'FAIL caso 7: el recálculo cambió el gasto a %', r.lifetime_spent; END IF;

  -- CASO 8: el recálculo NO sube version ni updated_at; una edición real sí.
  SELECT version, updated_at INTO v_ver, v_upd FROM customers_v2 WHERE id = c1;
  INSERT INTO sales (business_id, branch_id, data)
  VALUES (v_biz_a, v_branch_a, jsonb_build_object('customerId', c1, 'status', 'PAID', 'total', 1000));
  SELECT * INTO r FROM customers_v2 WHERE id = c1;
  IF r.version <> v_ver OR r.updated_at <> v_upd THEN
    RAISE EXCEPTION 'FAIL caso 8a: un recálculo de métricas no debe cambiar version/updated_at';
  END IF;
  UPDATE customers_v2 SET name = 'Cliente Uno Editado' WHERE id = c1;
  SELECT * INTO r FROM customers_v2 WHERE id = c1;
  IF r.version <> v_ver + 1 THEN RAISE EXCEPTION 'FAIL caso 8b: editar el nombre debe subir version a %, obtenido %', v_ver + 1, r.version; END IF;
  -- Si el cliente intenta fijar su propia versión, el servidor la ignora.
  UPDATE customers_v2 SET name = 'Cliente Uno v3', version = 999 WHERE id = c1;
  SELECT * INTO r FROM customers_v2 WHERE id = c1;
  IF r.version <> v_ver + 2 THEN RAISE EXCEPTION 'FAIL caso 8c: version debe ser % (no 999), obtenido %', v_ver + 2, r.version; END IF;

  -- CASO 9: loyalty_tier es generada: nadie la escribe
  BEGIN
    UPDATE customers_v2 SET loyalty_tier = 'oro' WHERE id = c1;
    RAISE EXCEPTION 'FAIL caso 9: loyalty_tier no debe poder escribirse';
  EXCEPTION WHEN generated_always THEN NULL;
  END;

  -- CASO 10: el trigger de sales NUNCA bloquea una venta
  ALTER TABLE customers_v2 ADD CONSTRAINT tmp_force_refresh_failure CHECK (lifetime_spent < 1) NOT VALID;
  INSERT INTO sales (id, business_id, branch_id, data)
  VALUES ('c2000000-0000-4000-8000-000000000401', v_biz_a, v_branch_a,
          jsonb_build_object('customerId', c1, 'status', 'PAID', 'total', 7000));
  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = 'c2000000-0000-4000-8000-000000000401') THEN
    RAISE EXCEPTION 'FAIL caso 10: la venta debe guardarse aunque el recálculo falle';
  END IF;
  ALTER TABLE customers_v2 DROP CONSTRAINT tmp_force_refresh_failure;
  PERFORM public.refresh_customers_v2_metrics(ARRAY[c1]);
  SELECT * INTO r FROM customers_v2 WHERE id = c1;
  IF r.lifetime_spent <> 150000.50 + 1000 + 7000 THEN
    RAISE EXCEPTION 'FAIL caso 10: la reparación debe dejar 158000.50, obtenido %', r.lifetime_spent;
  END IF;

  -- CASO 11: privilegios por columna (rol authenticated)
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE customers_v2 SET lifetime_points = 999999 WHERE id = c1;
    RESET ROLE;
    RAISE EXCEPTION 'FAIL caso 11a: authenticated no debe poder escribir lifetime_points';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE;
  END;
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO customers_v2 (business_id, name, lifetime_spent) VALUES (v_biz_a, 'Tramposo', 1);
    RESET ROLE;
    RAISE EXCEPTION 'FAIL caso 11b: authenticated no debe poder insertar lifetime_spent';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE;
  END;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.refresh_customers_v2_metrics(NULL);
    RESET ROLE;
    RAISE EXCEPTION 'FAIL caso 11c: authenticated no debe ejecutar refresh_customers_v2_metrics';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE;
  END;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.backfill_customers_v2_from_legacy();
    RESET ROLE;
    RAISE EXCEPTION 'FAIL caso 11d: authenticated no debe ejecutar backfill_customers_v2_from_legacy';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE;
  END;

  -- CASO 12: RLS multi-negocio y rol para borrar
  INSERT INTO customers_v2 (id, business_id, name) VALUES
    ('c2000000-0000-4000-8000-000000000501', v_biz_b, 'Ajeno B'),
    ('c2000000-0000-4000-8000-000000000502', v_biz_c, 'De C');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM customers_v2 WHERE business_id = v_biz_b;
  IF v_n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'FAIL caso 12a: no debe ver clientes de un negocio ajeno (vio %)', v_n; END IF;
  SELECT count(*) INTO v_n FROM customers_v2 WHERE business_id = v_biz_a;
  IF v_n <> 3 THEN RESET ROLE; RAISE EXCEPTION 'FAIL caso 12b: debe ver los 3 clientes de A (vio %)', v_n; END IF;
  RESET ROLE;
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO customers_v2 (business_id, name) VALUES (v_biz_b, 'Intruso');
    RESET ROLE;
    RAISE EXCEPTION 'FAIL caso 12c: no debe poder insertar en un negocio ajeno';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE;
  END;
  -- CAJERO en C puede crear/editar, pero NO borrar (el DELETE no afecta filas).
  SET LOCAL ROLE authenticated;
  INSERT INTO customers_v2 (business_id, name) VALUES (v_biz_c, 'Creado por cajero');
  DELETE FROM customers_v2 WHERE id = 'c2000000-0000-4000-8000-000000000502';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL caso 12d: un CAJERO no debe poder borrar clientes'; END IF;
  -- ADMIN en A sí puede borrar.
  SET LOCAL ROLE authenticated;
  DELETE FROM customers_v2 WHERE id = c3;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RESET ROLE;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL caso 12e: un ADMIN debe poder borrar un cliente'; END IF;

  -- CASO 13: unicidad y formato E.164 / documento
  UPDATE customers_v2 SET phone_e164 = '+573001234567' WHERE id = c1;
  BEGIN
    UPDATE customers_v2 SET phone_e164 = '+573001234567' WHERE id = c2;
    RAISE EXCEPTION 'FAIL caso 13a: mismo teléfono E.164 en el mismo negocio debe fallar';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO customers_v2 (business_id, name, phone_e164) VALUES (v_biz_b, 'Mismo tel otro negocio', '+573001234567');
  INSERT INTO customers_v2 (business_id, name) VALUES (v_biz_a, 'Sin tel 1'), (v_biz_a, 'Sin tel 2');
  BEGIN
    UPDATE customers_v2 SET phone_e164 = '3001234567' WHERE id = c2;
    RAISE EXCEPTION 'FAIL caso 13b: un teléfono sin formato E.164 debe fallar el CHECK';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE customers_v2 SET document_type = 'NIT', document_number = '900123456-7', document_key = '900123456' WHERE id = c1;
  BEGIN
    UPDATE customers_v2 SET document_type = 'NIT', document_number = '900.123.456-7', document_key = '900123456' WHERE id = c2;
    RAISE EXCEPTION 'FAIL caso 13c: mismo documento (tipo+llave) en el mismo negocio debe fallar';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  UPDATE customers_v2 SET document_type = 'CC', document_number = '900123456', document_key = '900123456' WHERE id = c2;
  BEGIN
    UPDATE customers_v2 SET document_key = 'X' WHERE id = c2 AND false;
    UPDATE customers_v2 SET document_type = NULL WHERE id = c2;
    RAISE EXCEPTION 'FAIL caso 13d: document_key sin tipo debe fallar el CHECK';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'CUSTOMERS_V2 LOYALTY: todos los casos PASS';
END $$;

ROLLBACK;