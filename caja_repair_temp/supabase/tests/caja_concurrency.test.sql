-- ============================================================================
-- caja_concurrency.test.sql — Tests de atomicidad e idempotencia a nivel DB
-- ----------------------------------------------------------------------------
-- Verifica el hardening de caja en:
--   - supabase/migrations/20260923190000_caja_final_hardening.sql  (RPC + RBAC)
--   - supabase/migrations/20260923_cash_hardening.sql              (índices + constraint)
--
-- Requiere: la migration aplicada en Supabase (project upoztxlcudrqhnjwjgho).
-- Cada test crea y borra su business/branch real (FK-safe) y usa RAISE EXCEPTION
-- para fallar con mensaje claro. Compatible con el SQL Editor web (SQL puro).
--
-- RBAC: has_business_role() requiere business_members.role = 'ADMIN' o 'CAJERO'.
-- Los tests positivos usan role='CAJERO'. El test de denegación (TEST I)
-- usa role='MESERO' y espera CAJA_FORBIDDEN.
-- ============================================================================

-- UUID de usuario de prueba (válido, reutilizable entre tests).
-- Cada DO $$ es una transacción independiente, por lo que el contexto JWT
-- debe configurarse dentro de cada bloque.
-- UUID válido: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11

-- === TEST USER SETUP ===
-- Crea un usuario de prueba REAL en auth.users (requerido por FK
-- business_members.user_id → auth.users(id)). Este usuario existe en
-- todos los entornos y se usa como request.jwt.claim.sub en cada test.
-- ON CONFLICT (id) DO NOTHING: si ya existe, no hace nada.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'test-user@vimdy.test', 'test-password-hash', now())
ON CONFLICT (id) DO NOTHING;

-- === TEST 1: Idempotencia de register_movement_atomic (mismo key → 1 fila) ===
DO $$
DECLARE
  cnt     int;
  b_id    uuid;
  br_id   uuid;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Caja', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal') RETURNING id INTO br_id;

  -- Setup: contexto JWT válido + membresía con rol CAJERO (permisos caja)
  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'CAJERO');

  PERFORM register_movement_atomic(
    'idempotency-test-01', b_id, br_id, 'IN', 60000::numeric,
    'Venta test idempotencia', 'CASH', 60000::numeric, 'sale-test-01', now()
  );
  PERFORM register_movement_atomic(
    'idempotency-test-01', b_id, br_id, 'IN', 60000::numeric,
    'Venta test idempotencia', 'CASH', 60000::numeric, 'sale-test-01', now()
  );

  SELECT count(*) INTO cnt FROM cash_movements WHERE idempotency_key = 'idempotency-test-01';
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL: se esperaba 1 movimiento idempotente, se encontraron % (doble conteo de caja)', cnt;
  END IF;

  RAISE NOTICE 'PASS: idempotencia — un solo movimiento para idempotency_key repetido';

  DELETE FROM cash_movements WHERE idempotency_key = 'idempotency-test-01';
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 2: Idempotency_key nulo RECHAZA (RPC exige clave no nula) ===
-- La nueva RPC register_movement_atomic exige idempotency_key NOT NULL.
-- Esto previene movimientos anónimos sin rastreo idempotente.
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  raised  boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Caja Manual Nulo', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal Manual') RETURNING id INTO br_id;

  -- Setup: contexto JWT válido + membresía con rol CAJERO
  -- El usuario debe pasar auth.uid(), membresía y RBAC antes de llegar a la
  -- validación de idempotency_key.
  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'CAJERO');

  BEGIN
    PERFORM register_movement_atomic(
      NULL, b_id, br_id, 'OUT', 5000::numeric,
      'Retiro sin clave idempotente', 'CASH', 5000::numeric, NULL, now()
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_IDEMPOTENCY_REQUIRED') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería rechazar idempotency_key NULL';
  END IF;

  RAISE NOTICE 'PASS: idempotency_key NULL es rechazado por la RPC';

  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 3: Constraint shifts_single_open_per_business_branch ===
DO $$
DECLARE
  b_id  uuid;
  br_id uuid;
  dup   boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Shifts', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal Shifts') RETURNING id INTO br_id;

  -- Setup: contexto JWT válido + membresía (para RLS del INSERT directo a shifts)
  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'CAJERO');

  INSERT INTO shifts (business_id, branch_id, data)
  VALUES (b_id, br_id,
          jsonb_build_object('status','OPEN','openedAt',now(),'cashierId','cashier-1'));

  BEGIN
    INSERT INTO shifts (business_id, branch_id, data)
    VALUES (b_id, br_id,
            jsonb_build_object('status','OPEN','openedAt',now(),'cashierId','cashier-2'));
    dup := false;
  EXCEPTION
    WHEN unique_violation THEN
      dup := true;
  END;

  IF NOT dup THEN
    RAISE EXCEPTION 'FAIL: se permitió un segundo shift abierto (race condition no bloqueada)';
  END IF;

  RAISE NOTICE 'PASS: constraint bloquea segundo shift abierto por sucursal';

  DELETE FROM shifts WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 4: Índices de performance existen ===
