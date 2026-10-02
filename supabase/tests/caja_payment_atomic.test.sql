-- ============================================================================
-- caja_payment_atomic.test.sql — Tests de idempotencia, concurrencia y RBAC
-- para register_sale_payment_atomic()
-- ----------------------------------------------------------------------------
-- Requiere: aplicar 20260821_initial_schema.sql + 20260923190000_caja_final_hardening.sql
-- en Supabase (project upoztxlcudrqhnjwjgho).
--
-- Cada bloque DO $$ es una transacción independiente. Usa RAISE EXCEPTION
-- para fallar con mensaje claro. Compatible con el SQL Editor web.
--
-- RBAC: has_business_role() requiere business_members.role = 'ADMIN' o 'CAJERO'.
-- Los tests positivos usan role='CAJERO'. El test de denegación usa 'MESERO'.
--
-- UUID de prueba: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
-- ============================================================================

-- === TEST USER SETUP ===
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id
  INTO v_user_id
  FROM auth.users
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION
      'CAJA_TEST_SETUP_REQUIRED: Supabase debe tener al menos un usuario real en auth.users.';
  END IF;

  PERFORM set_config('vimdy.caja_test_user_id', v_user_id::text, false);
  RAISE NOTICE 'CAJA TEST USER: %', v_user_id;
END $$;


-- === TEST 1: register_sale_payment_atomic — idempotencia (mismo payment_id → 1 movimiento) ===
DO $$
DECLARE
  b_id       uuid;
  br_id      uuid;
  shift_id   uuid;
  cash_register_id uuid;
  sale_id    uuid := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  cnt        int;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Payment Idempotent', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.caja_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, current_setting('vimdy.caja_test_user_id')::uuid, 'CAJERO');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (b_id, br_id, 'PAY-IDEMPOTENT', 'Test payment register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO cash_register_id;

  shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(
    shift_id, b_id, br_id, cash_register_id,
    current_setting('vimdy.caja_test_user_id')::uuid, 0, 'Test payment idempotency shift'
  );

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale_id, b_id, br_id, 1,
    jsonb_build_object(
      'status','PENDING_PAYMENT','type','QUICK','total',10000,'subtotal',8403,
      'tax',1597,'discount',0,'items','[]'::jsonb,'code','TEST-001'
    ), now(), now());

  -- Primer pago: OK
  PERFORM register_sale_payment_atomic(
    sale_id::text, b_id, br_id, 'sale-payment-' || sale_id::text, NULL,
    'CASH', 10000::numeric, 10000::numeric, 10000::numeric, 0::numeric, 'Test pago', NULL, 'CASH'
  );

  -- Retry con MISMA clave: debe devolver el mismo resultado sin duplicar
  PERFORM register_sale_payment_atomic(
    sale_id::text, b_id, br_id, 'sale-payment-' || sale_id::text, NULL,
    'CASH', 10000::numeric, 10000::numeric, 10000::numeric, 0::numeric, 'Test pago', NULL, 'CASH'
  );

  -- Verificar: exactamente 1 movimiento de ingreso
  SELECT count(*) INTO cnt
  FROM cash_movements
  WHERE idempotency_key = 'sale-payment-' || sale_id::text
    AND business_id = b_id
    AND branch_id = br_id;

  IF cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL: idempotencia falló — se encontraron % movimientos (esperado 1)', cnt;
  END IF;

  -- Verificar: la venta quedó PAID con paymentMethod
  IF (SELECT data->>'status' FROM sales WHERE id = sale_id) <> 'PAID' THEN
    RAISE EXCEPTION 'FAIL: la venta debería estar PAID después del pago idempotente';
  END IF;

  RAISE NOTICE 'PASS: idempotencia — retry con mismo payment_id no duplica movimientos';

  DELETE FROM cash_movements WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM sales WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM shifts WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM cash_registers WHERE id = cash_register_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 2: Idempotency key reusado para venta DIFFERENTE → rechazado ===
