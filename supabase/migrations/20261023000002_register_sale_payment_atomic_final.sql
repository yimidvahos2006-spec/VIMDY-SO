-- ============================================================================
-- VIMDY OS - FINALIZACIÓN CANÓNICA DE register_sale_payment_atomic
-- ============================================================================
-- Esta migration reemplaza cualquier sobrecarga antigua de la RPC y deja una
-- única firma canónica compatible con CashMovementRepository.ts.
--
-- Firma canónica:
-- register_sale_payment_atomic(
--   text, uuid, uuid, text, text, text, numeric, numeric, numeric, numeric,
--   text, uuid, text, uuid
-- )
--
-- Propiedades:
--   * idempotencia por (business_id, branch_id, p_payment_id)
--   * lock de venta FOR UPDATE para evitar doble cobro concurrente
--   * lock del turno cuando corresponde
--   * ingreso + cambio + PAID en una única transacción PostgreSQL
--   * validación server-side de CASH/CARD/TRANSFER/QR/MIXED
--   * rechazo de reutilización de idempotency key con payload financiero distinto
--   * seguridad SECURITY DEFINER + RBAC server-side
--   * sin dependencia de overloads ambiguas
--
-- NOTA DE DESPLIEGUE:
--   La migration 20260923190000_caja_final_hardening.sql es histórica y quedó
--   obsoleta. No debe volver a ejecutarse. Si fue ejecutada parcialmente, este
--   archivo limpia las sobrecargas antes de crear la firma final.
-- ============================================================================

BEGIN;