-- Índice de idempotencia ahora es composite (business_id, branch_id, idempotency_key)
DO $$
DECLARE
  c1 int; c2 int; c3 int;
BEGIN
  SELECT count(*) INTO c1 FROM pg_indexes WHERE indexname = 'cash_movements_business_branch_idempotency_idx';
  SELECT count(*) INTO c2 FROM pg_indexes WHERE indexname = 'cash_movements_date_idx';
  SELECT count(*) INTO c3 FROM pg_indexes WHERE indexname = 'cash_movements_sale_idx';
  IF c1 <> 1 OR c2 <> 1 OR c3 <> 1 THEN
    RAISE EXCEPTION 'FAIL: faltan índices. composite_idx=% date_idx=% sale_idx=%', c1, c2, c3;
  END IF;
  RAISE NOTICE 'PASS: índices de caja presentes (incluido composite multi-tenant)';
END $$;


-- === TEST 5: Doble cobro concurrente no duplica (misma clave) ===
DO $$
DECLARE
  cnt     int;
  b_id    uuid;
  br_id   uuid;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Doble Cobro', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal Doble') RETURNING id INTO br_id;

  -- Setup: contexto JWT válido + membresía con rol CAJERO
  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'CAJERO');

  PERFORM register_movement_atomic(
    'idempotency-double-pay-01', b_id, br_id, 'IN', 150000::numeric,
    'Venta doble cobro', 'CASH', 150000::numeric, 'sale-double-01', now()
  );
  PERFORM register_movement_atomic(
    'idempotency-double-pay-01', b_id, br_id, 'IN', 150000::numeric,
    'Venta doble cobro', 'CASH', 150000::numeric, 'sale-double-01', now()
  );

  SELECT count(*) INTO cnt FROM cash_movements WHERE idempotency_key = 'idempotency-double-pay-01';
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL: doble cobro duplicó movimiento (% filas)', cnt;
  END IF;

  RAISE NOTICE 'PASS: doble cobro concurrente no duplica movimiento de caja';
  DELETE FROM cash_movements WHERE idempotency_key = 'idempotency-double-pay-01';
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST A: register_movement_atomic requiere auth.uid() (sin JWT → error) ===
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  raised  boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Auth', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal Auth') RETURNING id INTO br_id;

  -- Simular sin JWT: limpiar el claim sub
  PERFORM set_config('request.jwt.claim.sub', '', true);

  BEGIN
    PERFORM register_movement_atomic(
      'auth-test-01', b_id, br_id, 'IN', 10000::numeric,
      'Sin auth', 'CASH', 10000::numeric, NULL, now()
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_AUTH_REQUIRED') > 0 THEN
        raised := true;
      END IF;
  END;

  -- Restaurar sub válido para tests posteriores (no persiste entre transacciones)
  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería requerir auth.uid()';
  END IF;

  RAISE NOTICE 'PASS: register_movement_atomic exige auth.uid() autenticado';

  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST B: register_movement_atomic rechaza business_id al que el usuario no pertenece ===
DO $$
DECLARE
  b1_id   uuid;
  b2_id   uuid;
  br_id   uuid;
  raised  boolean := false;
BEGIN
  -- Business que NO es del usuario
  INSERT INTO businesses (name, timezone) VALUES ('TEST No Miembro', 'America/Bogota') RETURNING id INTO b1_id;
  -- Business del usuario (miembro simulado)
  INSERT INTO businesses (name, timezone) VALUES ('TEST Miembro', 'America/Bogota') RETURNING id INTO b2_id;
  INSERT INTO branches (business_id, name) VALUES (b2_id, 'TEST Sucursal Miembro') RETURNING id INTO br_id;

  -- El usuario pertenece a b2_id (rol MESERO por defecto), no a b1_id
  -- La verificación de membresía falla ANTES de la verificación RBAC
  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b2_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'CAJERO');

  BEGIN
    PERFORM register_movement_atomic(
      'not-member-test-01', b1_id, br_id, 'IN', 10000::numeric,
      'No soy miembro', 'CASH', 10000::numeric, NULL, now()
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_NOT_A_MEMBER') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería rechazar business_id sin membresía';
  END IF;

  RAISE NOTICE 'PASS: register_movement_atomic rechaza business no miembro';

  DELETE FROM business_members WHERE business_id = b2_id;
  DELETE FROM branches WHERE business_id = b2_id;
  DELETE FROM businesses WHERE id = b1_id;
  DELETE FROM businesses WHERE id = b2_id;
END $$;


-- === TEST C: register_movement_atomic rechaza monto inválido (<= 0) ===
-- El usuario debe pasar auth, membresía y RBAC (rol CAJERO) para llegar
-- a la validación de monto.
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  raised  boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Amount', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal Amount') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'CAJERO');

  BEGIN
    PERFORM register_movement_atomic(
      'invalid-amount-test', b_id, br_id, 'IN', 0::numeric,
      'Monto cero', 'CASH', 0::numeric, NULL, now()
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_INVALID_AMOUNT') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería rechazar amount <= 0';
  END IF;

  RAISE NOTICE 'PASS: register_movement_atomic rechaza monto inválido';

  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST D: register_movement_atomic rechaza método de pago inválido ===
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  raised  boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Method', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal Method') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'CAJERO');

  BEGIN
    PERFORM register_movement_atomic(
      'invalid-method-test', b_id, br_id, 'IN', 10000::numeric,
      'Método inválido', 'BITCOIN', 10000::numeric, NULL, now()
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_INVALID_PAYMENT_METHOD') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería rechazar método de pago inválido';
  END IF;

  RAISE NOTICE 'PASS: register_movement_atomic rechaza método de pago inválido';

  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST E: register_movement_atomic rechaza egreso no en efectivo ===
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  raised  boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Expense Method', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal Expense') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'CAJERO');

  BEGIN
    PERFORM register_movement_atomic(
      'expense-card-test', b_id, br_id, 'OUT', 5000::numeric,
      'Egreso con tarjeta (inválido)', 'CARD', 5000::numeric, NULL, now()
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_INVALID_EXPENSE_METHOD') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería rechazar egreso no en efectivo';
  END IF;

  RAISE NOTICE 'PASS: register_movement_atomic rechaza egreso no CASH';

  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST F: register_movement_atomic rechaza sucursal inválida (no pertenece al business) ===
DO $$
DECLARE
  b1_id   uuid;
  b2_id   uuid;
  br_b2   uuid;
  raised  boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Branch Cross', 'America/Bogota') RETURNING id INTO b1_id;
  INSERT INTO businesses (name, timezone) VALUES ('TEST Branch Owner', 'America/Bogota') RETURNING id INTO b2_id;
  INSERT INTO branches (business_id, name) VALUES (b2_id, 'Sucursal B2') RETURNING id INTO br_b2;

  -- Usuario es miembro de b1_id con rol CAJERO (pasa auth + membresía + RBAC)
  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b1_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'CAJERO');

  -- Usar br_b2 (de b2_id) con p_business_id = b1_id → no pertenece
  BEGIN
    PERFORM register_movement_atomic(
      'cross-branch-test', b1_id, br_b2, 'IN', 10000::numeric,
      'Sucursal cruzada', 'CASH', 10000::numeric, NULL, now()
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_INVALID_BRANCH') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería rechazar branch_id de otro business';
  END IF;

  RAISE NOTICE 'PASS: register_movement_atomic rechaza sucursal ajena al business';

  DELETE FROM business_members WHERE business_id = b1_id;
  DELETE FROM branches WHERE business_id = b2_id;
  DELETE FROM businesses WHERE id = b1_id;
  DELETE FROM businesses WHERE id = b2_id;
END $$;


-- === TEST I: RBAC denegado — miembro con rol MESERO no puede registrar movimientos ===
-- El usuario PERTENECE al business pero su rol MESERO no tiene el permiso
-- 'cash.registerMovement'. La RPC debe rechazar con CAJA_FORBIDDEN (server-side).
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  raised  boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST RBAC Denegado', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal RBAC') RETURNING id INTO br_id;

  -- Usuario es miembro con rol MESERO (NO tiene permiso cash.registerMovement)
  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'MESERO');

  BEGIN
    PERFORM register_movement_atomic(
      'rbac-denied-test', b_id, br_id, 'IN', 10000::numeric,
      'Rol MESERO intenta registrar movimiento', 'CASH', 10000::numeric, NULL, now()
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_FORBIDDEN') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería rechazar rol MESERO (server-side RBAC)';
  END IF;

  RAISE NOTICE 'PASS: register_movement_atomic rechaza rol sin permiso (RBAC server-side)';

  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST G: close_shift_atomic calcula arqueo y cierra atómicamente ===
-- La RPC retorna TABLE(shift_id uuid, data jsonb, version integer).
-- Se usa tipo record para capturar la fila compuesta y acceder a data->>'status'.
DO $$
DECLARE
  b_id       uuid;
  br_id      uuid;
  shift_id   uuid;
  result     record;
  diff_val   numeric;
  status_val text;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Arqueo', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal Arqueo') RETURNING id INTO br_id;

  -- Setup: contexto JWT válido + membresía con rol CAJERO
  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'CAJERO');

  -- Abrir shift
  INSERT INTO shifts (business_id, branch_id, version, data)
  VALUES (b_id, br_id, 1,
    jsonb_build_object(
      'status', 'OPEN',
      'openedAt', now(),
      'openingAmount', 50000,
      'cashierId', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
    )
  ) RETURNING id INTO shift_id;

  -- Registrar 30000 efectivo (income) y 10000 egreso
  PERFORM register_movement_atomic(
    'arqueo-income-01', b_id, br_id, 'IN', 30000::numeric,
    'Venta efectivo', 'CASH', 30000::numeric, NULL, now()
  );
  PERFORM register_movement_atomic(
    'arqueo-expense-01', b_id, br_id, 'OUT', 10000::numeric,
    'Retiro', 'CASH', 10000::numeric, NULL, now()
  );

  -- Esperado: 50000 + 30000 - 10000 = 70000
  -- Contado: 68500 → diferencia = -1500
  SELECT * INTO result FROM close_shift_atomic(shift_id, 68500, 'Prueba de arqueo');

  SELECT result.data->>'status' INTO status_val;
  SELECT (result.data->>'difference')::numeric INTO diff_val;

  IF status_val <> 'CLOSED' THEN
    RAISE EXCEPTION 'FAIL: shift no quedó CLOSED, status=%', status_val;
  END IF;

  IF diff_val <> -1500 THEN
    RAISE EXCEPTION 'FAIL: diferencia esperada -1500, obtenida %', diff_val;
  END IF;

  RAISE NOTICE 'PASS: close_shift_atomic cierra turno y calcula diferencia correctamente (% contado vs 70000 esperado)', diff_val;

  DELETE FROM shifts WHERE id = shift_id;
  DELETE FROM cash_movements WHERE idempotency_key IN ('arqueo-income-01','arqueo-expense-01');
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST H: close_shift_atomic rechaza doble cierre ===
DO $$
DECLARE
  b_id      uuid;
  br_id     uuid;
  shift_id  uuid;
  raised    boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Double Close', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal DoubleClose') RETURNING id INTO br_id;

  -- Setup: contexto JWT válido + membresía con rol CAJERO
  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'CAJERO');

  INSERT INTO shifts (business_id, branch_id, version, data)
  VALUES (b_id, br_id, 1,
    jsonb_build_object('status', 'OPEN', 'openedAt', now(), 'openingAmount', 50000, 'cashierId', 'cashier-1')
  ) RETURNING id INTO shift_id;

  -- Primer cierre: OK
  PERFORM register_movement_atomic(
    'double-close-income', b_id, br_id, 'IN', 20000::numeric,
    'Venta', 'CASH', 20000::numeric, NULL, now()
  );
  PERFORM close_shift_atomic(shift_id, 70000, 'Primer cierre');

  -- Segundo cierre: debe fallar
  BEGIN
    PERFORM close_shift_atomic(shift_id, 70000, 'Segundo cierre');
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'SHIFT_ALREADY_CLOSED') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: close_shift_atomic debería rechazar doble cierre';
  END IF;

  RAISE NOTICE 'PASS: close_shift_atomic rechaza doble cierre de turno';

  DELETE FROM shifts WHERE id = shift_id;
  DELETE FROM cash_movements WHERE idempotency_key = 'double-close-income';
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST I-bis: RBAC denegado en cierre de turno — MESERO no puede cerrar ===
DO $$
DECLARE
  b_id      uuid;
  br_id     uuid;
  shift_id  uuid;
  raised    boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST RBAC Close', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal RBAC Close') RETURNING id INTO br_id;

  -- Usuario es miembro con rol MESERO (NO tiene permiso shift.close)
  PERFORM set_config('request.jwt.claim.sub', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, 'MESERO');

  INSERT INTO shifts (business_id, branch_id, version, data)
  VALUES (b_id, br_id, 1,
    jsonb_build_object('status', 'OPEN', 'openedAt', now(), 'openingAmount', 50000, 'cashierId', 'cashier-1')
  ) RETURNING id INTO shift_id;

  BEGIN
    PERFORM close_shift_atomic(shift_id, 70000, 'Cierre MESERO (debe fallar)');
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'SHIFT_FORBIDDEN') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: close_shift_atomic debería rechazar rol MESERO (server-side RBAC)';
  END IF;

  RAISE NOTICE 'PASS: close_shift_atomic rechaza cierre sin permiso shift.close (RBAC server-side)';

  DELETE FROM shifts WHERE id = shift_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TESTS PASSED ===
-- === Todos los tests de caja (caja_concurrency.test.sql) pasaron ===