-- ============================================================================
-- 20261118000000_team_admin_only_and_last_admin_guard.sql
-- ----------------------------------------------------------------------------
-- Configuración > Equipo ("Usuarios y roles" y "Meseros") — Paso 1:
-- Base de datos y seguridad.
--
-- QUÉ HACE
--   1) Candado ADMIN-only para crear / editar / eliminar miembros del equipo:
--        - public.app_users          (Usuarios y roles)
--        - public.waiters            (Meseros)
--        - public.business_members   (membresía + rol: fuente de verdad del rol)
--      ANTES: app_users y waiters aceptaban escritura de ADMIN **y GERENTE**
--      (migración 20261005000000). AHORA: solo ADMIN.
--   2) Protección del ÚLTIMO administrador activo de cada negocio: ninguna
--      vía (cliente, Edge Function con service_role, SQL Editor) puede
--      eliminarlo, degradarlo, suspenderlo, marcarlo DELETED ni moverlo a
--      otro negocio si con eso el negocio se queda sin ADMIN activo.
--
-- POR QUÉ ASÍ (causa real encontrada en el código)
--   * 20261005000000 fijó write_roles = {ADMIN, GERENTE} para app_users y
--     waiters, pero GERENTE solo tiene `users.view` en permissions.ts: la BD
--     era más permisiva que la app.
--   * business_members tiene policies de UPDATE/DELETE para ADMIN, pero la
--     policy DELETE además deja borrar la propia fila (`user_id = auth.uid()`)
--     y el repo no deja claro el GRANT real de escritura para `authenticated`
--     (get_grant_gaps() lo marca como cerrado a propósito). Aquí se deja
--     explícito y se cierra, y se añade un trigger porque NINGUNA policy puede
--     expresar "no borres al último ADMIN" (una policy ve una fila, no el
--     conjunto).
--   * "Activo" no es una columna de business_members: el estado vive en
--     app_users.data->>'status' (ACTIVE | SUSPENDED | DELETED). Un miembro
--     ADMIN sin fila en app_users se considera activo (cuentas legacy).
--
-- DISEÑO
--   * Policies PERMISSIVE reescritas (ADMIN-only) + policies RESTRICTIVE de
--     refuerzo: una policy residual más permisiva (p. ej. un
--     `tenant_isolation` heredado) no puede reabrir la escritura, porque las
--     RESTRICTIVE se combinan con AND.
--   * Triggers BEFORE UPDATE/DELETE SECURITY DEFINER (search_path vacío, igual
--     que auth_business_ids): necesitan contar admins de todo el negocio sin
--     depender del RLS de quien llama.
--   * pg_advisory_xact_lock por negocio: sin él, dos admins que se degradan
--     a la vez en transacciones concurrentes verían al otro como "aún admin"
--     y ambos pasarían (negocio con 0 admins). Con el lock se serializan.
--   * No se bloquea el borrado en cascada de un negocio completo: se detecta
--     porque la fila de `businesses` ya no existe cuando corre la cascada.
--   * Los triggers NO validan filas existentes: la migración no puede fallar
--     por datos históricos. Un RAISE NOTICE informa negocios que hoy ya no
--     tienen ADMIN activo (diagnóstico, no bloquea).
--   * service_role (Edge Functions) sigue pudiendo escribir (bypass de RLS),
--     pero NO puede saltarse los triggers de último admin.
--
-- COMPATIBILIDAD (verificado en el código)
--   * create-staff-user / register-business / accept_invitation escriben con
--     service_role o SECURITY DEFINER: no se afectan (solo INSERT, que los
--     triggers no tocan).
--   * ensureOwnerProfile() inserta app_users como el dueño (ADMIN): permitido.
--   * El cliente nunca escribe business_members directamente (solo SELECT).
--
-- ROLLBACK (si hiciera falta; ver al final del archivo).
-- Migración NUEVA e idempotente: no modifica migraciones históricas.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Helper interno: ¿queda OTRO administrador activo en el negocio?
--    Fuente de verdad del rol: business_members. Estado: app_users.data.status.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_has_other_active_admin(
  p_business_id uuid,
  p_excluded_user_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members AS bm
    WHERE bm.business_id = p_business_id
      AND bm.user_id::text <> p_excluded_user_id
      AND upper(btrim(bm.role)) = 'ADMIN'
      AND NOT EXISTS (
        SELECT 1
        FROM public.app_users AS au
        WHERE au.business_id = bm.business_id
          AND au.id = bm.user_id::text
          AND upper(btrim(COALESCE(au.data ->> 'status', 'ACTIVE'))) IN ('SUSPENDED', 'DELETED')
      )
  );
