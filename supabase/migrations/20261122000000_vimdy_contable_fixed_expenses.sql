-- ============================================================================
-- VIMDY Contable — Parte 1: tabla fixed_expenses (gastos fijos del negocio)
-- ----------------------------------------------------------------------------
-- * Cambio aditivo: crea una tabla nueva, no toca ninguna tabla existente.
-- * Idempotente: se puede correr más de una vez sin romper nada.
-- * Multi-tenant: business_id (igual que el resto de VIMDY OS) + RLS.
-- * Permisos:
--     - Leer:     ADMIN, GERENTE, CONTADOR
--     - Escribir: ADMIN, GERENTE (y solo con suscripción activa)
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.fixed_expenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category     text NOT NULL
               CONSTRAINT fixed_expenses_category_check
               CHECK (category IN ('arriendo', 'servicios', 'nomina', 'proveedores', 'otros')),
  amount       numeric(14, 2) NOT NULL
               CONSTRAINT fixed_expenses_amount_check
               CHECK (amount > 0),
  expense_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date),
  description  text
               CONSTRAINT fixed_expenses_description_check
               CHECK (description IS NULL OR char_length(description) <= 200),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Consulta principal: gastos de un negocio por rango de fechas (mes actual, etc.)
CREATE INDEX IF NOT EXISTS fixed_expenses_business_date_idx
  ON public.fixed_expenses (business_id, expense_date DESC, created_at DESC);

ALTER TABLE public.fixed_expenses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.fixed_expenses FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_expenses TO authenticated;
GRANT ALL ON public.fixed_expenses TO service_role;

DROP POLICY IF EXISTS fixed_expenses_select ON public.fixed_expenses;
CREATE POLICY fixed_expenses_select ON public.fixed_expenses
  FOR SELECT TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN','GERENTE','CONTADOR']::text[])
  );

DROP POLICY IF EXISTS fixed_expenses_insert ON public.fixed_expenses;
CREATE POLICY fixed_expenses_insert ON public.fixed_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN','GERENTE']::text[])
    AND public.is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS fixed_expenses_update ON public.fixed_expenses;
CREATE POLICY fixed_expenses_update ON public.fixed_expenses
  FOR UPDATE TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN','GERENTE']::text[])
  )
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN','GERENTE']::text[])
    AND public.is_business_subscription_active(business_id)
  );

-- Borrar se permite aunque la suscripción haya vencido (corregir un error propio).
DROP POLICY IF EXISTS fixed_expenses_delete ON public.fixed_expenses;
CREATE POLICY fixed_expenses_delete ON public.fixed_expenses
  FOR DELETE TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN','GERENTE']::text[])
  );

COMMIT;