-- Elimina cualquier overload cuyo identity signature NO sea la firma final.
-- Esto cubre de forma segura las versiones antiguas de 11 y 13 argumentos y
-- evita depender de conocer exactamente qué versión quedó instalada.
DO $$
DECLARE
  v_function record;
  v_final_identity text :=
    'text, uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, text, uuid, text, uuid';
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure AS regproc,
           pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n
      ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'register_sale_payment_atomic'
      AND pg_get_function_identity_arguments(p.oid) IS DISTINCT FROM v_final_identity
  LOOP
    EXECUTE pg_catalog.format(
      'DROP FUNCTION IF EXISTS %s',
      v_function.regproc
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_sale_payment_atomic(
  p_sale_id text,
  p_business_id uuid,
  p_branch_id uuid,
  p_payment_id text,
  p_change_id text,
  p_payment_method text,
  p_total numeric,
  p_cash_amount numeric,
  p_received numeric,
  p_change numeric,
  p_reference text DEFAULT NULL,
  p_cash_register_id uuid DEFAULT NULL,
  p_verification_source text DEFAULT NULL,
  p_shift_id uuid DEFAULT NULL
)
RETURNS TABLE(
  sale_data jsonb,
  sale_version integer,
  payment_idempotency_key text,
  payment_amount numeric,
  payment_description text,
  payment_date timestamptz,
  payment_method text,
  payment_cash_amount numeric,
  change_idempotency_key text,
  change_amount numeric,
  change_description text,
  change_date timestamptz,
  business_id uuid,
  branch_id uuid,
  cash_register_id uuid,
  shift_id text,
  payment_verification_source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_sale public.sales%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_payment public.cash_movements%ROWTYPE;
  v_change public.cash_movements%ROWTYPE;
  v_cash_register_id uuid := p_cash_register_id;
  v_open_shift_count integer := 0;
  v_payment_date timestamptz := clock_timestamp();
  v_paid_data jsonb;
  v_has_change boolean := false;
  v_verified_provider_reference text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CAJA_AUTH_REQUIRED'; END IF;
  IF p_sale_id IS NULL OR p_payment_id IS NULL OR btrim(p_payment_id) = '' THEN RAISE EXCEPTION 'CAJA_PAYMENT_IDENTIFIERS_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_members bm WHERE bm.business_id=p_business_id AND bm.user_id=auth.uid()) THEN RAISE EXCEPTION 'CAJA_NOT_A_MEMBER'; END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','CAJERO']) THEN RAISE EXCEPTION 'CAJA_FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id=p_branch_id AND b.business_id=p_business_id AND b.active=true) THEN RAISE EXCEPTION 'CAJA_INVALID_BRANCH'; END IF;
  IF p_payment_method NOT IN ('CASH','CARD','TRANSFER','QR','MIXED') THEN RAISE EXCEPTION 'CAJA_INVALID_PAYMENT_METHOD'; END IF;
  IF p_total IS NULL OR p_total <= 0 OR p_cash_amount IS NULL OR p_cash_amount < 0 OR p_received IS NULL OR p_received < 0 OR p_change IS NULL OR p_change < 0 THEN RAISE EXCEPTION 'CAJA_INVALID_PAYMENT'; END IF;
  IF abs(p_change - greatest(p_received - p_total,0)) > 0.005 THEN RAISE EXCEPTION 'CAJA_INVALID_CHANGE'; END IF;

  -- Nunca se permite confirmar una transferencia/QR por una referencia sola.
  IF p_payment_method IN ('TRANSFER','QR') AND p_verification_source <> 'PROVIDER' THEN
    RAISE EXCEPTION 'CAJA_PAYMENT_NOT_VERIFIED';
  END IF;
  IF p_payment_method = 'CARD' AND p_verification_source NOT IN ('EXTERNAL_TERMINAL','PROVIDER') THEN
    RAISE EXCEPTION 'CAJA_CARD_CONFIRMATION_REQUIRED';
  END IF;
  IF p_payment_method = 'CASH' AND p_verification_source IS DISTINCT FROM 'CASH' THEN
    RAISE EXCEPTION 'CAJA_CASH_CONFIRMATION_REQUIRED';
  END IF;
  IF p_payment_method = 'MIXED' AND p_verification_source NOT IN ('EXTERNAL_TERMINAL','PROVIDER') THEN
    RAISE EXCEPTION 'CAJA_MIXED_CONFIRMATION_REQUIRED';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales s
  WHERE s.id = p_sale_id::uuid AND s.business_id = p_business_id AND s.branch_id = p_branch_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;

  IF abs((v_sale.data->>'total')::numeric - p_total) > 0.005 THEN RAISE EXCEPTION 'CAJA_SALE_TOTAL_MISMATCH'; END IF;

  IF p_payment_method IN ('TRANSFER','QR') THEN
    SELECT pv.provider_reference
      INTO v_verified_provider_reference
    FROM public.payment_verifications pv
    WHERE pv.business_id = p_business_id
      AND pv.branch_id = p_branch_id
      AND pv.sale_id = p_sale_id
      AND pv.payment_id = p_payment_id
      AND pv.method = p_payment_method
      AND pv.amount = p_total
      AND pv.status = 'CONFIRMED'
      AND pv.verified_at IS NOT NULL
      AND pv.provider_reference IS NOT NULL
    FOR UPDATE;

    IF v_verified_provider_reference IS NULL THEN
      RAISE EXCEPTION 'CAJA_PAYMENT_NOT_VERIFIED';
    END IF;

    IF NULLIF(btrim(p_reference), '') IS NOT NULL
       AND btrim(p_reference) IS DISTINCT FROM btrim(v_verified_provider_reference) THEN
      RAISE EXCEPTION 'CAJA_PAYMENT_REFERENCE_MISMATCH';
    END IF;
  END IF;

  SELECT * INTO v_payment
  FROM public.cash_movements cm
  WHERE cm.business_id = p_business_id AND cm.branch_id = p_branch_id AND cm.idempotency_key = p_payment_id
  FOR UPDATE;

  IF FOUND THEN
    -- Una clave de idempotencia representa una operación financiera concreta.
    -- Un reintento con la misma clave puede devolver el resultado original,
    -- pero nunca puede reutilizar la clave con otro importe, método o cambio.
    IF v_payment.data->>'saleId' IS DISTINCT FROM p_sale_id THEN
      RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED';
    END IF;
    IF v_payment.data->>'paymentMethod' IS DISTINCT FROM p_payment_method THEN
      RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED';
    END IF;
    IF abs(COALESCE((v_payment.data->>'amount')::numeric, 0) - p_total) > 0.005 THEN
      RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED';
    END IF;
    IF abs(COALESCE((v_payment.data->>'cashAmount')::numeric, 0) - p_cash_amount) > 0.005 THEN
      RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED';
    END IF;
    IF abs(COALESCE((v_sale.data->>'paymentReceived')::numeric, 0) - p_received) > 0.005 THEN
      RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED';
    END IF;
    IF abs(COALESCE((v_sale.data->>'changeGiven')::numeric, 0) - p_change) > 0.005 THEN
      RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED';
    END IF;
    IF p_shift_id IS NOT NULL AND v_payment.shift_id IS DISTINCT FROM p_shift_id::text THEN
      RAISE EXCEPTION 'CAJA_SHIFT_MISMATCH';
    END IF;
    IF p_cash_register_id IS NOT NULL AND v_payment.cash_register_id IS DISTINCT FROM p_cash_register_id THEN
      RAISE EXCEPTION 'CAJA_CASH_REGISTER_MISMATCH';
    END IF;
    IF v_sale.data->>'status' NOT IN ('PAID','CLOSED') THEN
      RAISE EXCEPTION 'CAJA_PAYMENT_SALE_STATE_MISMATCH';
    END IF;
    IF p_change_id IS NOT NULL THEN
      SELECT * INTO v_change
      FROM public.cash_movements cm
      WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_change_id
      FOR UPDATE;
      v_has_change := FOUND;
    END IF;
    RETURN QUERY SELECT
      v_sale.data, v_sale.version,
      v_payment.idempotency_key, (v_payment.data->>'amount')::numeric, v_payment.data->>'description', (v_payment.data->>'date')::timestamptz,
      v_payment.data->>'paymentMethod', COALESCE((v_payment.data->>'cashAmount')::numeric,0),
      CASE WHEN v_has_change THEN v_change.idempotency_key ELSE NULL END,
      CASE WHEN v_has_change THEN (v_change.data->>'amount')::numeric ELSE NULL END,
      CASE WHEN v_has_change THEN v_change.data->>'description' ELSE NULL END,
      CASE WHEN v_has_change THEN (v_change.data->>'date')::timestamptz ELSE NULL END,
      p_business_id,p_branch_id,v_payment.cash_register_id,v_payment.shift_id,
      v_payment.data->>'paymentVerificationSource';
    RETURN;
  END IF;

  IF v_sale.data->>'status' IN ('PAID','CLOSED') THEN RAISE EXCEPTION 'SALE_ALREADY_PAID'; END IF;
  IF v_sale.data->>'status' IN ('CANCELLED','REFUNDED') THEN RAISE EXCEPTION 'SALE_NOT_PAYABLE'; END IF;
  IF v_sale.data->>'status' NOT IN ('PENDING_PAYMENT','OPEN') THEN RAISE EXCEPTION 'SALE_INVALID_STATE'; END IF;

  IF p_shift_id IS NOT NULL THEN
    SELECT * INTO v_shift
    FROM public.shifts s
    WHERE s.id = p_shift_id
      AND s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.data->>'status' = 'OPEN'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CAJA_SHIFT_NOT_FOUND_OR_CLOSED';
    END IF;

    IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN'])
       AND NULLIF(v_shift.data->>'cashierId', '')::uuid IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'CAJA_SHIFT_OWNER_REQUIRED';
    END IF;

    IF v_shift.cash_register_id IS NULL THEN
      IF v_cash_register_id IS NULL THEN
        RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
      END IF;
      UPDATE public.shifts
      SET cash_register_id = v_cash_register_id,
          data = jsonb_set(data, '{cashRegisterId}', to_jsonb(v_cash_register_id::text), true),
          updated_at = clock_timestamp()
      WHERE id = v_shift.id AND cash_register_id IS NULL;
      v_shift.cash_register_id := v_cash_register_id;
    ELSIF v_cash_register_id IS NOT NULL AND v_shift.cash_register_id <> v_cash_register_id THEN
      RAISE EXCEPTION 'CAJA_CASH_REGISTER_MISMATCH';
    ELSE
      v_cash_register_id := v_shift.cash_register_id;
    END IF;
  ELSIF v_cash_register_id IS NULL THEN
    SELECT count(*) INTO v_open_shift_count
    FROM public.shifts s
    WHERE s.business_id=p_business_id
      AND s.branch_id=p_branch_id
      AND s.data->>'status'='OPEN';

    IF v_open_shift_count = 0 THEN
      RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT';
    ELSIF v_open_shift_count > 1 THEN
      RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
    END IF;

    SELECT s.cash_register_id INTO v_cash_register_id
    FROM public.shifts s
    WHERE s.business_id=p_business_id
      AND s.branch_id=p_branch_id
      AND s.data->>'status'='OPEN'
    ORDER BY s.id ASC
    LIMIT 1;

    IF v_cash_register_id IS NULL THEN
      SELECT count(*) INTO v_open_shift_count
      FROM public.cash_registers r
      WHERE r.business_id=p_business_id
        AND r.branch_id=p_branch_id
        AND r.active=true
        AND r.status='ACTIVE';

      IF v_open_shift_count = 0 THEN
        PERFORM public.ensure_default_cash_register(p_business_id, p_branch_id);
        SELECT count(*) INTO v_open_shift_count
        FROM public.cash_registers r
        WHERE r.business_id=p_business_id
          AND r.branch_id=p_branch_id
          AND r.active=true
          AND r.status='ACTIVE';
      END IF;

      IF v_open_shift_count <> 1 THEN
        RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
      END IF;

      SELECT r.id INTO v_cash_register_id
      FROM public.cash_registers r
      WHERE r.business_id=p_business_id
        AND r.branch_id=p_branch_id
        AND r.active=true
        AND r.status='ACTIVE'
      LIMIT 1;
    END IF;

    IF v_cash_register_id IS NULL THEN
      RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
    END IF;
  END IF;

  IF p_shift_id IS NULL THEN
    SELECT * INTO v_shift
    FROM public.shifts s
    WHERE s.business_id=p_business_id
      AND s.branch_id=p_branch_id
      AND s.cash_register_id=v_cash_register_id
      AND s.data->>'status'='OPEN'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT'; END IF;

    IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN'])
       AND NULLIF(v_shift.data->>'cashierId', '')::uuid IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'CAJA_SHIFT_OWNER_REQUIRED';
    END IF;
  END IF;

  IF p_payment_method='CASH' THEN
    IF abs(p_cash_amount-p_total)>0.005 OR p_received<p_total THEN RAISE EXCEPTION 'CAJA_INVALID_CASH_PAYMENT'; END IF;
  ELSIF p_payment_method IN ('CARD','TRANSFER','QR') THEN
    IF p_cash_amount<>0 OR abs(p_received-p_total)>0.005 OR p_change<>0 THEN RAISE EXCEPTION 'CAJA_INVALID_NON_CASH_PAYMENT'; END IF;
  ELSE
    IF p_cash_amount>p_received OR p_change>p_cash_amount THEN RAISE EXCEPTION 'CAJA_INVALID_MIXED_PAYMENT'; END IF;
  END IF;

  INSERT INTO public.cash_movements(id,idempotency_key,business_id,branch_id,cash_register_id,shift_id,data)
  VALUES (
    gen_random_uuid(),p_payment_id,p_business_id,p_branch_id,v_cash_register_id,v_shift.id::text,
    jsonb_build_object(
      'id',p_payment_id,'idempotencyKey',p_payment_id,'type','IN','amount',p_total,
      'description',format('Venta %s (%s)',coalesce(v_sale.data->>'code',p_sale_id),p_payment_method),
      'date',v_payment_date,'paymentMethod',p_payment_method,'cashAmount',p_cash_amount,
      'saleId',p_sale_id,'shiftId',v_shift.id::text,'cashRegisterId',v_cash_register_id::text,
      'createdAt',v_payment_date,'businessId',p_business_id::text,'branchId',p_branch_id::text,
      'userId',auth.uid()::text,
      'paymentVerificationSource',p_verification_source
    )
  ) ON CONFLICT (business_id,branch_id,idempotency_key) DO NOTHING;

  SELECT * INTO v_payment FROM public.cash_movements cm
  WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_payment_id
  FOR UPDATE;

  IF p_change>0 THEN
    IF p_change_id IS NULL OR btrim(p_change_id)='' THEN RAISE EXCEPTION 'CAJA_CHANGE_ID_REQUIRED'; END IF;
    INSERT INTO public.cash_movements(id,idempotency_key,business_id,branch_id,cash_register_id,shift_id,data)
    VALUES (
      gen_random_uuid(),p_change_id,p_business_id,p_branch_id,v_cash_register_id,v_shift.id::text,
      jsonb_build_object(
        'id',p_change_id,'idempotencyKey',p_change_id,'type','OUT','amount',p_change,
        'description',format('Cambio venta %s',coalesce(v_sale.data->>'code',p_sale_id)),
        'date',v_payment_date,'paymentMethod','CASH','cashAmount',p_change,
        'saleId',p_sale_id,'shiftId',v_shift.id::text,'cashRegisterId',v_cash_register_id::text,
        'createdAt',v_payment_date,'businessId',p_business_id::text,'branchId',p_branch_id::text,
        'userId',auth.uid()::text
      )
    ) ON CONFLICT (business_id,branch_id,idempotency_key) DO NOTHING;
    SELECT * INTO v_change FROM public.cash_movements cm
    WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_change_id
    FOR UPDATE;
    v_has_change := FOUND;
    IF NOT v_has_change OR v_change.data->>'saleId' IS DISTINCT FROM p_sale_id THEN RAISE EXCEPTION 'CAJA_CHANGE_KEY_REUSED'; END IF;
  END IF;

  v_paid_data := v_sale.data || jsonb_build_object(
    'status','PAID','paymentMethod',p_payment_method,'cashAmount',p_cash_amount,
    'paymentReference',COALESCE(v_verified_provider_reference,NULLIF(p_reference,'')),'paymentReceived',p_received,'changeGiven',p_change,
    'paymentStatus','CONFIRMED','paymentVerificationSource',p_verification_source,
    'paymentVerifiedAt',v_payment_date,'paidAt',v_payment_date,'shiftId',v_shift.id::text,
    'cashRegisterId',v_cash_register_id::text
  );

  UPDATE public.sales
  SET data=v_paid_data,version=v_sale.version+1,updated_at=v_payment_date
  WHERE id=p_sale_id::uuid AND business_id=p_business_id AND branch_id=p_branch_id
    AND version=v_sale.version AND data->>'status' IN ('PENDING_PAYMENT','OPEN');
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_PAYMENT_CONFLICT'; END IF;

  RETURN QUERY SELECT
    v_paid_data,v_sale.version+1,
    v_payment.idempotency_key,(v_payment.data->>'amount')::numeric,v_payment.data->>'description',(v_payment.data->>'date')::timestamptz,
    v_payment.data->>'paymentMethod',COALESCE((v_payment.data->>'cashAmount')::numeric,0),
    CASE WHEN v_has_change THEN v_change.idempotency_key ELSE NULL END,
    CASE WHEN v_has_change THEN (v_change.data->>'amount')::numeric ELSE NULL END,
    CASE WHEN v_has_change THEN v_change.data->>'description' ELSE NULL END,
    CASE WHEN v_has_change THEN (v_change.data->>'date')::timestamptz ELSE NULL END,
    p_business_id,p_branch_id,v_cash_register_id,v_shift.id::text,
    v_payment.data->>'paymentVerificationSource';
