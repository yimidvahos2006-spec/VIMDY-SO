-- ============================================================================
-- step3_payments_refunds.test.sql — Tests de Paso 3: Pagos + Reembolsos
-- ----------------------------------------------------------------------------
-- Valida:
--   - payment_sessions: CRUD, idempotencia, tenant isolation, RLS
--   - payment_refunds: CRUD, idempotencia, tenant isolation
--   - refund_sale_cash_atomic: éxito, idempotencia, rollback, RBAC
--   - External refunds: request_subscription_refund_atomic,
--     settle_subscription_refund_atomic
--   - Payment verification: sin evidencia → rechazado, con evidencia → aceptado
--
-- Requiere migraciones Step 3 aplicadas:
--   - 20261008000000_step3_payment_sessions_and_refund_ledger.sql
--   - 20261009000000_step3_cash_refund_atomic.sql
-- ============================================================================

-- === TEST USER SETUP ===
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'STEP3_TEST_SETUP_REQUIRED: se necesita un usuario real en auth.users.';
  END IF;
  PERFORM set_config('vimdy.step3_test_user_id', v_user_id::text, false);
  RAISE NOTICE 'STEP3 TEST USER: %', v_user_id;
END $$;

-- ============================================================================
-- PAYMENT SESSIONS
-- ============================================================================

-- === TEST 1: create_sale_payment_session_atomic — crea sesión de pago ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_sale_id uuid := gen_random_uuid();
  v_session_id uuid;
  v_session_status text;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Payment Session', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'TEST Sucursal') RETURNING id INTO v_branch_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, current_setting('vimdy.step3_test_user_id')::uuid, 'CAJERO');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object('status', 'PENDING_PAYMENT', 'total', 10000, 'items', '[]'::jsonb), now(), now());

  PERFORM create_sale_payment_session_atomic((v_sale_id)::text, 'CARD', 'step3-session-idempotency-01');

  SELECT id, status INTO v_session_id, v_session_status
  FROM payment_sessions
  WHERE business_id = v_business_id AND sale_id = (SELECT id FROM sales WHERE id = v_sale_id);

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: no se creó la sesión de pago';
  END IF;

  IF v_session_status <> 'pending' THEN
    RAISE EXCEPTION 'FAIL: estado inicial incorrecto: %', v_session_status;
  END IF;

  RAISE NOTICE 'PASS: create_sale_payment_session_atomic crea sesión con estado pending';

  DELETE FROM payment_sessions WHERE business_id = v_business_id;
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 2: create_sale_payment_session_atomic — idempotencia (misma clave → misma sesión) ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_sale_id uuid := gen_random_uuid();
  v_session_count integer;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Session Idempotency', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'TEST Sucursal') RETURNING id INTO v_branch_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, current_setting('vimdy.step3_test_user_id')::uuid, 'CAJERO');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object('status', 'PENDING_PAYMENT', 'total', 10000, 'items', '[]'::jsonb), now(), now());

  PERFORM create_sale_payment_session_atomic((v_sale_id)::text, 'CARD', 'step3-session-idempotency-02');
  PERFORM create_sale_payment_session_atomic((v_sale_id)::text, 'CARD', 'step3-session-idempotency-02');

  SELECT count(*) INTO v_session_count
  FROM payment_sessions
  WHERE business_id = v_business_id AND idempotency_key = 'step3-session-idempotency-02';

  IF v_session_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: idempotencia falló — se encontraron % sesiones', v_session_count;
  END IF;

  RAISE NOTICE 'PASS: create_sale_payment_session_atomic es idempotente';

  DELETE FROM payment_sessions WHERE business_id = v_business_id;
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 3: payment_sessions — tenant isolation (otro business no ve sesiones) ===
DO $$
DECLARE
  v_business_a uuid;
  v_branch_a uuid;
  v_business_b uuid;
  v_branch_b uuid;
  v_sale_a uuid := gen_random_uuid();
  v_sale_b uuid := gen_random_uuid();
  v_count_a integer;
  v_count_b integer;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Tenant A', 'America/Bogota') RETURNING id INTO v_business_a;
  INSERT INTO branches (business_id, name) VALUES (v_business_a, 'TEST Sucursal A') RETURNING id INTO v_branch_a;
  INSERT INTO businesses (name, timezone) VALUES ('TEST Tenant B', 'America/Bogota') RETURNING id INTO v_business_b;
  INSERT INTO branches (business_id, name) VALUES (v_business_b, 'TEST Sucursal B') RETURNING id INTO v_branch_b;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_a, current_setting('vimdy.step3_test_user_id')::uuid, 'CAJERO');
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_b, current_setting('vimdy.step3_test_user_id')::uuid, 'CAJERO');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_a, v_business_a, v_branch_a, 1, jsonb_build_object('status', 'PENDING_PAYMENT', 'total', 10000, 'items', '[]'::jsonb), now(), now());
  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_b, v_business_b, v_branch_b, 1, jsonb_build_object('status', 'PENDING_PAYMENT', 'total', 20000, 'items', '[]'::jsonb), now(), now());

  PERFORM create_sale_payment_session_atomic((v_sale_a)::text, 'CARD', 'step3-tenant-a-session');
  PERFORM create_sale_payment_session_atomic((v_sale_b)::text, 'CARD', 'step3-tenant-b-session');

  SELECT count(*) INTO v_count_a FROM payment_sessions WHERE business_id = v_business_a;
  SELECT count(*) INTO v_count_b FROM payment_sessions WHERE business_id = v_business_b;

  IF v_count_a <> 1 THEN
    RAISE EXCEPTION 'FAIL: tenant A debería tener 1 sesión, tiene %', v_count_a;
  END IF;

  IF v_count_b <> 1 THEN
    RAISE EXCEPTION 'FAIL: tenant B debería tener 1 sesión, tiene %', v_count_b;
  END IF;

  RAISE NOTICE 'PASS: payment_sessions respeta tenant isolation';

  DELETE FROM payment_sessions WHERE business_id IN (v_business_a, v_business_b);
  DELETE FROM sales WHERE business_id IN (v_business_a, v_business_b);
  DELETE FROM business_members WHERE business_id IN (v_business_a, v_business_b);
  DELETE FROM branches WHERE business_id IN (v_business_a, v_business_b);
  DELETE FROM businesses WHERE id IN (v_business_a, v_business_b);
