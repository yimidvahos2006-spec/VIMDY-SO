-- ============================================================================
-- caja_payment_verification.test.sql
-- ----------------------------------------------------------------------------
-- Valida el principio de seguridad de pagos digitales de Caja Enterprise V2:
-- una transferencia/QR NO puede confirmar una venta sin una verificación de
-- proveedor registrada por un proceso de servidor/trusted role.
--
-- Este archivo requiere aplicar primero:
--   supabase/migrations/20260927230000_caja_enterprise_v2.sql
--
-- El bloque usa un usuario REAL existente en auth.users para la parte RBAC.
-- La inserción de la fila CONFIRMED en payment_verifications simula el lado
-- trusted del proveedor (un webhook/Edge Function con service role), no al
-- navegador del cajero.
-- ============================================================================

DO $$
DECLARE
  v_user_id uuid;
  b_id uuid;
  br_id uuid;
  shift_id uuid;
  sale_id text := 'verification-test-sale';
  payment_id text := 'verification-test-payment';
  movement_count integer;
  sale_status text;
  verification_source text;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'CAJA_TEST_SETUP_REQUIRED: se necesita un usuario real en auth.users.';
  END IF;

  INSERT INTO businesses (name, timezone)
  VALUES ('TEST Payment Verification', 'America/Bogota')
  RETURNING id INTO b_id;

  INSERT INTO branches (business_id, name)
  VALUES (b_id, 'TEST Sucursal')
  RETURNING id INTO br_id;

  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO business_members (business_id, user_id, role)
  VALUES (b_id, v_user_id, 'CAJERO');

  INSERT INTO shifts (business_id, branch_id, version, data)
  VALUES (
    b_id,
    br_id,
    1,
    jsonb_build_object(
      'status', 'OPEN',
      'openedAt', now(),
      'openingAmount', 0,
      'cashierId', v_user_id::text
    )
  )
  RETURNING id INTO shift_id;

  INSERT INTO sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (
    sale_id,
    b_id,
    br_id,
    1,
    jsonb_build_object(
      'status', 'PENDING_PAYMENT',
      'type', 'QUICK',
      'total', 10000,
      'subtotal', 10000,
      'tax', 0,
      'discount', 0,
      'items', '[]'::jsonb,
      'code', 'TEST-VERIFY-001'
    ),
    now(),
    now()
  );

  -- Sin evidencia CONFIRMED del proveedor: debe rechazar.
  BEGIN
    PERFORM register_sale_payment_atomic(
      sale_id, b_id, br_id, payment_id, NULL,
      'TRANSFER', 10000, 0, 10000, 0, 'REFERENCIA-FAKE'
    );
    RAISE EXCEPTION 'FAIL: una transferencia sin payment_verifications CONFIRMED fue aceptada.';
  EXCEPTION
    WHEN OTHERS THEN
      IF strpos(sqlerrm, 'CAJA_PAYMENT_NOT_VERIFIED') = 0 THEN
        RAISE;
      END IF;
  END;

  SELECT count(*) INTO movement_count
  FROM cash_movements
  WHERE business_id = b_id AND branch_id = br_id AND idempotency_key = payment_id;

  IF movement_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: se creó un movimiento financiero para un pago no verificado.';
  END IF;

  -- Simulación del proceso trusted: webhook/Edge Function registra la evidencia.
  INSERT INTO payment_verifications (
    business_id, branch_id, sale_id, payment_id, method, amount,
    provider, provider_reference, status, verified_at
  )
  VALUES (
    b_id, br_id, sale_id, payment_id, 'TRANSFER', 10000,
    'TEST_PROVIDER', 'PROVIDER-REAL-001', 'CONFIRMED', clock_timestamp()
  );

  PERFORM register_sale_payment_atomic(
    sale_id, b_id, br_id, payment_id, NULL,
    'TRANSFER', 10000, 0, 10000, 0, 'PROVIDER-REAL-001', NULL, 'PROVIDER'
  );

  SELECT data->>'status' INTO sale_status
  FROM sales
  WHERE id = sale_id;

  IF sale_status <> 'PAID' THEN
    RAISE EXCEPTION 'FAIL: el pago con evidencia confirmada no dejó la venta PAID.';
  END IF;

  SELECT data->>'paymentVerificationSource' INTO verification_source
  FROM cash_movements
  WHERE business_id = b_id
    AND branch_id = br_id
    AND idempotency_key = payment_id;

  IF verification_source <> 'PROVIDER' THEN
    RAISE EXCEPTION 'FAIL: el movimiento no quedó marcado con origen PROVIDER.';
  END IF;

  RAISE NOTICE 'PASS: TRANSFER sin evidencia es rechazada; TRANSFER con evidencia trusted CONFIRMED es aceptada.';

  DELETE FROM cash_movements WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM payment_verifications WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM sales WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM shifts WHERE business_id = b_id AND branch_id = br_id;
  DELETE FROM business_members WHERE business_id = b_id;
  DELETE FROM branches WHERE business_id = b_id;
  DELETE FROM businesses WHERE id = b_id;
END $$;


-- Integrity assertions for the server-side confirmation path.
-- These require the existing harness/fixtures and must run against real Supabase.
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'payment_verifications_confirmed_consistency_ck'
      AND t.relname = 'payment_verifications'
      AND n.nspname = 'public'
  ) THEN 'PASS' ELSE 'FAIL' END
  AS confirmed_requires_provider_evidence_constraint;

SELECT CASE
  WHEN NOT has_table_privilege('authenticated', 'public.payment_verifications', 'INSERT')
   AND NOT has_table_privilege('authenticated', 'public.payment_verifications', 'UPDATE')
   AND NOT has_table_privilege('authenticated', 'public.payment_verifications', 'DELETE')
  THEN 'PASS' ELSE 'FAIL' END
  AS payment_verification_not_client_writable;
