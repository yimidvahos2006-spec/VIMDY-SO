-- ============================================================================
-- step6_branch_scope_audit_duplicates.test.sql — Paso 6 (cierre)
-- ----------------------------------------------------------------------------
--   1) BRANCH ISOLATION fail-closed con app_users.branch_id (20261013000000 + 20261109000000)
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


-- === TEST 1: alcance por sucursal FAIL-CLOSED (20261109000000) ===
-- Nota: el usuario de prueba puede ser miembro de OTROS negocios (p. ej. dueno
-- de uno real en staging), asi que NUNCA se compara el tamano del arreglo:
-- solo se mira si las sucursales de ESTE negocio de prueba estan o no dentro.
DO $$
DECLARE
  v_biz uuid; v_br1 uuid; v_br2 uuid; v_user uuid;
BEGIN
  -- Usuario TEMPORAL propio: app_users.id es llave primaria, y un usuario real
  -- ya tiene su fila en app_users (no se puede insertar otra ni tocarla).
  v_user := gen_random_uuid();
  INSERT INTO auth.users (id, aud, role, email)
  VALUES (v_user, 'authenticated', 'authenticated', 'p6b-' || v_user::text || '@test.local');
  DELETE FROM app_users WHERE id = v_user::text;  -- por si algun trigger creo una fila
  DELETE FROM business_members WHERE user_id = v_user;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'P6B Branch','America/Bogota') RETURNING id INTO v_biz;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id=v_biz;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC 1') RETURNING id INTO v_br1;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC 2') RETURNING id INTO v_br2;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'CAJERO');

  -- (a) CAJERO SIN fila en app_users => denegado (antes heredaba todo el negocio)
  IF v_br1 = ANY(public.auth_branch_ids()) OR v_br2 = ANY(public.auth_branch_ids()) THEN
    RAISE EXCEPTION 'FAIL: CAJERO sin fila en app_users NO debe ver ninguna sucursal de este negocio';
  END IF;

  -- (b) CAJERO con branch_id NULL => denegado (antes era business-wide)
  INSERT INTO app_users (id,business_id,branch_id,version,data,created_at,updated_at)
  VALUES (v_user::text, v_biz, NULL, 1, jsonb_build_object('id',v_user::text,'businessId',v_biz), now(), now());

  IF v_br1 = ANY(public.auth_branch_ids()) OR v_br2 = ANY(public.auth_branch_ids()) THEN
    RAISE EXCEPTION 'FAIL: CAJERO con branch_id NULL NO debe ver ninguna sucursal de este negocio';
  END IF;

  -- (c) CAJERO con branch_id = SUC 1 => solo ve SUC 1
  UPDATE app_users SET branch_id = v_br1 WHERE business_id=v_biz AND id=v_user::text;

  IF NOT (v_br1 = ANY(public.auth_branch_ids())) THEN
    RAISE EXCEPTION 'FAIL: el CAJERO asignado a SUC 1 debe ver SUC 1';
  END IF;
  IF v_br2 = ANY(public.auth_branch_ids()) THEN
    RAISE EXCEPTION 'FAIL: fuga cross-branch: el CAJERO de SUC 1 NO debe ver SUC 2';
  END IF;

  -- (d) GERENTE y ADMIN => negocio completo, aunque su fila tenga branch_id NULL
  UPDATE app_users SET branch_id = NULL WHERE business_id=v_biz AND id=v_user::text;

  UPDATE business_members SET role='GERENTE' WHERE business_id=v_biz AND user_id=v_user;
  IF NOT (v_br1 = ANY(public.auth_branch_ids())) OR NOT (v_br2 = ANY(public.auth_branch_ids())) THEN
    RAISE EXCEPTION 'FAIL: GERENTE debe ver las 2 sucursales del negocio';
  END IF;

  UPDATE business_members SET role='ADMIN' WHERE business_id=v_biz AND user_id=v_user;
  IF NOT (v_br1 = ANY(public.auth_branch_ids())) OR NOT (v_br2 = ANY(public.auth_branch_ids())) THEN
    RAISE EXCEPTION 'FAIL: ADMIN debe ver las 2 sucursales del negocio';
  END IF;

  -- (e) rol desconocido => se trata como operativo (denegado sin asignacion)
  UPDATE business_members SET role='ROL_NUEVO' WHERE business_id=v_biz AND user_id=v_user;
  IF v_br1 = ANY(public.auth_branch_ids()) OR v_br2 = ANY(public.auth_branch_ids()) THEN
    RAISE EXCEPTION 'FAIL: un rol desconocido sin sucursal debe quedar denegado';
  END IF;

  RAISE NOTICE 'PASS: branch scope fail-closed (sin fila=denegado, NULL=denegado, asignado=solo esa, ADMIN/GERENTE=negocio completo, rol desconocido=denegado)';

  DELETE FROM app_users WHERE business_id=v_biz;
  DELETE FROM branches WHERE business_id=v_biz;
  DELETE FROM business_members WHERE business_id=v_biz;
  DELETE FROM businesses WHERE id=v_biz;
  DELETE FROM auth.users WHERE id=v_user;