END $$;


-- ============================================================================
-- REFUND CASH ATOMIC
-- ============================================================================

-- === TEST 4: refund_sale_cash_atomic — reembolso CASH exitoso ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_shift_id uuid;
  v_cash_register_id uuid;
  v_sale_id uuid := gen_random_uuid();
  v_refund_id text := 'step3-cash-refund-01';
  v_refund_amount numeric;
  v_sale_status text;
  v_cash_movement_count integer;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Cash Refund', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'TEST Sucursal') RETURNING id INTO v_branch_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, current_setting('vimdy.step3_test_user_id')::uuid, 'ADMIN');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (v_business_id, v_branch_id, 'REFUND-CASH-01', 'Test refund register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO v_cash_register_id;

  v_shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(v_shift_id, v_business_id, v_branch_id, v_cash_register_id, current_setting('vimdy.step3_test_user_id')::uuid, 50000, 'Test refund shift');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object(
      'status', 'PAID',
      'paymentStatus', 'CONFIRMED',
      'paymentMethod', 'CASH',
      'total', 10000,
      'subtotal', 8403,
      'tax', 1597,
      'discount', 0,
      'items', jsonb_build_array(
        jsonb_build_object('productId', gen_random_uuid()::text, 'quantity', 2, 'price', 4200)
      ),
      'code', 'TEST-REFUND-001'
    ), now(), now());

  PERFORM refund_sale_cash_atomic(
    v_business_id, v_branch_id, (v_sale_id)::text, v_refund_id,
    jsonb_build_array(jsonb_build_object('productId', (SELECT (item->>'productId')::uuid FROM jsonb_array_elements((SELECT data->'items' FROM sales WHERE id = v_sale_id)) AS item LIMIT 1), 'quantity', 2)),
    'Producto defectuoso - prueba Step 3',
    v_cash_register_id
  );

  SELECT data->>'status' INTO v_sale_status FROM sales WHERE id = v_sale_id;
  SELECT count(*) INTO v_cash_movement_count
  FROM cash_movements
  WHERE business_id = v_business_id AND branch_id = v_branch_id AND idempotency_key = v_refund_id;

  IF v_sale_status <> 'REFUNDED' THEN
    RAISE EXCEPTION 'FAIL: la venta debería estar REFUNDED, status: %', v_sale_status;
  END IF;

  IF v_cash_movement_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: debería haber 1 movimiento de caja, se encontraron %', v_cash_movement_count;
  END IF;

  RAISE NOTICE 'PASS: refund_sale_cash_atomic — reembolso CASH exitoso';

  DELETE FROM cash_movements WHERE business_id = v_business_id AND branch_id = v_branch_id;
  DELETE FROM payment_refunds WHERE business_id = v_business_id;
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM shifts WHERE business_id = v_business_id;
  DELETE FROM cash_registers WHERE id = v_cash_register_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 5: refund_sale_cash_atomic — idempotencia (mismo refund_id → no duplica) ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_shift_id uuid;
  v_cash_register_id uuid;
  v_sale_id uuid := gen_random_uuid();
  v_refund_id text := 'step3-cash-refund-idempotency-01';
  v_cash_movement_count integer;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Cash Refund Idempotency', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'TEST Sucursal') RETURNING id INTO v_branch_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, current_setting('vimdy.step3_test_user_id')::uuid, 'ADMIN');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (v_business_id, v_branch_id, 'REFUND-IDEMP', 'Test idempotency register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO v_cash_register_id;

  v_shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(v_shift_id, v_business_id, v_branch_id, v_cash_register_id, current_setting('vimdy.step3_test_user_id')::uuid, 50000, 'Test idempotency shift');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object(
      'status', 'PAID',
      'paymentStatus', 'CONFIRMED',
      'paymentMethod', 'CASH',
      'total', 10000,
      'subtotal', 8403,
      'tax', 1597,
      'discount', 0,
      'items', jsonb_build_array(
        jsonb_build_object('productId', gen_random_uuid()::text, 'quantity', 2, 'price', 4200)
      ),
      'code', 'TEST-REFUND-IDEMP-001'
    ), now(), now());

  PERFORM refund_sale_cash_atomic(v_business_id, v_branch_id, (v_sale_id)::text, v_refund_id,
    jsonb_build_array(jsonb_build_object('productId', (SELECT (item->>'productId')::uuid FROM jsonb_array_elements((SELECT data->'items' FROM sales WHERE id = v_sale_id)) AS item LIMIT 1), 'quantity', 1)),
    'Producto defectuoso - idempotencia', v_cash_register_id);

  PERFORM refund_sale_cash_atomic(v_business_id, v_branch_id, (v_sale_id)::text, v_refund_id,
    jsonb_build_array(jsonb_build_object('productId', (SELECT (item->>'productId')::uuid FROM jsonb_array_elements((SELECT data->'items' FROM sales WHERE id = v_sale_id)) AS item LIMIT 1), 'quantity', 1)),
    'Producto defectuoso - idempotencia', v_cash_register_id);

  SELECT count(*) INTO v_cash_movement_count
  FROM cash_movements
  WHERE business_id = v_business_id AND branch_id = v_branch_id AND idempotency_key = v_refund_id;

  IF v_cash_movement_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: idempotencia de reembolso falló — % movimientos', v_cash_movement_count;
  END IF;

  RAISE NOTICE 'PASS: refund_sale_cash_atomic es idempotente';

  DELETE FROM cash_movements WHERE business_id = v_business_id AND branch_id = v_branch_id;
  DELETE FROM payment_refunds WHERE business_id = v_business_id;
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM shifts WHERE business_id = v_business_id;
  DELETE FROM cash_registers WHERE id = v_cash_register_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 6: refund_sale_cash_atomic — rechaza reembolso de pago no CASH ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_sale_id uuid := gen_random_uuid();
  v_raised boolean := false;
  v_error text := '(sin excepcion)';
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Non-Cash Refund', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'TEST Sucursal') RETURNING id INTO v_branch_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, current_setting('vimdy.step3_test_user_id')::uuid, 'ADMIN');

  -- El trigger sales_require_verified_external_tender (fail-closed) impide
  -- crear directamente una venta PAID con metodo externo: exige
  -- paymentVerificationSource=PROVIDER y una fila CONFIRMED en
  -- payment_verifications. Por eso la venta nace PENDING_PAYMENT, se registra
  -- la evidencia del proveedor y recien ahi se marca PAID. Asi el test ejercita
  -- la cadena real y no un atajo que el schema ya prohibe.
  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object(
      'status', 'PENDING_PAYMENT',
      'paymentMethod', 'CARD',
      'total', 10000,
      'subtotal', 10000,
      'items', jsonb_build_array(
        jsonb_build_object('productId', gen_random_uuid()::text, 'quantity', 1, 'price', 10000)
      )
    ), now(), now());

  INSERT INTO payment_verifications (
    business_id, branch_id, sale_id, payment_id, method, amount,
    provider, provider_reference, status, verified_at
  ) VALUES (
    v_business_id, v_branch_id, v_sale_id, 'sale-payment-' || v_sale_id::text, 'CARD', 10000,
    'TEST_PROVIDER', 'PROVIDER-NONCASH-001', 'CONFIRMED', clock_timestamp()
  );

  UPDATE sales
  SET data = data || jsonb_build_object(
    'status', 'PAID',
    'paymentStatus', 'CONFIRMED',
    'paymentVerificationSource', 'PROVIDER',
    'paymentReference', 'PROVIDER-NONCASH-001'
  )
  WHERE id = v_sale_id;

  BEGIN
    PERFORM refund_sale_cash_atomic(v_business_id, v_branch_id, (v_sale_id)::text, 'step3-non-cash-refund',
      jsonb_build_array(jsonb_build_object('productId', (SELECT (item->>'productId')::uuid FROM jsonb_array_elements((SELECT data->'items' FROM sales WHERE id = v_sale_id)) AS item LIMIT 1), 'quantity', 1)),
      'No debería funcionar', NULL);
  EXCEPTION
    WHEN OTHERS THEN
      v_error := sqlerrm;
      IF strpos(v_error, 'EXTERNAL_REFUND_REQUIRES_PROVIDER_CONFIRMATION') > 0 THEN
        v_raised := true;
      END IF;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: debería rechazar reembolso de pago no CASH (sqlerrm=% | status venta=% | paymentMethod=% | paymentStatus=%)',
      v_error,
      (SELECT data->>'status' FROM sales WHERE id = v_sale_id),
      (SELECT data->>'paymentMethod' FROM sales WHERE id = v_sale_id),
      (SELECT data->>'paymentStatus' FROM sales WHERE id = v_sale_id);
  END IF;

  RAISE NOTICE 'PASS: refund_sale_cash_atomic rechaza pago no CASH';

  DELETE FROM payment_verifications WHERE business_id = v_business_id;
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 7: refund_sale_cash_atomic — RBAC (ADMIN/GERENTE permitido, MESERO rechazado) ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_shift_id uuid;
  v_cash_register_id uuid;
  v_sale_id uuid := gen_random_uuid();
  v_raised boolean := false;
  v_user_id uuid;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Refund RBAC', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'TEST Sucursal') RETURNING id INTO v_branch_id;

  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;

  -- El turno se abre como ADMIN (open_shift_atomic exige ADMIN/CAJERO) y solo
  -- despues el rol degrada a MESERO. Asi el rechazo que se verifica es el de
  -- refund_sale_cash_atomic (REFUND_FORBIDDEN por rol), no un SHIFT_FORBIDDEN
  -- incidental por no poder abrir el turno.
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (v_business_id, v_branch_id, 'REFUND-RBAC', 'Test RBAC register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO v_cash_register_id;

  v_shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(v_shift_id, v_business_id, v_branch_id, v_cash_register_id, v_user_id, 50000, 'Test RBAC shift');

  -- El turno ya esta abierto y funded; ahora el usuario pierde el permiso.
  UPDATE business_members SET role = 'MESERO'
  WHERE business_id = v_business_id AND user_id = v_user_id;

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object(
      'status', 'PAID',
      'paymentStatus', 'CONFIRMED',
      'paymentMethod', 'CASH',
      'total', 10000,
      'items', jsonb_build_array(
        jsonb_build_object('productId', gen_random_uuid()::text, 'quantity', 2, 'price', 4200)
      )
    ), now(), now());

  BEGIN
    PERFORM refund_sale_cash_atomic(v_business_id, v_branch_id, (v_sale_id)::text, 'step3-rbac-refund',
      jsonb_build_array(jsonb_build_object('productId', (SELECT (item->>'productId')::uuid FROM jsonb_array_elements((SELECT data->'items' FROM sales WHERE id = v_sale_id)) AS item LIMIT 1), 'quantity', 1)),
      'No autorizado', v_cash_register_id);
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'REFUND_FORBIDDEN') > 0 THEN
        v_raised := true;
      END IF;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: MESERO debería estar rechazado para reembolsar';
  END IF;

  RAISE NOTICE 'PASS: refund_sale_cash_atomic respeta RBAC (MESERO rechazado)';

  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM shifts WHERE business_id = v_business_id;
  DELETE FROM cash_registers WHERE id = v_cash_register_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- ============================================================================
