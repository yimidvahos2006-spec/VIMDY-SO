-- ============================================================================
-- ticket_report_settings.test.sql — Configuración > Tickets y Reportes (Parte 1)
-- ----------------------------------------------------------------------------
-- Verifica 20261119000000_ticket_and_report_settings.sql:
--   * solo ADMIN escribe (RLS) y la suscripción vencida bloquea INSERT/UPDATE
--   * lectura: ticket_print_settings la lee cualquier miembro (con aislamiento
--     por sucursal); report_close_settings solo ADMIN
--   * aislamiento entre negocios, FK compuesto negocio/sucursal
--   * herencia: override de sucursal -> global -> sin fila
--   * upsert atómico (una fila por alcance), CHECKs y columnas inmutables
--
-- EJECUCIÓN: pegar completo en el SQL Editor de Supabase (BD de pruebas o
-- staging; NO hace falta producción). Todo corre dentro de una transacción y
-- termina en ROLLBACK, así que no deja datos. Crea sus propios usuarios en
-- auth.users. Si algo falla, lanza EXCEPTION con el motivo ("FALLO: ...").
-- Si todo pasa, imprime "TICKET_REPORT_SETTINGS: OK".
--
-- Los ataques corren con `SET LOCAL ROLE authenticated` (postgres BYPASEA RLS
-- y no probaría nada).
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_a uuid := gen_random_uuid();       -- negocio A
  v_b uuid := gen_random_uuid();       -- negocio B (ajeno)
  v_br_a1 uuid; v_br_a2 uuid; v_br_b uuid;
  u_admin  uuid := gen_random_uuid();  -- ADMIN de A
  u_cajero uuid := gen_random_uuid();  -- CAJERO de A, asignado a la sucursal A1
  u_gerente uuid := gen_random_uuid(); -- GERENTE de A
  u_admin_b uuid := gen_random_uuid(); -- ADMIN de B
  v_full jsonb;
  v_row public.ticket_print_settings;
  v_rep public.report_close_settings;
  v_rows integer;
  v_blocked boolean;
  v_n integer;
  v_code text;
