-- =============================================================================
-- 20261025000001_revoke_ensure_branch_for_business.sql
-- ensure_branch_for_business(uuid) es SECURITY DEFINER, no valida sesión ni
-- pertenencia al negocio y estaba ejecutable por anon/authenticated: cualquiera
-- que conociera un business_id podía obtener su sucursal principal o crear una
-- "Sucursal principal" en un negocio ajeno. No la usa el frontend ni las Edge
-- Functions. Se restringe a service_role (las funciones SECURITY DEFINER que la
-- llamen internamente corren como dueño y no se ven afectadas).
-- =============================================================================
REVOKE ALL ON FUNCTION public.ensure_branch_for_business(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_branch_for_business(uuid) TO service_role;