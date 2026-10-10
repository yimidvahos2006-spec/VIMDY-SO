BEGIN;

CREATE OR REPLACE FUNCTION public.register_business_atomic(
  p_user_id uuid,
  p_registration_mode text,
  p_business_name text,
  p_country text,
  p_currency text,
  p_language text,
  p_timezone text,
  p_tax_rate numeric,
  p_business_type text,
  p_enabled_modules text[],
  p_trial_ends_at timestamptz,
  p_trial_used_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_source_business public.businesses%ROWTYPE;
  v_business_id uuid;
  v_branch_id uuid;
  v_role text;
BEGIN
  IF p_user_id IS NULL
     OR p_registration_mode IS NULL
     OR p_registration_mode NOT IN ('initial', 'additional')
     OR NULLIF(btrim(p_business_name), '') IS NULL
     OR NULLIF(btrim(p_country), '') IS NULL
     OR NULLIF(btrim(p_currency), '') IS NULL
     OR NULLIF(btrim(p_language), '') IS NULL
     OR NULLIF(btrim(p_timezone), '') IS NULL
     OR p_tax_rate IS NULL
     OR NULLIF(btrim(p_business_type), '') IS NULL
     OR p_enabled_modules IS NULL
     OR p_trial_ends_at IS NULL
     OR p_trial_used_at IS NULL THEN
    RAISE EXCEPTION 'REGISTER_BUSINESS_INVALID_INPUT';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  IF p_registration_mode = 'initial' THEN
    SELECT member.business_id, member.role
      INTO v_business_id, v_role
    FROM public.business_members AS member
    WHERE member.user_id = p_user_id
      AND member.role = 'ADMIN'
    ORDER BY member.created_at, member.business_id
    LIMIT 1;

    IF v_business_id IS NOT NULL THEN
      SELECT business.* INTO v_business
      FROM public.businesses AS business
      WHERE business.id = v_business_id;

      SELECT branch.id INTO v_branch_id
      FROM public.branches AS branch
      WHERE branch.business_id = v_business_id
        AND branch.is_main = true
        AND branch.active = true
      ORDER BY branch.created_at, branch.id
      LIMIT 1;

      IF v_branch_id IS NULL THEN
        INSERT INTO public.branches (business_id, name, is_main, active)
        VALUES (v_business_id, 'Sucursal principal', true, true)
        RETURNING id INTO v_branch_id;
      END IF;

      INSERT INTO public.user_trial_usage (user_id, business_id, plan, used_at)
      VALUES (p_user_id, v_business_id, 'trial', p_trial_used_at)
      ON CONFLICT (user_id) DO NOTHING;

      RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'businessId', v_business_id,
        'branchId', v_branch_id,
        'role', COALESCE(v_role, 'ADMIN'),
        'business', pg_catalog.to_jsonb(v_business),
        'idempotent', true
      );
    END IF;
  END IF;

  IF p_registration_mode = 'additional' THEN
    SELECT business.* INTO v_source_business
    FROM public.business_members AS member
    JOIN public.businesses AS business ON business.id = member.business_id
    WHERE member.user_id = p_user_id
      AND member.role = 'ADMIN'
      AND public.is_business_subscription_active(business.id)
    ORDER BY member.created_at, business.id
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ADDITIONAL_BUSINESS_REQUIRES_ACTIVE_SUBSCRIPTION';
    END IF;
  END IF;

  IF p_registration_mode = 'initial' AND EXISTS (
    SELECT 1 FROM public.user_trial_usage AS usage
    WHERE usage.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'TRIAL_YA_USADO: ya utilizaste tu prueba gratuita.';
  END IF;

  INSERT INTO public.businesses (
    name, plan, trial_ends_at, trial_used_at, country, currency, language,
    timezone, tax_rate, business_type, enabled_modules, subscription_status,
    renewal_date, next_charge_at, payment_method, payment_status
  ) VALUES (
    btrim(p_business_name),
    CASE WHEN p_registration_mode = 'initial' THEN 'trial' ELSE v_source_business.plan END,
    CASE WHEN p_registration_mode = 'initial' THEN p_trial_ends_at ELSE v_source_business.trial_ends_at END,
    CASE WHEN p_registration_mode = 'initial' THEN p_trial_used_at ELSE v_source_business.trial_used_at END,
    p_country, p_currency, p_language, p_timezone, p_tax_rate,
    p_business_type, p_enabled_modules,
    CASE WHEN p_registration_mode = 'initial' THEN 'trial' ELSE v_source_business.subscription_status END,
    CASE WHEN p_registration_mode = 'initial' THEN NULL ELSE v_source_business.renewal_date END,
    CASE WHEN p_registration_mode = 'initial' THEN NULL ELSE v_source_business.next_charge_at END,
    CASE WHEN p_registration_mode = 'initial' THEN NULL ELSE v_source_business.payment_method END,
    CASE WHEN p_registration_mode = 'initial' THEN 'none' ELSE v_source_business.payment_status END
  )
  RETURNING * INTO v_business;

  INSERT INTO public.business_members (user_id, business_id, role)
  VALUES (p_user_id, v_business.id, 'ADMIN');

  INSERT INTO public.branches (business_id, name, is_main, active)
  VALUES (v_business.id, 'Sucursal principal', true, true)
  RETURNING id INTO v_branch_id;

  IF p_registration_mode = 'initial' THEN
    INSERT INTO public.user_trial_usage (user_id, business_id, plan, used_at)
    VALUES (p_user_id, v_business.id, 'trial', p_trial_used_at)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'businessId', v_business.id,
    'branchId', v_branch_id,
    'role', 'ADMIN',
    'business', pg_catalog.to_jsonb(v_business),
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_business_atomic(
  uuid, text, text, text, text, text, text, numeric, text, text[], timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_business_atomic(
  uuid, text, text, text, text, text, text, numeric, text, text[], timestamptz, timestamptz
) TO service_role;

COMMIT;