BEGIN
  -- ===== Preparación (como postgres) =====
  INSERT INTO auth.users (id, email) VALUES
    (u_admin, 'admin@test.local'), (u_cajero, 'cajero@test.local'),
    (u_gerente, 'gerente@test.local'), (u_admin_b, 'adminb@test.local');

  INSERT INTO businesses (id, name) VALUES (v_a, 'SETTINGS A'), (v_b, 'SETTINGS B');
  UPDATE businesses SET plan = 'monthly', renewal_date = NULL WHERE id IN (v_a, v_b);
  -- Multi-Sucursal: el trigger branches_enforce_plan_limit solo deja 1 sucursal activa en plan 'single'.
  UPDATE businesses SET plan_tier = 'multi' WHERE id IN (v_a, v_b);
  INSERT INTO branches (business_id, name) VALUES (v_a, 'A1') RETURNING id INTO v_br_a1;
  INSERT INTO branches (business_id, name) VALUES (v_a, 'A2') RETURNING id INTO v_br_a2;
  INSERT INTO branches (business_id, name) VALUES (v_b, 'B1') RETURNING id INTO v_br_b;

  INSERT INTO business_members (user_id, business_id, role) VALUES
    (u_admin, v_a, 'ADMIN'), (u_cajero, v_a, 'CAJERO'),
    (u_gerente, v_a, 'GERENTE'), (u_admin_b, v_b, 'ADMIN');
  INSERT INTO app_users (id, business_id, branch_id, data) VALUES
    (u_cajero::text, v_a, v_br_a1, jsonb_build_object('roleId', 'CAJERO', 'status', 'ACTIVE'));

  v_full := jsonb_build_object(
    'template', 'restaurante', 'paper_width', '58mm', 'accent_color', 'green',
    'show_logo', false, 'show_qr', true, 'show_address', true, 'show_phone', true,
    'show_email', true, 'show_cashier', true, 'show_customer', false, 'show_tax', true,
    'show_discount', true, 'footer_message', 'Gracias');

  -- =========================================================================
  -- PARTE 1 — ADMIN escribe: global + override de sucursal (upsert atómico)
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', u_admin::text, true);
  SET LOCAL ROLE authenticated;

  v_row := public.upsert_ticket_print_settings(v_a, NULL, v_full);
  IF v_row.branch_id IS NOT NULL OR v_row.template <> 'restaurante' THEN
    RAISE EXCEPTION 'FALLO: el upsert global no guardó lo esperado'; END IF;
  -- Segundo upsert del mismo alcance ACTUALIZA, no duplica.
  v_row := public.upsert_ticket_print_settings(v_a, NULL, v_full || '{"template":"clasico"}');
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.ticket_print_settings WHERE business_id = v_a AND branch_id IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALLO: el upsert global duplicó la fila (% filas)', v_n; END IF;
  IF (SELECT template FROM public.ticket_print_settings WHERE business_id = v_a AND branch_id IS NULL) <> 'clasico' THEN
    RAISE EXCEPTION 'FALLO: el segundo upsert no actualizó'; END IF;

  SET LOCAL ROLE authenticated;
  v_row := public.upsert_ticket_print_settings(v_a, v_br_a1, v_full || '{"template":"cafeteria"}');
  IF v_row.branch_id IS DISTINCT FROM v_br_a1 THEN RAISE EXCEPTION 'FALLO: override sin branch_id'; END IF;
  PERFORM public.upsert_ticket_print_settings(v_a, v_br_a1, v_full || '{"template":"cafeteria","footer_message":"Hola"}');
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.ticket_print_settings WHERE business_id = v_a;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALLO: se esperaban 2 filas (global + A1), hay %', v_n; END IF;

  -- =========================================================================
  -- PARTE 2 — Herencia (resolve_*)
  -- =========================================================================
  SET LOCAL ROLE authenticated;
  -- A1 tiene override -> cafeteria
  IF (SELECT template FROM public.resolve_ticket_print_settings(v_a, v_br_a1)) <> 'cafeteria' THEN
    RAISE EXCEPTION 'FALLO: A1 no devolvió su override'; END IF;
  -- A2 NO tiene override -> hereda el global (clasico)
  IF (SELECT template FROM public.resolve_ticket_print_settings(v_a, v_br_a2)) <> 'clasico' THEN
    RAISE EXCEPTION 'FALLO: A2 no heredó el global'; END IF;
  -- Sin sucursal -> global
  IF (SELECT template FROM public.resolve_ticket_print_settings(v_a, NULL)) <> 'clasico' THEN
    RAISE EXCEPTION 'FALLO: sin sucursal no devolvió el global'; END IF;
  -- Negocio sin configuración -> 0 filas (defaults de la app)
  IF EXISTS (SELECT 1 FROM public.resolve_ticket_print_settings(v_b, v_br_b)) THEN
    RAISE EXCEPTION 'FALLO: un negocio ajeno devolvió filas'; END IF;
  -- Borrar el override de A1 -> A1 vuelve a heredar.
  DELETE FROM public.ticket_print_settings WHERE business_id = v_a AND branch_id = v_br_a1;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'FALLO: el ADMIN no pudo borrar el override'; END IF;
  IF (SELECT template FROM public.resolve_ticket_print_settings(v_a, v_br_a1)) <> 'clasico' THEN
    RAISE EXCEPTION 'FALLO: tras borrar el override A1 no volvió a heredar'; END IF;
  PERFORM public.upsert_ticket_print_settings(v_a, v_br_a1, v_full || '{"template":"cafeteria"}');
  PERFORM public.upsert_ticket_print_settings(v_a, v_br_a2, v_full || '{"template":"moderno"}');
  RESET ROLE;

  -- =========================================================================
  -- PARTE 3 — Solo ADMIN escribe. CAJERO y GERENTE (que sí ven el negocio).
  -- =========================================================================
  FOR i IN 1..2 LOOP
    PERFORM set_config('request.jwt.claim.sub', (CASE WHEN i = 1 THEN u_cajero ELSE u_gerente END)::text, true);
    SET LOCAL ROLE authenticated;

    -- INSERT directo
    v_blocked := false;
    BEGIN
      INSERT INTO public.ticket_print_settings (business_id, branch_id) VALUES (v_a, NULL);
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO[%]: un no-ADMIN pudo INSERTAR ticket_print_settings', i; END IF;

    -- UPSERT por RPC
    v_blocked := false;
    BEGIN
      PERFORM public.upsert_ticket_print_settings(v_a, NULL, v_full);
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO[%]: un no-ADMIN pudo escribir por upsert_ticket_print_settings', i; END IF;

    v_blocked := false;
    BEGIN
      PERFORM public.upsert_report_close_settings(v_a, NULL,
        '{"enabled":true,"send_on_shift_close":true,"email_enabled":true,"email_recipients":["x@y.co"],"email_fallback_enabled":true}');
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO[%]: un no-ADMIN pudo escribir por upsert_report_close_settings', i; END IF;

    -- UPDATE / DELETE directos: 0 filas (la RLS las oculta, sin error)
    UPDATE public.ticket_print_settings SET template = 'clasico' WHERE business_id = v_a;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN RAISE EXCEPTION 'FALLO[%]: un no-ADMIN pudo ACTUALIZAR (% filas)', i, v_rows; END IF;
    DELETE FROM public.ticket_print_settings WHERE business_id = v_a;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN RAISE EXCEPTION 'FALLO[%]: un no-ADMIN pudo BORRAR (% filas)', i, v_rows; END IF;

    RESET ROLE;
  END LOOP;

  -- =========================================================================
  -- PARTE 4 — Lectura. Ticket: miembros con aislamiento de sucursal.
  --           Reporte de cierre: solo ADMIN.
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', u_admin::text, true);
  SET LOCAL ROLE authenticated;
  v_rep := public.upsert_report_close_settings(v_a, NULL,
    '{"enabled":true,"send_on_shift_close":true,"email_enabled":true,"email_recipients":["dueno@negocio.co"],"email_fallback_enabled":true}');
  PERFORM public.upsert_report_close_settings(v_a, v_br_a2,
    '{"enabled":true,"send_on_shift_close":false,"email_enabled":true,"email_recipients":["sede2@negocio.co"],"email_fallback_enabled":false}');
  RESET ROLE;

  -- CAJERO (sucursal A1): ve el global y A1, NO A2.
  PERFORM set_config('request.jwt.claim.sub', u_cajero::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.ticket_print_settings WHERE business_id = v_a;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALLO: el cajero de A1 debía ver 2 filas (global + A1), vio %', v_n; END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_print_settings WHERE branch_id = v_br_a2) THEN
    RAISE EXCEPTION 'FALLO: el cajero de A1 vio el override de A2'; END IF;
  -- Resolver para A2 desde el cajero de A1: devuelve el global (no filtra A2).
  IF (SELECT branch_id FROM public.resolve_ticket_print_settings(v_a, v_br_a2)) IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO: el cajero de A1 resolvió el override de A2'; END IF;
  -- Reporte de cierre: ningún no-ADMIN lo lee.
  SELECT count(*) INTO v_n FROM public.report_close_settings;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALLO: el cajero leyó report_close_settings (% filas)', v_n; END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', u_gerente::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.report_close_settings;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALLO: el gerente leyó report_close_settings (% filas)', v_n; END IF;
  RESET ROLE;

  -- ADMIN de A: ve todo lo suyo (2 de reporte).
  PERFORM set_config('request.jwt.claim.sub', u_admin::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.report_close_settings;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALLO: el ADMIN debía ver 2 filas de reporte, vio %', v_n; END IF;
  -- Herencia del reporte: A1 sin override -> global; A2 -> su override.
  IF (SELECT email_recipients[1] FROM public.resolve_report_close_settings(v_a, v_br_a1)) <> 'dueno@negocio.co' THEN
    RAISE EXCEPTION 'FALLO: A1 no heredó el reporte global'; END IF;
  IF (SELECT email_recipients[1] FROM public.resolve_report_close_settings(v_a, v_br_a2)) <> 'sede2@negocio.co' THEN
    RAISE EXCEPTION 'FALLO: A2 no devolvió su override de reporte'; END IF;
  RESET ROLE;

  -- =========================================================================
  -- PARTE 5 — Aislamiento entre negocios
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', u_admin_b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.ticket_print_settings WHERE business_id = v_a;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALLO: el ADMIN de B vio ticket_print_settings de A'; END IF;
  SELECT count(*) INTO v_n FROM public.report_close_settings WHERE business_id = v_a;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALLO: el ADMIN de B vio report_close_settings de A'; END IF;

  v_blocked := false;
  BEGIN
    PERFORM public.upsert_ticket_print_settings(v_a, NULL, v_full);
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: el ADMIN de B escribió en el negocio A'; END IF;

  -- Sucursal de A con negocio B: la RLS (o, en su defecto, el FK compuesto) lo bloquea.
  v_blocked := false;
  BEGIN
    PERFORM public.upsert_ticket_print_settings(v_b, v_br_a1, v_full);
  EXCEPTION WHEN foreign_key_violation OR insufficient_privilege THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se aceptó una sucursal de otro negocio'; END IF;
  RESET ROLE;

  -- El FK compuesto también protege a service_role (que salta la RLS).
  v_blocked := false;
  BEGIN
    INSERT INTO public.report_close_settings (business_id, branch_id) VALUES (v_b, v_br_a1);
  EXCEPTION WHEN foreign_key_violation THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: el FK compuesto no bloqueó negocio/sucursal cruzados'; END IF;

  -- =========================================================================
  -- PARTE 6 — Suscripción vencida: bloquea INSERT/UPDATE del ADMIN
  -- =========================================================================
  UPDATE businesses SET renewal_date = now() - interval '1 day' WHERE id = v_a;  -- plan vencido
  PERFORM set_config('request.jwt.claim.sub', u_admin::text, true);
  SET LOCAL ROLE authenticated;
  v_blocked := false;
  BEGIN
    PERFORM public.upsert_ticket_print_settings(v_a, NULL, v_full || '{"template":"moderno"}');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: con suscripción vencida el ADMIN pudo escribir'; END IF;
  RESET ROLE;
  UPDATE businesses SET renewal_date = NULL WHERE id = v_a;

  -- =========================================================================
  -- PARTE 7 — CHECKs, inmutabilidad y correos
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', u_admin::text, true);
  SET LOCAL ROLE authenticated;

  -- valores fuera de catálogo
  FOREACH v_code IN ARRAY ARRAY['{"template":"inventada"}', '{"paper_width":"100mm"}', '{"accent_color":"morado"}'] LOOP
    v_blocked := false;
    BEGIN
      PERFORM public.upsert_ticket_print_settings(v_a, NULL, v_full || v_code::jsonb);
    EXCEPTION WHEN check_violation THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se aceptó un valor fuera de catálogo (%)', v_code; END IF;
  END LOOP;

  -- pie demasiado largo
  v_blocked := false;
  BEGIN
    PERFORM public.upsert_ticket_print_settings(v_a, NULL, v_full || jsonb_build_object('footer_message', repeat('x', 241)));
  EXCEPTION WHEN check_violation THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se aceptó un pie de 241 caracteres'; END IF;

  -- payload incompleto
  v_blocked := false;
  BEGIN
    PERFORM public.upsert_ticket_print_settings(v_a, NULL, '{"template":"clasico"}');
  EXCEPTION WHEN invalid_parameter_value THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se aceptó un payload incompleto'; END IF;

  -- correos: mayúsculas, formato, duplicados, más de 5
  FOREACH v_code IN ARRAY ARRAY[
    '["Dueno@Negocio.co"]', '["no-es-correo"]', '["a@b.co","a@b.co"]',
    '["1@a.co","2@a.co","3@a.co","4@a.co","5@a.co","6@a.co"]'
  ] LOOP
    v_blocked := false;
    BEGIN
      PERFORM public.upsert_report_close_settings(v_a, NULL,
        ('{"enabled":true,"send_on_shift_close":true,"email_enabled":true,"email_fallback_enabled":true,"email_recipients":' || v_code || '}')::jsonb);
    EXCEPTION WHEN check_violation THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se aceptó una lista de correos inválida (%)', v_code; END IF;
  END LOOP;

  -- columnas de alcance inmutables
  v_blocked := false;
  BEGIN
    UPDATE public.ticket_print_settings SET branch_id = v_br_a2 WHERE business_id = v_a AND branch_id = v_br_a1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = MESSAGE_TEXT;
    v_blocked := v_code LIKE 'SETTINGS_SCOPE_IMMUTABLE%' OR SQLSTATE IN ('23505');
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FALLO: se pudo mover una fila a otra sucursal'; END IF;
  RESET ROLE;

  -- updated_by / updated_at los pone el trigger
  IF (SELECT updated_by FROM public.report_close_settings WHERE business_id = v_a AND branch_id IS NULL) IS DISTINCT FROM u_admin THEN
    RAISE EXCEPTION 'FALLO: updated_by no registró al ADMIN'; END IF;

  -- =========================================================================
  -- PARTE 8 — Borrar la sucursal borra su override (vuelve a heredar)
  -- =========================================================================
  DELETE FROM branches WHERE id = v_br_a2;
  IF EXISTS (SELECT 1 FROM public.ticket_print_settings WHERE branch_id = v_br_a2)
     OR EXISTS (SELECT 1 FROM public.report_close_settings WHERE branch_id = v_br_a2) THEN
    RAISE EXCEPTION 'FALLO: quedaron overrides huérfanos de una sucursal borrada'; END IF;

  RAISE NOTICE 'TICKET_REPORT_SETTINGS: OK';
END;
$$;

ROLLBACK;