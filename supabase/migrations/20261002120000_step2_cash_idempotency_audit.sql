BEGIN;

DO $migration$
DECLARE
  v_function regprocedure := 'public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)'::regprocedure;
  v_definition text;
  v_updated_definition text;
  v_needle text;
  v_replacement text;
BEGIN
  v_definition := pg_get_functiondef(v_function);

  v_needle := $needle$IF FOUND THEN
    RETURN QUERY SELECT
      v_existing.id::text,$needle$;
  v_replacement := $replacement$IF FOUND THEN
    IF v_existing.data->>'type' IS DISTINCT FROM p_type
       OR abs(COALESCE((v_existing.data->>'amount')::numeric, 0) - p_amount) > 0.005
       OR v_existing.data->>'description' IS DISTINCT FROM p_description
       OR v_existing.data->>'paymentMethod' IS DISTINCT FROM p_payment_method
       OR abs(COALESCE((v_existing.data->>'cashAmount')::numeric, 0) - p_cash_amount) > 0.005
       OR v_existing.data->>'saleId' IS DISTINCT FROM p_sale_id
       OR v_existing.data->>'paymentVerificationSource' IS DISTINCT FROM p_verification_source
       OR (p_cash_register_id IS NOT NULL AND v_existing.cash_register_id IS DISTINCT FROM p_cash_register_id) THEN
      RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED';
    END IF;
    RETURN QUERY SELECT
      v_existing.id::text,$replacement$;

  IF position(v_needle IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not locate initial idempotency return in %', v_function;
  END IF;
  v_updated_definition := replace(v_definition, v_needle, v_replacement);

  v_needle := $needle$AND cm.idempotency_key = p_idempotency_key
  FOR UPDATE;

  RETURN QUERY SELECT
    v_existing.id::text,$needle$;
  v_replacement := $replacement$AND cm.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND
     OR v_existing.data->>'type' IS DISTINCT FROM p_type
     OR abs(COALESCE((v_existing.data->>'amount')::numeric, 0) - p_amount) > 0.005
     OR v_existing.data->>'description' IS DISTINCT FROM p_description
     OR v_existing.data->>'paymentMethod' IS DISTINCT FROM p_payment_method
     OR abs(COALESCE((v_existing.data->>'cashAmount')::numeric, 0) - p_cash_amount) > 0.005
     OR v_existing.data->>'saleId' IS DISTINCT FROM p_sale_id
     OR v_existing.data->>'paymentVerificationSource' IS DISTINCT FROM p_verification_source
     OR (p_cash_register_id IS NOT NULL AND v_existing.cash_register_id IS DISTINCT FROM p_cash_register_id) THEN
    RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED';
  END IF;

  RETURN QUERY SELECT
    v_existing.id::text,$replacement$;

  IF position(v_needle IN v_updated_definition) = 0 THEN
    RAISE EXCEPTION 'Could not locate conflict idempotency return in %', v_function;
  END IF;
  v_updated_definition := replace(v_updated_definition, v_needle, v_replacement);
  EXECUTE v_updated_definition;
END;
$migration$;

DO $migration$
DECLARE
  v_function regprocedure := 'public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text,uuid,text,uuid)'::regprocedure;
  v_definition text;
  v_updated_definition text;
  v_needle text;
  v_replacement text;
BEGIN
  v_definition := pg_get_functiondef(v_function);
  v_needle := $needle$IF v_payment.data->>'saleId' IS DISTINCT FROM p_sale_id THEN RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED'; END IF;$needle$;
  v_replacement := $replacement$IF v_payment.data->>'saleId' IS DISTINCT FROM p_sale_id
     OR v_payment.data->>'type' IS DISTINCT FROM 'IN'
     OR abs(COALESCE((v_payment.data->>'amount')::numeric, 0) - p_total) > 0.005
     OR v_payment.data->>'paymentMethod' IS DISTINCT FROM p_payment_method
     OR abs(COALESCE((v_payment.data->>'cashAmount')::numeric, 0) - p_cash_amount) > 0.005
     OR v_payment.data->>'paymentVerificationSource' IS DISTINCT FROM p_verification_source
     OR v_sale.data->>'paymentMethod' IS DISTINCT FROM p_payment_method
     OR abs(COALESCE((v_sale.data->>'paymentReceived')::numeric, 0) - p_received) > 0.005
     OR abs(COALESCE((v_sale.data->>'changeGiven')::numeric, 0) - p_change) > 0.005 THEN
      RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED';
    END IF;$replacement$;
  IF position(v_needle IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not locate payment idempotency guard in %', v_function;
  END IF;
  v_updated_definition := replace(v_definition, v_needle, v_replacement);

  v_needle := $needle$IF p_change_id IS NOT NULL THEN
      SELECT * INTO v_change
      FROM public.cash_movements cm
      WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_change_id
      FOR UPDATE;
      v_has_change := FOUND;
    END IF;
    RETURN QUERY SELECT$needle$;
  v_replacement := $replacement$IF p_change_id IS NOT NULL THEN
      SELECT * INTO v_change
      FROM public.cash_movements cm
      WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_change_id
      FOR UPDATE;
      v_has_change := FOUND;
      IF NOT v_has_change
         OR v_change.data->>'saleId' IS DISTINCT FROM p_sale_id
         OR v_change.data->>'type' IS DISTINCT FROM 'OUT'
         OR v_change.data->>'paymentMethod' IS DISTINCT FROM 'CASH'
         OR abs(COALESCE((v_change.data->>'amount')::numeric, 0) - p_change) > 0.005
         OR abs(COALESCE((v_change.data->>'cashAmount')::numeric, 0) - p_change) > 0.005
         OR v_change.cash_register_id IS DISTINCT FROM v_payment.cash_register_id
         OR v_change.shift_id IS DISTINCT FROM v_payment.shift_id THEN
        RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED';
      END IF;
    ELSIF p_change > 0 THEN
      RAISE EXCEPTION 'CAJA_CHANGE_ID_REQUIRED';
    END IF;$replacement$;
  v_replacement := v_replacement || $replacement$
    RETURN QUERY SELECT$replacement$;
  IF position(v_needle IN v_updated_definition) = 0 THEN
    RAISE EXCEPTION 'Could not locate change idempotency guard in %', v_function;
  END IF;
  v_updated_definition := replace(v_updated_definition, v_needle, v_replacement);
  EXECUTE v_updated_definition;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.audit_caja_financial_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_action text;
  v_data jsonb;
  v_audit_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
BEGIN
  IF TG_TABLE_NAME = 'cash_movements' THEN
    v_action := 'CASH_MOVEMENT_REGISTERED';
    v_data := NEW.data;
  ELSIF TG_TABLE_NAME = 'shifts' THEN
    IF TG_OP = 'INSERT' THEN
      v_action := 'SHIFT_OPENED';
    ELSIF OLD.data->>'status' IS DISTINCT FROM NEW.data->>'status'
       AND NEW.data->>'status' = 'CLOSED' THEN
      v_action := 'SHIFT_CLOSED';
    ELSE
      RETURN NEW;
    END IF;
    v_data := NEW.data;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.audit_logs (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (
    v_audit_id, NEW.business_id, NEW.branch_id, 1,
    jsonb_build_object(
      'id', v_audit_id::text,
      'actorId', COALESCE(auth.uid()::text, v_data->>'userId', v_data->>'cashierId'),
      'action', v_action,
      'module', 'cash',
      'entityId', NEW.id::text,
      'description', v_action || ' (' || TG_TABLE_NAME || ').',
      'date', v_now,
      'idempotencyKey', COALESCE(v_data->>'idempotencyKey', v_data->>'id'),
      'result', 'SUCCESS'
    ), v_now, v_now
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_cash_movements_financial_write ON public.cash_movements;
CREATE TRIGGER audit_cash_movements_financial_write
AFTER INSERT ON public.cash_movements
FOR EACH ROW EXECUTE FUNCTION public.audit_caja_financial_change();

DROP TRIGGER IF EXISTS audit_shifts_financial_insert ON public.shifts;
CREATE TRIGGER audit_shifts_financial_insert
AFTER INSERT ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.audit_caja_financial_change();

DROP TRIGGER IF EXISTS audit_shifts_financial_close ON public.shifts;
CREATE TRIGGER audit_shifts_financial_close
AFTER UPDATE OF data ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.audit_caja_financial_change();

REVOKE ALL ON FUNCTION public.audit_caja_financial_change() FROM PUBLIC, anon, authenticated;

COMMIT;