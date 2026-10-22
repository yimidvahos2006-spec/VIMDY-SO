-- ============================================================================
-- 20261102000000_inventory_count_sessions.sql
-- ----------------------------------------------------------------------------
-- Entrega 3 (Inventario): sesiones de conteo guiado.
--
-- Una sesion guarda que se conto, quien la abrio, cuando, y (al cerrar) las
-- diferencias que se aplicaron al inventario. Cambio ADITIVO: crea una tabla
-- nueva, no toca ninguna tabla ni dato existente.
--
-- Forma generica igual a las demas tablas (id, business_id, branch_id,
-- version, data jsonb). La app la lee/escribe con SupabaseRepository.
--
-- Reglas de seguridad:
--   * Lectura: miembros del negocio (y de la sucursal si la fila la tiene).
--   * Insertar / actualizar: solo ADMIN, GERENTE o INVENTARIO, con suscripcion
--     activa. Mismo criterio que adjust_stock_with_kardex.
--   * NO hay DELETE: una sesion no se borra desde el navegador.
--   * Una sesion CERRADA no se puede modificar (trigger).
--   * El ajuste real del stock NO pasa por esta tabla: se hace con las RPC de
--     inventario que ya existen (adjust_stock_with_kardex), que dejan Kardex.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_count_sessions (
  id text PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_count_sessions_data_valid
    CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 3000000)
);

CREATE INDEX IF NOT EXISTS inventory_count_sessions_business_id_idx
  ON public.inventory_count_sessions (business_id);

ALTER TABLE public.inventory_count_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.inventory_count_sessions FROM anon;
REVOKE ALL ON public.inventory_count_sessions FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.inventory_count_sessions TO authenticated;

DROP POLICY IF EXISTS inventory_count_sessions_tenant_read ON public.inventory_count_sessions;
CREATE POLICY inventory_count_sessions_tenant_read ON public.inventory_count_sessions
  FOR SELECT TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
  );

DROP POLICY IF EXISTS inventory_count_sessions_tenant_insert ON public.inventory_count_sessions;
CREATE POLICY inventory_count_sessions_tenant_insert ON public.inventory_count_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND public.has_business_role(business_id, ARRAY['ADMIN','GERENTE','INVENTARIO']::text[])
    AND public.is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS inventory_count_sessions_tenant_update ON public.inventory_count_sessions;
CREATE POLICY inventory_count_sessions_tenant_update ON public.inventory_count_sessions
  FOR UPDATE TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND public.has_business_role(business_id, ARRAY['ADMIN','GERENTE','INVENTARIO']::text[])
  )
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND public.has_business_role(business_id, ARRAY['ADMIN','GERENTE','INVENTARIO']::text[])
    AND public.is_business_subscription_active(business_id)
  );

-- Una sesion cerrada es evidencia: no se edita ni se reabre.
CREATE OR REPLACE FUNCTION public.inventory_count_sessions_block_closed_edit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.data->>'status' = 'CLOSED' THEN
    RAISE EXCEPTION 'COUNT_SESSION_CLOSED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_count_sessions_block_closed_edit ON public.inventory_count_sessions;
CREATE TRIGGER inventory_count_sessions_block_closed_edit
  BEFORE UPDATE ON public.inventory_count_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_count_sessions_block_closed_edit();

COMMIT;