DO $$
DECLARE
  b_id       uuid;
  br_id      uuid;
  shift_id   uuid;
  cash_register_id uuid;
  sale1      uuid := gen_random_uuid();
  sale2      uuid := gen_random_uuid();
  raised     boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Key Reused', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.caja_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, current_setting('vimdy.caja_test_user_id')::uuid, 'CAJERO');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (b_id, br_id, 'KEY-REUSE', 'Test key reuse register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO cash_register_id;
  shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(
    shift_id, b_id, br_id, cash_register_id,
    current_setting('vimdy.caja_test_user_id')::uuid, 0, 'Test key reuse shift'
  );

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale1, b_id, br_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',10000,'subtotal',8403,'tax',1597,'discount',0,'items','[]'::jsonb), now(), now());
  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale2, b_id, br_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',10000,'subtotal',8403,'tax',1597,'discount',0,'items','[]'::jsonb), now(), now());

  -- Pago sale1 con key K
  PERFORM register_sale_payment_atomic(
    sale1::text, b_id, br_id, 'shared-payment-key', NULL,
    'CASH', 10000::numeric, 10000::numeric, 10000::numeric, 0::numeric, NULL, NULL, 'CASH'
  );

  -- Intento pagar sale2 con la MISMA key K → debe fallar
  BEGIN
    PERFORM register_sale_payment_atomic(
      sale2::text, b_id, br_id, 'shared-payment-key', NULL,
      'CASH', 10000::numeric, 10000::numeric, 10000::numeric, 0::numeric, NULL, NULL, 'CASH'
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_IDEMPOTENCY_KEY_REUSED') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería rechazar idempotency_key reusado para venta diferente';
  END IF;

  RAISE NOTICE 'PASS: idempotency_key reusado en venta diferente es rechazado';

  DELETE FROM cash_movements WHERE idempotency_key = 'shared-payment-key';
  DELETE FROM sales WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM shifts WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM cash_registers WHERE id = cash_register_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 3: Doble cobro — misma venta simultánea (lock FOR UPDATE) ===
-- La RPC hace SELECT ... FOR UPDATE sobre la venta. El segundo llamado
-- espera el lock, ve la venta PAID y lanza SALE_ALREADY_PAID.
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  shift_id uuid;
  cash_register_id uuid;
  sale_id uuid := gen_random_uuid();
  cnt     int;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Double Pay', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.caja_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, current_setting('vimdy.caja_test_user_id')::uuid, 'CAJERO');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (b_id, br_id, 'DOUBLE-PAY', 'Test double pay register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO cash_register_id;
  shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(
    shift_id, b_id, br_id, cash_register_id,
    current_setting('vimdy.caja_test_user_id')::uuid, 0, 'Test double pay shift'
  );

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale_id, b_id, br_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',50000,'subtotal',42017,'tax',7978,'discount',0,'items','[]'::jsonb), now(), now());

  -- Primer pago
  PERFORM register_sale_payment_atomic(
    sale_id::text, b_id, br_id, 'sale-payment-' || sale_id::text, NULL,
    'CASH', 50000::numeric, 50000::numeric, 50000::numeric, 0::numeric, NULL, NULL, 'CASH'
  );

  -- Segundo intento: debe fallar con SALE_ALREADY_PAID
  BEGIN
    PERFORM register_sale_payment_atomic(
      sale_id::text, b_id, br_id, 'sale-payment-' || sale_id::text || '-retry', NULL,
      'CASH', 50000::numeric, 50000::numeric, 50000::numeric, 0::numeric, NULL, NULL, 'CASH'
    );
    RAISE EXCEPTION 'FAIL: debería haber fallado con SALE_ALREADY_PAID';
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'SALE_ALREADY_PAID') = 0 THEN
        RAISE EXCEPTION 'FAIL: error inesperado: %', sqlerrm;
      END IF;
  END;

  -- Verificar: sigue habiendo exactamente 1 movimiento
  SELECT count(*) INTO cnt
  FROM cash_movements
  WHERE idempotency_key = 'sale-payment-' || sale_id::text;

  IF cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL: doble cobro creó % movimientos (esperado 1)', cnt;
  END IF;

  RAISE NOTICE 'PASS: doble cobro rechazado con SALE_ALREADY_PAID, 1 solo movimiento';

  DELETE FROM cash_movements WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM sales WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM shifts WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM cash_registers WHERE id = cash_register_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 4: Pago sin turno abierto → CAJA_NO_OPEN_SHIFT ===
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  sale_id uuid := gen_random_uuid();
  raised  boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST No Shift', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.caja_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, current_setting('vimdy.caja_test_user_id')::uuid, 'CAJERO');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale_id, b_id, br_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',10000,'subtotal',8403,'tax',1597,'discount',0,'items','[]'::jsonb), now(), now());

  BEGIN
    PERFORM register_sale_payment_atomic(
      sale_id::text, b_id, br_id, 'sale-payment-no-shift', NULL,
      'CASH', 10000::numeric, 10000::numeric, 10000::numeric, 0::numeric, NULL, NULL, 'CASH'
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_NO_OPEN_SHIFT') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería rechazar pago sin turno abierto';
  END IF;

  RAISE NOTICE 'PASS: pago sin turno abierto rechazado';

  DELETE FROM sales WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 5: Pago con turno cerrado → CAJA_NO_OPEN_SHIFT ===
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  shift_id uuid;
  cash_register_id uuid;
  sale_id uuid := gen_random_uuid();
  raised  boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Closed Shift', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.caja_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, current_setting('vimdy.caja_test_user_id')::uuid, 'CAJERO');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (b_id, br_id, 'CLOSED-SHIFT', 'Test closed shift register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO cash_register_id;
  shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(
    shift_id, b_id, br_id, cash_register_id,
    current_setting('vimdy.caja_test_user_id')::uuid, 0, 'Test shift to close'
  );
  PERFORM close_shift_atomic(shift_id, 0, 'Close before payment test');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale_id, b_id, br_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',10000,'subtotal',8403,'tax',1597,'discount',0,'items','[]'::jsonb), now(), now());

  BEGIN
    PERFORM register_sale_payment_atomic(
      sale_id::text, b_id, br_id, 'sale-payment-closed-shift', NULL,
      'CASH', 10000::numeric, 10000::numeric, 10000::numeric, 0::numeric, NULL, NULL, 'CASH'
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_NO_OPEN_SHIFT') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería rechazar pago con turno cerrado';
  END IF;

  RAISE NOTICE 'PASS: pago con turno cerrado rechazado';

  DELETE FROM shifts WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM cash_registers WHERE id = cash_register_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 6: Pago en otro negocio → CAJA_NOT_A_MEMBER (multi-tenant) ===
DO $$
DECLARE
  b1_id  uuid;
  b2_id  uuid;
  br1_id uuid;
  br2_id uuid;
  sale_id uuid := gen_random_uuid();
  raised   boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Cross Biz 1', 'America/Bogota') RETURNING id INTO b1_id;
  INSERT INTO businesses (name, timezone) VALUES ('TEST Cross Biz 2', 'America/Bogota') RETURNING id INTO b2_id;
  INSERT INTO branches (business_id, name) VALUES (b1_id, 'Suc B1') RETURNING id INTO br1_id;
  INSERT INTO branches (business_id, name) VALUES (b2_id, 'Suc B2') RETURNING id INTO br2_id;

  -- Usuario es miembro de b1_id con CAJERO, intenta pagar en b2_id
  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.caja_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b1_id, current_setting('vimdy.caja_test_user_id')::uuid, 'CAJERO');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale_id, b2_id, br2_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',10000,'subtotal',8403,'tax',1597,'discount',0,'items','[]'::jsonb), now(), now());

  BEGIN
    PERFORM register_sale_payment_atomic(
      sale_id::text, b2_id, br2_id, 'sale-payment-cross-biz', NULL,
      'CASH', 10000::numeric, 10000::numeric, 10000::numeric, 0::numeric, NULL, NULL, 'CASH'
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_NOT_A_MEMBER') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería rechazar pago en business sin membresía';
  END IF;

  RAISE NOTICE 'PASS: pago en otro business rechazado (multi-tenant isolamento)';

  DELETE FROM sales WHERE business_id = b2_id AND branch_id = br2_id;
  DELETE FROM business_members WHERE business_id = b1_id;
  DELETE FROM branches WHERE business_id = b2_id;
  DELETE FROM businesses WHERE id = b1_id;
  DELETE FROM businesses WHERE id = b2_id;
END $$;


-- === TEST 7: RBAC — MESERO no puede pagar con register_sale_payment_atomic → CAJA_FORBIDDEN ===
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  sale_id uuid := gen_random_uuid();
  raised  boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST RBAC Mesero', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.caja_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, current_setting('vimdy.caja_test_user_id')::uuid, 'MESERO');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale_id, b_id, br_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',10000,'subtotal',8403,'tax',1597,'discount',0,'items','[]'::jsonb), now(), now());

  BEGIN
    PERFORM register_sale_payment_atomic(
      sale_id::text, b_id, br_id, 'sale-payment-rbac-mesero', NULL,
      'CASH', 10000::numeric, 10000::numeric, 10000::numeric, 0::numeric, NULL, NULL, 'CASH'
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_FORBIDDEN') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería rechazar rol MESERO (no tiene cash.registerMovement)';
  END IF;

  RAISE NOTICE 'PASS: RBAC — MESERO rechazado en pago de venta';

  DELETE FROM sales WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 8: Pago con cambio registra 2 movimientos (ingreso + egreso) ===
DO $$
DECLARE
  b_id        uuid;
  br_id       uuid;
  shift_id    uuid;
  cash_register_id uuid;
  sale_id     uuid := gen_random_uuid();
  income_cnt  int;
  change_cnt  int;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Payment Change', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.caja_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, current_setting('vimdy.caja_test_user_id')::uuid, 'CAJERO');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (b_id, br_id, 'PAY-CHANGE', 'Test payment change register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO cash_register_id;
  shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(
    shift_id, b_id, br_id, cash_register_id,
    current_setting('vimdy.caja_test_user_id')::uuid, 0, 'Test payment change shift'
  );

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale_id, b_id, br_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',10000,'subtotal',8403,'tax',1597,'discount',0,'items','[]'::jsonb), now(), now());

  -- Pago en efectivo: recibe 20000, total 10000 → cambio 10000
  PERFORM register_sale_payment_atomic(
    sale_id::text, b_id, br_id, 'sale-payment-' || sale_id::text,
    'sale-change-' || sale_id::text,
    'CASH', 10000::numeric, 10000::numeric, 20000::numeric, 10000::numeric, 'Pago con cambio', NULL, 'CASH'
  );

  -- Verificar: 1 movimiento IN (ingreso)
  SELECT count(*) INTO income_cnt
  FROM cash_movements cm
  WHERE cm.idempotency_key = 'sale-payment-' || sale_id::text
    AND cm.data->>'type' = 'IN'
    AND cm.business_id = b_id AND cm.branch_id = br_id;

  -- Verificar: 1 movimiento OUT (cambio)
  SELECT count(*) INTO change_cnt
  FROM cash_movements cm
  WHERE cm.idempotency_key = 'sale-change-' || sale_id::text
    AND cm.data->>'type' = 'OUT'
    AND cm.business_id = b_id AND cm.branch_id = br_id;

  IF income_cnt <> 1 OR change_cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL: esperados 1 IN + 1 OUT, encontrados IN=% OUT=%', income_cnt, change_cnt;
  END IF;

  RAISE NOTICE 'PASS: pago con cambio registra ingreso + egreso de cambio';

  DELETE FROM cash_movements WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM sales WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM shifts WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM cash_registers WHERE id = cash_register_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 9: Pago de tarjeta (no efectivo) — sin movimiento de cambio ===
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  shift_id uuid;
  cash_register_id uuid;
  sale_id uuid := gen_random_uuid();
  cnt     int;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Card Payment', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.caja_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, current_setting('vimdy.caja_test_user_id')::uuid, 'CAJERO');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (b_id, br_id, 'CARD-PENDING', 'Test unverified card register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO cash_register_id;
  shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(
    shift_id, b_id, br_id, cash_register_id,
    current_setting('vimdy.caja_test_user_id')::uuid, 0, 'Test unverified card shift'
  );

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale_id, b_id, br_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',50000,'subtotal',42017,'tax',7978,'discount',0,'items','[]'::jsonb), now(), now());

  -- Without terminal/provider confirmation, CARD must not create a payment.
  BEGIN
    PERFORM register_sale_payment_atomic(
      sale_id::text, b_id, br_id, 'sale-payment-' || sale_id::text, NULL,
      'CARD', 50000::numeric, 0::numeric, 50000::numeric, 0::numeric,
      'Pago con tarjeta', cash_register_id, NULL, shift_id
    );
    RAISE EXCEPTION 'FAIL: un pago CARD sin verificación fue aceptado';
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(SQLERRM, 'CAJA_PAYMENT_NOT_VERIFIED') = 0 THEN
        RAISE;
      END IF;
  END;

  SELECT count(*) INTO cnt
  FROM cash_movements cm
  WHERE cm.idempotency_key = 'sale-payment-' || sale_id::text
    AND cm.business_id = b_id AND cm.branch_id = br_id;
  IF cnt <> 0
     OR (SELECT data->>'status' FROM sales WHERE id = sale_id) <> 'PENDING_PAYMENT' THEN
    RAISE EXCEPTION 'FAIL: CARD sin verificar dejó estado o movimiento financiero';
  END IF;

  RAISE NOTICE 'PASS: pago CARD sin confirmación externa es rechazado sin movimiento';

  DELETE FROM cash_movements WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM sales WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM shifts WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM cash_registers WHERE id = cash_register_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 10: Pago simultáneo diferentes ventas, mismo turno → ambos OK ===
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  shift_id uuid;
  cash_register_id uuid;
  sale1   uuid := gen_random_uuid();
  sale2   uuid := gen_random_uuid();
  cnt1    int;
  cnt2    int;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Concurrent', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.caja_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, current_setting('vimdy.caja_test_user_id')::uuid, 'CAJERO');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (b_id, br_id, 'CONCURRENT', 'Test concurrent payment register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO cash_register_id;
  shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(
    shift_id, b_id, br_id, cash_register_id,
    current_setting('vimdy.caja_test_user_id')::uuid, 0, 'Test concurrent payment shift'
  );

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale1, b_id, br_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',10000,'subtotal',8403,'tax',1597,'discount',0,'items','[]'::jsonb), now(), now());
  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale2, b_id, br_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',20000,'subtotal',16807,'tax',3193,'discount',0,'items','[]'::jsonb), now(), now());

  -- Pago simultáneo de ventas diferentes
  PERFORM register_sale_payment_atomic(
    sale1::text, b_id, br_id, 'sale-payment-' || sale1::text, NULL,
    'CASH', 10000::numeric, 10000::numeric, 10000::numeric, 0::numeric, NULL, NULL, 'CASH'
  );
  PERFORM register_sale_payment_atomic(
    sale2::text, b_id, br_id, 'sale-payment-' || sale2::text, NULL,
    'CASH', 20000::numeric, 20000::numeric, 20000::numeric, 0::numeric, NULL, NULL, 'CASH'
  );

  SELECT count(*) INTO cnt1 FROM cash_movements WHERE idempotency_key = 'sale-payment-' || sale1::text;
  SELECT count(*) INTO cnt2 FROM cash_movements WHERE idempotency_key = 'sale-payment-' || sale2::text;

  IF cnt1 <> 1 OR cnt2 <> 1 THEN
    RAISE EXCEPTION 'FAIL: concurrencia entre ventas — cnt1=% cnt2=% (esperado 1+1)', cnt1, cnt2;
  END IF;

  RAISE NOTICE 'PASS: pagos simultáneos de ventas diferentes coexisten sin conflicto';

  DELETE FROM cash_movements WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM sales WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM shifts WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM cash_registers WHERE id = cash_register_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 11: Aislamiento entre sucursales (mismo negocio) ===
DO $$
DECLARE
  b_id    uuid;
  br1_id  uuid;
  br2_id  uuid;
  shift1  uuid;
  shift2  uuid;
  cash_register1_id uuid;
  cash_register2_id uuid;
  sale1   uuid := gen_random_uuid();
  sale2   uuid := gen_random_uuid();
  cnt1    int;
  cnt2    int;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Branch Isolation', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'Sucursal 1') RETURNING id INTO br1_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'Sucursal 2') RETURNING id INTO br2_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.caja_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, current_setting('vimdy.caja_test_user_id')::uuid, 'CAJERO');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (b_id, br1_id, 'BRANCH-1', 'Branch 1 register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO cash_register1_id;
  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (b_id, br2_id, 'BRANCH-2', 'Branch 2 register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO cash_register2_id;

  shift1 := gen_random_uuid();
  PERFORM open_shift_atomic(
    shift1, b_id, br1_id, cash_register1_id,
    current_setting('vimdy.caja_test_user_id')::uuid, 0, 'Branch 1 test shift'
  );
  shift2 := gen_random_uuid();
  PERFORM open_shift_atomic(
    shift2, b_id, br2_id, cash_register2_id,
    current_setting('vimdy.caja_test_user_id')::uuid, 0, 'Branch 2 test shift'
  );

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale1, b_id, br1_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',10000,'subtotal',8403,'tax',1597,'discount',0,'items','[]'::jsonb), now(), now());
  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale2, b_id, br2_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',20000,'subtotal',16807,'tax',3193,'discount',0,'items','[]'::jsonb), now(), now());

  -- Pago en sucursal 1
  PERFORM register_sale_payment_atomic(
    sale1::text, b_id, br1_id, 'sale-payment-' || sale1::text, NULL,
    'CASH', 10000::numeric, 10000::numeric, 10000::numeric, 0::numeric, NULL, NULL, 'CASH'
  );

  -- Pago en sucursal 2
  PERFORM register_sale_payment_atomic(
    sale2::text, b_id, br2_id, 'sale-payment-' || sale2::text, NULL,
    'CASH', 20000::numeric, 20000::numeric, 20000::numeric, 0::numeric, NULL, NULL, 'CASH'
  );

  -- Verificar: cada movimiento está en su propia sucursal
  SELECT count(*) INTO cnt1
  FROM cash_movements cm
  WHERE cm.idempotency_key = 'sale-payment-' || sale1::text
    AND cm.branch_id = br1_id;

  SELECT count(*) INTO cnt2
  FROM cash_movements cm
  WHERE cm.idempotency_key = 'sale-payment-' || sale2::text
    AND cm.branch_id = br2_id;

  IF cnt1 <> 1 OR cnt2 <> 1 THEN
    RAISE EXCEPTION 'FAIL: aislamiento sucursal — cnt1=% cnt2=% (esperado 1+1)', cnt1, cnt2;
  END IF;

  RAISE NOTICE 'PASS: pagos en sucursales diferentes están aislados';

  DELETE FROM cash_movements WHERE business_id = b_id;
  DELETE FROM sales WHERE business_id = b_id;
  DELETE FROM shifts WHERE business_id = b_id;
  DELETE FROM cash_registers WHERE business_id = b_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 12: Pago con change_id inválido (NULL cuando change > 0) → CAJA_CHANGE_ID_REQUIRED ===
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  shift_id uuid;
  cash_register_id uuid;
  sale_id uuid := gen_random_uuid();
  raised  boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Change Required', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.caja_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, current_setting('vimdy.caja_test_user_id')::uuid, 'CAJERO');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (b_id, br_id, 'CHANGE-REQUIRED', 'Test change required register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO cash_register_id;
  shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(
    shift_id, b_id, br_id, cash_register_id,
    current_setting('vimdy.caja_test_user_id')::uuid, 0, 'Test change required shift'
  );

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale_id, b_id, br_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','type','QUICK','total',10000,'subtotal',8403,'tax',1597,'discount',0,'items','[]'::jsonb), now(), now());

  -- pago CASH con change > 0 pero p_change_id = NULL → debe fallar
  BEGIN
    PERFORM register_sale_payment_atomic(
      sale_id::text, b_id, br_id, 'sale-payment-change-req', NULL,
      'CASH', 10000::numeric, 10000::numeric, 20000::numeric, 10000::numeric,
      NULL, cash_register_id, 'CASH', shift_id
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_CHANGE_ID_REQUIRED') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería exigir change_id cuando change > 0';
  END IF;

  RAISE NOTICE 'PASS: change_id requerido cuando change > 0';

  DELETE FROM shifts WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM cash_registers WHERE id = cash_register_id;
  DELETE FROM sales WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TEST 13: Venta PAID no puede pagarse dos veces ===
DO $$
DECLARE
  b_id    uuid;
  br_id   uuid;
  shift_id uuid;
  cash_register_id uuid;
  sale_id uuid := gen_random_uuid();
  raised  boolean := false;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Paid Twice', 'America/Bogota') RETURNING id INTO b_id;
  INSERT INTO branches (business_id, name) VALUES (b_id, 'TEST Sucursal') RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.caja_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, current_setting('vimdy.caja_test_user_id')::uuid, 'CAJERO');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (b_id, br_id, 'PAID-TWICE', 'Test paid twice register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO cash_register_id;
  shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(
    shift_id, b_id, br_id, cash_register_id,
    current_setting('vimdy.caja_test_user_id')::uuid, 0, 'Test paid twice shift'
  );

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (sale_id, b_id, br_id, 1,
    jsonb_build_object('status','PAID','type','QUICK','total',10000,'subtotal',8403,'tax',1597,'discount',0,'items','[]'::jsonb,'paymentMethod','CASH'), now(), now());

  BEGIN
    PERFORM register_sale_payment_atomic(
      sale_id::text, b_id, br_id, 'sale-payment-paid-twice', NULL,
      'CASH', 10000::numeric, 10000::numeric, 10000::numeric, 0::numeric,
      NULL, cash_register_id, 'CASH', shift_id
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'SALE_ALREADY_PAID') > 0 THEN
        raised := true;
      END IF;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: la RPC debería rechazar pago de venta ya PAID';
  END IF;

  RAISE NOTICE 'PASS: venta PAID no puede pagarse dos veces';

  DELETE FROM cash_movements WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM sales WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM shifts WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM cash_registers WHERE id = cash_register_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- === TESTS PASSED ===
RESET vimdy.caja_test_user_id;
