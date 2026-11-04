-- ============================================================================
-- VIMDY Contable — Parte 2: sucursal opcional en fixed_expenses
-- ----------------------------------------------------------------------------
-- * branch_id NULL  = gasto global del negocio (ej. contador, software).
-- * branch_id <id>  = gasto de una sucursal específica (ej. arriendo del local 2).
-- * Aditivo e idempotente: depende de 20261122000000_vimdy_contable_fixed_expenses.sql.
-- * Si se borra la sucursal, el gasto NO se pierde: pasa a ser global (SET NULL).
-- * Lectura: gastos globales + los de las sucursales que el usuario puede ver
--   (ADMIN/GERENTE ven todas; CONTADOR solo su sucursal asignada, y siempre los globales).
-- ============================================================================
BEGIN;

ALTER TABLE public.fixed_expenses
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS fixed_expenses_business_branch_date_idx
  ON public.fixed_expenses (business_id, branch_id, expense_date DESC);

DROP POLICY IF EXISTS fixed_expenses_select ON public.fixed_expenses;
CREATE POLICY fixed_expenses_select ON public.fixed_expenses
  FOR SELECT TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND public.has_business_role(business_id, ARRAY['ADMIN','GERENTE','CONTADOR']::text[])
  );

DROP POLICY IF EXISTS fixed_expenses_insert ON public.fixed_expenses;
CREATE POLICY fixed_expenses_insert ON public.fixed_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    -- La sucursal debe pertenecer al MISMO negocio del gasto.
    AND (
      branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.branches AS b
        WHERE b.id = branch_id AND b.business_id = fixed_expenses.business_id
      )
    )
    AND public.has_business_role(business_id, ARRAY['ADMIN','GERENTE']::text[])
    AND public.is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS fixed_expenses_update ON public.fixed_expenses;
CREATE POLICY fixed_expenses_update ON public.fixed_expenses
  FOR UPDATE TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND public.has_business_role(business_id, ARRAY['ADMIN','GERENTE']::text[])
  )
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND (
      branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.branches AS b
        WHERE b.id = branch_id AND b.business_id = fixed_expenses.business_id
      )
    )
    AND public.has_business_role(business_id, ARRAY['ADMIN','GERENTE']::text[])
    AND public.is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS fixed_expenses_delete ON public.fixed_expenses;
CREATE POLICY fixed_expenses_delete ON public.fixed_expenses
  FOR DELETE TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND public.has_business_role(business_id, ARRAY['ADMIN','GERENTE']::text[])
  );

COMMIT;