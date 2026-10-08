-- ============================================================================
-- step8_customer_purchase_stats.test.sql — Paso 6 · A7.4-B
-- ----------------------------------------------------------------------------
-- Verifica public.get_customer_purchase_stats(uuid) contra el esquema real
-- (public.sales documental) y, sobre todo, que un negocio NO puede leer las
-- estadisticas de otro (el IDOR que traia la version historica perdida).
--
-- Requiere un usuario real en auth.users (mismo patron que step6/step4).
-- ============================================================================

DO $$
DECLARE
  v_user_id uuid;
  v_biz_a uuid;
  v_biz_b uuid;
  v_branch uuid;
  v_err text := '(sin excepcion)';
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'STEP8_CUSTOMER_STATS_SETUP_REQUIRED: se necesita un usuario real en auth.users.';
  END IF;

  PERFORM set_config('vimdy.step8_test_user_id', v_user_id::text, false);
  RAISE NOTICE 'STEP8 CUSTOMER STATS TEST USER: %', v_user_id;

  INSERT INTO businesses (id, name, timezone, plan, renewal_date)
  VALUES ('a8000000-0000-4000-8000-000000000001', 'Stats Biz A', 'America/Bogota', 'monthly', NULL),
         ('a8000000-0000-4000-8000-000000000002', 'Stats Biz B', 'America/Bogota', 'monthly', NULL);

  INSERT INTO branches (business_id, name)
  VALUES ('a8000000-0000-4000-8000-000000000001', 'SUC A');
  SELECT id INTO v_branch FROM branches
   WHERE business_id = 'a8000000-0000-4000-8000-000000000001' LIMIT 1;

  -- El usuario es ADMIN de A y NO miembro de B.
  INSERT INTO business_members (business_id, user_id, role)
  VALUES ('a8000000-0000-4000-8000-000000000001', v_user_id, 'ADMIN');
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  -------------------------------------------------------------------
  -- CASO 1: cliente sin compras -> no aparece en el resultado
  -------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM public.get_customer_purchase_stats('a8000000-0000-4000-8000-000000000001'::uuid) s
     WHERE s.customer_id = 'cli-sin-compras'
  ) THEN
    RAISE EXCEPTION 'FAIL: un cliente sin compras no debe aparecer';
  END IF;

  -------------------------------------------------------------------
  -- CASO 2: una venta PAID y varias (CLOSED) -> conteo, LTV y ultima fecha
  -------------------------------------------------------------------
  INSERT INTO public.sales (id, business_id, branch_id, version, data, created_at, updated_at) VALUES
    ('b8000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001', v_branch, 1,
     '{"paymentMethod":"CASH","customerId":"cli-1","status":"PAID","total":"10000"}'::jsonb, '2026-03-01T10:00:00Z', now()),
    ('b8000000-0000-4000-8000-000000000002','a8000000-0000-4000-8000-000000000001', v_branch, 1,
     '{"paymentMethod":"CASH","customerId":"cli-1","status":"CLOSED","total":"5000.50"}'::jsonb, '2026-03-05T10:00:00Z', now()),
    -- estados que NO deben contar
    ('b8000000-0000-4000-8000-000000000003','a8000000-0000-4000-8000-000000000001', v_branch, 1,
     '{"paymentMethod":"CASH","customerId":"cli-1","status":"PENDING_PAYMENT","total":"999"}'::jsonb, '2026-03-06T10:00:00Z', now()),
    ('b8000000-0000-4000-8000-000000000004','a8000000-0000-4000-8000-000000000001', v_branch, 1,
     '{"paymentMethod":"CASH","customerId":"cli-1","status":"OPEN","total":"888"}'::jsonb, '2026-03-07T10:00:00Z', now()),
    ('b8000000-0000-4000-8000-000000000005','a8000000-0000-4000-8000-000000000001', v_branch, 1,
     '{"paymentMethod":"CASH","customerId":"cli-1","status":"CANCELLED","total":"777"}'::jsonb, '2026-03-08T10:00:00Z', now()),
    -- customerId vacio / whitespace / ausente
    ('b8000000-0000-4000-8000-000000000006','a8000000-0000-4000-8000-000000000001', v_branch, 1,
     '{"paymentMethod":"CASH","customerId":"   ","status":"PAID","total":"666"}'::jsonb, '2026-03-09T10:00:00Z', now()),
    ('b8000000-0000-4000-8000-000000000007','a8000000-0000-4000-8000-000000000001', v_branch, 1,
     '{"paymentMethod":"CASH","status":"PAID","total":"555"}'::jsonb, '2026-03-10T10:00:00Z', now()),
    -- total sucio: no debe romper la consulta
    ('b8000000-0000-4000-8000-000000000008','a8000000-0000-4000-8000-000000000001', v_branch, 1,
     '{"paymentMethod":"CASH","customerId":"cli-1","status":"PAID","total":"1.000,50"}'::jsonb, '2026-03-11T10:00:00Z', now()),
    ('b8000000-0000-4000-8000-000000000009','a8000000-0000-4000-8000-000000000001', v_branch, 1,
     '{"paymentMethod":"CASH","customerId":"cli-1","status":"PAID","total":"NaN"}'::jsonb, '2026-03-12T10:00:00Z', now());

  DECLARE
    v_count bigint; v_ltv numeric; v_last timestamptz;
  BEGIN
    SELECT s.purchase_count, s.ltv, s.last_purchase_at
      INTO v_count, v_ltv, v_last
      FROM public.get_customer_purchase_stats('a8000000-0000-4000-8000-000000000001'::uuid) s
     WHERE s.customer_id = 'cli-1';

    -- Solo las 2 ventas cobradas (PAID + CLOSED). Los 2 totales sucios
    -- cuentan para el conteo pero aportan 0 al LTV (con version segura).
    IF v_count <> 4 THEN
      RAISE EXCEPTION 'FAIL: purchase_count esperado 4 (2 cobradas + 2 con total sucio), obtenido %', v_count;
    END IF;
    IF v_ltv <> 15000.50 THEN
      RAISE EXCEPTION 'FAIL: ltv esperado 15000.50, obtenido %', v_ltv;
    END IF;
    IF v_last <> '2026-03-12T10:00:00Z'::timestamptz THEN
      RAISE EXCEPTION 'FAIL: last_purchase_at esperado 2026-03-12, obtenido %', v_last;
    END IF;

    RAISE NOTICE 'PASS: purchase_count=4, ltv=15000.50, last_purchase_at=2026-03-12 (solo PAID/CLOSED; PENDING_PAYMENT/OPEN/CANCELLED y customerId vacio excluidos; total sucio no rompe)';
  END;

  -------------------------------------------------------------------
  -- CASO 12 (IDOR): el usuario de A NO puede leer stats de B
  -------------------------------------------------------------------
  INSERT INTO public.sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES ('b8000000-0000-4000-8000-000000000010','a8000000-0000-4000-8000-000000000002', NULL, 1,
    '{"paymentMethod":"CASH","customerId":"cli-b","status":"PAID","total":"777777"}'::jsonb, '2026-03-15T10:00:00Z', now());

  IF EXISTS (
    SELECT 1 FROM public.get_customer_purchase_stats('a8000000-0000-4000-8000-000000000002'::uuid)
  ) THEN
    RAISE EXCEPTION 'FUGA IDOR: un usuario sin membresia en B logro leer las estadisticas de B';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.get_customer_purchase_stats('a8000000-0000-4000-8000-000000000001'::uuid) s
     WHERE s.customer_id = 'cli-b'
  ) THEN
    RAISE EXCEPTION 'FUGA IDOR: las ventas de B se filtraron dentro de los stats de A';
  END IF;

  RAISE NOTICE 'PASS IDOR: usuario de A recibe 0 filas al pedir stats de B, y las ventas de B no aparecen en los stats de A';

  -------------------------------------------------------------------
  -- Limpieza
  -------------------------------------------------------------------
  DELETE FROM public.sales WHERE business_id IN ('a8000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000002');
  DELETE FROM public.branches WHERE business_id IN ('a8000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000002');
  DELETE FROM public.business_members WHERE business_id IN ('a8000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000002');
  DELETE FROM public.businesses WHERE id IN ('a8000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000002');
END $$;