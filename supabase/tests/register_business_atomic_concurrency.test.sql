-- Concurrent registration check for staging.
-- Replace the user UUID below with a dedicated, verified auth.users user that
-- has no business_members or user_trial_usage rows. Run sessions A and B
-- against the same test user and identical arguments.
--
-- Session A: run the BEGIN and SELECT below, then leave its transaction open.
-- Session B: run the same BEGIN and SELECT; it must wait on the user lock.
-- Session A: COMMIT. Session B must then return the same businessId with
-- idempotent=true; COMMIT session B and run the assertions at the bottom.

-- BEGIN;
-- SELECT public.register_business_atomic(
--   '11111111-1111-4111-8111-111111111111'::uuid,
--   'initial', 'Atomic registration test', 'CO', 'COP', 'es',
--   'America/Bogota', 19, 'restaurante', ARRAY['caja'],
--   now() + interval '14 days', now()
-- );
-- COMMIT;

DO $$
DECLARE
  v_user_id uuid := '11111111-1111-4111-8111-111111111111';
  v_memberships integer;
  v_business_id uuid;
  v_main_branches integer;
  v_trial_rows integer;
BEGIN
  SELECT count(*) INTO v_memberships
  FROM public.business_members
  WHERE user_id = v_user_id AND role = 'ADMIN';

  SELECT business_id INTO v_business_id
  FROM public.business_members
  WHERE user_id = v_user_id AND role = 'ADMIN'
  ORDER BY created_at, business_id
  LIMIT 1;

  IF v_memberships <> 1 OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: expected exactly one ADMIN membership, got %', v_memberships;
  END IF;

  SELECT count(*) INTO v_main_branches
  FROM public.branches
  WHERE business_id = v_business_id AND is_main = true AND active = true;

  SELECT count(*) INTO v_trial_rows
  FROM public.user_trial_usage
  WHERE user_id = v_user_id AND business_id = v_business_id;

  IF v_main_branches <> 1 OR v_trial_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: branches %, trial rows %', v_main_branches, v_trial_rows;
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.register_business_atomic(uuid,text,text,text,text,text,text,numeric,text,text[],timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: authenticated must not execute register_business_atomic';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.register_business_atomic(uuid,text,text,text,text,text,text,numeric,text,text[],timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: service_role must execute register_business_atomic';
  END IF;

  RAISE NOTICE 'PASS: one business bootstrap, one ADMIN membership, one main branch, one trial row';
  DELETE FROM public.businesses WHERE id = v_business_id;
END;
$$;
