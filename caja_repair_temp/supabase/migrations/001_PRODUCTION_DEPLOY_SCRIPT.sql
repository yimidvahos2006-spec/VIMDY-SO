-- ============================================================================
-- SCRIPT DE DEPLOY ÚNICO — FASE 4-C PRODUCCIÓN
-- ============================================================================
-- Objetivo: Alinear producción con el código actual.
-- NO destruye datos. Todas las operaciones son idempotent (IF NOT EXISTS,
-- CREATE OR REPLACE, DROP IF EXISTS).
--
-- ORDEN DE APLICACIÓN (NO cambiar):
--   1. record_trial_usage + grants         (tabla ya existe en prod)
--   2. app_users table + RLS + policies     (no existe en prod)
--   3. is_business_subscription_active     (corregir lógica de fechas)
--   4. businesses_insert_policies          (redefinir + eliminar owner)
--   5. REVOKE record_trial_usage de authenticated  (debe ser LO ÚLTIMO)
--
-- PRE-REQUISITOS (existentes en prod ✅):
--   - businesses (con plan, trial_ends_at, renewal_date, trial_used_at,
--     payment_status, subscription_status)
--   - business_members
--   - branches
--   - user_trial_usage
--   - has_user_used_trial() — EXISTE
--   - is_business_subscription_active() — EXISTE (versión obsoleta)
--   - auth_business_ids(), auth_branch_ids() — EXISTEN
--   - businesses_insert_own — EXISTE (con trial check)
--
-- RECOMENDACIÓN: Ejecutar en un horario de bajo tráfico. Hacer backup antes.
-- ============================================================================

-- ============================================================================
-- PARTE 1: VERIFICACIÓN PRE-DEPLOY (estado actual de prod)
-- ============================================================================
-- Ejecutar ESTE bloque antes de aplicar los cambios y comparar resultados.
-- ============================================================================
/*
-- 1.1 ¿app_users existe?
SELECT 'app_users_exists' AS check, to_regclass('app_users') AS result;
--   EXPECTED: NULL (no existe)

-- 1.2 ¿record_trial_usage existe?
SELECT 'record_trial_usage_exists' AS check,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname = 'record_trial_usage' AND n.nspname = 'public') AS result;
--   EXPECTED: false (no existe)

-- 1.3 ¿businesses_insert_owner existe?
SELECT 'businesses_insert_owner_exists' AS check,
  (SELECT COUNT(*) FROM pg_policy WHERE polname = 'businesses_insert_owner') AS result;
--   EXPECTED: 0 (no existe)

-- 1.4 ¿businesses tiene trial_ends_at?
SELECT 'businesses_trial_ends_at' AS check,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'businesses' AND column_name = 'trial_ends_at') AS result;
--   EXPECTED: 1 (existe)

-- 1.5 ¿businesses tiene renewal_date?
SELECT 'businesses_renewal_date' AS check,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'businesses' AND column_name = 'renewal_date') AS result;
--   EXPECTED: 1 (existe)

-- 1.6 ¿user_trial_usage existe?
SELECT 'user_trial_usage_exists' AS check, to_regclass('user_trial_usage') AS result;
--   EXPECTED: user_trial_usage (existe)

-- 1.7 ¿businesses_insert_own tiene trial check?
SELECT 'businesses_insert_own_check' AS check,
  pg_get_expr(pg_policy.policy_expr, pg_policy.policy_relid, true) AS check_expr
FROM pg_policy
WHERE polname = 'businesses_insert_own'
AND polrelid = 'businesses'::regclass::oid;
--   EXPECTED contiene: has_user_used_trial
*/

-- ============================================================================
-- FIN DE VERIFICACIÓN PRE-DEPLOY
-- ============================================================================


