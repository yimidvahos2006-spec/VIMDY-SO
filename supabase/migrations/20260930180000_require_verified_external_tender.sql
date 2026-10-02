BEGIN;

ALTER TABLE public.payment_verifications
  DROP CONSTRAINT IF EXISTS payment_verifications_method_check;

ALTER TABLE public.payment_verifications
  ADD CONSTRAINT payment_verifications_method_check
  CHECK (method IN ('TRANSFER', 'QR', 'CARD', 'MIXED'));

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
    AND pv.sale_id = NEW.id
    AND pv.payment_id = 'sale-payment-' || NEW.id
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

DROP TRIGGER IF EXISTS sales_require_verified_external_tender ON public.sales;
CREATE TRIGGER sales_require_verified_external_tender
  BEFORE INSERT OR UPDATE OF data ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.require_verified_external_tender_on_paid_sale();

COMMENT ON FUNCTION public.require_verified_external_tender_on_paid_sale() IS
  'Prevents a client-supplied reference or EXTERNAL_TERMINAL assertion from marking CARD/TRANSFER/QR/MIXED sales PAID. Trusted provider evidence must be persisted in payment_verifications first.';

COMMIT;
