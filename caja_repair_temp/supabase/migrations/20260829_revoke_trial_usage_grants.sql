-- ============================================================================
-- 20260829_revoke_trial_usage_grants.sql
-- ----------------------------------------------------------------------------
-- Seguridad reforzada: revoca el grant de record_trial_usage a authenticated.
--
-- DESDE ESTA MIGRACIÓN:
--   - record_trial_usage(uuid, uuid) SOLO puede invocarse desde service_role
--   - Los clientes (rol authenticated) NO pueden ejecutar directamente esta RPC
--   - La inserción de user_trial_usage ocurre exclusivamente desde la
--     Edge Function register-business, que valida el usuario vía JWT
--
-- JUSTIFICACIÓN:
--   Antes de esta migration, un usuario autenticado podía llamar manualmente:
--     supabase.rpc("record_trial_usage", { p_user_id: "otro-user", ... })
--   aunque la policy user_trial_usage_service_only bloqueara acceso directo a
--   la tabla, la función SECURITY DEFINER saltaba RLS. Con DO NOTHING, esto
--   no causaba daño inmediato, pero permitía "marcar" trials de otros usuarios.
--
--   Ahora, el GRANT a authenticated se revoca. createAdditionalBusiness() ya
--   no llama al RPC desde el cliente — delega todo al Edge Function
--   register-business (invocado via supabase.functions.invoke), que usa
--   admin.rpc() con service_role.
--
-- VERIFICACIÓN:
--   - register-business/index.ts: usa admin.rpc con SERVICE_ROLE_KEY ✅
--   - authBusinessContext.ts createAdditionalBusiness(): uses
--     supabase.functions.invoke("register-business") ✅ (no RPC directa)
--   - subscriptionService.ts:428 — ¡VERIFICAR! Si todavía llama desde cliente,
--     necesitará también delegar a Edge Function.
-- ============================================================================

-- Revocar acceso de authenticated; solo service_role puede registrar trial usage
REVOKE ALL ON FUNCTION public.record_trial_usage(uuid, uuid) FROM authenticated;

-- Asegurar que service_role sigue teniendo acceso
GRANT EXECUTE ON FUNCTION public.record_trial_usage(uuid, uuid) TO service_role;

-- ============================================================================
-- FIN DE MIGRACIÓN
-- ============================================================================
