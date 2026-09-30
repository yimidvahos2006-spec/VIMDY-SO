-- ============================================================================
# VIMDY OS - SQL CORREGIDO PARA APLICAR PERMISOS
# ============================================================================
# Este SQL es idempotente: se puede ejecutar múltiples veces sin problemas.
# Solo aplica los permisos faltantes, no modifica datos existentes.
#
# INSTRUCCIONES:
# 1. Ve a Supabase Dashboard → SQL Editor
# 2. Copia y pega TODO este archivo
# 3. Ejecuta
# ============================================================================

-- ============================================================================
-- PARTE 1: FUNCIONES AUXILIARES (necesarias para las políticas)
-- ============================================================================

-- Función: IDs de negocios del usuario actual
CREATE OR REPLACE FUNCTION public.auth_business_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT business_id FROM business_members WHERE user_id = auth.uid();
$$;

-- Función: IDs de sucursales del usuario actual
CREATE OR REPLACE FUNCTION public.auth_branch_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM branches WHERE business_id IN (SELECT auth_business_ids());
$$;

-- Función: Verificar si es miembro de un negocio
CREATE OR REPLACE FUNCTION public.is_business_member(target_business_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM business_members
    WHERE business_id = target_business_id
      AND user_id = auth.uid()
  );
$$;

-- Función: Verificar rol en un negocio
CREATE OR REPLACE FUNCTION public.has_business_role(
  target_business_id uuid,
  allowed_roles text[]
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM business_members
    WHERE business_id = target_business_id
      AND user_id = auth.uid()
      AND role = ANY(allowed_roles)
  );
$$;

-- ============================================================================
-- PARTE 1: DEFINICIONES DE FUNCIONES
-- ----------------------------------------------------------------------------
-- IMPORTANTE: Las definiciones de has_user_used_trial, record_trial_usage e
-- is_business_subscription_active ahora están CONSOLIDADAS en la migration:
--   supabase/migrations/20260829_consolidate_subscription_functions.sql
--
-- Este archivo NO redefine funciones conflictivas. Solo otorga/revoca
-- permisos. Si este script se ejecuta después de la migration, las
-- definiciones permanecerán correctas.
-- ============================================================================

-- Función: Verificar si la suscripción está activa
-- Fuente de verdad consolidada: 20260829_consolidate_subscription_functions.sql
-- Modelo VIMDY: trial | monthly | yearly | expired | suspended
-- Activo: plan IN ('trial','monthly','yearly') con vigencia de fechas:
--   - trial: trial_ends_at > now()
--   - monthly/yearly: renewal_date IS NULL o renewal_date > now()
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

-- Función: Verificar si ya usó el trial
-- DEFINICIÓN CONSOLIDADA EN: 20260829_consolidate_subscription_functions.sql
CREATE OR REPLACE FUNCTION public.has_user_used_trial(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM user_trial_usage WHERE user_id = p_user_id
  );
$$;

-- Función: Registrar uso del trial
-- DEFINICIÓN CONSOLIDADA EN: 20260829_consolidate_subscription_functions.sql
-- IMPORTANTE: record_trial_usage SOLO otorga EXECUTE a service_role (NO a authenticated).
-- El cliente no puede llamar directamente esta RPC. La inserción de
-- user_trial_usage ocurre exclusivamente desde register-business Edge Function.
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

