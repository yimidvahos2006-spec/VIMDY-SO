-- ============================================================================
-- 20261109000001_invitations_branch_assignment.sql
-- ----------------------------------------------------------------------------
-- P1 #1 (cierre) — Invitaciones compatibles con el aislamiento fail-closed.
--
-- PROBLEMA: accept_invitation() creaba la membresia (business_members) pero NO
-- la fila de app_users. Con auth_branch_ids() fail-closed (20261109000000), un
-- invitado con rol operativo (CAJERO/MESERO/COCINA...) quedaba sin acceso a
-- ninguna sucursal y no habia forma de asignarsela.
--
-- QUE HACE:
--   1) business_invitations.branch_id (opcional): sucursal que el ADMIN eligio.
--   2) accept_invitation(): para roles que no sean ADMIN/GERENTE crea/actualiza
--      la fila de app_users con una sucursal ACTIVA del negocio: la de la
--      invitacion si es valida, si no la principal. Sin sucursal activa => error
--      INVITATION_NO_BRANCH y no se acepta (revierte todo). ADMIN/GERENTE no
--      necesitan sucursal (su alcance lo da el rol).
--   3) Backfill: miembros operativos YA existentes sin ninguna fila en
--      app_users (p. ej. aceptaron una invitacion antes de este arreglo) reciben
--      su fila en la sucursal principal activa. No toca filas existentes.
--
-- NO CAMBIA: firma, SECURITY DEFINER, search_path ni grants de accept_invitation.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Sucursal opcional en la invitacion
-- ---------------------------------------------------------------------------
ALTER TABLE public.business_invitations
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2) Backfill de miembros operativos sin fila en app_users
-- ---------------------------------------------------------------------------
WITH target_branch AS (
  SELECT DISTINCT ON (b.business_id)
         b.business_id,
         b.id AS branch_id
  FROM public.branches AS b
  WHERE b.active = true
  ORDER BY b.business_id, b.is_main DESC, b.created_at ASC, b.id ASC
)
INSERT INTO public.app_users (id, business_id, branch_id, version, data, created_at, updated_at)
SELECT bm.user_id::text,
       bm.business_id,
       tb.branch_id,
       1,
       jsonb_build_object(
         'id',        bm.user_id::text,
         'name',      COALESCE(NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1)),
         'email',     u.email,
         'roleId',    upper(btrim(bm.role)),
         'status',    'ACTIVE',
         'createdAt', to_jsonb(now()),
         'updatedAt', to_jsonb(now())
       ),
       now(),
       now()
FROM public.business_members AS bm
JOIN auth.users AS u
  ON u.id = bm.user_id
JOIN target_branch AS tb
  ON tb.business_id = bm.business_id
WHERE upper(btrim(bm.role)) NOT IN ('ADMIN', 'GERENTE')
  AND NOT EXISTS (
    SELECT 1
    FROM public.app_users AS au
    WHERE au.id = bm.user_id::text
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) accept_invitation() con asignacion de sucursal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_invitation  public.business_invitations%ROWTYPE;
  v_business_id uuid;
  v_user_email  text;
  v_user_meta   jsonb;
  v_role        text;
  v_branch_id   uuid;
  v_rows        integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'INVITATION_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT u.email, u.raw_user_meta_data
  INTO v_user_email, v_user_meta
  FROM auth.users AS u
  WHERE u.id = auth.uid();

  SELECT * INTO v_invitation
  FROM public.business_invitations
  WHERE token = p_token
    AND accepted_at IS NULL
    AND expires_at > now()
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND_OR_EXPIRED' USING ERRCODE = 'P0002';
  END IF;

  IF v_invitation.email IS DISTINCT FROM v_user_email THEN
    RAISE EXCEPTION 'INVITATION_EMAIL_MISMATCH' USING ERRCODE = 'P0002';
  END IF;

  v_business_id := v_invitation.business_id;
  v_role := upper(btrim(v_invitation.role));

  -- Roles operativos: SIEMPRE necesitan una sucursal activa de este negocio.
  IF v_role NOT IN ('ADMIN', 'GERENTE') THEN
    IF v_invitation.branch_id IS NOT NULL THEN
      SELECT b.id INTO v_branch_id
      FROM public.branches AS b
      WHERE b.id = v_invitation.branch_id
        AND b.business_id = v_business_id
        AND b.active = true;
    END IF;

    IF v_branch_id IS NULL THEN
      SELECT b.id INTO v_branch_id
      FROM public.branches AS b
      WHERE b.business_id = v_business_id
        AND b.active = true
      ORDER BY b.is_main DESC, b.created_at ASC, b.id ASC
      LIMIT 1;
    END IF;

    IF v_branch_id IS NULL THEN
      RAISE EXCEPTION 'INVITATION_NO_BRANCH' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.business_members (user_id, business_id, role)
  VALUES (auth.uid(), v_business_id, v_invitation.role)
  ON CONFLICT (user_id, business_id) DO UPDATE
    SET role = EXCLUDED.role;

  IF v_branch_id IS NOT NULL THEN
    INSERT INTO public.app_users (id, business_id, branch_id, version, data, created_at, updated_at)
    VALUES (
      auth.uid()::text,
      v_business_id,
      v_branch_id,
      1,
      jsonb_build_object(
        'id',        auth.uid()::text,
        'name',      COALESCE(NULLIF(btrim(v_user_meta ->> 'full_name'), ''), split_part(v_user_email, '@', 1)),
        'email',     v_user_email,
        'roleId',    v_role,
        'status',    'ACTIVE',
        'createdAt', to_jsonb(now()),
        'updatedAt', to_jsonb(now())
      ),
      now(),
      now()
    )
    ON CONFLICT (id) DO UPDATE
      SET branch_id  = EXCLUDED.branch_id,
          data       = public.app_users.data || jsonb_build_object('roleId', v_role),
          version    = public.app_users.version + 1,
          updated_at = now()
      WHERE public.app_users.business_id = EXCLUDED.business_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- app_users.id es llave primaria global: si el usuario ya tiene perfil en
    -- OTRO negocio no se puede reasignar sin pisarlo. Se rechaza todo (la
    -- membresia insertada arriba se revierte con la excepcion).
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'INVITATION_PROFILE_CONFLICT' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  UPDATE public.business_invitations
  SET accepted_at = now()
  WHERE id = v_invitation.id;

  RETURN v_business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;

COMMIT;