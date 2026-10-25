-- ============================================================================
-- invitation_branch_assignment.test.sql — cierre P1 #1
-- ----------------------------------------------------------------------------
-- Verifica accept_invitation() con aislamiento fail-closed
-- (20261109000000 + 20261109000001). Usa usuarios TEMPORALES propios y limpia
-- todo al terminar. No toca cuentas reales.
-- ============================================================================

-- === TEST 1: invitado CAJERO con sucursal elegida => solo esa sucursal ===
DO $$
DECLARE
  v_biz uuid; v_br1 uuid; v_br2 uuid;
  v_owner uuid := gen_random_uuid();
  v_guest uuid := gen_random_uuid();
  v_email text;
  v_token text := 'tok-' || gen_random_uuid()::text;
  v_branch_saved uuid;
BEGIN
  v_email := 'inv-' || v_guest::text || '@test.local';
  INSERT INTO auth.users (id, aud, role, email) VALUES (v_owner, 'authenticated', 'authenticated', 'own-' || v_owner::text || '@test.local');
  INSERT INTO auth.users (id, aud, role, email) VALUES (v_guest, 'authenticated', 'authenticated', v_email);
  DELETE FROM app_users WHERE id IN (v_owner::text, v_guest::text);
  DELETE FROM business_members WHERE user_id IN (v_owner, v_guest);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'INV Test 1','America/Bogota') RETURNING id INTO v_biz;
  INSERT INTO branches (business_id,name,is_main) VALUES (v_biz,'SUC 1',true) RETURNING id INTO v_br1;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC 2') RETURNING id INTO v_br2;

  INSERT INTO business_invitations (business_id,user_id,email,role,token,invited_by,expires_at,branch_id)
  VALUES (v_biz, v_owner, v_email, 'CAJERO', v_token, v_owner, now() + interval '7 days', v_br2);

  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  PERFORM public.accept_invitation(v_token);

  SELECT branch_id INTO v_branch_saved FROM app_users WHERE id = v_guest::text AND business_id = v_biz;
  IF v_branch_saved IS DISTINCT FROM v_br2 THEN
    RAISE EXCEPTION 'FAIL: la invitacion con sucursal SUC 2 debe guardar branch_id = SUC 2, quedo %', v_branch_saved;
  END IF;
  IF NOT (v_br2 = ANY(public.auth_branch_ids())) THEN
    RAISE EXCEPTION 'FAIL: el invitado debe ver SUC 2';
  END IF;
  IF v_br1 = ANY(public.auth_branch_ids()) THEN
    RAISE EXCEPTION 'FAIL: fuga cross-branch: el invitado de SUC 2 NO debe ver SUC 1';
  END IF;

  RAISE NOTICE 'PASS: invitacion CAJERO con sucursal => solo esa sucursal';

  DELETE FROM app_users WHERE business_id = v_biz;
  DELETE FROM business_invitations WHERE business_id = v_biz;
  DELETE FROM business_members WHERE business_id = v_biz;
  DELETE FROM branches WHERE business_id = v_biz;
  DELETE FROM businesses WHERE id = v_biz;
  DELETE FROM auth.users WHERE id IN (v_owner, v_guest);
END $$;


-- === TEST 2: invitado MESERO sin sucursal elegida => sucursal principal ===
DO $$
DECLARE
  v_biz uuid; v_br1 uuid; v_br2 uuid;
  v_owner uuid := gen_random_uuid();
  v_guest uuid := gen_random_uuid();
  v_email text;
  v_token text := 'tok-' || gen_random_uuid()::text;