-- EXTERNAL REFUNDS (SUSCRIPTION)
-- ============================================================================

-- === TEST 8: request_subscription_refund_atomic — solicitud de reembolso externo ===
DO $$
DECLARE
  v_business_id uuid;
  v_payment_id uuid;
  v_refund_id uuid;
  v_refund_status text;
  v_result jsonb;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST External Refund', 'America/Bogota') RETURNING id INTO v_business_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, current_setting('vimdy.step3_test_user_id')::uuid, 'ADMIN');

  INSERT INTO subscription_payments (id, business_id, amount, currency, status, provider, payment_method, plan, renewal_number, idempotency_key)
  VALUES (gen_random_uuid(), v_business_id, 50000, 'COP', 'approved', 'wompi', 'CARD', 'monthly', 1, 'step3-external-refund-01')
  RETURNING id INTO v_payment_id;

  SELECT request_subscription_refund_atomic(
    p_subscription_payment_id => v_payment_id,
    p_amount => NULL,
    p_idempotency_key => 'step3-external-refund-01',
    p_reason => 'Test external refund',
    p_actor_id => current_setting('vimdy.step3_test_user_id')::uuid
  ) INTO v_result;

  IF NOT (v_result->>'success')::boolean THEN
    RAISE EXCEPTION 'FAIL: request_subscription_refund_atomic debería tener success=true';
  END IF;

  RAISE NOTICE 'PASS: request_subscription_refund_atomic — solicitud de reembolso externo';

  DELETE FROM payment_refunds WHERE business_id = v_business_id;
  DELETE FROM subscription_payments WHERE business_id = v_business_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- ============================================================================
