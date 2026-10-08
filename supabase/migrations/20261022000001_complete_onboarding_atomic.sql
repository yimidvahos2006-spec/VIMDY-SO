BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_direct_onboarding_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.onboarding_completed IS DISTINCT FROM NEW.onboarding_completed
     AND NEW.onboarding_completed = true
     AND (
       current_user <> pg_catalog.pg_get_userbyid((
         SELECT procedure.proowner
         FROM pg_catalog.pg_proc AS procedure
         WHERE procedure.oid = 'public.complete_onboarding_atomic(uuid)'::pg_catalog.regprocedure
       ))
       OR pg_catalog.current_setting('vimdy.complete_onboarding_business_id', true)
         IS DISTINCT FROM NEW.id::text
     ) THEN
    RAISE EXCEPTION 'ONBOARDING_COMPLETION_REQUIRES_RPC'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_direct_onboarding_completion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_direct_onboarding_completion ON public.businesses;
CREATE TRIGGER prevent_direct_onboarding_completion
BEFORE UPDATE OF onboarding_completed ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.prevent_direct_onboarding_completion();

CREATE OR REPLACE FUNCTION public.complete_onboarding_atomic(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_branch_id uuid;
  v_updated integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ONBOARDING_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_members AS member
    WHERE member.business_id = p_business_id
      AND member.user_id = v_user_id
      AND member.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'ONBOARDING_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT branch.id INTO v_branch_id
  FROM public.branches AS branch
  WHERE branch.business_id = p_business_id
    AND branch.is_main = true
    AND branch.active = true
  ORDER BY branch.created_at, branch.id
  LIMIT 1;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'ONBOARDING_MAIN_BRANCH_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.products AS product
    WHERE product.business_id = p_business_id
      AND (product.branch_id IS NULL OR product.branch_id = v_branch_id)
      AND COALESCE((product.data->>'active')::boolean, true)
  ) THEN
    RAISE EXCEPTION 'ONBOARDING_PRODUCT_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cash_registers AS cash_register
    WHERE cash_register.business_id = p_business_id
      AND cash_register.branch_id = v_branch_id
      AND cash_register.active = true
      AND cash_register.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'ONBOARDING_ACTIVE_CASH_REGISTER_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.shifts AS shift
    JOIN public.cash_registers AS cash_register
      ON cash_register.id = shift.cash_register_id
     AND cash_register.business_id = shift.business_id
     AND cash_register.branch_id = shift.branch_id
    WHERE shift.business_id = p_business_id
      AND shift.branch_id = v_branch_id
      AND shift.data->>'status' = 'OPEN'
      AND cash_register.active = true
      AND cash_register.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'ONBOARDING_OPEN_SHIFT_REQUIRED';
  END IF;

  PERFORM pg_catalog.set_config(
    'vimdy.complete_onboarding_business_id',
    p_business_id::text,
    true
  );

  UPDATE public.businesses
  SET onboarding_completed = true
  WHERE id = p_business_id
    AND onboarding_completed = false;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 AND NOT EXISTS (
    SELECT 1 FROM public.businesses AS business WHERE business.id = p_business_id
  ) THEN
    RAISE EXCEPTION 'ONBOARDING_BUSINESS_NOT_FOUND';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_onboarding_atomic(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_onboarding_atomic(uuid) TO authenticated;

COMMIT;
