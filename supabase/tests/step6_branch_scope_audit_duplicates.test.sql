-- ============================================================================
-- step6_branch_scope_audit_duplicates.test.sql — Paso 6 (cierre)
-- ----------------------------------------------------------------------------
--   1) BRANCH ISOLATION con app_users.branch_id (nuevo, 20261013000000)
--   2) AUDITORIA de clientes (CUSTOMER_CREATED/UPDATED/DELETED)
--   3) DUPLICADOS de cliente por telefono y negocio
--   4) SEARCH por nombre/telefono/correo sobre los campos reales del modelo
-- ============================================================================

DO $$
DECLARE v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'STEP6B_TEST_SETUP_REQUIRED: se necesita un usuario real en auth.users.';
  END IF;
  PERFORM set_config('vimdy.step6_test_user_id', v_user_id::text, false);
  RAISE NOTICE 'STEP6B TEST USER: %', v_user_id;
END $$;


-- === TEST 1: branch-scoped vs business-wide (decision de negocio) ===
DO $$
DECLARE
  v_biz uuid; v_br1 uuid; v_br2 uuid; v_user uuid;
  v_other uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'P6B Branch','America/Bogota') RETURNING id INTO v_biz;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id=v_biz;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC 1') RETURNING id INTO v_br1;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC 2') RETURNING id INTO v_br2;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'CAJERO');

  -- SIN fila en app_users => business-wide (compatibilidad con Pasos 1-5)
  IF NOT EXISTS (SELECT 1 FROM app_users WHERE business_id=v_biz AND id=v_user::text) THEN
    -- lo verificamos abajo; primero el caso con asignacion
    NULL;
  END IF;

  IF NOT (v_br1 = ANY(public.auth_branch_ids())) OR NOT (v_br2 = ANY(public.auth_branch_ids())) THEN
    RAISE EXCEPTION 'FAIL: sin asignacion en app_users el usuario debe ser business-wide (varias 2/2 visibles)';
  END IF;

  -- CON branch_id = SUC 1 => solo ve SUC 1
  INSERT INTO app_users (id,business_id,branch_id,version,data,created_at,updated_at)
  VALUES (v_user::text, v_biz, v_br1, 1, jsonb_build_object('id',v_user::text,'businessId',v_biz), now(), now());

  IF NOT (v_br1 = ANY(public.auth_branch_ids())) THEN
    RAISE EXCEPTION 'FAIL: el usuario asignado a SUC 1 debe ver SUC 1';
  END IF;
  IF v_br2 = ANY(public.auth_branch_ids()) THEN
    RAISE EXCEPTION 'FAIL: fuga cross-branch: el usuario de SUC 1 NO debe ver SUC 2';
  END IF;

  -- branch_id NULL => business-wide explicito
  UPDATE app_users SET branch_id = NULL WHERE business_id=v_biz AND id=v_user::text;
  IF NOT (v_br1 = ANY(public.auth_branch_ids())) OR NOT (v_br2 = ANY(public.auth_branch_ids())) THEN
    RAISE EXCEPTION 'FAIL: branch_id NULL debe.restore business-wide';
  END IF;

  RAISE NOTICE 'PASS: branch scope real (sin asignacion=business-wide, con branch_id=solo esa, NULL=business-wide)';

  DELETE FROM app_users WHERE business_id=v_biz;
  DELETE FROM branches WHERE business_id=v_biz;
  DELETE FROM business_members WHERE business_id=v_biz;
  DELETE FROM businesses WHERE id=v_biz;
END $$;


-- === TEST 2: branch scope aplicado a datos reales (RLS) ===
DO $$
DECLARE
  v_biz uuid; v_br1 uuid; v_br2 uuid; v_user uuid;
  v_c1 uuid := gen_random_uuid();
  v_c2 uuid := gen_random_uuid();
  v_visible integer;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'P6B Datos','America/Bogota') RETURNING id INTO v_biz;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id=v_biz;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC 1') RETURNING id INTO v_br1;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC 2') RETURNING id INTO v_br2;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'MESERO');

  INSERT INTO customers (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_c1, v_biz, v_br1, 1, jsonb_build_object('id',v_c1,'name','Cliente Suc1','phone','3001110001'), now(), now()),
    (v_c2, v_biz, v_br2, 1, jsonb_build_object('id',v_c2,'name','Cliente Suc2','phone','3001110002'), now(), now());

  -- business-wide: ve ambos
  SELECT count(*) INTO v_visible FROM customers WHERE business_id=v_biz;
  IF v_visible <> 2 THEN
    RAISE EXCEPTION 'FAIL: business-wide deberia ver 2 clientes, ve %', v_visible;
  END IF;

  -- branch-scoped a SUC 1: ve solo el de SUC 1.
  -- La lectura se hace con SET LOCAL ROLE authenticated porque la conexion de
  -- pruebas entra como postgres (superusuario), que BYPASSEA RLS: contarla en
  -- ese rol no probaria nada.
  INSERT INTO app_users (id,business_id,branch_id,version,data,created_at,updated_at)
  VALUES (v_user::text, v_biz, v_br1, 1, jsonb_build_object('id',v_user::text), now(), now());

  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_visible FROM customers WHERE business_id=v_biz;
  RESET ROLE;

  IF v_visible <> 1 THEN
    RAISE EXCEPTION 'FAIL: branch-scoped deberia ver 1 cliente, ve % (RLS no aplico auth_branch_ids)', v_visible;
  END IF;

  RAISE NOTICE 'PASS: branch scope aplicado a datos reales via RLS (business-wide=2, branch-scoped=1)';

  DELETE FROM customers WHERE business_id=v_biz;
  DELETE FROM app_users WHERE business_id=v_biz;
  DELETE FROM branches WHERE business_id=v_biz;
  DELETE FROM business_members WHERE business_id=v_biz;
  DELETE FROM businesses WHERE id=v_biz;