-- PAYMENT VERIFICATION
-- ============================================================================

-- === TEST 9: Pago CARD sin verificación → rechazado ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_sale_id uuid := gen_random_uuid();
  v_raised boolean := false;
  v_error text := '(sin excepcion)';
  v_shift_id uuid;
  v_cash_register_id uuid;
  v_final_status text;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Card Unverified', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'TEST Sucursal') RETURNING id INTO v_branch_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, current_setting('vimdy.step3_test_user_id')::uuid, 'CAJERO');

  -- Turno abierto para que la RPC llegue hasta el UPDATE ... SET data = PAID.
  -- El bloqueo de un CARD sin evidencia NO esta en la RPC: una verification
  -- source nula la deja pasar. Quien cierra la puerta es el trigger fail-closed
  -- sales_require_verified_external_tender, que exige
  -- paymentVerificationSource=PROVIDER mas una fila CONFIRMED en
  -- payment_verifications. Sin turno la RPC cortaria antes con
  -- CAJA_NO_OPEN_SHIFT y el test no probaria lo que importa.
  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (v_business_id, v_branch_id, 'CARD-UNVERIFIED', 'Test unverified register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO v_cash_register_id;

  v_shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(v_shift_id, v_business_id, v_branch_id, v_cash_register_id, current_setting('vimdy.step3_test_user_id')::uuid, 50000, 'Test unverified shift');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object('status', 'PENDING_PAYMENT', 'total', 10000, 'items', '[]'::jsonb), now(), now());

  BEGIN
    PERFORM register_sale_payment_atomic((v_sale_id)::text, v_business_id, v_branch_id, 'step3-card-unverified-payment', NULL,
      'CARD', 10000::numeric, 0::numeric, 10000::numeric, 0::numeric,
      'Pago sin verificar', v_cash_register_id, NULL, v_shift_id
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_error := sqlerrm;
      IF strpos(v_error, 'CAJA_PAYMENT_NOT_VERIFIED') > 0 THEN
        v_raised := true;
      END IF;
  END;

  -- Sin confirmacion del proveedor NO puede quedar PAID (fail-closed).
  SELECT data->>'status' INTO v_final_status FROM sales WHERE id = v_sale_id;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: pago CARD sin verificación debería ser rechazado (sqlerrm=% | status final=%)',
      v_error, v_final_status;
  END IF;

  IF v_final_status = 'PAID' THEN
    RAISE EXCEPTION 'FAIL: la venta NO debe quedar PAID sin verificación de proveedor';
  END IF;

  RAISE NOTICE 'PASS: pago CARD sin verificación es rechazado (sqlerrm=%, status final=%)', v_error, v_final_status;

  DELETE FROM cash_movements WHERE business_id = v_business_id AND branch_id = v_branch_id;
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM shifts WHERE business_id = v_business_id;
  DELETE FROM cash_registers WHERE id = v_cash_register_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 10: Pago CARD con payment_verifications CONFIRMED → aceptado ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_cash_register_id uuid;
  v_shift_id uuid;
  v_sale_id uuid := gen_random_uuid();
  -- El trigger sales_require_verified_external_tender exige que la evidencia
  -- este registrada con el id canonico 'sale-payment-<saleId>', que es el mismo
  -- que CashEngine.registerSalePaymentAtomic usa como idempotency key. Con un id
  -- arbitrario el trigger no encuentra la verificacion y la venta nunca llega a
  -- PAID.
  v_payment_id text;
  v_sale_status text;
BEGIN
  v_payment_id := 'sale-payment-' || v_sale_id::text;
  INSERT INTO businesses (name, timezone) VALUES ('TEST Card Verified', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'TEST Sucursal') RETURNING id INTO v_branch_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, current_setting('vimdy.step3_test_user_id')::uuid, 'CAJERO');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (v_business_id, v_branch_id, 'CARD-VERIFIED', 'Test verified card register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO v_cash_register_id;

  v_shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(v_shift_id, v_business_id, v_branch_id, v_cash_register_id, current_setting('vimdy.step3_test_user_id')::uuid, 0, 'Test verified shift');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object('status', 'PENDING_PAYMENT', 'total', 10000, 'items', '[]'::jsonb), now(), now());

  INSERT INTO payment_verifications (
    business_id, branch_id, sale_id, payment_id, method, amount,
    provider, provider_reference, status, verified_at
  ) VALUES (
    v_business_id, v_branch_id, v_sale_id, v_payment_id, 'CARD', 10000,
    'TEST_PROVIDER', 'PROVIDER-REAL-001', 'CONFIRMED', clock_timestamp()
  );

  PERFORM register_sale_payment_atomic((v_sale_id)::text, v_business_id, v_branch_id, v_payment_id, NULL,
    'CARD', 10000::numeric, 0::numeric, 10000::numeric, 0::numeric,
    'PROVIDER-REAL-001', v_cash_register_id, 'PROVIDER', v_shift_id
  );

  SELECT data->>'status' INTO v_sale_status FROM sales WHERE id = v_sale_id;

  IF v_sale_status <> 'PAID' THEN
    RAISE EXCEPTION 'FAIL: pago CARD con verificación debería dejar venta PAID, status: %', v_sale_status;
  END IF;

  RAISE NOTICE 'PASS: pago CARD con payment_verifications CONFIRMED es aceptado';

  DELETE FROM cash_movements WHERE business_id = v_business_id AND branch_id = v_branch_id;
  DELETE FROM payment_verifications WHERE business_id = v_business_id;
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM shifts WHERE business_id = v_business_id;
  DELETE FROM cash_registers WHERE id = v_cash_register_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- ============================================================================
