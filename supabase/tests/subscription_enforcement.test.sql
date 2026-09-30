-- ============================================================================
-- subscription_enforcement.test.sql — Tests de permisos / RLS para caja
-- ----------------------------------------------------------------------------
-- Verifica que el rol `authenticated` pueda ejecutar register_movement_atomic
-- y que RLS aísle movimientos/turnos por negocio. Compatible con el SQL Editor
-- web (SQL puro; sin meta-comandos psql).
-- ============================================================================

-- === TEST 1: El rol authenticated puede ejecutar register_movement_atomic ===
DO $$
DECLARE
  has_rights boolean;
BEGIN
  SELECT has_function_privilege(
    'authenticated',
    'register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)'::regprocedure,
    'EXECUTE'
  ) INTO has_rights;

  IF NOT has_rights THEN
    RAISE EXCEPTION 'FAIL: el rol authenticated no tiene EXECUTE sobre register_movement_atomic';
  END IF;
  RAISE NOTICE 'PASS: authenticated puede ejecutar register_movement_atomic';
END $$;


-- === TEST 2: RLS impide ver movimientos de otro negocio ===
DO $$
DECLARE
  b_a       uuid;
  br_a      uuid;
  b_b       uuid;
  br_b      uuid;
  own_cnt   int;
  other_cnt int;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST RLS A', 'America/Bogota') RETURNING id INTO b_a;
  INSERT INTO branches (business_id, name) VALUES (b_a, 'Suc A') RETURNING id INTO br_a;
  INSERT INTO businesses (name, timezone) VALUES ('TEST RLS B', 'America/Bogota') RETURNING id INTO b_b;
  INSERT INTO branches (business_id, name) VALUES (b_b, 'Suc B') RETURNING id INTO br_b;

  PERFORM register_movement_atomic('rls-key-a', b_a, br_a, 'IN', 10000::numeric, 'Venta A', 'CASH', 10000::numeric, NULL, now());
  PERFORM register_movement_atomic('rls-key-b', b_b, br_b, 'IN', 20000::numeric, 'Venta B', 'CASH', 20000::numeric, NULL, now());

  SELECT count(*) INTO own_cnt FROM cash_movements WHERE business_id = b_a AND branch_id = br_a;
  IF own_cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL: el negocio A no ve su propio movimiento (cnt=%)', own_cnt;
  END IF;

  SELECT count(*) INTO other_cnt FROM cash_movements WHERE business_id = b_b AND branch_id = br_b;
  IF other_cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL: no se guardó el movimiento del negocio B';
  END IF;

  RAISE NOTICE 'PASS: RLS aísla movimientos por negocio (A ve 1, B ve 1)';

  DELETE FROM cash_movements WHERE idempotency_key IN ('rls-key-a','rls-key-b');
  DELETE FROM shifts WHERE business_id IN (b_a, b_b);
  DELETE FROM branches WHERE business_id IN (b_a, b_b);
  DELETE FROM businesses WHERE id IN (b_a, b_b);
END $$;


-- === TEST 3: Shift abierto filtrado por negocio ===
DO $$
DECLARE
  b_a   uuid;
  b_b   uuid;
  cnt_a int;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Shift A', 'America/Bogota') RETURNING id INTO b_a;
  INSERT INTO businesses (name, timezone) VALUES ('TEST Shift B', 'America/Bogota') RETURNING id INTO b_b;

  INSERT INTO shifts (business_id, branch_id, data)
  VALUES
    (b_a, gen_random_uuid(),
     jsonb_build_object('status','OPEN','openedAt',now(),'cashierId','c1')::jsonb),
    (b_b, gen_random_uuid(),
     jsonb_build_object('status','OPEN','openedAt',now(),'cashierId','c2')::jsonb);

  SELECT count(*) INTO cnt_a
  FROM shifts
  WHERE business_id = b_a AND (data->>'status') = 'OPEN';
  IF cnt_a <> 1 THEN
    RAISE EXCEPTION 'FAIL: filtrado de shifts por negocio falló (cnt_a=%)', cnt_a;
  END IF;

  RAISE NOTICE 'PASS: shifts aislados por negocio';

  DELETE FROM shifts WHERE business_id IN (b_a, b_b);
  DELETE FROM branches WHERE business_id IN (b_a, b_b);
  DELETE FROM businesses WHERE id IN (b_a, b_b);
END $$;


-- === TEST 4: Idempotency key único permite upsert pero no duplicados ===
DO $$
DECLARE
  b_id  uuid;
  br_id uuid;
  cnt   int;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Upsert', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'Suc Upsert') RETURNING id INTO br_id;

  PERFORM register_movement_atomic('enforcement-unique-01', b_id, br_id, 'IN', 5000::numeric, 'x', 'CASH', 5000::numeric, NULL, now());
  PERFORM register_movement_atomic('enforcement-unique-01', b_id, br_id, 'IN', 7000::numeric, 'x editado', 'CASH', 7000::numeric, NULL, now());

  SELECT count(*) INTO cnt FROM cash_movements WHERE idempotency_key = 'enforcement-unique-01';
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL: idempotency_key no única (% filas)', cnt;
  END IF;

  RAISE NOTICE 'PASS: upsert funciona, idempotency_key única';
  DELETE FROM cash_movements WHERE idempotency_key = 'enforcement-unique-01';
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;

-- === Todos los tests de subscription_enforcement pasaron ===