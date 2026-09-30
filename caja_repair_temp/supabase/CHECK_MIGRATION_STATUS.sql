-- ============================================================================
-- ORDEN CORRECTO DE MIGRACIONES PARA SUPABASE
-- ============================================================================
-- Ejecuta CADA archivo en este orden en el SQL Editor de Supabase:
--
-- 1. supabase/migrations/20260821_initial_schema.sql
-- 2. supabase/migrations/20260821200020_fix_schema_grants.sql
-- 3. supabase/migrations/20260821200020_fix_business_members_rls.sql
-- 4. supabase/migrations/20260822_add_provider_checkout_url_and_onboarding_rpc.sql
-- 5. supabase/migrations/20260824_monitoring_metrics.sql
-- 6. supabase/migrations/20260826_operation_config.sql ← NUEVO: configuración de operación
--
-- NOTA: El archivo supabase/schema.sql contiene TODO el esquema completo
-- pero está pensado para crear desde cero. Si ya tienes tablas creadas,
-- usa las migraciones individuales en orden.
-- ============================================================================

-- ============================================================================
-- ALTERNATIVA: Si quieres verificar qué migraciones faltan, ejecuta esto:
-- ============================================================================

-- Verificar si las funciones existen:
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'auth_business_ids',
    'auth_branch_ids',
    'is_business_member',
    'has_business_role',
    'is_business_subscription_active',
    'has_user_used_trial',
    'record_trial_usage',
    'mark_onboarding_completed_server_side'
  );

-- Verificar si las políticas existen:
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Verificar si RLS está habilitado en las tablas:
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