-- Función: Marcar onboarding como completado (server-side)
CREATE OR REPLACE FUNCTION public.mark_onboarding_completed_server_side(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM business_members
      WHERE business_id = p_business_id
        AND user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'NOT_A_MEMBER: no perteneces a este negocio.';
    END IF;
  END IF;

  UPDATE businesses
  SET onboarding_completed = true
  WHERE id = p_business_id
    AND onboarding_completed = false;

  RETURN found;
END;
$$;

-- ============================================================================
-- PARTE 2: PERMISOS DE SCHEMA
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public TO service_role;

-- ============================================================================
-- PARTE 3: GRANTS PARA service_role (usado por Edge Functions)
-- ============================================================================

DO $$
DECLARE
  store_name text;
  store_names text[] := ARRAY[
    'businesses', 'business_members', 'business_invitations', 'branches',
    'subscription_payments', 'subscription_audit_log', 'user_trial_usage',
    'app_users', 'products', 'sales', 'sale_items', 'customers',
    'kitchen_orders', 'kitchen_order_items', 'alerts', 'inventory_movements',
    'cash_movements', 'tables', 'orders', 'shifts', 'roles', 'permissions',
    'audit_logs', 'categories', 'suppliers', 'business_snapshots',
    'purchase_orders', 'waiters', 'receipts', 'notifications',
    'pending_sales', 'pending_inventory_adjustments',
    'pending_table_operations', 'pending_customer_operations'
  ];
BEGIN
  FOREACH store_name IN ARRAY store_names LOOP
    EXECUTE format('GRANT ALL ON %I TO service_role;', store_name);
  END LOOP;
END $$;

-- ============================================================================
-- PARTE 4: GRANTS PARA authenticated
-- ============================================================================

-- businesses: SELECT, INSERT, DELETE (UPDATE se maneja aparte por columnas)
GRANT SELECT, INSERT, DELETE ON businesses TO authenticated;

-- business_members: SELECT (las demás operaciones vía políticas RLS)
GRANT SELECT ON business_members TO authenticated;

-- business_invitations: CRUD completo (sujeto a RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON business_invitations TO authenticated;

-- branches: SELECT
GRANT SELECT ON branches TO authenticated;

-- subscription tables: SELECT
GRANT SELECT ON subscription_payments TO authenticated;
GRANT SELECT ON subscription_audit_log TO authenticated;

-- user_trial_usage: sin grants directos (solo service_role)
-- NOTA: El revoke ya debería existir, pero por seguridad:
REVOKE ALL ON user_trial_usage FROM authenticated, anon;

-- app_users: CRUD sujeto a RLS (políticas tenant isolation).
-- NO usar GRANT ALL — eso otorga privilegios que RLS no puede restringir
-- (ej. TRUNCATE, REFERENCES). Usar permisos específicos sujetos a policies.
-- El RLS sigue activo (PARTE 10) y filtra por negocio/tenant.
GRANT SELECT, INSERT, UPDATE, DELETE ON app_users TO authenticated;

-- Store tables: CRUD completo (sujeto a RLS)
DO $$
DECLARE
  store_name text;
  store_names text[] := ARRAY[
    'products', 'sales', 'sale_items', 'customers', 'kitchen_orders',
    'kitchen_order_items', 'alerts', 'inventory_movements', 'cash_movements',
    'tables', 'orders', 'shifts', 'roles', 'permissions', 'audit_logs',
    'categories', 'suppliers', 'business_snapshots', 'purchase_orders',
    'waiters', 'receipts', 'notifications', 'pending_sales',
    'pending_inventory_adjustments', 'pending_table_operations',
    'pending_customer_operations'
  ];
BEGIN
  FOREACH store_name IN ARRAY store_names LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated;', store_name);
  END LOOP;
END $$;

-- ============================================================================
-- PARTE 5: UPDATE DE SOLO COLUMNAS SEGURAS EN businesses
-- ============================================================================

REVOKE UPDATE ON businesses FROM authenticated;
GRANT UPDATE (
  name, country, currency, language, timezone, tax_rate,
  business_type, enabled_modules, salida_cocina, onboarding_completed
) ON businesses TO authenticated;

-- ============================================================================
-- PARTE 6: POLÍTICAS RLS PARA businesses
-- ============================================================================

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS businesses_member_access ON businesses;
CREATE POLICY businesses_member_access ON businesses
  FOR SELECT
  USING (id IN (SELECT auth_business_ids()));

DROP POLICY IF EXISTS businesses_insert_own ON businesses;
CREATE POLICY businesses_insert_own ON businesses
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND NOT public.has_user_used_trial(auth.uid())
  );

DROP POLICY IF EXISTS businesses_update_own ON businesses;
CREATE POLICY businesses_update_own ON businesses
  FOR UPDATE
  USING (id IN (SELECT auth_business_ids()))
  WITH CHECK (id IN (SELECT auth_business_ids()));

DROP POLICY IF EXISTS businesses_delete_own ON businesses;
CREATE POLICY businesses_delete_own ON businesses
  FOR DELETE
  USING (id IN (SELECT auth_business_ids()));

-- ============================================================================
-- PARTE 7: POLÍTICAS RLS PARA business_members
-- ============================================================================

ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_members_self_read ON business_members;
CREATE POLICY business_members_self_read ON business_members
  FOR SELECT
  USING (business_id IN (SELECT auth_business_ids()));

DROP POLICY IF EXISTS business_members_admin_insert ON business_members;
CREATE POLICY business_members_admin_insert ON business_members
  FOR INSERT
  WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN'])
  );

