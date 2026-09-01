-- ============================================================================
-- SCRIPT DE APLICACIÓN A PRODUCCIÓN — FASE 4 + FASE 4-BIS
-- ----------------------------------------------------------------------------
-- Este script debe ejecutarse manualmente en el Supabase SQL Editor de
-- producción (https://supabase.com/dashboard). Requiere la Service Role Key
-- o permisos de propietario.
--
-- ORDEN DE APLICACIÓN (IMPORTANTE: sigue este orden):
--   1. trial_user_migration.sql          (user_trial_usage + has_user_used_trial + record_trial_usage)
--   2. 20260828_add_app_users_table.sql   (app_users table + policies + grants)
--   3. 20260829_consolidate_subscription_functions.sql  (funciones consolidadas)
--   4. 20260829_fix_businesses_insert_policies.sql        (policies businesses INSERT)
--   5. 20260829_revoke_trial_usage_grants.sql            (revocar grant trial_usage)
--
-- RECOMENDACIÓN: Aplica esto en un entorno de staging primero.
-- ============================================================================

-- ============================================================================
-- PASO 1: trial_user_migration.sql
-- ============================================================================
-- Crea: user_trial_usage (si no existe), has_user_used_trial (actualizada),
--        record_trial_usage (con ON CONFLICT DO NOTHING)
-- Otorga: EXEC a service_role solo; REVOCADO a authenticated para record_trial_usage

-- [Ver archivo: supabase/trial_user_migration.sql — CORREGIDO FASE 4-BIS]
-- Cambios aplicados en este archivo:
--   - record_trial_usage: ON CONFLICT DO NOTHING (era DO UPDATE)
--   - GRANT EXECUTE: service_role SOLO (era service_role, authenticated)

-- ============================================================================
-- PASO 2: 20260828_add_app_users_table.sql
-- ============================================================================
-- Crea: app_users table, RLS, policies, grants
-- Ya actualizado en FASE 3 (consolidado por schema.sql)
-- Grants de funciones para auth_business_ids, auth_branch_ids, is_business_subscription_active

-- ============================================================================
-- PASO 3: 20260829_consolidate_subscription_functions.sql
-- ============================================================================
-- Reemplaza is_business_subscription_active con lógica basada en fechas
--   (plan + trial_ends_at / renewal_date), compatible con SubscriptionEngine.ts
-- has_user_used_trial: versión SQL definitiva
-- record_trial_usage: DO NOTHING, GRANT a service_role SOLO

-- ============================================================================
-- PASO 4: 20260829_fix_businesses_insert_policies.sql
-- ============================================================================
-- Elimina businesses_insert_owner (policy peligrosa de fix_permissions.sql)
-- Asegura businesses_insert_own como única policy INSERT con trial check

-- ============================================================================
-- PASO 5: 20260829_revoke_trial_usage_grants.sql
-- ============================================================================
-- REVOKE ALL ON FUNCTION record_trial_usage FROM authenticated
-- GRANT EXECUTE ON FUNCTION record_trial_usage TO service_role

-- ============================================================================
-- VERIFICACIÓN POST-APLICACIÓN:
-- ============================================================================
-- 1. app_users existe:
--    SELECT to_regclass('app_users');  -- debe devolver app_users

-- 2. record_trial_usage no accesible con authenticated:
--    (con anon/authenticated key, rpc('record_trial_usage') debe fallar con PGRST203)

-- 3. has_user_used_trial accesible con authenticated:
--    (con authenticated key, rpc('has_user_used_trial') debe devolver boolean)

-- 4. businesses_insert_owner NO existe:
--    SELECT COUNT(*) FROM pg_policies WHERE policy_name = 'businesses_insert_owner';
--    -- debe devolver 0

-- 5. businesses_insert_own verifica trial:
--    SELECT policy_name, permis
--    FROM pg_policies WHERE tablename = 'businesses' AND policy_name = 'businesses_insert_own';

-- ============================================================================
-- FIN DEL SCRIPT DE APLICACIÓN
-- ============================================================================
