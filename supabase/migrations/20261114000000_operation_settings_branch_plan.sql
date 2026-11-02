-- ============================================================================
-- Configuración > Operación: plan de sedes y sucursal principal atómica.
--
-- 1) businesses.plan_tier  ('single' | 'multi')
--    Hasta hoy el nivel contratado solo viajaba en la metadata del pago y no se
--    guardaba en ninguna columna, así que la pantalla no tenía de dónde leerlo.
--    Los clientes (rol authenticated) pueden LEERLO pero no escribirlo: solo el
--    servidor (service_role: webhooks de pago) puede cambiarlo.
--
-- 2) Una sola sucursal principal por negocio.
--    "Marcar como principal" hacía UPDATE directo y podía dejar dos principales.
--    Se limpian los duplicados existentes (queda la principal más antigua), se
--    crea un índice único parcial y se agrega la función set_main_branch que
--    cambia la principal en una sola transacción.
--
-- Antes de aplicar en producción, revisa si hay negocios con 2+ principales:
--   SELECT business_id, count(*) FROM public.branches
--   WHERE is_main GROUP BY business_id HAVING count(*) > 1;
-- ============================================================================
BEGIN;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'single';

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_plan_tier_valid;
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_plan_tier_valid CHECK (plan_tier IN ('single', 'multi'));

-- La tabla usa permisos por columna: solo lectura para el cliente.
GRANT SELECT (plan_tier) ON public.businesses TO authenticated;

-- Deja una sola principal por negocio (la más antigua) antes de crear el índice.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY business_id ORDER BY created_at ASC, id ASC) AS rn
  FROM public.branches
  WHERE is_main
)
UPDATE public.branches b
SET is_main = false
FROM ranked r
WHERE b.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS branches_one_main_per_business
  ON public.branches (business_id)
  WHERE is_main;

CREATE OR REPLACE FUNCTION public.set_main_branch(p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_active boolean;
BEGIN
  -- SECURITY INVOKER: la RLS de `branches` decide quién ve y quién modifica.
  SELECT business_id, active INTO v_business_id, v_active
  FROM public.branches
  WHERE id = p_branch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRANCH_NOT_FOUND: la sucursal no existe o no tienes acceso.';
  END IF;

  IF NOT v_active THEN
    RAISE EXCEPTION 'BRANCH_INACTIVE: reactiva la sucursal antes de marcarla como principal.';
  END IF;

  UPDATE public.branches
  SET is_main = false
  WHERE business_id = v_business_id AND is_main AND id <> p_branch_id;

  UPDATE public.branches
  SET is_main = true
  WHERE id = p_branch_id;

  -- Si la RLS no dejó modificar la fila no hay error de Postgres: se detecta aquí
  -- y la excepción deshace también el paso anterior.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRANCH_FORBIDDEN: no tienes permiso para cambiar la sucursal principal.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_main_branch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_main_branch(uuid) TO authenticated;

COMMIT;