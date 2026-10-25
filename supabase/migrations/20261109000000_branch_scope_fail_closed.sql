-- ============================================================================
-- 20261109000000_branch_scope_fail_closed.sql
-- ----------------------------------------------------------------------------
-- P1 #1 — Aislamiento estricto por sucursal (FAIL-CLOSED).
--
-- PROBLEMA (20261013000000_step6_branch_scope_and_customer_uniqueness.sql):
--   auth_branch_ids() devolvia TODAS las sucursales del negocio cuando:
--     (a) el usuario no tenia fila en app_users, o
--     (b) su fila tenia branch_id NULL.
--   Ademas la funcion ignoraba el rol. Resultado: un CAJERO/MESERO sin sucursal
--   asignada (y create-staff-user los creaba SIN sucursal) heredaba acceso a
--   todo el negocio en cada policy y RPC que usa branch_id = ANY(auth_branch_ids()).
--
-- REGLA NUEVA:
--   * ADMIN / GERENTE (business_members.role) -> todas las sucursales del negocio.
--   * Cualquier otro rol (CAJERO, MESERO, COCINA, INVENTARIO, CONTADOR, rol
--     desconocido...) -> SOLO la sucursal de su fila app_users.branch_id.
--     Sin fila, o con branch_id NULL  =>  arreglo vacio (acceso denegado).
--   * El rol sale de business_members (fuente de verdad del servidor), nunca de
--     app_users.data, que es jsonb editable por la app.
--
-- PARA NO DEJAR SIN ACCESO AL PERSONAL ACTUAL:
--   El personal no-ADMIN/GERENTE que HOY tiene branch_id NULL se asigna a la
--   sucursal principal activa de su negocio antes de activar la regla. Asi
--   conservan acceso a una sucursal (no a todas). Quien no tenga fila en
--   app_users no se inventa: queda denegado y se reporta con RAISE NOTICE.
--
-- NO CAMBIA: firma, SECURITY DEFINER, search_path vacio ni grants de
-- auth_branch_ids(). Las policies/RPC existentes no se tocan.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Backfill: personal operativo con branch_id NULL -> sucursal principal.
--    (version + 1 para respetar el bloqueo optimista que usa la app)
-- ---------------------------------------------------------------------------
WITH target_branch AS (
  SELECT DISTINCT ON (b.business_id)
         b.business_id,
         b.id AS branch_id
  FROM public.branches AS b
  WHERE b.active = true
  ORDER BY b.business_id, b.is_main DESC, b.created_at ASC, b.id ASC
)
UPDATE public.app_users AS au
SET branch_id  = tb.branch_id,
    version    = au.version + 1,
    updated_at = now()
FROM public.business_members AS bm,
     target_branch AS tb
WHERE bm.user_id::text = au.id
  AND bm.business_id   = au.business_id
  AND tb.business_id   = au.business_id
  AND au.branch_id IS NULL
  AND upper(btrim(bm.role)) NOT IN ('ADMIN', 'GERENTE');

-- Miembros operativos SIN fila en app_users: quedaran denegados (fail-closed).
DO $$
DECLARE
  v_orphans integer;
BEGIN
  SELECT count(*)
  INTO v_orphans
  FROM public.business_members AS bm
  WHERE upper(btrim(bm.role)) NOT IN ('ADMIN', 'GERENTE')
    AND NOT EXISTS (
      SELECT 1
      FROM public.app_users AS au
      WHERE au.id = bm.user_id::text
        AND au.business_id = bm.business_id
    );

  RAISE NOTICE 'BRANCH_FAIL_CLOSED: % miembro(s) operativo(s) sin fila en app_users quedan SIN acceso hasta que se les asigne sucursal.', v_orphans;
END $$;

-- ---------------------------------------------------------------------------
-- 2) auth_branch_ids() fail-closed y consciente del rol.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_branch_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
           array_agg(DISTINCT b.id) FILTER (WHERE b.id IS NOT NULL),
           '{}'::uuid[]
         )
  FROM public.business_members AS bm
  JOIN public.branches AS b
    ON b.business_id = bm.business_id
  WHERE bm.user_id = auth.uid()
    AND b.business_id IN (SELECT public.auth_business_ids())
    AND (
      -- Roles con alcance de negocio completo.
      upper(btrim(bm.role)) IN ('ADMIN', 'GERENTE')
      -- Resto de roles: solo la sucursal explicitamente asignada.
      -- Sin fila o con branch_id NULL no hay coincidencia => acceso denegado.
      OR EXISTS (
        SELECT 1
        FROM public.app_users AS au
        WHERE au.business_id = b.business_id
          AND au.id = bm.user_id::text
          AND au.branch_id = b.id
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.auth_branch_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_branch_ids() TO authenticated, service_role;

COMMENT ON FUNCTION public.auth_branch_ids() IS
  'Sucursales accesibles para el usuario actual. FAIL-CLOSED: ADMIN/GERENTE (business_members.role) ven todas las del negocio; cualquier otro rol solo la de app_users.branch_id. Sin fila en app_users o con branch_id NULL devuelve {} (sin acceso). SECURITY DEFINER para poder leer app_users aunque su RLS solo abra lectura a ADMIN/GERENTE.';

COMMIT;