DROP POLICY IF EXISTS business_members_admin_update ON business_members;
CREATE POLICY business_members_admin_update ON business_members
  FOR UPDATE
  USING (
    business_id IN (SELECT auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN'])
  )
  WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN'])
  );

DROP POLICY IF EXISTS business_members_delete_member ON business_members;
CREATE POLICY business_members_delete_member ON business_members
  FOR DELETE
  USING (
    business_id IN (SELECT auth_business_ids())
    AND (
      public.has_business_role(business_id, ARRAY['ADMIN'])
      OR user_id = auth.uid()
    )
  );

-- ============================================================================
-- PARTE 8: POLÍTICAS RLS PARA business_invitations
-- ============================================================================

ALTER TABLE business_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_invitations_admin_read ON business_invitations;
CREATE POLICY business_invitations_admin_read ON business_invitations
  FOR SELECT
  USING (
    business_id IN (SELECT auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN'])
  );

DROP POLICY IF EXISTS business_invitations_admin_insert ON business_invitations;
CREATE POLICY business_invitations_admin_insert ON business_invitations
  FOR INSERT
  WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN'])
  );

DROP POLICY IF EXISTS business_invitations_self_accept ON business_invitations;
CREATE POLICY business_invitations_self_accept ON business_invitations
  FOR SELECT
  USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND expires_at > now()
    AND accepted_at IS NULL
  );

-- ============================================================================
-- PARTE 9: POLÍTICAS RLS PARA branches
-- ============================================================================

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branches_tenant_read ON branches;
CREATE POLICY branches_tenant_read ON branches
  FOR SELECT
  USING (business_id IN (SELECT auth_business_ids()));

DROP POLICY IF EXISTS branches_admin_insert ON branches;
CREATE POLICY branches_admin_insert ON branches
  FOR INSERT
  WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN'])
  );

DROP POLICY IF EXISTS branches_admin_update ON branches;
CREATE POLICY branches_admin_update ON branches
  FOR UPDATE
  USING (
    business_id IN (SELECT auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN'])
  )
  WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN'])
  );

-- ============================================================================
-- PARTE 10: POLÍTICAS RLS PARA app_users
-- ============================================================================

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_users_tenant_read ON app_users;
CREATE POLICY app_users_tenant_read ON app_users
  FOR SELECT
  USING (
    business_id IN (SELECT auth_business_ids())
    AND (branch_id IS NULL OR branch_id IN (SELECT auth_branch_ids()))
  );

DROP POLICY IF EXISTS app_users_tenant_insert ON app_users;
CREATE POLICY app_users_tenant_insert ON app_users
  FOR INSERT
  WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND (branch_id IS NULL OR branch_id IN (SELECT auth_branch_ids()))
  );

DROP POLICY IF EXISTS app_users_tenant_update ON app_users;
CREATE POLICY app_users_tenant_update ON app_users
  FOR UPDATE
  USING (
    business_id IN (SELECT auth_business_ids())
    AND (branch_id IS NULL OR branch_id IN (SELECT auth_branch_ids()))
  )
  WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND (branch_id IS NULL OR branch_id IN (SELECT auth_branch_ids()))
  );

DROP POLICY IF EXISTS app_users_tenant_delete ON app_users;
CREATE POLICY app_users_tenant_delete ON app_users
  FOR DELETE
  USING (
    business_id IN (SELECT auth_business_ids())
    AND (branch_id IS NULL OR branch_id IN (SELECT auth_branch_ids()))
  );

-- ============================================================================
-- PARTE 11: POLÍTICAS RLS PARA STORE TABLES (products, sales, etc.)
-- ============================================================================

DO $$
DECLARE
  store_name text;
  store_names text[] := ARRAY[
    'products', 'sales', 'sale_items', 'customers', 'kitchen_orders',
    'kitchen_order_items', 'alerts', 'inventory_movements', 'cash_movements',
    'tables', 'orders', 'shifts', 'roles', 'permissions', 'audit_logs',
    'categories', 'suppliers', 'business_snapshots', 'purchase_orders',
    'waiters', 'receipts', 'notifications', 'pending_sales',
    'pending_inventory_adjustments', 'pending_table_operations',
    'pending_customer_operations'
  ];
