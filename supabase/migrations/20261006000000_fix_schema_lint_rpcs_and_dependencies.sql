BEGIN;

CREATE TABLE IF NOT EXISTS public.business_payment_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'wompi',
  public_key_encrypted text,
  private_key_encrypted text,
  integrity_secret_encrypted text,
  events_secret_encrypted text,
  is_active boolean NOT NULL DEFAULT true,
  last_tested_at timestamptz,
  last_test_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_payment_credentials_business_provider_unique
  ON public.business_payment_credentials (business_id, provider)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS business_payment_credentials_business_id_idx
  ON public.business_payment_credentials (business_id);

ALTER TABLE public.business_payment_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_payment_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.business_payment_credentials TO authenticated;
GRANT ALL ON public.business_payment_credentials TO service_role;

DROP POLICY IF EXISTS business_payment_credentials_admin_access
  ON public.business_payment_credentials;
CREATE POLICY business_payment_credentials_admin_access
  ON public.business_payment_credentials
  FOR SELECT TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND public.has_business_role(business_id, ARRAY['ADMIN'])
  );

CREATE OR REPLACE FUNCTION public.save_payment_credentials(
  p_business_id uuid,
  p_provider text,
  p_public_key text,
  p_private_key text,
  p_integrity_secret text,
  p_events_secret text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_business_role(p_business_id, ARRAY['ADMIN']) THEN
    RAISE EXCEPTION 'FORBIDDEN: solo un administrador puede guardar credenciales.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.business_payment_credentials
  SET public_key_encrypted = p_public_key,
      private_key_encrypted = p_private_key,
      integrity_secret_encrypted = p_integrity_secret,
      events_secret_encrypted = p_events_secret,
      is_active = true,
      updated_at = now()
  WHERE business_id = p_business_id
    AND provider = p_provider
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.business_payment_credentials (
      business_id, provider, public_key_encrypted, private_key_encrypted,
      integrity_secret_encrypted, events_secret_encrypted, is_active
    ) VALUES (
      p_business_id, p_provider, p_public_key, p_private_key,
      p_integrity_secret, p_events_secret, true
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.test_payment_credentials(
  p_business_id uuid,
  p_provider text
)
RETURNS TABLE(success boolean, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_business_role(p_business_id, ARRAY['ADMIN']) THEN
    RAISE EXCEPTION 'FORBIDDEN: solo un administrador puede probar credenciales.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_payment_credentials
    WHERE business_id = p_business_id
      AND provider = p_provider
      AND is_active = true
  ) THEN
    RETURN QUERY SELECT false, 'No hay credenciales guardadas para este proveedor.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.business_payment_credentials
    WHERE business_id = p_business_id
      AND provider = p_provider
      AND is_active = true
      AND (public_key_encrypted IS NULL OR public_key_encrypted = '')
  ) THEN
    RETURN QUERY SELECT false, 'Public key vacía.';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'Credenciales válidas (formato correcto).';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_plan_period_days(p_plan text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_plan = 'monthly' THEN
    RETURN 30;
  ELSIF p_plan = 'yearly' THEN
    RETURN 420;
  END IF;
  RAISE EXCEPTION 'Plan inválido: %', p_plan;
END;
$$;
REVOKE ALL ON FUNCTION public.get_plan_period_days(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plan_period_days(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_invitation public.business_invitations%ROWTYPE;
  v_business_id uuid;
  v_user_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'INVITATION_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT u.email INTO v_user_email
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

  INSERT INTO public.business_members (user_id, business_id, role)
  VALUES (auth.uid(), v_business_id, v_invitation.role)
  ON CONFLICT (user_id, business_id) DO UPDATE
    SET role = EXCLUDED.role;

  UPDATE public.business_invitations
  SET accepted_at = now()
  WHERE id = v_invitation.id;

  RETURN v_business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.vimdy_uuid_from_text(p_value text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT pg_catalog.substr(
    pg_catalog.encode(extensions.digest(p_value, 'sha256'), 'hex'),
    1,
    32
  )::uuid;
$$;
REVOKE ALL ON FUNCTION public.vimdy_uuid_from_text(text) FROM PUBLIC, anon, authenticated;

DO $migration$
DECLARE
  v_function record;
  v_definition text;
  v_updated_definition text;
  v_old text := 'unnest(public.auth_business_ids())';
  v_repaired_count integer := 0;
BEGIN
  FOR v_function IN
    SELECT p.oid, p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND position(v_old IN p.prosrc) > 0
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    v_updated_definition := replace(v_definition, v_old, 'public.auth_business_ids()');
    IF v_updated_definition = v_definition THEN
      RAISE EXCEPTION 'Could not repair auth_business_ids() use in %', v_function.signature;
    END IF;
    EXECUTE v_updated_definition;
    v_repaired_count := v_repaired_count + 1;
  END LOOP;
  IF v_repaired_count = 0 THEN
    RAISE EXCEPTION 'Expected auth_business_ids() RPC source repairs were not found';
  END IF;

  v_definition := pg_get_functiondef(
    'public.close_shift_atomic(uuid,numeric,text)'::regprocedure
  );
  v_updated_definition := replace(
    v_definition,
    'WHERE id=v_shift.id AND version=v_shift.version;',
    'WHERE public.shifts.id=v_shift.id AND public.shifts.version=v_shift.version;'
  );
  IF v_updated_definition = v_definition THEN
    RAISE EXCEPTION 'Could not qualify optimistic-lock columns in close_shift_atomic';
  END IF;
  EXECUTE v_updated_definition;

  v_definition := pg_get_functiondef(
    'public.deactivate_cash_register_atomic(uuid)'::regprocedure
  );
  v_updated_definition := replace(
    v_definition,
    'WHERE id = p_cash_register_id AND version = v_row.version;',
    'WHERE public.cash_registers.id = p_cash_register_id AND public.cash_registers.version = v_row.version;'
  );
  IF v_updated_definition = v_definition THEN
    RAISE EXCEPTION 'Could not qualify optimistic-lock columns in deactivate_cash_register_atomic';
  END IF;
  EXECUTE v_updated_definition;
  ALTER FUNCTION public.deactivate_cash_register_atomic(uuid)
    SET search_path = pg_catalog;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.cash_movements'::regclass
      AND conname = 'cash_movements_business_branch_idempotency_key_unique'
  ) THEN
    ALTER TABLE public.cash_movements
      ADD CONSTRAINT cash_movements_business_branch_idempotency_key_unique
      UNIQUE USING INDEX cash_movements_business_branch_idempotency_key_idx;
  END IF;

  v_definition := pg_get_functiondef(
    'public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)'::regprocedure
  );
  v_updated_definition := replace(
    v_definition,
    'ON CONFLICT (business_id, branch_id, idempotency_key) DO NOTHING;',
    'ON CONFLICT ON CONSTRAINT cash_movements_business_branch_idempotency_key_unique DO NOTHING;'
  );
  IF v_updated_definition = v_definition THEN
    RAISE EXCEPTION 'Could not qualify idempotency conflict target in register_movement_atomic';
  END IF;
  EXECUTE v_updated_definition;
  ALTER FUNCTION public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)
    SET search_path = pg_catalog;
END;
$migration$;

DO $migration$
DECLARE
  v_function record;
  v_definition text;
  v_updated_definition text;
  v_product_fix_count integer := 0;
  v_movement_fix_count integer := 0;
  v_path_check text :=
    'jsonb_path_exists(v_sale, ''$.refunds[*] ? (@.id == $refund_id)'', p_refund_id, p_refund_id)';
  v_path_check_replacement text :=
    'EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_sale->''refunds'', ''[]''::jsonb)) AS refund_entry(value) WHERE refund_entry.value->>''id'' = p_refund_id)';
  v_note_expression text :=
    'coalesce(v_sale->''notes'', ''""'') || '' | '' || p_cancel_reason';
BEGIN
  FOR v_function IN
    SELECT p.oid
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN ('refund_sale_full_atomic', 'cancel_sale_full_atomic')
      AND p.prosrc ~* 'v_product_id[[:space:]]+text'
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    v_updated_definition := regexp_replace(
      v_definition,
      'AND[[:space:]]+id[[:space:]]*=[[:space:]]*v_product_id',
      'AND id = v_product_id::uuid',
      'i'
    );
    v_updated_definition := regexp_replace(
      v_updated_definition,
      '(v_movement_id[[:space:]]+)text;',
      E'\\1uuid;',
      'i'
    );
    v_updated_definition := replace(
      v_updated_definition,
      'v_movement_id := ''refund-'' || p_refund_id || ''-'' || v_ingredient_id;',
      'v_movement_id := public.vimdy_uuid_from_text(''refund-'' || p_refund_id || ''-'' || v_ingredient_id);'
    );
    v_updated_definition := replace(
      v_updated_definition,
      'v_movement_id := ''refund-'' || p_refund_id || ''-'' || v_product_id;',
      'v_movement_id := public.vimdy_uuid_from_text(''refund-'' || p_refund_id || ''-'' || v_product_id);'
    );
    v_updated_definition := replace(
      v_updated_definition,
      'v_movement_id := ''cancel-'' || p_sale_id || ''-'' || v_ingredient_id;',
      'v_movement_id := public.vimdy_uuid_from_text(''cancel-'' || p_sale_id || ''-'' || v_ingredient_id);'
    );
    v_updated_definition := replace(
      v_updated_definition,
      'v_movement_id := ''cancel-'' || p_sale_id || ''-'' || v_product_id;',
      'v_movement_id := public.vimdy_uuid_from_text(''cancel-'' || p_sale_id || ''-'' || v_product_id);'
    );
    v_updated_definition := regexp_replace(
      v_updated_definition,
      'WHERE[[:space:]]+id[[:space:]]*=[[:space:]]*v_ingredient_id',
      'WHERE id = v_ingredient_id::uuid',
      'i'
    );
    IF v_updated_definition = v_definition THEN
      RAISE EXCEPTION 'Could not cast product UUID in function %', v_function.oid::regprocedure;
    END IF;
    v_definition := v_updated_definition;
    v_updated_definition := regexp_replace(
      v_definition,
      'WHERE[[:space:]]+id[[:space:]]*=[[:space:]]*v_movement_id',
      'WHERE id = v_movement_id::uuid',
      'i'
    );
    IF v_updated_definition = v_definition THEN
      RAISE EXCEPTION 'Could not cast inventory movement UUID in function %',
        v_function.oid::regprocedure;
    END IF;
    EXECUTE v_updated_definition;
    v_product_fix_count := v_product_fix_count + 1;
    v_movement_fix_count := v_movement_fix_count + 1;
  END LOOP;
  IF v_product_fix_count <> 2 OR v_movement_fix_count <> 2 THEN
    RAISE EXCEPTION
      'Expected two product and two inventory movement UUID fixes; fixed % and %',
      v_product_fix_count, v_movement_fix_count;
  END IF;

  FOR v_function IN
    SELECT p.oid
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND position(v_path_check IN p.prosrc) > 0
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    v_updated_definition := replace(
      v_definition,
      v_path_check,
      v_path_check_replacement
    );
    IF v_updated_definition = v_definition THEN
      RAISE EXCEPTION 'Could not repair refund idempotency check in %', v_function.oid::regprocedure;
    END IF;
    EXECUTE v_updated_definition;
  END LOOP;

  FOR v_function IN
    SELECT p.oid
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND position(v_note_expression IN p.prosrc) > 0
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    v_updated_definition := replace(
      v_definition,
      v_note_expression,
      'to_jsonb(concat_ws('' | '', nullif(v_sale->>''notes'', ''''), p_cancel_reason))'
    );
    IF v_updated_definition = v_definition THEN
      RAISE EXCEPTION 'Could not repair cancellation note JSON in %', v_function.oid::regprocedure;
    END IF;
    EXECUTE v_updated_definition;
  END LOOP;
END;
$migration$;

ALTER FUNCTION public.vimdy_try_parse_timestamptz(text) STABLE;
ALTER FUNCTION public.vimdy_try_parse_timestamptz(text) SET search_path = pg_catalog;

REVOKE ALL ON FUNCTION public.save_payment_credentials(uuid,text,text,text,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_payment_credentials(uuid,text,text,text,text,text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.test_payment_credentials(uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.test_payment_credentials(uuid,text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.register_sale_payment_movements(uuid,uuid,text,numeric,text,numeric,numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_sale_payment_movements(uuid,uuid,text,numeric,text,numeric,numeric)
  TO service_role;
REVOKE ALL ON FUNCTION public.refund_sale_full_atomic(uuid,uuid,text,integer,numeric,text,text,text,jsonb,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_sale_full_atomic(uuid,uuid,text,integer,numeric,text,text,jsonb,text,boolean)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_payment_atomic(uuid,uuid,text,integer,text,numeric,numeric,numeric)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refund_sale_atomic(uuid,uuid,text,integer,numeric,text,text,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_sale_atomic(uuid,uuid,text,integer,numeric,text,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deactivate_cash_register_atomic(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_cash_register_atomic(uuid)
  TO authenticated, service_role;

COMMIT;
