-- ============================================================================
-- close_shift_requires_cash_count.test.sql
-- Verifica que NO exista cierre de turno sin arqueo desde el cliente.
-- Ejecutar con un rol administrador (postgres) despues de aplicar
-- 20261110000000_close_shift_requires_cash_count.sql
-- ============================================================================

-- A) Permisos: ningun rol de cliente ejecuta close_shift_atomic.
DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(v_role, 'public.close_shift_atomic(uuid,numeric,text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % puede ejecutar close_shift_atomic', v_role;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = 'public.close_shift_atomic(uuid,numeric,text)'::regprocedure
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: PUBLIC puede ejecutar close_shift_atomic';
  END IF;

  RAISE NOTICE 'PASS: close_shift_atomic no es ejecutable por PUBLIC/anon/authenticated/service_role';
END $$;

-- B) La implementacion interna tampoco es accesible.
DO $$
DECLARE
  v_role text;
BEGIN
  IF to_regprocedure('public.caja_internal_close_shift_atomic(uuid,numeric,text)') IS NULL THEN
    RAISE NOTICE 'SKIP: caja_internal_close_shift_atomic no existe';
    RETURN;
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(v_role, 'public.caja_internal_close_shift_atomic(uuid,numeric,text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % puede ejecutar caja_internal_close_shift_atomic', v_role;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: caja_internal_close_shift_atomic cerrada';
END $$;

-- C) La unica via publica de cierre sigue abierta para authenticated y cerrada para anon.
DO $$
BEGIN
  IF NOT has_function_privilege('authenticated',
       'public.close_shift_with_cash_count_atomic(uuid,uuid,uuid,uuid,numeric,jsonb,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated no puede ejecutar close_shift_with_cash_count_atomic';
  END IF;
  IF has_function_privilege('anon',
       'public.close_shift_with_cash_count_atomic(uuid,uuid,uuid,uuid,numeric,jsonb,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon puede ejecutar close_shift_with_cash_count_atomic';
  END IF;
  RAISE NOTICE 'PASS: close_shift_with_cash_count_atomic es la unica via publica de cierre';
END $$;

-- D) Comportamiento: un usuario authenticated recibe permission denied (42501).
DO $$
DECLARE
  v_blocked boolean := false;
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.close_shift_atomic(gen_random_uuid(), 0, 'bypass sin arqueo');
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  RESET ROLE;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FAIL: authenticated logro invocar close_shift_atomic';
  END IF;
  RAISE NOTICE 'PASS: authenticated recibe permission denied al llamar close_shift_atomic';
END $$;