BEGIN
  v_email := 'inv-' || v_guest::text || '@test.local';
  INSERT INTO auth.users (id, aud, role, email) VALUES (v_owner, 'authenticated', 'authenticated', 'own-' || v_owner::text || '@test.local');
  INSERT INTO auth.users (id, aud, role, email) VALUES (v_guest, 'authenticated', 'authenticated', v_email);
  DELETE FROM app_users WHERE id IN (v_owner::text, v_guest::text);
  DELETE FROM business_members WHERE user_id IN (v_owner, v_guest);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'INV Test 2','America/Bogota') RETURNING id INTO v_biz;
  INSERT INTO branches (business_id,name,is_main) VALUES (v_biz,'SUC 1',true) RETURNING id INTO v_br1;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC 2') RETURNING id INTO v_br2;

  INSERT INTO business_invitations (business_id,user_id,email,role,token,invited_by,expires_at)
  VALUES (v_biz, v_owner, v_email, 'MESERO', v_token, v_owner, now() + interval '7 days');

  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  PERFORM public.accept_invitation(v_token);

  IF NOT (v_br1 = ANY(public.auth_branch_ids())) THEN
    RAISE EXCEPTION 'FAIL: sin sucursal elegida el invitado debe quedar en la sucursal principal (SUC 1)';
  END IF;
  IF v_br2 = ANY(public.auth_branch_ids()) THEN
    RAISE EXCEPTION 'FAIL: el invitado sin sucursal elegida NO debe ver SUC 2';
  END IF;

  RAISE NOTICE 'PASS: invitacion MESERO sin sucursal => sucursal principal, nunca todo el negocio';

  DELETE FROM app_users WHERE business_id = v_biz;
  DELETE FROM business_invitations WHERE business_id = v_biz;
  DELETE FROM business_members WHERE business_id = v_biz;
  DELETE FROM branches WHERE business_id = v_biz;
  DELETE FROM businesses WHERE id = v_biz;
  DELETE FROM auth.users WHERE id IN (v_owner, v_guest);
END $$;


-- === TEST 3: invitado ADMIN => negocio completo, sin fila en app_users ===
DO $$
DECLARE
  v_biz uuid; v_br1 uuid; v_br2 uuid;
  v_owner uuid := gen_random_uuid();
  v_guest uuid := gen_random_uuid();
  v_email text;
  v_token text := 'tok-' || gen_random_uuid()::text;
BEGIN
  v_email := 'inv-' || v_guest::text || '@test.local';
  INSERT INTO auth.users (id, aud, role, email) VALUES (v_owner, 'authenticated', 'authenticated', 'own-' || v_owner::text || '@test.local');
  INSERT INTO auth.users (id, aud, role, email) VALUES (v_guest, 'authenticated', 'authenticated', v_email);
  DELETE FROM app_users WHERE id IN (v_owner::text, v_guest::text);
  DELETE FROM business_members WHERE user_id IN (v_owner, v_guest);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'INV Test 3','America/Bogota') RETURNING id INTO v_biz;
  INSERT INTO branches (business_id,name,is_main) VALUES (v_biz,'SUC 1',true) RETURNING id INTO v_br1;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC 2') RETURNING id INTO v_br2;

  INSERT INTO business_invitations (business_id,user_id,email,role,token,invited_by,expires_at)
  VALUES (v_biz, v_owner, v_email, 'ADMIN', v_token, v_owner, now() + interval '7 days');

  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  PERFORM public.accept_invitation(v_token);

  IF NOT (v_br1 = ANY(public.auth_branch_ids())) OR NOT (v_br2 = ANY(public.auth_branch_ids())) THEN
    RAISE EXCEPTION 'FAIL: un ADMIN invitado debe ver las 2 sucursales';
  END IF;
  IF EXISTS (SELECT 1 FROM app_users WHERE id = v_guest::text) THEN
    RAISE EXCEPTION 'FAIL: un ADMIN invitado no necesita fila en app_users';
  END IF;

  RAISE NOTICE 'PASS: invitacion ADMIN => negocio completo por rol';

  DELETE FROM business_invitations WHERE business_id = v_biz;
  DELETE FROM business_members WHERE business_id = v_biz;
  DELETE FROM branches WHERE business_id = v_biz;
  DELETE FROM businesses WHERE id = v_biz;
  DELETE FROM auth.users WHERE id IN (v_owner, v_guest);
END $$;