-- ============================================================================
-- VIMDY Total: la edición que se contrata queda guardada en el pago y en el negocio
-- ----------------------------------------------------------------------------
-- Hasta hoy el cobro solo sabía "mensual/anual" y (en la tabla del negocio) un
-- nivel de sedes que nada escribía al pagar. Esta migración agrega:
--
--   1) businesses.plan_edition          'operativo' | 'total'   (solo lectura para el cliente)
--   2) subscription_payments.edition    lo que se quiso comprar en ese pago
--   3) subscription_payments.tier       'single' | 'multi' en ese pago
--   4) activate_subscription_server_side ahora copia edición y nivel del PAGO
--      aprobado al negocio (businesses.plan_edition / plan_tier). Lo demás de la
--      función queda igual: lock por negocio, idempotencia, protección contra pagos
--      viejos (obsolete_payment), mark_trial_used y auditoría.
--
-- La edición y el nivel salen del pago que creó el servidor (wompi-create-checkout),
-- nunca del navegador. Lo que el negocio paga es lo que recibe: un pago de Mercado
-- Pago/PayPal (solo Plan Operativo de 1 sede) deja plan_edition='operativo'.
--
-- Cambio aditivo e idempotente: se puede correr más de una vez.
-- Los negocios y pagos que ya existen quedan como 'operativo' / 'single'.
--
-- ORDEN DE APLICACIÓN: primero este SQL, después desplegar wompi-create-checkout.
-- ============================================================================
BEGIN;

-- 1) Edición contratada del negocio -----------------------------------------
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS plan_edition text NOT NULL DEFAULT 'operativo';

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_plan_edition_valid;
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_plan_edition_valid CHECK (plan_edition IN ('operativo', 'total'));

-- Igual que plan_tier: el cliente la puede LEER pero no escribir.
GRANT SELECT (plan_edition) ON public.businesses TO authenticated;

-- 2) y 3) Edición y nivel dentro de cada pago --------------------------------
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS edition text NOT NULL DEFAULT 'operativo';

ALTER TABLE public.subscription_payments
  DROP CONSTRAINT IF EXISTS subscription_payments_edition_valid;
ALTER TABLE public.subscription_payments
  ADD CONSTRAINT subscription_payments_edition_valid CHECK (edition IN ('operativo', 'total'));

ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'single';

ALTER TABLE public.subscription_payments
  DROP CONSTRAINT IF EXISTS subscription_payments_tier_valid;
ALTER TABLE public.subscription_payments
  ADD CONSTRAINT subscription_payments_tier_valid CHECK (tier IN ('single', 'multi'));

-- 4) Activación: copia edición y nivel del pago aprobado al negocio ------------
-- (Mismos permisos de antes: CREATE OR REPLACE conserva los GRANT/REVOKE de
--  20261025000003, es decir, solo service_role puede ejecutarla.)
CREATE OR REPLACE FUNCTION public.activate_subscription_server_side(
  p_business_id uuid,
  p_plan text,
  p_payment_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lock_key bigint;
  v_payment record;
  v_period_days integer;
  v_renewal_date timestamptz;
  v_next_charge_at timestamptz;
  v_edition text;
  v_tier text;
  v_result jsonb;
  v_audit_id uuid;
BEGIN
  IF p_plan NOT IN ('monthly', 'yearly') THEN
    RAISE EXCEPTION 'Plan inválido: %', p_plan;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN']) THEN
      RAISE EXCEPTION 'FORBIDDEN: solo un administrador puede activar suscripciones.';
    END IF;
  END IF;

  -- Lock a nivel de transacción: serializa activaciones simultáneas del mismo negocio.
  v_lock_key := pg_catalog.hashtextextended('subscription-activation:' || p_business_id::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_payment
  FROM public.subscription_payments
  WHERE id = p_payment_id
    AND business_id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pago no encontrado: %', p_payment_id;
  END IF;

  IF v_payment.status = 'approved' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_activated', true,
      'renewal_number', v_payment.renewal_number
    );
  END IF;

  IF v_payment.status = 'declined' THEN
    RAISE EXCEPTION 'El pago % ya fue declinado. No se puede activar.', p_payment_id;
  END IF;

  v_edition := COALESCE(v_payment.edition, 'operativo');
  v_tier := COALESCE(v_payment.tier, 'single');

  v_period_days := public.get_plan_period_days(p_plan);
  IF v_payment.paid_at IS NOT NULL THEN
    v_renewal_date := (v_payment.paid_at + (v_period_days || ' days')::interval);
  ELSE
    v_renewal_date := (p_now + (v_period_days || ' days')::interval);
  END IF;
  v_next_charge_at := v_renewal_date;

  IF EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = p_business_id
      AND renewal_date > v_renewal_date
  ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_activated', true,
      'renewal_number', v_payment.renewal_number,
      'reason', 'obsolete_payment'
    );
  END IF;

  UPDATE public.businesses
  SET
    plan = p_plan,
    plan_edition = v_edition,
    plan_tier = v_tier,
    renewal_date = v_renewal_date,
    next_charge_at = v_next_charge_at,
    payment_status = 'approved',
    subscription_status = p_plan
  WHERE id = p_business_id;

  UPDATE public.subscription_payments
  SET
    status = 'approved',
    paid_at = p_now,
    renewal_number = COALESCE(renewal_number, 0) + 1
  WHERE id = p_payment_id;

  -- Primer pago aprobado: la prueba gratuita de 14 días queda marcada como usada
  -- (sirve igual para Plan Operativo y para VIMDY Total).
  IF v_payment.renewal_number IS NULL OR v_payment.renewal_number = 0 THEN
    PERFORM public.mark_trial_used(p_business_id);
  END IF;

  INSERT INTO public.subscription_audit_log (business_id, action, actor_type, details)
  VALUES (
    p_business_id,
    'SUBSCRIPTION_ACTIVATED',
    'payment_provider',
    jsonb_build_object(
      'plan', p_plan,
      'edition', v_edition,
      'tier', v_tier,
      'payment_id', p_payment_id,
      'renewal_number', COALESCE(v_payment.renewal_number, 0) + 1,
      'renewal_date', to_char(v_renewal_date, 'YYYY-MM-DD HH24:MI:SS')
    )
  )
  RETURNING id INTO v_audit_id;

  v_result := jsonb_build_object(
    'ok', true,
    'already_activated', false,
    'renewal_number', COALESCE(v_payment.renewal_number, 0) + 1,
    'renewal_date', to_char(v_renewal_date, 'YYYY-MM-DD HH24:MI:SS'),
    'audit_id', v_audit_id
  );

  RETURN v_result;
END;
$$;

COMMIT;