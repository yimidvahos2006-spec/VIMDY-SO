-- ============================================================================
-- record_audit_event
-- ----------------------------------------------------------------------------
-- La migración 20261005000000 dejó audit_logs como tabla de SOLO LECTURA para
-- el navegador (REVOKE INSERT ... FROM authenticated). Correcto para que nadie
-- pueda falsificar la auditoría, pero el cliente (AuditEngine) seguía
-- intentando hacer upsert directo -> "permission denied for table audit_logs"
-- al crear un empleado, editarlo, cambiar su estado, etc.
--
-- Esta función es el ÚNICO camino de escritura desde el navegador:
--   * el actor SIEMPRE es auth.uid() (no se puede falsificar)
--   * solo escribe en negocios de los que el usuario es miembro
--   * la fila queda append-only (no hay RPC de update/delete)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_audit_event(
  p_business_id uuid,
  p_action      text,
  p_module      text,
  p_description text,
  p_entity_id   text DEFAULT NULL,
  p_branch_id   uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_audit_id uuid := pg_catalog.gen_random_uuid();
  v_now      timestamptz := pg_catalog.now();
  v_branch   uuid := NULL;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  IF p_business_id IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'NOT_BUSINESS_MEMBER' USING ERRCODE = '42501';
  END IF;

  IF p_action IS NULL OR pg_catalog.btrim(p_action) = ''
     OR p_module IS NULL OR pg_catalog.btrim(p_module) = '' THEN
    RAISE EXCEPTION 'AUDIT_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  -- Solo se acepta una sucursal que realmente pertenezca a ese negocio.
  IF p_branch_id IS NOT NULL THEN
    SELECT b.id INTO v_branch
    FROM public.branches b
    WHERE b.id = p_branch_id AND b.business_id = p_business_id;
  END IF;

  INSERT INTO public.audit_logs (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (
    v_audit_id,
    p_business_id,
    v_branch,
    1,
    pg_catalog.jsonb_build_object(
      'id', v_audit_id::text,
      'actorId', v_actor::text,
      'action', pg_catalog.left(p_action, 80),
      'module', pg_catalog.left(p_module, 80),
      'entityId', p_entity_id,
      'description', pg_catalog.left(COALESCE(p_description, ''), 500),
      'date', v_now,
      'result', 'SUCCESS'
    ),
    v_now,
    v_now
  );

  RETURN v_audit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_audit_event(uuid, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_audit_event(uuid, text, text, text, text, uuid) TO authenticated, service_role;