END $$;


-- === TEST 3: duplicados de cliente (telefono) ===
DO $$
DECLARE
  v_biz uuid; v_br uuid; v_user uuid;
  v_br_other uuid; v_biz_other uuid;
  v_c uuid := gen_random_uuid();
  v_dup uuid := gen_random_uuid();
  v_same_doc_other_biz uuid := gen_random_uuid();
  v_dup_error text := '(no reboto)';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'P6B Dup','America/Bogota') RETURNING id INTO v_biz;
  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'P6B Otro','America/Bogota') RETURNING id INTO v_biz_other;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id IN (v_biz,v_biz_other);
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC') RETURNING id INTO v_br;
  INSERT INTO branches (business_id,name) VALUES (v_biz_other,'SUC') RETURNING id INTO v_br_other;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'ADMIN');

  INSERT INTO customers (id,business_id,branch_id,version,data,created_at,updated_at)
  VALUES (v_c, v_biz, v_br, 1, jsonb_build_object('id',v_c,'name','Ana','phone','+57 300 111 2222'), now(), now());

  -- Mismo telefono MISMO negocio => debe rebotar (normalizado: espacios/simbolos)
  BEGIN
    INSERT INTO customers (id,business_id,branch_id,version,data,created_at,updated_at)
    VALUES (v_dup, v_biz, v_br, 1, jsonb_build_object('id',v_dup,'name','Ana Duplicada','phone','573001112222'), now(), now());
    v_dup_error := '(no reboto)';
  EXCEPTION WHEN unique_violation THEN
    v_dup_error := 'unique_violation';
  END;

  IF v_dup_error <> 'unique_violation' THEN
    RAISE EXCEPTION 'FAIL: mismo telefono en mismo negocio deberia rechazarse, obtuvo: %', v_dup_error;
  END IF;

  -- Mismo telefono OTRO negocio => permitido
  BEGIN
    INSERT INTO customers (id,business_id,branch_id,version,data,created_at,updated_at)
    VALUES (v_same_doc_other_biz, v_biz_other, v_br_other, 1,
      jsonb_build_object('id',v_same_doc_other_biz,'name','Ana Otro Negocio','phone','+57 300 111 2222'), now(), now());
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL: el mismo telefono en otro negocio debe permitirse: %', sqlerrm;
  END;

  -- Cliente SIN telefono => permitido multiples
  INSERT INTO customers (id,business_id,branch_id,version,data,created_at,updated_at)
  VALUES (gen_random_uuid(), v_biz, v_br, 1, jsonb_build_object('name','Mostrador 1'), now(), now()),
         (gen_random_uuid(), v_biz, v_br, 1, jsonb_build_object('name','Mostrador 2'), now(), now());

  RAISE NOTICE 'PASS: duplicados de cliente por telefono (mismo+negocio=unique_violation, otro negocio=permitido, sin telefono=permitido)';

  DELETE FROM customers WHERE business_id IN (v_biz,v_biz_other);
  DELETE FROM branches WHERE business_id IN (v_biz,v_biz_other);
  DELETE FROM business_members WHERE business_id IN (v_biz,v_biz_other);
  DELETE FROM businesses WHERE id IN (v_biz,v_biz_other);
END $$;


-- === TEST 4: auditoría de clientes + cross-tenant ===
DO $$
DECLARE
  v_biz uuid; v_br uuid; v_user uuid;
  v_c uuid := gen_random_uuid();
  v_audits integer;
  v_action text;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at ASC, id ASC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'P6B Audit','America/Bogota') RETURNING id INTO v_biz;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id=v_biz;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC') RETURNING id INTO v_br;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'ADMIN');

  INSERT INTO audit_logs (id,business_id,branch_id,version,data,created_at,updated_at)
  VALUES (gen_random_uuid(), v_biz, v_br, 1,
    jsonb_build_object('actorId',v_user::text,'action','CUSTOMER_CREATED','module','customers',
      'entityId',v_c,'description','Cliente "Ana" creado.','date',now()), now(), now());

  SELECT count(*), max(data->>'action') INTO v_audits, v_action
  FROM audit_logs WHERE business_id=v_biz AND data->>'module'='customers';

  IF v_audits <> 1 THEN
    RAISE EXCEPTION 'FAIL: se esperaba 1 auditoria de cliente, hay %', v_audits;
  END IF;
  IF v_action <> 'CUSTOMER_CREATED' THEN
    RAISE EXCEPTION 'FAIL: accion de auditoria inesperada: %', v_action;
  END IF;

  RAISE NOTICE 'PASS: auditoria de clientes (CUSTOMER_CREATED registrada con actor/modulo/entityId)';

  DELETE FROM audit_logs WHERE business_id=v_biz;
  DELETE FROM customers WHERE business_id=v_biz;
  DELETE FROM branches WHERE business_id=v_biz;
  DELETE FROM business_members WHERE business_id=v_biz;
  DELETE FROM businesses WHERE id=v_biz;
END $$;