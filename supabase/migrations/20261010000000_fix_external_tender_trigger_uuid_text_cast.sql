-- ============================================================================
-- 20261010000000_fix_external_tender_trigger_uuid_text_cast.sql
-- ----------------------------------------------------------------------------
-- Corrige un defecto REAL de produccion en el trigger fail-closed
-- sales_require_verified_external_tender.
--
-- Defecto
-- -------
-- public.sales.id es uuid, pero public.payment_verifications.sale_id es text.
-- El trigger comparaba ambas columnas directamente:
--
--     AND pv.sale_id = NEW.id
--     AND pv.payment_id = 'sale-payment-' || NEW.id
--
-- Postgres no tiene operador `text = uuid`, asi que la comparacion fallaba con
--     ERROR: operator does not exist: text = uuid
-- y abortaba la transicion a PAID. Como el trigger es BEFORE INSERT OR UPDATE
-- OF data ON sales, el error reventaba la propia RPC
-- register_sale_payment_atomic() en su UPDATE ... SET data = v_paid_data.
--
-- Impacto: TODO pago externo (CARD, TRANSFER, QR, MIXED) era imposible de
-- confirmar en produccion. El fail-closed seguia intacto, pero por un fallo de
-- tipo, no por la logica de verificacion: no era "rechazar sin evidencia", era
-- "rechazar siempre".
--
-- Correccion
-- ---------
-- Se castea explicitamente el uuid a text para comparar contra las columnas
-- text de payment_verifications. No se relaja ninguna condicion: el trigger
-- sigue exigiendo paymentVerificationSource = 'PROVIDER' y una fila CONFIRMED
-- con provider_reference, verified_at y monto coincidente. Sin esa evidencia
-- sigue fallando cerrado con CAJA_PAYMENT_NOT_VERIFIED.
--
-- Migracion NUEVA a proposito: NO se modifica 20260930180000 (historica).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.require_verified_external_tender_on_paid_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous_status text;
  v_method text;
  v_source text;
  v_expected_provider_amount numeric;
  v_verified_reference text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_previous_status := OLD.data->>'status';
  END IF;

  IF NEW.data->>'status' IS DISTINCT FROM 'PAID'
     OR v_previous_status = 'PAID' THEN
    RETURN NEW;
  END IF;

  v_method := NEW.data->>'paymentMethod';
  IF v_method NOT IN ('CARD', 'TRANSFER', 'QR', 'MIXED') THEN
    RETURN NEW;
  END IF;

  v_source := NEW.data->>'paymentVerificationSource';
  IF v_source IS DISTINCT FROM 'PROVIDER' THEN
    RAISE EXCEPTION 'CAJA_PAYMENT_NOT_VERIFIED'
      USING ERRCODE = 'P0001';
  END IF;

  v_expected_provider_amount := CASE
    WHEN v_method = 'MIXED' THEN
      COALESCE((NEW.data->>'total')::numeric, 0)
        - COALESCE((NEW.data->>'cashAmount')::numeric, 0)
    ELSE COALESCE((NEW.data->>'total')::numeric, 0)
  END;

  IF v_expected_provider_amount <= 0 THEN
    RAISE EXCEPTION 'CAJA_PAYMENT_NOT_VERIFIED'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pv.provider_reference
    INTO v_verified_reference
  FROM public.payment_verifications AS pv
  WHERE pv.business_id = NEW.business_id
    AND pv.branch_id = NEW.branch_id
    AND pv.sale_id = NEW.id::text
    AND pv.payment_id = 'sale-payment-' || NEW.id::text
    AND pv.method = v_method
    AND abs(pv.amount - v_expected_provider_amount) <= 0.005
    AND pv.status = 'CONFIRMED'
    AND pv.verified_at IS NOT NULL
    AND pv.provider_reference IS NOT NULL
  FOR UPDATE;

  IF v_verified_reference IS NULL THEN
    RAISE EXCEPTION 'CAJA_PAYMENT_NOT_VERIFIED'
      USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(btrim(NEW.data->>'paymentReference'), '') IS NOT NULL
     AND btrim(NEW.data->>'paymentReference') IS DISTINCT FROM btrim(v_verified_reference) THEN
    RAISE EXCEPTION 'CAJA_PAYMENT_REFERENCE_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.require_verified_external_tender_on_paid_sale() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.require_verified_external_tender_on_paid_sale() IS
  'Prevents a client-supplied reference or EXTERNAL_TERMINAL assertion from marking CARD/TRANSFER/QR/MIXED sales PAID. Trusted provider evidence must be persisted in payment_verifications first. Compares pv.sale_id (text) against sales.id (uuid) using an explicit ::text cast.';

COMMIT;