BEGIN
  FOREACH store_name IN ARRAY store_names LOOP
    -- Habilitar RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', store_name);

    -- SELECT policy
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I; CREATE POLICY %I ON %I FOR SELECT USING (business_id IN (SELECT auth_business_ids()) AND (branch_id IS NULL OR branch_id IN (SELECT auth_branch_ids())));',
      store_name || '_tenant_read', store_name,
      store_name || '_tenant_read', store_name
    );

    -- INSERT policy
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I; CREATE POLICY %I ON %I FOR INSERT WITH CHECK (business_id IN (SELECT auth_business_ids()) AND (branch_id IS NULL OR branch_id IN (SELECT auth_branch_ids())) AND public.is_business_subscription_active(business_id));',
      store_name || '_tenant_insert', store_name,
      store_name || '_tenant_insert', store_name
    );

    -- UPDATE policy
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I; CREATE POLICY %I ON %I FOR UPDATE USING (business_id IN (SELECT auth_business_ids()) AND (branch_id IS NULL OR branch_id IN (SELECT auth_branch_ids()))) WITH CHECK (business_id IN (SELECT auth_business_ids()) AND (branch_id IS NULL OR branch_id IN (SELECT auth_branch_ids())) AND public.is_business_subscription_active(business_id));',
      store_name || '_tenant_update', store_name,
      store_name || '_tenant_update', store_name
    );

    -- DELETE policy
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I; CREATE POLICY %I ON %I FOR DELETE USING (business_id IN (SELECT auth_business_ids()) AND (branch_id IS NULL OR branch_id IN (SELECT auth_branch_ids())) AND public.is_business_subscription_active(business_id));',
      store_name || '_tenant_delete', store_name,
      store_name || '_tenant_delete', store_name
    );
  END LOOP;
END $$;

-- ============================================================================
-- PARTE 12: POLÍTICAS RLS PARA subscription tables
-- ============================================================================

-- subscription_payments
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_payments_tenant_read ON subscription_payments;
CREATE POLICY subscription_payments_tenant_read ON subscription_payments
  FOR SELECT
  USING (business_id IN (SELECT auth_business_ids()));

-- subscription_audit_log
ALTER TABLE subscription_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_audit_log_tenant_read ON subscription_audit_log;
CREATE POLICY subscription_audit_log_tenant_read ON subscription_audit_log
  FOR SELECT
  USING (business_id IN (SELECT auth_business_ids()));

-- user_trial_usage
ALTER TABLE user_trial_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_trial_usage_service_only ON user_trial_usage;
CREATE POLICY user_trial_usage_service_only ON user_trial_usage
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- PARTE 13: GRANTS PARA FUNCIONES
-- ============================================================================

-- Funciones auxiliares (usadas por las políticas)
REVOKE ALL ON FUNCTION public.auth_business_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.auth_business_ids() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.auth_branch_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.auth_branch_ids() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_business_member(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_business_member(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_business_role(uuid, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_business_role(uuid, text[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_business_subscription_active(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_business_subscription_active(uuid) TO authenticated, service_role;

-- Funciones de trial: service_role (Edge Functions) y authenticated
-- (createAdditionalBusiness desde el cliente). La función es
-- SECURITY DEFINER, así que aunque authenticated la invoque, las queries
-- internas corren con privilegios del creador — el GRANT solo controla
-- quién puede *invocar* la función, no cómo se ejecuta internamente.
-- user_trial_usage tiene RLS que niega todo a authenticated
-- (user_trial_usage_service_only: USING (false) WITH CHECK (false)),
-- así que authenticated NO puede leer/escribir la tabla directamente —
-- solo a través de estas funciones SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.has_user_used_trial(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_user_used_trial(uuid) TO service_role, authenticated;

REVOKE ALL ON FUNCTION public.record_trial_usage(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_trial_usage(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.record_trial_usage(uuid, uuid) FROM authenticated;

-- Función de onboarding
REVOKE ALL ON FUNCTION public.mark_onboarding_completed_server_side(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_onboarding_completed_server_side(uuid) TO authenticated, service_role;

-- ============================================================================
-- FIN
-- ============================================================================
