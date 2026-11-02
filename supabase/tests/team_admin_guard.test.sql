-- ============================================================================
-- team_admin_guard.test.sql — Configuración > Equipo: candado ADMIN-only +
-- protección del último administrador activo.
-- ----------------------------------------------------------------------------
-- Verifica 20261118000000_team_admin_only_and_last_admin_guard.sql.
--
-- EJECUCIÓN: pegar completo en el SQL Editor de Supabase (BD de pruebas o
-- staging; NO hace falta producción). Todo corre dentro de una transacción y
-- termina en ROLLBACK, así que no deja datos. Crea sus propios usuarios en
-- auth.users. Si algo falla, lanza EXCEPTION con el motivo ("FALLO: ...").
-- Si todo pasa, imprime "TEAM_ADMIN_GUARD: OK".
--
-- Los ataques corren con `SET LOCAL ROLE authenticated` (postgres BYPASEA RLS
-- y no probaría nada).
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_a uuid := gen_random_uuid();      -- negocio A
  v_b uuid := gen_random_uuid();      -- negocio B (ajeno)
  v_br_a uuid; v_br_b uuid;
  u_admin1 uuid := gen_random_uuid();
  u_admin2 uuid := gen_random_uuid();
  u_gerente uuid := gen_random_uuid();
  u_cajero uuid := gen_random_uuid();
  u_admin_b uuid := gen_random_uuid();
  v_wa uuid := gen_random_uuid();     -- mesero de A
  v_wb uuid := gen_random_uuid();     -- mesero de B
  v_rows integer;
  v_blocked boolean;