-- ============================================================================
-- PASO 1: record_trial_usage() — función con ON CONFLICT DO NOTHING
-- ============================================================================
-- La tabla user_trial_usage YA existe en prod (creada por migration base).
-- Solo falta crear la función record_trial_usage.
-- SECURITY DEFINER + search_path = public para que funcione en policies.
-- ON CONFLICT DO NOTHING previene duplicados (trial único por persona).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_trial_usage(
  p_user_id uuid,
  p_business_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_trial_usage (user_id, business_id, plan, used_at)
  VALUES (p_user_id, p_business_id, 'trial', now())
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

-- Revocar acceso de todos los roles públicos, anon, authenticated
REVOKE ALL ON FUNCTION public.record_trial_usage(uuid, uuid) FROM public, anon, authenticated;

-- Solo service_role puede registrar uso de trial (lo hace register-business)
GRANT EXECUTE ON FUNCTION public.record_trial_usage(uuid, uuid) TO service_role;


-- ============================================================================
-- PASO 2: app_users table + RLS + policies
-- ============================================================================
-- Estructura: id (text), business_id (uuid), branch_id (uuid nullable),
-- version (integer), data (jsonb), created_at, updated_at.
-- Compatible con: register-business, create-staff-user, ensureOwnerProfile,
-- UserRepository (SupabaseRepository).
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_users (
  id text primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  version integer not null default 1,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS app_users_business_id_idx ON app_users (business_id);

-- --- RLS ---
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- --- Policies multi-tenant ---
-- Solo usuarios de TU negocio pueden ver/editar/eliminar empleados.
-- auth_business_ids() devuelve los business_ids donde el usuario tiene rol.

DROP POLICY IF EXISTS app_users_tenant_read ON app_users;
CREATE POLICY app_users_tenant_read ON app_users
  FOR SELECT
  USING (
    business_id IN (SELECT auth_business_ids())
    AND (
      branch_id IS NULL
      OR branch_id IN (SELECT auth_branch_ids())
    )
  );

DROP POLICY IF EXISTS app_users_tenant_insert ON app_users;
CREATE POLICY app_users_tenant_insert ON app_users
  FOR INSERT
  WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND (
      branch_id IS NULL
      OR branch_id IN (SELECT auth_branch_ids())
    )
    AND public.is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS app_users_tenant_update ON app_users;
CREATE POLICY app_users_tenant_update ON app_users
  FOR UPDATE
  USING (
    business_id IN (SELECT auth_business_ids())
    AND (
      branch_id IS NULL
      OR branch_id IN (SELECT auth_branch_ids())
    )
  )
  WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND (
      branch_id IS NULL
      OR branch_id IN (SELECT auth_branch_ids())
    )
    AND public.is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS app_users_tenant_delete ON app_users;
CREATE POLICY app_users_tenant_delete ON app_users
  FOR DELETE
  USING (
    business_id IN (SELECT auth_business_ids())
    AND (
      branch_id IS NULL
      OR branch_id IN (SELECT auth_branch_ids())
    )
    AND public.is_business_subscription_active(business_id)
  );

-- --- GRANTS ---
-- service_role: acceso completo (register-business, create-staff-user, ensureOwnerProfile)
GRANT ALL ON app_users TO service_role;

-- authenticated: acceso completo SUJETO A RLS (solo filas de su negocio)
GRANT SELECT, INSERT, UPDATE, DELETE ON app_users TO authenticated;

-- Grants para funciones auxiliares usadas en policies
GRANT EXECUTE ON FUNCTION public.auth_business_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_branch_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_business_subscription_active(uuid) TO authenticated, service_role;


-- ============================================================================
-- PASO 3: is_business_subscription_active() — corregir lógica de fechas
-- ============================================================================
-- La versión obsoleta en prod usa:
--   subscription_status IN ('trial', 'monthly', 'yearly')
-- que NO verifica fechas → trial indefinido posible.
--
-- Nueva versión: usa plan + fechas reales:
--   - trial: trial_ends_at > CURRENT_TIMESTAMP
--   - monthly/yearly: renewal_date IS NULL OR renewal_date > CURRENT_TIMESTAMP
-- Compatible con SubscriptionEngine.ts effectiveStatus().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_business_subscription_active(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM businesses
    WHERE id = p_business_id
      AND (
        (
          plan = 'trial'
          AND trial_ends_at IS NOT NULL
          AND trial_ends_at > CURRENT_TIMESTAMP
        )
        OR (
          plan IN ('monthly', 'yearly')
          AND (
            renewal_date IS NULL
            OR renewal_date > CURRENT_TIMESTAMP
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_business_subscription_active(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_business_subscription_active(uuid) TO authenticated, service_role;


-- ============================================================================
-- PASO 4: businesses INSERT policies — garantizar una sola policy correcta
-- ============================================================================
-- Elimina la policy peligrosa businesses_insert_owner (si existe).
-- Asegura businesses_insert_own con trial check.

-- 4.1 Eliminar policy peligrosa si existe
DROP POLICY IF EXISTS businesses_insert_owner ON businesses;

-- 4.2 Redefinir businesses_insert_own (la ÚNICA policy INSERT válida)
--     con verificación de trial: NOT public.has_user_used_trial(auth.uid())
DROP POLICY IF EXISTS businesses_insert_own ON businesses;

CREATE POLICY businesses_insert_own ON businesses
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND NOT public.has_user_used_trial(auth.uid())
  );


-- ============================================================================
-- PASO 5: REVOKE record_trial_usage de authenticated (LO ÚLTIMO)
-- ============================================================================
-- Ya hecho en el Paso 1 (REVOKE ALL FROM authenticated).
-- Este bloque es redundante pero idempotente:
-- ============================================================================

REVOKE ALL ON FUNCTION public.record_trial_usage(uuid, uuid) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.record_trial_usage(uuid, uuid) TO service_role;


-- ============================================================================
-- PARTE FINAL: VERIFICACIÓN POST-DEPLOY
-- ============================================================================
-- Ejecutar ESTE bloque después de aplicar todos los cambios.
-- ============================================================================
/*
-- 1. app_users existe:
SELECT 'app_users_exists' AS check, to_regclass('app_users') AS result;
--   EXPECTED: app_users (✅)

-- 2. app_users tiene RLS:
SELECT 'app_users_rls' AS check, relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname = 'app_users' AND n.nspname = 'public';
--   EXPECTED: true (✅)

-- 3. app_users policies:
SELECT 'app_users_policies' AS check, polname
FROM pg_policy WHERE polrelid = 'app_users'::regclass::oid
ORDER BY polname;
--   EXPECTED: app_users_tenant_read, app_users_tenant_insert,
--             app_users_tenant_update, app_users_tenant_delete (✅)

-- 4. app_users grants (authenticated debe tener SELECT/INSERT/UPDATE/DELETE, NO ALL):
SELECT 'app_users_grants' AS check,
  grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'app_users' AND grantee IN ('authenticated', 'service_role')
ORDER BY grantee, privilege_type;
--   EXPECTED: authenticated → DELETE, INSERT, SELECT, UPDATE
--             service_role → ALL (DELETE, INSERT, REFERENCES, SELECT, TRIGGER, UPDATE)

-- 5. record_trial_usage existe:
SELECT 'record_trial_usage_exists' AS check,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname = 'record_trial_usage' AND n.nspname = 'public') AS result;
--   EXPECTED: true (✅)

-- 6. record_trial_usage grant (solo service_role):
SELECT 'record_trial_usage_grant' AS check,
  grantee
FROM information_schema.role_routine_grants
WHERE routine_name = 'record_trial_usage' AND grantee IN ('authenticated', 'service_role')
ORDER BY grantee;
--   EXPECTED: SOLO service_role (✅ no authenticated)

-- 7. has_user_used_trial grant (authenticated + service_role):
SELECT 'has_user_used_trial_grant' AS check,
  grantee
FROM information_schema.role_routine_grants
WHERE routine_name = 'has_user_used_trial' AND grantee IN ('authenticated', 'service_role')
ORDER BY grantee;
--   EXPECTED: authenticated, service_role (✅)

-- 8. is_business_subscription_active grant (authenticated + service_role):
SELECT 'is_business_subscription_active_grant' AS check,
  grantee
FROM information_schema.role_routine_grants
WHERE routine_name = 'is_business_subscription_active' AND grantee IN ('authenticated', 'service_role')
ORDER BY grantee;
--   EXPECTED: authenticated, service_role (✅)

-- 9. is_business_subscription_active usa fechas (no subscription_status):
SELECT 'is_business_subscription_active_body' AS check,
  pg_get_funcdef(c.oid) AS definition
FROM pg_proc p
JOIN pg_class c ON c.oid = p.oid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE p.proname = 'is_business_subscription_active' AND n.nspname = 'public';
--   EXPECTED en definición:
--     trial_ends_at > CURRENT_TIMESTAMP
--     renewal_date > CURRENT_TIMESTAMP
--   NO debe contener: subscription_status = 'approved'

-- 10. businesses INSERT policies (auditar todas):
SELECT 'businesses_insert_policies' AS check, polname, pg_get_expr(policy_expr, policy_relid) AS check_expr
FROM pg_policy
WHERE polrelid = 'businesses'::regclass::oid
AND polname LIKE '%insert%';
--   EXPECTED: solo businesses_insert_own con has_user_used_trial

-- 11. businesses_insert_owner NO existe:
SELECT 'businesses_insert_owner_exists' AS check,
  (SELECT COUNT(*) FROM pg_policy WHERE polname = 'businesses_insert_owner') AS result;
--   EXPECTED: 0 (✅)

-- 12. Test de acceso con authenticated key:
--    supabase.rpc('record_trial_usage', { p_user_id: uuid, p_business_id: uuid })
--    → debe devolver PGRST203 (permission denied) ✅
--    supabase.rpc('has_user_used_trial', { p_user_id: uuid })
--    → debe devolver boolean ✅
--    supabase.from('app_users').select('*')
--    → debe devolver rows del negocio (sujeto a RLS) ✅
*/

-- ============================================================================
-- FIN DEL SCRIPT DE DEPLOY
-- ============================================================================