$function$;

COMMENT ON FUNCTION public.team_has_other_active_admin(uuid, text) IS
  'Interna. true si el negocio tiene al menos un ADMIN activo distinto del usuario indicado. ADMIN = business_members.role; activo = app_users.data.status no es SUSPENDED/DELETED (sin perfil = activo).';

-- ---------------------------------------------------------------------------
-- 2) Trigger sobre business_members: no eliminar / degradar / mover al último ADMIN
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_last_admin_business_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result record;
BEGIN
  v_result := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  -- Solo importa si la fila ANTES era un ADMIN.
  IF upper(btrim(OLD.role)) <> 'ADMIN' THEN
    RETURN v_result;
  END IF;

  -- UPDATE que lo deja igual de ADMIN, mismo negocio y mismo usuario: libre.
  IF TG_OP = 'UPDATE'
     AND upper(btrim(NEW.role)) = 'ADMIN'
     AND NEW.business_id = OLD.business_id
     AND NEW.user_id = OLD.user_id THEN
    RETURN NEW;
  END IF;

  -- Cascada por borrado del negocio completo: permitido.
  IF NOT EXISTS (SELECT 1 FROM public.businesses AS b WHERE b.id = OLD.business_id) THEN
    RETURN v_result;
  END IF;

  -- Serializa cambios de administradores de ESTE negocio (evita la carrera de
  -- dos admins degradándose a la vez).
  PERFORM pg_advisory_xact_lock(hashtextextended('team_admin:' || OLD.business_id::text, 0));

  -- Si el ADMIN que sale ya estaba suspendido/borrado, no reduce los activos.
  IF EXISTS (
    SELECT 1
    FROM public.app_users AS au
    WHERE au.business_id = OLD.business_id
      AND au.id = OLD.user_id::text
      AND upper(btrim(COALESCE(au.data ->> 'status', 'ACTIVE'))) IN ('SUSPENDED', 'DELETED')
  ) THEN
    RETURN v_result;
  END IF;

  IF NOT public.team_has_other_active_admin(OLD.business_id, OLD.user_id::text) THEN
    RAISE EXCEPTION 'LAST_ADMIN_PROTECTED: el negocio debe conservar al menos un administrador activo. Asigna el rol ADMIN a otro miembro antes de eliminar o cambiar a este.'
      USING ERRCODE = 'P0001',
            HINT = 'Promueve primero a otro miembro a ADMIN.';
  END IF;

  RETURN v_result;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_last_admin_business_members ON public.business_members;
CREATE TRIGGER trg_guard_last_admin_business_members
  BEFORE UPDATE OR DELETE ON public.business_members
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_last_admin_business_members();

-- ---------------------------------------------------------------------------
-- 3) Trigger sobre app_users: no borrar / suspender / degradar (data.roleId)
--    al último ADMIN activo desde el perfil que ve la pantalla de Equipo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_last_admin_app_users()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result record;
  v_old_role text;
  v_old_is_admin boolean;
  v_degrades boolean := false;