END;
$$;

-- Permisos sobre la única firma canónica.
REVOKE ALL ON FUNCTION public.register_sale_payment_atomic(
  text, uuid, uuid, text, text, text, numeric, numeric, numeric, numeric,
  text, uuid, text, uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.register_sale_payment_atomic(
  text, uuid, uuid, text, text, text, numeric, numeric, numeric, numeric,
  text, uuid, text, uuid
) TO authenticated, service_role;

ALTER FUNCTION public.register_sale_payment_atomic(
  text, uuid, uuid, text, text, text, numeric, numeric, numeric, numeric,
  text, uuid, text, uuid
) SET search_path = pg_catalog;

COMMENT ON FUNCTION public.register_sale_payment_atomic(
  text, uuid, uuid, text, text, text, numeric, numeric, numeric, numeric,
  text, uuid, text, uuid
) IS
  'Canonical atomic POS sale payment. Idempotent by business/branch/payment key; validates tender, cash register, shift, payment verification and sale state server-side.';

-- Verificación final de estructura: debe existir EXACTAMENTE una sobrecarga.
DO $$
DECLARE
  v_count integer;
  v_execute boolean;
BEGIN
  SELECT count(*)
    INTO v_count
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'register_sale_payment_atomic';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'CAJA_RPC_OVERLOAD_STATE_INVALID: register_sale_payment_atomic tiene % sobrecargas; se esperaba exactamente 1.',
      v_count;
  END IF;

  IF to_regprocedure(
    'public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text,uuid,text,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'CAJA_RPC_FINAL_SIGNATURE_MISSING: falta la firma canónica de 14 parámetros.';
  END IF;

  v_execute := has_function_privilege(
    'authenticated',
    'public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text,uuid,text,uuid)',
    'EXECUTE'
  );

  IF NOT v_execute THEN
    RAISE EXCEPTION
      'CAJA_RPC_AUTHENTICATED_EXECUTE_MISSING: authenticated no tiene EXECUTE sobre la RPC canónica.';
  END IF;
END;
$$;

COMMIT;
