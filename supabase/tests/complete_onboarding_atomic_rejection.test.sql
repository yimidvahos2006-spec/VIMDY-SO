-- Run in the staging SQL editor as postgres. The referenced auth user must
-- exist. This transaction is rolled back and leaves no fixture rows behind.
BEGIN;

INSERT INTO public.businesses (id, name, plan, subscription_status, trial_ends_at)
VALUES (
  'b10e0000-0000-4000-8000-000000000001',
  'Onboarding completion rejection test', 'trial', 'trial', now() + interval '14 days'
);

INSERT INTO public.business_members (user_id, business_id, role)
VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'b10e0000-0000-4000-8000-000000000001',
  'ADMIN'
);

INSERT INTO public.branches (id, business_id, name, is_main, active)
VALUES (
  'b10e0000-0000-4000-8000-000000000002',
  'b10e0000-0000-4000-8000-000000000001',
  'Sucursal principal', true, true
);

GRANT UPDATE (onboarding_completed) ON public.businesses TO authenticated;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  true
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.complete_onboarding_atomic(
      'b10e0000-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ONBOARDING_PRODUCT_REQUIRED' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL: completion RPC accepted a business without an active product';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE public.businesses
    SET onboarding_completed = true
    WHERE id = 'b10e0000-0000-4000-8000-000000000001';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM = 'ONBOARDING_COMPLETION_REQUIRES_RPC' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL: direct authenticated UPDATE unexpectedly completed onboarding';
  END IF;

  RAISE NOTICE 'PASS: RPC rejects missing active product and direct UPDATE is blocked';
END;
$$;

ROLLBACK;