-- AUDIT TRAIL
-- ============================================================================

-- === TEST 11: refund_sale_cash_atomic — registra audit_log ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_shift_id uuid;
  v_cash_register_id uuid;
  v_sale_id uuid := gen_random_uuid();
  v_audit_count integer;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Audit Trail', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'TEST Sucursal') RETURNING id INTO v_branch_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, current_setting('vimdy.step3_test_user_id')::uuid, 'ADMIN');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (v_business_id, v_branch_id, 'AUDIT-TRAIL', 'Test audit register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO v_cash_register_id;

  v_shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(v_shift_id, v_business_id, v_branch_id, v_cash_register_id, current_setting('vimdy.step3_test_user_id')::uuid, 50000, 'Test audit shift');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object(
      'status', 'PAID',
      'paymentStatus', 'CONFIRMED',
      'paymentMethod', 'CASH',
      'total', 10000,
      'subtotal', 8403,
      'tax', 1597,
      'discount', 0,
      'items', jsonb_build_array(
        jsonb_build_object('productId', gen_random_uuid()::text, 'quantity', 2, 'price', 4200)
      )
    ), now(), now());

  PERFORM refund_sale_cash_atomic(v_business_id, v_branch_id, (v_sale_id)::text, 'step3-audit-refund',
    jsonb_build_array(jsonb_build_object('productId', (SELECT (item->>'productId')::uuid FROM jsonb_array_elements((SELECT data->'items' FROM sales WHERE id = v_sale_id)) AS item LIMIT 1), 'quantity', 1)),
    'Test audit trail', v_cash_register_id);

  SELECT count(*) INTO v_audit_count
  FROM audit_logs
  WHERE business_id = v_business_id AND data->>'action' IN ('SALE_REFUNDED', 'SALE_PARTIALLY_REFUNDED');

  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: debería haber 1 audit log, se encontraron %', v_audit_count;
  END IF;

  RAISE NOTICE 'PASS: refund_sale_cash_atomic registra audit_log';

  DELETE FROM audit_logs WHERE business_id = v_business_id;
  DELETE FROM cash_movements WHERE business_id = v_business_id AND branch_id = v_branch_id;
  DELETE FROM payment_refunds WHERE business_id = v_business_id;
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM shifts WHERE business_id = v_business_id;
  DELETE FROM cash_registers WHERE id = v_cash_register_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- ============================================================================
-- HARDENING: over-refund, duplicados, aislamiento y rollback
-- ============================================================================

