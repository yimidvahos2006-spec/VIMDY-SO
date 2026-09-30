-- ============================================================================
-- VIMDY OS — HARDENING: selección de cajas en onboarding/operación
-- ============================================================================
-- Problema corregido:
--   SELECT sobre public.cash_registers fallaba con:
--   "permission denied for table business_members"
--
-- Causa:
--   La policy cash_registers_select_member consultaba directamente
--   public.business_members desde el rol authenticated. Si el grant de
--   business_members no estaba aplicado en el entorno remoto, PostgreSQL
--   rechazaba la evaluación de la policy antes de devolver la caja.
--
-- Diseño de producción:
--   1) Mantener un grant explícito de SELECT para business_members.
--   2) Hacer que la policy de cash_registers use la función SECURITY DEFINER
--      is_business_member(), evitando depender de privilegios directos de la
--      policy sobre business_members.
--   3) Mantener RLS como barrera de aislamiento por negocio.
--
-- La migración es idempotente y no modifica datos históricos.
-- ============================================================================

BEGIN;

-- Acceso explícito para la tabla de membresías usada por pantallas legítimas
-- y políticas que necesiten consultarla directamente.
GRANT SELECT ON public.business_members TO authenticated;

-- La tabla de cajas debe poder leerse por usuarios autenticados; la policy
-- controla qué filas puede ver cada miembro.
GRANT SELECT ON public.cash_registers TO authenticated;

-- Asegurar que el helper de membresía sea el único punto de comprobación
-- privilegiado para esta policy.
CREATE OR REPLACE FUNCTION public.is_business_member(target_business_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members
    WHERE business_id = target_business_id
      AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_business_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_business_member(uuid) TO authenticated, service_role;

-- Reemplazar la policy problemática por una policy que delega la lectura de
-- business_members al helper SECURITY DEFINER.
DROP POLICY IF EXISTS cash_registers_select_member ON public.cash_registers;

CREATE POLICY cash_registers_select_member
ON public.cash_registers
FOR SELECT TO authenticated
USING (
  public.is_business_member(cash_registers.business_id)
);

COMMIT;
