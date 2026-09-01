-- ============================================================================
-- 20260829_fix_businesses_insert_policies.sql
-- ----------------------------------------------------------------------------
-- Corrige policies INSERT sobre businesses para garantizar el trial único.
-- Elimina la policy peligrosa businesses_insert_owner (definida en
-- fix_permissions.sql histórico) que permitía crear negocios sin trial check
-- y/o para business_ids de otros usuarios.
--
-- Conserva UNA sola policy correcta: businesses_insert_own, que verifica:
--   auth.uid() IS NOT NULL
--   AND NOT public.has_user_used_trial(auth.uid())
--
-- Esto previene que un usuario autenticado cree negocios ilimitadamente
-- saltándose la regla del trial. La verificación adicional en
-- createAdditionalBusiness() (client-side) complementa esta policy.
--
-- Seguridad multi-tenant:
--   - RLS está habilitado (permite que las policies filtren filas)
--   - businesses_insert_own verifica trial vía RPC con SECURITY DEFINER
--   - business_members_insert_admin verifica rol ADMIN
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Elimina la policy peligrosa si existe (viene de fix_permissions.sql histórico)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS businesses_insert_owner ON businesses;

-- ----------------------------------------------------------------------------
-- 2. Asegura que businesses_insert_own sea la ÚNICA policy INSERT
--    Esta es la policy correcta, definida en schema.sql y reforzada aquí.
--    Si se había aplicado una versión incorrecta (sin trial check), esta
--    la reemplaza con la lógica correcta.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS businesses_insert_own ON businesses;

CREATE POLICY businesses_insert_own ON businesses
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND NOT public.has_user_used_trial(auth.uid())
  );

-- ============================================================================
-- FIN DE MIGRACIÓN
-- ============================================================================