-- === TEST 12: over-refund rechazado y sin efecto financiero ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_shift_id uuid;
  v_cash_register_id uuid;
  v_sale_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_error text := '(sin excepcion)';
  v_raised boolean := false;
  v_movements integer;
  v_status text;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Over Refund', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'TEST Sucursal') RETURNING id INTO v_branch_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, current_setting('vimdy.step3_test_user_id')::uuid, 'ADMIN');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (v_business_id, v_branch_id, 'OVER-REFUND', 'Test over refund register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO v_cash_register_id;

  v_shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(v_shift_id, v_business_id, v_branch_id, v_cash_register_id, current_setting('vimdy.step3_test_user_id')::uuid, 50000, 'Test over refund shift');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object('status','PAID','paymentStatus','CONFIRMED','paymentMethod','CASH',
      'total', 10000, 'subtotal', 8403, 'tax', 1597, 'discount', 0,
      'items', jsonb_build_array(jsonb_build_object('productId', v_product_id::text, 'quantity', 2, 'price', 5000)),
      'code', 'TEST-OVER-REFUND'), now(), now());

  -- Pide 3 unidades cuando la venta solo tiene 2.
  BEGIN
    PERFORM refund_sale_cash_atomic(v_business_id, v_branch_id, (v_sale_id)::text, 'step3-over-refund',
      jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 3)),
      'Over refund', v_cash_register_id);
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
    IF strpos(v_error, 'REFUND_EXCEEDS_AVAILABLE') > 0 THEN v_raised := true; END IF;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: over-refund deberia rechazarse (sqlerrm=%)', v_error;
  END IF;

  -- Rechazo total: ni caja, ni refund ledger, ni cambio de estado.
  SELECT count(*) INTO v_movements FROM cash_movements
    WHERE business_id = v_business_id AND branch_id = v_branch_id AND idempotency_key = 'step3-over-refund';
  IF v_movements <> 0 THEN
    RAISE EXCEPTION 'FAIL: over-refund no debe crear movimientos de caja, hallados %', v_movements;
  END IF;

  SELECT count(*) INTO v_movements FROM payment_refunds WHERE business_id = v_business_id;
  IF v_movements <> 0 THEN
    RAISE EXCEPTION 'FAIL: over-refund no debe escribir en payment_refunds, hallados %', v_movements;
  END IF;

  SELECT data->>'status' INTO v_status FROM sales WHERE id = v_sale_id;
  IF v_status <> 'PAID' THEN
    RAISE EXCEPTION 'FAIL: la venta debe seguir PAID tras un over-refund rechazado, status: %', v_status;
  END IF;

  RAISE NOTICE 'PASS: over-refund rechazado sin efecto financiero';

  DELETE FROM cash_movements WHERE business_id = v_business_id AND branch_id = v_branch_id;
  DELETE FROM payment_refunds WHERE business_id = v_business_id;
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM shifts WHERE business_id = v_business_id;
  DELETE FROM cash_registers WHERE id = v_cash_register_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 13: refund duplicado con clave DISTINTA no devuelve dos veces ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_shift_id uuid;
  v_cash_register_id uuid;
  v_sale_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_error text := '(sin excepcion)';
  v_raised boolean := false;
  v_total_out numeric;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Duplicate Refund', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'TEST Sucursal') RETURNING id INTO v_branch_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, current_setting('vimdy.step3_test_user_id')::uuid, 'ADMIN');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (v_business_id, v_branch_id, 'DUP-REFUND', 'Test dup register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO v_cash_register_id;

  v_shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(v_shift_id, v_business_id, v_branch_id, v_cash_register_id, current_setting('vimdy.step3_test_user_id')::uuid, 50000, 'Test dup refund shift');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object('status','PAID','paymentStatus','CONFIRMED','paymentMethod','CASH',
      'total', 10000, 'subtotal', 8403, 'tax', 1597, 'discount', 0,
      'items', jsonb_build_array(jsonb_build_object('productId', v_product_id::text, 'quantity', 2, 'price', 5000)),
      'code', 'TEST-DUP-REFUND'), now(), now());

  -- Primer reembolso: 1 unidad, clave A.
  PERFORM refund_sale_cash_atomic(v_business_id, v_branch_id, (v_sale_id)::text, 'step3-dup-A',
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
    'Primer reembolso', v_cash_register_id);

  -- Segundo reembolso de la MISMA unidad pero con clave DISTINTA: la RPC debe
  -- rechazarlo por sobre-reembolso, no devolver la unidad dos veces.
  BEGIN
    PERFORM refund_sale_cash_atomic(v_business_id, v_branch_id, (v_sale_id)::text, 'step3-dup-B',
      jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 2)),
      'Reembolso duplicado', v_cash_register_id);
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
    v_raised := true;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: un refund duplicado con clave distinta deberia rechazarse';
  END IF;

  -- Aunque la segunda llamada falle por la regla que sea, el total de salidas de
  -- caja nunca puede superar el total de la venta.
  SELECT COALESCE(sum((data->>'amount')::numeric), 0) INTO v_total_out
    FROM cash_movements
    WHERE business_id = v_business_id AND branch_id = v_branch_id AND data->>'type' = 'OUT';

  IF v_total_out > 10000 THEN
    RAISE EXCEPTION 'FAIL: el total reembolsado supera el total de la venta: %', v_total_out;
  END IF;

  RAISE NOTICE 'PASS: refund duplicado con clave distinta rechazado (sqlerrm=%, total OUT=%)', v_error, v_total_out;

  DELETE FROM cash_movements WHERE business_id = v_business_id AND branch_id = v_branch_id;
  DELETE FROM payment_refunds WHERE business_id = v_business_id;
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM shifts WHERE business_id = v_business_id;
  DELETE FROM cash_registers WHERE id = v_cash_register_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 14: refund entre negocios distintos rechazado (tenant isolation) ===