BEGIN
  v_result := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  v_old_role := upper(btrim(COALESCE(OLD.data ->> 'roleId', '')));

  -- Un perfil es de ADMIN si el rol del servidor lo dice, o si el propio
  -- perfil lo declara (la UI guarda el rol también en data.roleId).
  v_old_is_admin := v_old_role = 'ADMIN'
    OR EXISTS (
      SELECT 1
      FROM public.business_members AS bm
      WHERE bm.business_id = OLD.business_id
        AND bm.user_id::text = OLD.id
        AND upper(btrim(bm.role)) = 'ADMIN'
    );

  IF NOT v_old_is_admin THEN
    RETURN v_result;
  END IF;

  -- Ya estaba suspendido/borrado: no era un admin activo, nada que proteger.
  IF upper(btrim(COALESCE(OLD.data ->> 'status', 'ACTIVE'))) IN ('SUSPENDED', 'DELETED') THEN
    RETURN v_result;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_degrades := true;
  ELSE
    v_degrades :=
         NEW.business_id IS DISTINCT FROM OLD.business_id
      OR NEW.id IS DISTINCT FROM OLD.id
      OR upper(btrim(COALESCE(NEW.data ->> 'status', 'ACTIVE'))) IN ('SUSPENDED', 'DELETED')
      OR (
           (v_old_role = 'ADMIN' OR v_old_role = '')
           AND NEW.data ? 'roleId'
           AND upper(btrim(COALESCE(NEW.data ->> 'roleId', ''))) <> 'ADMIN'
         );
  END IF;

  -- UPDATE inocuo (lastLoginAt, avatar, settings, branch_id, version...): libre,
  -- sin tocar locks ni contar nada.
  IF NOT v_degrades THEN
    RETURN v_result;
  END IF;

  -- Cascada por borrado del negocio completo: permitido.
  IF NOT EXISTS (SELECT 1 FROM public.businesses AS b WHERE b.id = OLD.business_id) THEN
    RETURN v_result;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('team_admin:' || OLD.business_id::text, 0));

  IF NOT public.team_has_other_active_admin(OLD.business_id, OLD.id) THEN
    RAISE EXCEPTION 'LAST_ADMIN_PROTECTED: el negocio debe conservar al menos un administrador activo. Asigna el rol ADMIN a otro miembro antes de eliminar, suspender o cambiar a este.'
      USING ERRCODE = 'P0001',
            HINT = 'Promueve primero a otro miembro a ADMIN.';
  END IF;

  RETURN v_result;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_last_admin_app_users ON public.app_users;
CREATE TRIGGER trg_guard_last_admin_app_users
  BEFORE UPDATE OR DELETE ON public.app_users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_last_admin_app_users();

-- Las funciones de trigger y el helper no son RPC: nadie las llama por la API.
REVOKE ALL ON FUNCTION public.team_has_other_active_admin(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_last_admin_business_members() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_last_admin_app_users() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_has_other_active_admin(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) RLS ADMIN-only en app_users y waiters (INSERT / UPDATE / DELETE)
--    La lectura NO cambia (ADMIN/GERENTE ven el equipo; MESERO ve meseros).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
  v_scope text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['app_users', 'waiters'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);

    -- Mismo alcance de negocio/sucursal que ya usaban las policies vigentes.
    v_scope := 'business_id IN (SELECT public.auth_business_ids())'
            || ' AND (branch_id IS NULL OR branch_id = ANY(public.auth_branch_ids()))';

    -- 4a) PERMISSIVE: solo ADMIN, suscripción activa (igual que antes).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_tenant_insert', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (
         %s
         AND public.has_business_role(business_id, ARRAY[''ADMIN'']::text[])
         AND public.is_business_subscription_active(business_id)
       )',
      v_table || '_tenant_insert', v_table, v_scope
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_tenant_update', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
       USING (
         %s
         AND public.has_business_role(business_id, ARRAY[''ADMIN'']::text[])
       )
       WITH CHECK (
         %s
         AND public.has_business_role(business_id, ARRAY[''ADMIN'']::text[])
         AND public.is_business_subscription_active(business_id)
       )',
      v_table || '_tenant_update', v_table, v_scope, v_scope
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_tenant_delete', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (
         %s
         AND public.has_business_role(business_id, ARRAY[''ADMIN'']::text[])
         AND public.is_business_subscription_active(business_id)
       )',
      v_table || '_tenant_delete', v_table, v_scope
    );

    -- 4b) RESTRICTIVE de refuerzo (AND con cualquier otra policy existente).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_admin_only_insert', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
       WITH CHECK (public.has_business_role(business_id, ARRAY[''ADMIN'']::text[]))',
      v_table || '_admin_only_insert', v_table
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_admin_only_update', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
       USING (public.has_business_role(business_id, ARRAY[''ADMIN'']::text[]))
       WITH CHECK (public.has_business_role(business_id, ARRAY[''ADMIN'']::text[]))',
      v_table || '_admin_only_update', v_table
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_admin_only_delete', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
       USING (public.has_business_role(business_id, ARRAY[''ADMIN'']::text[]))',
      v_table || '_admin_only_delete', v_table
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) business_members: el rol y la membresía solo los cambia un ADMIN
--    (y en la práctica solo el backend: Edge Functions / RPC definer).
-- ---------------------------------------------------------------------------
-- 5a) Cerrar la escritura directa desde el navegador. El cliente solo lee
--     business_members; las altas pasan por create-staff-user (service_role) y
--     accept_invitation() (SECURITY DEFINER). Coincide con get_grant_gaps(),
--     que ya declara estos tres privilegios como cerrados a propósito.
REVOKE INSERT, UPDATE, DELETE ON public.business_members FROM anon, authenticated;
GRANT SELECT ON public.business_members TO authenticated;
GRANT ALL ON public.business_members TO service_role;

