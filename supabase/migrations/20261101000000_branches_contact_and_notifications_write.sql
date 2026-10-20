-- ============================================================================
-- 1) branches: la app (Sucursales, selector del Dashboard e Inventario) pide las
--    columnas address y phone, pero la tabla nunca las tuvo -> HTTP 400.
--    Cambio aditivo: no toca datos existentes.
-- 2) notifications: la migración 20261005000000 la dejó SOLO de lectura, pero
--    la app guarda ahí el centro de notificaciones -> "permission denied for
--    table notifications" (se veía en system_errors en cada carga).
--    Se agregan permisos de escritura con las mismas reglas de negocio/sucursal/
--    rol que ya usan las demás tablas. Sin chequeo de suscripción a propósito:
--    los avisos de "tu prueba terminó" deben poder guardarse justo cuando la
--    suscripción ya no está activa.
-- ============================================================================
BEGIN;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text;

GRANT INSERT, UPDATE, DELETE ON public.notifications TO authenticated;

DROP POLICY IF EXISTS notifications_tenant_insert ON public.notifications;
CREATE POLICY notifications_tenant_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND public.has_business_role(
      business_id,
      ARRAY['ADMIN','GERENTE','CAJERO','MESERO','COCINA','INVENTARIO','CONTADOR']::text[]
    )
  );

DROP POLICY IF EXISTS notifications_tenant_update ON public.notifications;
CREATE POLICY notifications_tenant_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND public.has_business_role(
      business_id,
      ARRAY['ADMIN','GERENTE','CAJERO','MESERO','COCINA','INVENTARIO','CONTADOR']::text[]
    )
  )
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND public.has_business_role(
      business_id,
      ARRAY['ADMIN','GERENTE','CAJERO','MESERO','COCINA','INVENTARIO','CONTADOR']::text[]
    )
  );

DROP POLICY IF EXISTS notifications_tenant_delete ON public.notifications;
CREATE POLICY notifications_tenant_delete ON public.notifications
  FOR DELETE TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND public.has_business_role(
      business_id,
      ARRAY['ADMIN','GERENTE','CAJERO','MESERO','COCINA','INVENTARIO','CONTADOR']::text[]
    )
  );

COMMIT;