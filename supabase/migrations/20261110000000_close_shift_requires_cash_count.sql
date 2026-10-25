-- ============================================================================
-- 20261110000000_close_shift_requires_cash_count.sql
-- ----------------------------------------------------------------------------
-- Cierre de caja OBLIGATORIO con arqueo (snapshot de billetes y monedas).
--
-- PROBLEMA:
--   public.close_shift_atomic(uuid,numeric,text) seguia ejecutable por
--   `authenticated` (y service_role). Permitia cerrar un turno enviando solo un
--   monto, sin registrar el conteo fisico por denominacion en
--   public.cash_drawer_counts.
--
-- SOLUCION:
--   1. Revocar EXECUTE de close_shift_atomic a PUBLIC, anon, authenticated y
--      service_role. Todo cierre desde el cliente pasa SOLO por
--      public.close_shift_with_cash_count_atomic(...).
--   2. close_shift_with_cash_count_atomic sigue funcionando: es SECURITY DEFINER
--      y llama a close_shift_atomic internamente. Dentro de una funcion
--      SECURITY DEFINER el permiso EXECUTE se evalua contra el DUENO de la
--      funcion (postgres), que conserva el privilegio. Por eso se verifica al
--      final que ambas funciones tengan el mismo dueno.
--   3. Se re-afirman los ACL de la RPC de arqueo y de las implementaciones
--      internas, y se verifica todo con un DO que aborta la migracion si
--      algun permiso quedo abierto.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Cerrar la ruta alternativa (sin arqueo).
-- ---------------------------------------------------------------------------
DO $revoke_close_shift$
BEGIN
  IF to_regprocedure('public.close_shift_atomic(uuid,numeric,text)') IS NULL THEN
    RAISE EXCEPTION 'CAJA_FUNCTION_MISSING: public.close_shift_atomic(uuid,numeric,text)';
  END IF;

  REVOKE ALL ON FUNCTION public.close_shift_atomic(uuid, numeric, text)
    FROM PUBLIC, anon, authenticated, service_role;

  IF to_regprocedure('public.caja_internal_close_shift_atomic(uuid,numeric,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.caja_internal_close_shift_atomic(uuid, numeric, text)
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END;
$revoke_close_shift$;

-- ---------------------------------------------------------------------------
-- 2. Unica ruta publica de cierre: la RPC con arqueo.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.close_shift_with_cash_count_atomic(uuid, uuid, uuid, uuid, numeric, jsonb, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_shift_with_cash_count_atomic(uuid, uuid, uuid, uuid, numeric, jsonb, text, text)
  TO authenticated;

DO $revoke_internal_cash_count$
BEGIN
  IF to_regprocedure('public.caja_internal_close_shift_with_cash_count_atomic(uuid,uuid,uuid,uuid,numeric,jsonb,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.caja_internal_close_shift_with_cash_count_atomic(uuid, uuid, uuid, uuid, numeric, jsonb, text, text)
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END;
$revoke_internal_cash_count$;

COMMENT ON FUNCTION public.close_shift_atomic(uuid, numeric, text) IS
  'USO INTERNO. Sin EXECUTE para anon/authenticated/service_role: el cierre de turno debe pasar por close_shift_with_cash_count_atomic (arqueo obligatorio).';

-- ---------------------------------------------------------------------------
-- 3. Verificacion: si algo quedo abierto, la migracion se aborta.
-- ---------------------------------------------------------------------------
DO $verify_close_shift_lockdown$
DECLARE
  v_role text;
  v_close_owner oid;
  v_count_owner oid;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(v_role, 'public.close_shift_atomic(uuid,numeric,text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'CAJA_CLOSE_BYPASS_OPEN: % aun puede ejecutar close_shift_atomic', v_role;
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
    RAISE EXCEPTION 'CAJA_CLOSE_BYPASS_OPEN: PUBLIC aun puede ejecutar close_shift_atomic';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.close_shift_with_cash_count_atomic(uuid,uuid,uuid,uuid,numeric,jsonb,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'CAJA_CLOSE_WITH_COUNT_CLOSED: authenticated perdio acceso a la RPC con arqueo';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.close_shift_with_cash_count_atomic(uuid,uuid,uuid,uuid,numeric,jsonb,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'CAJA_CLOSE_WITH_COUNT_OPEN: anon puede ejecutar la RPC con arqueo';
  END IF;

  -- La RPC con arqueo llama a close_shift_atomic como SECURITY DEFINER: ambas
  -- deben pertenecer al mismo dueno para que la llamada interna siga valida.
  SELECT proowner INTO v_close_owner
  FROM pg_proc WHERE oid = 'public.close_shift_atomic(uuid,numeric,text)'::regprocedure;
  SELECT proowner INTO v_count_owner
  FROM pg_proc WHERE oid = to_regprocedure('public.caja_internal_close_shift_with_cash_count_atomic(uuid,uuid,uuid,uuid,numeric,jsonb,text,text)');

  IF v_count_owner IS NOT NULL AND v_close_owner IS DISTINCT FROM v_count_owner THEN
    RAISE EXCEPTION 'CAJA_CLOSE_OWNER_MISMATCH: close_shift_atomic y la RPC con arqueo tienen distinto dueno';
  END IF;
END;
$verify_close_shift_lockdown$;

NOTIFY pgrst, 'reload schema';

COMMIT;