DO $$
DECLARE
  v_business_a uuid;
  v_business_b uuid;
  v_branch_a uuid;
  v_branch_b uuid;
  v_sale_id uuid := gen_random_uuid();
  v_error text := '(sin excepcion)';
  v_raised boolean := false;
  v_movements integer;
  v_status text;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Tenant A Refund', 'America/Bogota') RETURNING id INTO v_business_a;
  INSERT INTO branches (business_id, name) VALUES (v_business_a, 'SUC A') RETURNING id INTO v_branch_a;
  INSERT INTO businesses (name, timezone) VALUES ('TEST Tenant B Refund', 'America/Bogota') RETURNING id INTO v_business_b;
  INSERT INTO branches (business_id, name) VALUES (v_business_b, 'SUC B') RETURNING id INTO v_branch_b;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  -- El actor es ADMIN solo del negocio A.
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_a, current_setting('vimdy.step3_test_user_id')::uuid, 'ADMIN');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_a, v_branch_a, 1,
    jsonb_build_object('status','PAID','paymentStatus','CONFIRMED','paymentMethod','CASH',
      'total', 10000, 'subtotal', 8403, 'tax', 1597, 'discount', 0,
      'items', jsonb_build_array(jsonb_build_object('productId', gen_random_uuid()::text, 'quantity', 1, 'price', 5000)),
      'code', 'TEST-CROSS-TENANT'), now(), now());

  -- Intenta reembolsar la venta de A pasando el contexto del negocio B.
  BEGIN
    PERFORM refund_sale_cash_atomic(v_business_b, v_branch_b, (v_sale_id)::text, 'step3-cross-tenant',
      jsonb_build_array(jsonb_build_object('productId',
        (SELECT (item->>'productId')::uuid FROM jsonb_array_elements((SELECT data->'items' FROM sales WHERE id = v_sale_id)) AS item LIMIT 1),
        'quantity', 1)),
      'Intento cross-tenant', NULL);
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
    v_raised := true;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: un refund entre negocios distintos deberia rechazarse';
  END IF;

  SELECT count(*) INTO v_movements FROM cash_movements WHERE idempotency_key = 'step3-cross-tenant';
  IF v_movements <> 0 THEN
    RAISE EXCEPTION 'FAIL: el refund cross-tenant no debe crear movimientos de caja';
  END IF;

  SELECT data->>'status' INTO v_status FROM sales WHERE id = v_sale_id;
  IF v_status <> 'PAID' THEN
    RAISE EXCEPTION 'FAIL: la venta del negocio A no debe cambiar de estado, quedo: %', v_status;
  END IF;

  RAISE NOTICE 'PASS: refund entre negocios distintos rechazado (sqlerrm=%, status venta A=%)', v_error, v_status;

  DELETE FROM cash_movements WHERE business_id IN (v_business_a, v_business_b);
  DELETE FROM payment_refunds WHERE business_id IN (v_business_a, v_business_b);
  DELETE FROM sales WHERE business_id IN (v_business_a, v_business_b);
  DELETE FROM business_members WHERE business_id IN (v_business_a, v_business_b);
  DELETE FROM branches WHERE business_id IN (v_business_a, v_business_b);
  DELETE FROM businesses WHERE id IN (v_business_a, v_business_b);
END $$;


-- === TEST 15: refund fallido no deja ningun rastro financiero ===
-- La RPC es validate-then-write dentro de UNA transaccion: valida venta, metodo,
-- monto, turno y disponibilidad antes de escribir, y cualquier fallo posterior
-- revierte lo ya escrito. Aqui se fuerza un fallo realista y determinista
-- (cajon sin efectivo) y se comprueba que no queda nada a medias: sin salida de
-- caja, sin registro en payment_refunds y con la venta intacta en PAID.
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_shift_id uuid;
  v_cash_register_id uuid;
  v_sale_id uuid := gen_random_uuid();
  v_error text := '(sin excepcion)';
  v_raised boolean := false;
  v_movements integer;
  v_refunds integer;
  v_status text;
  v_product_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Refund Rollback', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'TEST Sucursal') RETURNING id INTO v_branch_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, current_setting('vimdy.step3_test_user_id')::uuid, 'ADMIN');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (v_business_id, v_branch_id, 'ROLLBACK', 'Test rollback register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO v_cash_register_id;

  -- Turno abierto con fondo 0: no hay efectivo para devolver.
  v_shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(v_shift_id, v_business_id, v_branch_id, v_cash_register_id, current_setting('vimdy.step3_test_user_id')::uuid, 0, 'Test rollback shift');

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object('status','PAID','paymentStatus','CONFIRMED','paymentMethod','CASH',
      'total', 10000, 'subtotal', 8403, 'tax', 1597, 'discount', 0,
      'items', jsonb_build_array(jsonb_build_object('productId', v_product_id::text, 'quantity', 1, 'price', 5000)),
      'code', 'TEST-ROLLBACK'), now(), now());

  BEGIN
    PERFORM refund_sale_cash_atomic(v_business_id, v_branch_id, (v_sale_id)::text, 'step3-rollback',
      jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
      'Rollback', v_cash_register_id);
  EXCEPTION WHEN OTHERS THEN
    v_error := sqlerrm;
    v_raised := true;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: un refund sin efectivo disponible deberia fallar';
  END IF;

  IF strpos(v_error, 'CAJA_EFECTIVO_INSUFICIENTE') = 0 THEN
    RAISE EXCEPTION 'FAIL: se esperaba CAJA_EFECTIVO_INSUFICIENTE, se obtuvo: %', v_error;
  END IF;

  SELECT count(*) INTO v_movements FROM cash_movements
    WHERE business_id = v_business_id AND branch_id = v_branch_id AND idempotency_key = 'step3-rollback';
  SELECT count(*) INTO v_refunds FROM payment_refunds WHERE business_id = v_business_id;
  SELECT data->>'status' INTO v_status FROM sales WHERE id = v_sale_id;

  IF v_movements <> 0 OR v_refunds <> 0 OR v_status <> 'PAID' THEN
    RAISE EXCEPTION 'FAIL: rollback incompleto (movimientos=% refunds=% status=%)', v_movements, v_refunds, v_status;
  END IF;

  RAISE NOTICE 'PASS: refund fallido no deja rastro financiero (sqlerrm=%, movimientos=0, refunds=0, status=PAID)', v_error;

  DELETE FROM cash_movements WHERE business_id = v_business_id AND branch_id = v_branch_id;
  DELETE FROM payment_refunds WHERE business_id = v_business_id;
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM shifts WHERE business_id = v_business_id;
  DELETE FROM cash_registers WHERE id = v_cash_register_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- === TEST 16: confirmacion duplicada del proveedor no duplica caja ===
DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_shift_id uuid;
  v_cash_register_id uuid;
  v_sale_id uuid := gen_random_uuid();
  v_payment_id text;
  v_movements integer;
  v_status text;
BEGIN
  INSERT INTO businesses (name, timezone) VALUES ('TEST Duplicate Confirm', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name) VALUES (v_business_id, 'TEST Sucursal') RETURNING id INTO v_branch_id;

  PERFORM set_config('request.jwt.claim.sub', current_setting('vimdy.step3_test_user_id'), true);
  INSERT INTO business_members (business_id, user_id, role) VALUES (v_business_id, current_setting('vimdy.step3_test_user_id')::uuid, 'CAJERO');

  INSERT INTO cash_registers (business_id, branch_id, code, name, active, status, data)
  VALUES (v_business_id, v_branch_id, 'DUP-CONFIRM', 'Test dup confirm register', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO v_cash_register_id;

  v_shift_id := gen_random_uuid();
  PERFORM open_shift_atomic(v_shift_id, v_business_id, v_branch_id, v_cash_register_id, current_setting('vimdy.step3_test_user_id')::uuid, 50000, 'Test dup confirm shift');

  v_payment_id := 'sale-payment-' || v_sale_id::text;

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object('status','PENDING_PAYMENT','total',10000,'items','[]'::jsonb), now(), now());

  INSERT INTO payment_verifications (
    business_id, branch_id, sale_id, payment_id, method, amount,
    provider, provider_reference, status, verified_at
  ) VALUES (
    v_business_id, v_branch_id, v_sale_id, v_payment_id, 'CARD', 10000,
    'TEST_PROVIDER', 'PROVIDER-DUP-001', 'CONFIRMED', clock_timestamp()
  );

  -- Primera confirmacion.
  PERFORM register_sale_payment_atomic((v_sale_id)::text, v_business_id, v_branch_id, v_payment_id, NULL,
    'CARD', 10000::numeric, 0::numeric, 10000::numeric, 0::numeric,
    'PROVIDER-DUP-001', v_cash_register_id, 'PROVIDER', v_shift_id);

  -- El proveedor reintenta el webhook con la MISMA evidencia: la RPC debe
  -- devolver el movimiento original, no crear un segundo ingreso.
  PERFORM register_sale_payment_atomic((v_sale_id)::text, v_business_id, v_branch_id, v_payment_id, NULL,
    'CARD', 10000::numeric, 0::numeric, 10000::numeric, 0::numeric,
    'PROVIDER-DUP-001', v_cash_register_id, 'PROVIDER', v_shift_id);

  SELECT count(*) INTO v_movements FROM cash_movements
    WHERE business_id = v_business_id AND branch_id = v_branch_id AND idempotency_key = v_payment_id;
  IF v_movements <> 1 THEN
    RAISE EXCEPTION 'FAIL: la confirmacion duplicada debe dejar 1 solo movimiento, hallados %', v_movements;
  END IF;

  SELECT data->>'status' INTO v_status FROM sales WHERE id = v_sale_id;
  IF v_status <> 'PAID' THEN
    RAISE EXCEPTION 'FAIL: la venta debe quedar PAID, status: %', v_status;
  END IF;

  RAISE NOTICE 'PASS: confirmacion duplicada del proveedor no duplica caja (movimientos=1)';

  DELETE FROM cash_movements WHERE business_id = v_business_id AND branch_id = v_branch_id;
  DELETE FROM payment_verifications WHERE business_id = v_business_id;
  DELETE FROM sales WHERE business_id = v_business_id;
  DELETE FROM shifts WHERE business_id = v_business_id;
  DELETE FROM cash_registers WHERE id = v_cash_register_id;
  DELETE FROM business_members WHERE business_id = v_business_id;
  DELETE FROM branches WHERE business_id = v_business_id;
  DELETE FROM businesses WHERE id = v_business_id;
END $$;


-- ============================================================================
-- CLEANUP
-- ============================================================================
RESET vimdy.step3_test_user_id;

-- === TESTS PASSED ===
-- === Todos los tests de Paso 3 (step3_payments_refunds.test.sql) pasaron ===