BEGIN
  -- ===== Preparación (como postgres) =====
  INSERT INTO auth.users (id, email) VALUES
    (u_admin1,  'admin1@test.local'),  (u_admin2, 'admin2@test.local'),
    (u_gerente, 'gerente@test.local'), (u_cajero, 'cajero@test.local'),
    (u_admin_b, 'adminb@test.local');

  INSERT INTO businesses (id, name) VALUES (v_a, 'TEAM A'), (v_b, 'TEAM B');
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id IN (v_a, v_b);
  INSERT INTO branches (business_id, name) VALUES (v_a, 'BR A') RETURNING id INTO v_br_a;
  INSERT INTO branches (business_id, name) VALUES (v_b, 'BR B') RETURNING id INTO v_br_b;

  INSERT INTO business_members (user_id, business_id, role) VALUES
    (u_admin1, v_a, 'ADMIN'), (u_admin2, v_a, 'ADMIN'),
    (u_gerente, v_a, 'GERENTE'), (u_cajero, v_a, 'CAJERO'),
    (u_admin_b, v_b, 'ADMIN');

  INSERT INTO app_users (id, business_id, branch_id, data) VALUES
    (u_admin1::text,  v_a, NULL, jsonb_build_object('id', u_admin1::text,  'name', 'Admin 1', 'roleId', 'ADMIN',   'status', 'ACTIVE')),
    (u_admin2::text,  v_a, NULL, jsonb_build_object('id', u_admin2::text,  'name', 'Admin 2', 'roleId', 'ADMIN',   'status', 'ACTIVE')),
    (u_gerente::text, v_a, NULL, jsonb_build_object('id', u_gerente::text, 'name', 'Gerente', 'roleId', 'GERENTE', 'status', 'ACTIVE')),
    (u_cajero::text,  v_a, v_br_a, jsonb_build_object('id', u_cajero::text,  'name', 'Cajero',  'roleId', 'CAJERO',  'status', 'ACTIVE')),
    (u_admin_b::text, v_b, NULL, jsonb_build_object('id', u_admin_b::text, 'name', 'Admin B', 'roleId', 'ADMIN',   'status', 'ACTIVE'));

  INSERT INTO waiters (id, business_id, branch_id, version, data) VALUES
    (v_wa, v_a, v_br_a, 1, jsonb_build_object('id', v_wa::text, 'name', 'Mesero A', 'active', true)),
    (v_wb, v_b, v_br_b, 1, jsonb_build_object('id', v_wb::text, 'name', 'Mesero B', 'active', true));

  -- =========================================================================
  -- PARTE 1 — Solo ADMIN escribe (RLS)
  -- =========================================================================
  -- Se prueba con CAJERO y con GERENTE (GERENTE ANTES sí podía escribir).
  FOR i IN 1..2 LOOP
    PERFORM set_config('request.jwt.claim.sub', (CASE WHEN i = 1 THEN u_cajero ELSE u_gerente END)::text, true);
    SET LOCAL ROLE authenticated;

    -- app_users: INSERT
    v_blocked := false;
    BEGIN
      INSERT INTO app_users (id, business_id, branch_id, data)
      VALUES (gen_random_uuid()::text, v_a, v_br_a, '{"name":"intruso","roleId":"ADMIN","status":"ACTIVE"}');
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO[%]: un no-ADMIN pudo INSERTAR en app_users', i; END IF;

    -- app_users: UPDATE (autoascenso a ADMIN en el perfil)
    UPDATE app_users SET data = data || '{"roleId":"ADMIN"}' WHERE id IN (u_cajero::text, u_gerente::text, u_admin2::text);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN RAISE EXCEPTION 'FALLO[%]: un no-ADMIN pudo ACTUALIZAR app_users (% filas)', i, v_rows; END IF;

    -- app_users: DELETE
    DELETE FROM app_users WHERE business_id = v_a;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN RAISE EXCEPTION 'FALLO[%]: un no-ADMIN pudo ELIMINAR app_users (% filas)', i, v_rows; END IF;

    -- waiters: INSERT / UPDATE / DELETE
    v_blocked := false;
    BEGIN
      INSERT INTO waiters (id, business_id, branch_id, version, data)
      VALUES (gen_random_uuid(), v_a, v_br_a, 1, '{"name":"intruso","active":true}');
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO[%]: un no-ADMIN pudo INSERTAR en waiters', i; END IF;

    UPDATE waiters SET data = data || '{"active":false}' WHERE business_id = v_a;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN RAISE EXCEPTION 'FALLO[%]: un no-ADMIN pudo ACTUALIZAR waiters', i; END IF;

    DELETE FROM waiters WHERE business_id = v_a;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN RAISE EXCEPTION 'FALLO[%]: un no-ADMIN pudo ELIMINAR waiters', i; END IF;

    -- business_members: nadie que no sea ADMIN toca roles ni membresías
    v_blocked := false;
    BEGIN
      UPDATE business_members SET role = 'ADMIN' WHERE user_id = u_cajero AND business_id = v_a;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN v_blocked := true; END IF;      -- RLS: 0 filas
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;  -- sin GRANT
    IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO[%]: un no-ADMIN pudo cambiar su rol en business_members', i; END IF;

    v_blocked := false;
    BEGIN
      DELETE FROM business_members WHERE business_id = v_a AND user_id = u_admin2;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN v_blocked := true; END IF;
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO[%]: un no-ADMIN pudo eliminar miembros', i; END IF;

    RESET ROLE;
  END LOOP;

  -- ADMIN de A: sí puede en SU negocio...
  PERFORM set_config('request.jwt.claim.sub', u_admin1::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO waiters (id, business_id, branch_id, version, data)
  VALUES (gen_random_uuid(), v_a, v_br_a, 1, '{"name":"nuevo","active":true}');
  UPDATE waiters SET data = data || '{"active":false}' WHERE id = v_wa;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'FALLO: ADMIN no pudo actualizar un mesero propio'; END IF;
  DELETE FROM waiters WHERE id = v_wa;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'FALLO: ADMIN no pudo eliminar un mesero propio'; END IF;

  INSERT INTO app_users (id, business_id, branch_id, data)
  VALUES (gen_random_uuid()::text, v_a, v_br_a, '{"name":"Cocina 1","roleId":"COCINA","status":"ACTIVE"}');
  UPDATE app_users SET data = data || '{"name":"Cajero Renombrado"}' WHERE id = u_cajero::text;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'FALLO: ADMIN no pudo editar un perfil propio'; END IF;

  -- ...pero NO en el negocio B (aislamiento entre negocios)
  UPDATE waiters SET data = data || '{"active":false}' WHERE id = v_wb;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FALLO: ADMIN de A modifico un mesero del negocio B'; END IF;
  DELETE FROM app_users WHERE id = u_admin_b::text;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FALLO: ADMIN de A elimino un perfil del negocio B'; END IF;
  v_blocked := false;
  BEGIN
    INSERT INTO waiters (id, business_id, branch_id, version, data)
    VALUES (gen_random_uuid(), v_b, v_br_b, 1, '{"name":"cruce","active":true}');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: ADMIN de A inserto un mesero en el negocio B'; END IF;

  RESET ROLE;

  -- =========================================================================
  -- PARTE 2 — Último administrador activo (aplica también a postgres/service_role)
  -- =========================================================================
  -- 2.1 Con DOS admins activos se puede quitar a uno...
  UPDATE app_users SET data = data || '{"roleId":"CAJERO"}' WHERE id = u_admin2::text;
  UPDATE business_members SET role = 'CAJERO' WHERE user_id = u_admin2 AND business_id = v_a;
  -- ...y ahora admin1 es el ULTIMO. Todo lo siguiente debe bloquearse:

  -- 2.2 Degradar rol en business_members
  v_blocked := false;
  BEGIN
    UPDATE business_members SET role = 'CAJERO' WHERE user_id = u_admin1 AND business_id = v_a;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'LAST_ADMIN_PROTECTED%' THEN v_blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se degrado al ultimo ADMIN (business_members.role)'; END IF;

  -- 2.3 Eliminar membresía
  v_blocked := false;
  BEGIN
    DELETE FROM business_members WHERE user_id = u_admin1 AND business_id = v_a;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'LAST_ADMIN_PROTECTED%' THEN v_blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se elimino al ultimo ADMIN (business_members)'; END IF;

  -- 2.4 Mover al último admin a otro negocio
  v_blocked := false;
  BEGIN
    UPDATE business_members SET business_id = v_b WHERE user_id = u_admin1 AND business_id = v_a;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'LAST_ADMIN_PROTECTED%' THEN v_blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se movio al ultimo ADMIN a otro negocio'; END IF;

  -- 2.5 Desde el perfil (app_users): degradar roleId, suspender, marcar DELETED, borrar
  v_blocked := false;
  BEGIN
    UPDATE app_users SET data = data || '{"roleId":"MESERO"}' WHERE id = u_admin1::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'LAST_ADMIN_PROTECTED%' THEN v_blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se degrado al ultimo ADMIN (app_users.roleId)'; END IF;

  v_blocked := false;
  BEGIN
    UPDATE app_users SET data = data || '{"status":"SUSPENDED"}' WHERE id = u_admin1::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'LAST_ADMIN_PROTECTED%' THEN v_blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se suspendio al ultimo ADMIN'; END IF;

  v_blocked := false;
  BEGIN
    UPDATE app_users SET data = data || '{"status":"DELETED"}' WHERE id = u_admin1::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'LAST_ADMIN_PROTECTED%' THEN v_blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se marco DELETED al ultimo ADMIN'; END IF;

  v_blocked := false;
  BEGIN
    DELETE FROM app_users WHERE id = u_admin1::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'LAST_ADMIN_PROTECTED%' THEN v_blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se elimino el perfil del ultimo ADMIN'; END IF;

  -- 2.6 Un ADMIN autenticado tampoco puede borrarse a sí mismo (RLS pasa, trigger frena)
  PERFORM set_config('request.jwt.claim.sub', u_admin1::text, true);
  SET LOCAL ROLE authenticated;
  v_blocked := false;
  BEGIN
    DELETE FROM app_users WHERE id = u_admin1::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'LAST_ADMIN_PROTECTED%' THEN v_blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: el ultimo ADMIN se borro a si mismo'; END IF;
  RESET ROLE;

  -- 2.7 Updates inocuos del último admin NO se bloquean (login, avatar, nombre)
  UPDATE app_users SET data = data || '{"lastLoginAt":"2026-11-01T00:00:00Z","name":"Admin Uno"}', version = version + 1
   WHERE id = u_admin1::text;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'FALLO: se bloqueo un update inocuo del ultimo ADMIN'; END IF;
  UPDATE business_members SET role = 'ADMIN' WHERE user_id = u_admin1 AND business_id = v_a;   -- no-op de rol

  -- 2.8 Un ADMIN SUSPENDIDO no cuenta como activo
  --     (admin1 + admin2 re-promovido pero suspendido => admin1 sigue siendo el único activo)
  UPDATE business_members SET role = 'ADMIN' WHERE user_id = u_admin2 AND business_id = v_a;
  UPDATE app_users SET data = data || '{"roleId":"ADMIN","status":"SUSPENDED"}' WHERE id = u_admin2::text;
  v_blocked := false;
  BEGIN
    UPDATE business_members SET role = 'CAJERO' WHERE user_id = u_admin1 AND business_id = v_a;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'LAST_ADMIN_PROTECTED%' THEN v_blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: un ADMIN suspendido conto como activo'; END IF;

  -- 2.9 Reactivar a admin2 => ahora sí se puede degradar a admin1
  UPDATE app_users SET data = data || '{"status":"ACTIVE"}' WHERE id = u_admin2::text;
  UPDATE business_members SET role = 'GERENTE' WHERE user_id = u_admin1 AND business_id = v_a;
  UPDATE app_users SET data = data || '{"roleId":"GERENTE"}' WHERE id = u_admin1::text;

  -- 2.10 Borrar al admin2 (ya único) vuelve a estar bloqueado
  v_blocked := false;
  BEGIN
    DELETE FROM business_members WHERE user_id = u_admin2 AND business_id = v_a;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'LAST_ADMIN_PROTECTED%' THEN v_blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se elimino al ADMIN que quedaba'; END IF;

  -- 2.11 Un negocio con un solo miembro no-admin se puede mover/borrar sin trabas (no es ADMIN)
  DELETE FROM business_members WHERE user_id = u_cajero AND business_id = v_a;

  -- 2.12 Borrar el NEGOCIO completo (cascada) NO se bloquea
  DELETE FROM businesses WHERE id = v_a;
  IF EXISTS (SELECT 1 FROM business_members WHERE business_id = v_a)
     OR EXISTS (SELECT 1 FROM app_users WHERE business_id = v_a) THEN
    RAISE EXCEPTION 'FALLO: la cascada de borrado de negocio dejo filas';
  END IF;
  DELETE FROM businesses WHERE id = v_b;

  RAISE NOTICE 'TEAM_ADMIN_GUARD: OK';
END;
$$;

ROLLBACK;