-- 5b) Defensa en profundidad si algún día se reabre el GRANT: UPDATE/DELETE
--     solo ADMIN del negocio (se elimina el "o borrar mi propia fila").
DROP POLICY IF EXISTS business_members_update_role ON public.business_members;
CREATE POLICY business_members_update_role ON public.business_members
  FOR UPDATE TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN']::text[])
    AND public.is_business_subscription_active(business_id)
  )
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN']::text[])
    AND public.is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS business_members_delete_member ON public.business_members;
CREATE POLICY business_members_delete_member ON public.business_members
  FOR DELETE TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN']::text[])
    AND public.is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS business_members_admin_only_update ON public.business_members;
CREATE POLICY business_members_admin_only_update ON public.business_members
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['ADMIN']::text[]))
  WITH CHECK (public.has_business_role(business_id, ARRAY['ADMIN']::text[]));

DROP POLICY IF EXISTS business_members_admin_only_delete ON public.business_members;
CREATE POLICY business_members_admin_only_delete ON public.business_members
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['ADMIN']::text[]));

-- ---------------------------------------------------------------------------
-- 6) Diagnóstico (no bloquea): negocios que HOY no tienen ADMIN activo.
--    Los triggers no validan datos históricos; esto solo avisa.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_without_admin integer;
BEGIN
  SELECT count(*) INTO v_without_admin
  FROM public.businesses AS b
  WHERE NOT public.team_has_other_active_admin(b.id, '');

  IF v_without_admin > 0 THEN
    RAISE NOTICE 'LAST_ADMIN_GUARD: % negocio(s) ya no tienen ningun ADMIN activo. Revisalos manualmente: los triggers no los modifican.', v_without_admin;
  END IF;
END;
$$;

COMMIT;

-- ============================================================================
-- ROLLBACK (solo si hace falta revertir; ejecutar manualmente):
--   BEGIN;
--   DROP TRIGGER IF EXISTS trg_guard_last_admin_business_members ON public.business_members;
--   DROP TRIGGER IF EXISTS trg_guard_last_admin_app_users ON public.app_users;
--   DROP FUNCTION IF EXISTS public.guard_last_admin_business_members();
--   DROP FUNCTION IF EXISTS public.guard_last_admin_app_users();
--   DROP FUNCTION IF EXISTS public.team_has_other_active_admin(uuid, text);
--   DROP POLICY IF EXISTS app_users_admin_only_insert ON public.app_users;
--   DROP POLICY IF EXISTS app_users_admin_only_update ON public.app_users;
--   DROP POLICY IF EXISTS app_users_admin_only_delete ON public.app_users;
--   DROP POLICY IF EXISTS waiters_admin_only_insert ON public.waiters;
--   DROP POLICY IF EXISTS waiters_admin_only_update ON public.waiters;
--   DROP POLICY IF EXISTS waiters_admin_only_delete ON public.waiters;
--   DROP POLICY IF EXISTS business_members_admin_only_update ON public.business_members;
--   DROP POLICY IF EXISTS business_members_admin_only_delete ON public.business_members;
--   -- Las policies *_tenant_insert/update/delete de app_users y waiters vuelven
--   -- a ADMIN+GERENTE re-ejecutando el primer DO $$ de
--   -- 20261005000000_restore_missing_rls_and_rpc_grants.sql.
--   COMMIT;
-- ============================================================================