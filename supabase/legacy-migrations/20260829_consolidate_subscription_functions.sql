-- ============================================================================
-- 20260829_consolidate_subscription_functions.sql
-- ----------------------------------------------------------------------------
-- Consolidación de funciones de suscripción y trial. Resuelve conflictos
-- entre schema.sql y APPLY_PERMISSIONS.sql donde se redefinían funciones
-- con lógica contradictoria.
--
-- Esta migration NO destruye datos. Solo reemplaza definiciones de funciones
-- y revoca/granta permisos. Es idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. is_business_subscription_active
--    Fuente de verdad: schema.sql:914-944
--    Lógica: verifica fechas reales de vigencia, no solo el estado.
--    Modelo VIMDY (SubscriptionEngine.ts effectiveStatus()):
--      - trial: activo si trial_ends_at > now()
--      - monthly/yearly: activo si renewal_date IS NULL (nunca vence) o renewal_date > now()
--      - expired: trial vencido o monthly/yearly con renewal_date pasado
--      - suspended: monthly/yearly con payment_status declined/past_due
--    La versión de APPLY_PERMISSIONS.sql usaba:
--      plan='trial' OR (payment_status='approved' AND subscription_status='active')
--    que es INCOMPATIBLE: durante trial, payment_status='none' y devolvía false.
--    También no verificaba trial_ends_at, permitiendo trial indefinido.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 2. has_user_used_trial — versión definitiva (SQL, SECURITY DEFINER, STABLE)
--    Fuente de verdad: schema.sql:180 (migrations initial_schema), confirmed in
--    trial_user_migration.sql:37-49, APPLY_PERMISSIONS.sql:92-104
--    Lógica: existe fila en user_trial_usage para este user_id.
--    Todas las versiones coinciden. Esta es la versión canonical.
-- ----------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.has_user_used_trial(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_user_used_trial(uuid) TO service_role, authenticated;

-- ----------------------------------------------------------------------------
-- 3. record_trial_usage — versión definitiva (ON CONFLICT DO NOTHING)
--    Fuente de verdad: schema.sql:590 (migrations), confirmed in
--    trial_user_migration.sql:57-75, APPLY_PERMISSIONS.sql:107-119
--    Lógica: ON CONFLICT (user_id) DO NOTHING.
--    Razón: el trial es por persona (único por lifetime). DO NOTHING previene
--    manipulación: un usuario no puede sobrescribir su registro de trial para
--    obtener otro trial. La fila user_id es PRIMARY KEY, por lo que cualquier
--    reintento de registro se ignora silenciosamente.
--    La alternativa DO UPDATE (trial_user_migration.sql histórico) era
--    innecesariamente permisiva: permitía "renovar" el trial usado_at.
-- ----------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.record_trial_usage(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_trial_usage(uuid, uuid) TO service_role;

-- ============================================================================
-- FIN DE MIGRACIÓN
-- ============================================================================