END $$;


-- === TEST 2: branch scope fail-closed aplicado a datos reales (RLS) ===
DO $$
DECLARE
  v_biz uuid; v_br1 uuid; v_br2 uuid; v_user uuid;
  v_c1 uuid := gen_random_uuid();
  v_c2 uuid := gen_random_uuid();
  v_visible integer;
BEGIN
  -- Usuario TEMPORAL propio: app_users.id es llave primaria, y un usuario real
  -- ya tiene su fila en app_users (no se puede insertar otra ni tocarla).
  v_user := gen_random_uuid();
  INSERT INTO auth.users (id, aud, role, email)
  VALUES (v_user, 'authenticated', 'authenticated', 'p6b-' || v_user::text || '@test.local');
  DELETE FROM app_users WHERE id = v_user::text;  -- por si algun trigger creo una fila
  DELETE FROM business_members WHERE user_id = v_user;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO businesses (id,name,timezone) VALUES (gen_random_uuid(),'P6B Datos','America/Bogota') RETURNING id INTO v_biz;
  UPDATE businesses SET plan='monthly', renewal_date=NULL WHERE id=v_biz;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC 1') RETURNING id INTO v_br1;
  INSERT INTO branches (business_id,name) VALUES (v_biz,'SUC 2') RETURNING id INTO v_br2;
  INSERT INTO business_members (business_id,user_id,role) VALUES (v_biz,v_user,'ADMIN');

  INSERT INTO customers (id,business_id,branch_id,version,data,created_at,updated_at) VALUES
    (v_c1, v_biz, v_br1, 1, jsonb_build_object('id',v_c1,'name','Cliente Suc1','phone','3001110001'), now(), now()),
    (v_c2, v_biz, v_br2, 1, jsonb_build_object('id',v_c2,'name','Cliente Suc2','phone','3001110002'), now(), now());

  -- Las lecturas usan SET LOCAL ROLE authenticated porque la conexion de
  -- pruebas entra como postgres (superusuario), que BYPASSEA RLS: contarla en
  -- ese rol no probaria nada.

  -- ADMIN (negocio completo): ve ambos
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_visible FROM customers WHERE business_id=v_biz;
  RESET ROLE;
  IF v_visible <> 2 THEN
    RAISE EXCEPTION 'FAIL: ADMIN deberia ver 2 clientes, ve %', v_visible;
  END IF;

  -- MESERO SIN asignacion de sucursal: no ve ninguno (fail-closed)
  UPDATE business_members SET role='MESERO' WHERE business_id=v_biz AND user_id=v_user;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_visible FROM customers WHERE business_id=v_biz;
  RESET ROLE;
  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'FAIL: MESERO sin sucursal asignada deberia ver 0 clientes, ve % (fail-open)', v_visible;
  END IF;

  -- MESERO asignado a SUC 1: ve solo el de SUC 1
  INSERT INTO app_users (id,business_id,branch_id,version,data,created_at,updated_at)
  VALUES (v_user::text, v_biz, v_br1, 1, jsonb_build_object('id',v_user::text), now(), now());

  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_visible FROM customers WHERE business_id=v_biz;
  RESET ROLE;

  IF v_visible <> 1 THEN
    RAISE EXCEPTION 'FAIL: MESERO de SUC 1 deberia ver 1 cliente, ve % (RLS no aplico auth_branch_ids)', v_visible;
  END IF;

  RAISE NOTICE 'PASS: branch scope fail-closed en datos reales via RLS (ADMIN=2, sin asignacion=0, asignado=1)';

  DELETE FROM customers WHERE business_id=v_biz;
  DELETE FROM app_users WHERE business_id=v_biz;
  DELETE FROM branches WHERE business_id=v_biz;
  DELETE FROM business_members WHERE business_id=v_biz;
  DELETE FROM businesses WHERE id=v_biz;
  DELETE FROM auth.users WHERE id=v_user;
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