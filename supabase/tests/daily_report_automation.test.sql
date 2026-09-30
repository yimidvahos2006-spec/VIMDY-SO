-- VIMDY — daily report automation DB test
-- Reuses the first real auth user; no synthetic Auth user is created.
DO $$
DECLARE
  v_user_id uuid;
  v_business_id uuid;
  v_branch_id uuid;
  v_shift_id uuid;
  v_job_count integer;
  v_business_day date;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'DAILY_REPORT_TEST_SETUP_REQUIRED: el proyecto necesita un usuario real en auth.users.';
  END IF;

  INSERT INTO businesses (name, timezone, currency) VALUES ('TEST Daily Report', 'America/Bogota', 'COP') RETURNING id INTO v_business_id;
  INSERT INTO branches (business_id, name, active) VALUES (v_business_id, 'TEST Branch', true) RETURNING id INTO v_branch_id;
  INSERT INTO business_members (user_id, business_id, role) VALUES (v_user_id, v_business_id, 'CAJERO');
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  v_shift_id := gen_random_uuid();
  INSERT INTO shifts (id, business_id, branch_id, data)
  VALUES (v_shift_id, v_business_id, v_branch_id, jsonb_build_object(
    'status','OPEN',
    'openedAt', (now() - interval '2 hours'),
    'openingAmount', 100000,
    'cashierId', v_user_id::text
  ));

  PERFORM * FROM public.close_shift_atomic(v_shift_id, 100000, 'test');

  SELECT count(*) INTO v_job_count FROM daily_report_jobs WHERE shift_id=v_shift_id;
  IF v_job_count <> 1 THEN RAISE EXCEPTION 'FAIL: cierre no creó exactamente un daily_report_job (%).', v_job_count; END IF;

  SELECT business_date INTO v_business_day FROM daily_report_jobs WHERE shift_id=v_shift_id;
  IF (SELECT data->>'closedBy' FROM shifts WHERE id=v_shift_id) <> v_user_id::text THEN
    RAISE EXCEPTION 'FAIL: el cierre no registró closedBy correctamente.';
  END IF;
  IF v_business_day <> (now() AT TIME ZONE 'America/Bogota')::date THEN
    RAISE EXCEPTION 'FAIL: business_date no corresponde al día local de cierre (%).', v_business_day;
  END IF;

  BEGIN
    PERFORM * FROM public.close_shift_atomic(v_shift_id, 100000, 'test-2');
    RAISE EXCEPTION 'FAIL: el segundo cierre fue aceptado.';
  EXCEPTION WHEN OTHERS THEN
    IF strpos(sqlerrm, 'SHIFT_ALREADY_CLOSED') = 0 THEN RAISE; END IF;
  END;

  SELECT count(*) INTO v_job_count FROM daily_report_jobs WHERE shift_id=v_shift_id;
  IF v_job_count <> 1 THEN RAISE EXCEPTION 'FAIL: el retry creó jobs duplicados (%).', v_job_count; END IF;

  RAISE NOTICE 'PASS: cierre atómico crea exactamente un job durable de reporte y evita duplicados.';

  DELETE FROM daily_report_deliveries WHERE business_id=v_business_id;
  DELETE FROM daily_report_jobs WHERE business_id=v_business_id;
  DELETE FROM shifts WHERE business_id=v_business_id;
  DELETE FROM business_members WHERE business_id=v_business_id;
  DELETE FROM branches WHERE business_id=v_business_id;
  DELETE FROM businesses WHERE id=v_business_id;
END $$;
