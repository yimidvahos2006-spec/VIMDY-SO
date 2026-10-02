-- Regression tests for 20260930180000_require_verified_external_tender.sql.
-- Run after the migrations in the Supabase SQL editor or local Supabase DB.

DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_sale_id text := gen_random_uuid()::text;
  v_rejected boolean := false;
BEGIN
  INSERT INTO public.businesses (name, timezone)
  VALUES ('TEST Unverified Card', 'America/Bogota')
  RETURNING id INTO v_business_id;

  INSERT INTO public.branches (business_id, name)
  VALUES (v_business_id, 'TEST Branch')
  RETURNING id INTO v_branch_id;

  INSERT INTO public.sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (
    v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object('status', 'PENDING_PAYMENT', 'total', 10000, 'items', '[]'::jsonb),
    now(), now()
  );

  BEGIN
    UPDATE public.sales
    SET data = data || jsonb_build_object(
      'status', 'PAID',
      'paymentMethod', 'CARD',
      'paymentVerificationSource', 'EXTERNAL_TERMINAL',
      'paymentReference', 'typed-by-client'
    )
    WHERE id = v_sale_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'CAJA_PAYMENT_NOT_VERIFIED' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL: a client-supplied card reference changed the sale to PAID';
  END IF;

  DELETE FROM public.sales WHERE id = v_sale_id;
  DELETE FROM public.branches WHERE id = v_branch_id;
  DELETE FROM public.businesses WHERE id = v_business_id;
END;
$$;

DO $$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_sale_id text := gen_random_uuid()::text;
  v_payment_id text;
BEGIN
  INSERT INTO public.businesses (name, timezone)
  VALUES ('TEST Verified Card', 'America/Bogota')
  RETURNING id INTO v_business_id;

  INSERT INTO public.branches (business_id, name)
  VALUES (v_business_id, 'TEST Branch')
  RETURNING id INTO v_branch_id;

  v_payment_id := 'sale-payment-' || v_sale_id;

  INSERT INTO public.sales (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (
    v_sale_id, v_business_id, v_branch_id, 1,
    jsonb_build_object('status', 'PENDING_PAYMENT', 'total', 10000, 'items', '[]'::jsonb),
    now(), now()
  );

  INSERT INTO public.payment_verifications (
    business_id, branch_id, sale_id, payment_id, method, amount,
    provider, provider_reference, status, verified_at
  )
  VALUES (
    v_business_id, v_branch_id, v_sale_id, v_payment_id, 'CARD', 10000,
    'test-provider', 'trusted-provider-reference', 'CONFIRMED', now()
  );

  UPDATE public.sales
  SET data = data || jsonb_build_object(
    'status', 'PAID',
    'paymentMethod', 'CARD',
    'paymentVerificationSource', 'PROVIDER',
    'paymentReference', 'trusted-provider-reference'
  )
  WHERE id = v_sale_id;

  IF (SELECT data->>'status' FROM public.sales WHERE id = v_sale_id) <> 'PAID' THEN
    RAISE EXCEPTION 'FAIL: a matching trusted provider verification was not accepted';
  END IF;

  DELETE FROM public.payment_verifications WHERE business_id = v_business_id;
  DELETE FROM public.sales WHERE id = v_sale_id;
  DELETE FROM public.branches WHERE id = v_branch_id;
  DELETE FROM public.businesses WHERE id = v_business_id;
END;
$$;
