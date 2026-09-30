-- ============================================================================
-- VIMDY CAJA ENTERPRISE V4 — TESTS SQL MANUALES
-- Ejecutar en Supabase SQL Editor después de V4.
-- Reutiliza un usuario real de auth.users como actor del test.
-- ============================================================================

-- 1) Estructura + privilegios
SELECT CASE WHEN to_regclass('public.cash_drawer_counts') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS cash_drawer_counts_exists;
SELECT CASE WHEN to_regclass('public.cash_register_transfers') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS cash_register_transfers_exists;
SELECT CASE WHEN has_function_privilege('authenticated', 'public.register_cash_movement_enterprise(text,uuid,uuid,uuid,uuid,text,numeric,text,text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END AS enterprise_movement_rpc_grant;
SELECT CASE WHEN has_function_privilege('authenticated', 'public.close_shift_with_cash_count_atomic(uuid,uuid,uuid,uuid,numeric,jsonb,text,text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END AS blind_close_rpc_grant;
SELECT CASE WHEN has_function_privilege('authenticated', 'public.transfer_cash_between_registers_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,numeric,text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END AS transfer_rpc_grant;

SELECT CASE
  WHEN NOT has_table_privilege('authenticated', 'public.cash_drawer_counts', 'INSERT')
   AND NOT has_table_privilege('authenticated', 'public.cash_drawer_counts', 'UPDATE')
   AND NOT has_table_privilege('authenticated', 'public.cash_drawer_counts', 'DELETE')
  THEN 'PASS' ELSE 'FAIL' END AS drawer_count_not_client_writable;

-- 2) Constraint histórica validada
SELECT CASE
  WHEN c.convalidated
  THEN 'PASS' ELSE 'FAIL' END AS payment_verifications_constraint_validated
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE c.conname = 'payment_verifications_confirmed_consistency_ck'
  AND t.relname = 'payment_verifications'
  AND n.nspname = 'public';

-- 3) Escenario funcional completo.
DO $$
DECLARE
  v_user_id uuid;
  v_business_id uuid;
  v_branch_id uuid;
  v_reg_1 uuid;
  v_reg_2 uuid;
  v_shift_1 uuid;
  v_shift_2 uuid;
  v_transfer_id uuid := gen_random_uuid();
  v_result record;
  v_movement_count integer;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'CAJA_TEST_SETUP_REQUIRED'; END IF;

  INSERT INTO public.businesses(name, timezone) VALUES ('TEST Caja V4', 'America/Bogota') RETURNING id INTO v_business_id;
  INSERT INTO public.branches(business_id, name) VALUES (v_business_id, 'TEST Principal') RETURNING id INTO v_branch_id;
  INSERT INTO public.business_members(business_id, user_id, role) VALUES (v_business_id, v_user_id, 'ADMIN');

  INSERT INTO public.cash_registers(business_id, branch_id, code, name, active, status, data)
  VALUES (v_business_id, v_branch_id, 'C01', 'Caja 01', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO v_reg_1;
  INSERT INTO public.cash_registers(business_id, branch_id, code, name, active, status, data)
  VALUES (v_business_id, v_branch_id, 'C02', 'Caja 02', true, 'ACTIVE', '{}'::jsonb)
  RETURNING id INTO v_reg_2;

  INSERT INTO public.shifts(business_id, branch_id, cash_register_id, version, data)
  VALUES (v_business_id, v_branch_id, v_reg_1, 1,
    jsonb_build_object('status','OPEN','openedAt',now(),'openingAmount',100000,'cashierId',v_user_id::text))
  RETURNING id INTO v_shift_1;

  INSERT INTO public.shifts(business_id, branch_id, cash_register_id, version, data)
  VALUES (v_business_id, v_branch_id, v_reg_2, 1,
    jsonb_build_object('status','OPEN','openedAt',now(),'openingAmount',0,'cashierId',v_user_id::text))
  RETURNING id INTO v_shift_2;

  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  -- Entrada manual + idempotencia.
  SELECT * INTO v_result FROM public.register_cash_movement_enterprise(
    'v4-in-1', v_business_id, v_branch_id, v_reg_1, v_shift_1, 'IN', 10000, 'CHANGE_FUND_IN', 'Cambio adicional'
  );
  SELECT * INTO v_result FROM public.register_cash_movement_enterprise(
    'v4-in-1', v_business_id, v_branch_id, v_reg_1, v_shift_1, 'IN', 10000, 'CHANGE_FUND_IN', 'Cambio adicional'
  );

  BEGIN
    PERFORM public.register_cash_movement_enterprise(
      'v4-in-1', v_business_id, v_branch_id, v_reg_1, v_shift_1, 'IN', 11000, 'OTHER_IN', 'Otro ingreso'
    );
    RAISE EXCEPTION 'FAIL: se permitió reutilizar la clave de movimiento con datos diferentes';
  EXCEPTION WHEN OTHERS THEN
    IF strpos(sqlerrm, 'CAJA_IDEMPOTENCY_KEY_REUSED') = 0 THEN RAISE; END IF;
  END;

  -- Salida superior al efectivo disponible debe fallar.
  BEGIN
    PERFORM public.register_cash_movement_enterprise(
      'v4-out-too-much', v_business_id, v_branch_id, v_reg_1, v_shift_1, 'OUT', 999999, 'EXPENSE', 'Gasto imposible'
    );
    RAISE EXCEPTION 'FAIL: se permitió salida superior al efectivo disponible';
  EXCEPTION WHEN OTHERS THEN
    IF strpos(sqlerrm, 'CAJA_EFECTIVO_INSUFICIENTE') = 0 THEN RAISE; END IF;
  END;

  -- Transferencia atómica 25.000 a caja 02.
  SELECT * INTO v_result FROM public.transfer_cash_between_registers_atomic(
    v_transfer_id, v_business_id, v_branch_id, v_reg_1, v_reg_2, v_shift_1, v_shift_2, 25000, 'Fondo de cambio'
  );

  -- Reintento exacto: devuelve la misma transferencia sin duplicar movimientos.
  SELECT * INTO v_result FROM public.transfer_cash_between_registers_atomic(
    v_transfer_id, v_business_id, v_branch_id, v_reg_1, v_reg_2, v_shift_1, v_shift_2, 25000, 'Fondo de cambio'
  );

  BEGIN
    PERFORM public.transfer_cash_between_registers_atomic(
      v_transfer_id, v_business_id, v_branch_id, v_reg_1, v_reg_2, v_shift_1, v_shift_2, 26000, 'Fondo de cambio'
    );
    RAISE EXCEPTION 'FAIL: se permitió reutilizar la transferencia con datos diferentes';
  EXCEPTION WHEN OTHERS THEN
    IF strpos(sqlerrm, 'CAJA_TRANSFER_IDEMPOTENCY_KEY_REUSED') = 0 THEN RAISE; END IF;
  END;

  -- El conteo físico del turno 1: 85.000 (100k +10k -25k).
  SELECT * INTO v_result FROM public.close_shift_with_cash_count_atomic(
    v_shift_1, v_business_id, v_branch_id, v_reg_1, 85000,
    jsonb_build_object('50000',1,'20000',1,'10000',1,'5000',1), 'COP', 'Cierre V4 de prueba'
  );

  -- Reintento exacto del cierre: devuelve el snapshot existente.
  SELECT * INTO v_result FROM public.close_shift_with_cash_count_atomic(
    v_shift_1, v_business_id, v_branch_id, v_reg_1, 85000,
    jsonb_build_object('50000',1,'20000',1,'10000',1,'5000',1), 'COP', 'Cierre V4 de prueba'
  );

  BEGIN
    PERFORM public.close_shift_with_cash_count_atomic(
      v_shift_1, v_business_id, v_branch_id, v_reg_1, 84000,
      jsonb_build_object('50000',1,'20000',1,'10000',1,'2000',2), 'COP', 'Intento diferente'
    );
    RAISE EXCEPTION 'FAIL: se permitió reutilizar el cierre con un conteo diferente';
  EXCEPTION WHEN OTHERS THEN
    IF strpos(sqlerrm, 'CAJA_CLOSE_IDEMPOTENCY_KEY_REUSED') = 0 THEN RAISE; END IF;
  END;

  SELECT count(*) INTO v_movement_count
  FROM public.cash_movements
  WHERE business_id=v_business_id AND branch_id=v_branch_id AND shift_id=v_shift_1::text;
  IF v_movement_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: movimientos esperados en turno 1 = 2, actual = %', v_movement_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cash_drawer_counts
    WHERE shift_id=v_shift_1 AND counted_amount=85000 AND difference=0 AND blind=true
  ) THEN
    RAISE EXCEPTION 'FAIL: snapshot de arqueo ciego no quedó almacenado correctamente';
  END IF;

  RAISE NOTICE 'PASS: V4 movimiento tipificado + límite de efectivo + transferencia atómica + arqueo ciego';

  DELETE FROM public.cash_drawer_counts WHERE business_id=v_business_id;
  DELETE FROM public.cash_movements WHERE business_id=v_business_id;
  DELETE FROM public.cash_register_transfers WHERE business_id=v_business_id;
  DELETE FROM public.shifts WHERE business_id=v_business_id;
  DELETE FROM public.cash_registers WHERE business_id=v_business_id;
  DELETE FROM public.business_members WHERE business_id=v_business_id;
  DELETE FROM public.branches WHERE business_id=v_business_id;
  DELETE FROM public.businesses WHERE id=v_business_id;
END $$;
