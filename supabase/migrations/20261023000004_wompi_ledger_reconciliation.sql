-- ============================================================================
-- VIMDY — Wompi Refund Ledger Reconciliation
-- Fecha: 2026-10-07
--
-- Propósito:
--   Cuando el servidor confirme que Wompi aprobó un refund, la escritura
--   PENDING -> CONFIRMED en payment_refunds debe producir exactamente una
--   conciliación financiera local, aun cuando la respuesta del proveedor
--   llegue después de una caída de red.
--
-- Importante:
--   PostgreSQL no puede descubrir por sí solo que Wompi aprobó un refund:
--   ese hecho ocurre fuera de la base. La Edge Function es quien consulta
--   Wompi y cambia payment_refunds a CONFIRMED. Esta migration convierte ese
--   cambio local en un settlement atómico e idempotente.
--
-- El dinero de un refund externo NO sale físicamente del cajón. Por eso el
-- movimiento se registra como OUT para el resultado financiero, pero con
-- cashAmount = 0.00 para no reducir dos veces el efectivo del arqueo.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Campos durables de trazabilidad del proveedor.
-- ---------------------------------------------------------------------------

ALTER TABLE public.payment_refunds
  ADD COLUMN IF NOT EXISTS provider_transaction_id text;

CREATE INDEX IF NOT EXISTS payment_refunds_provider_transaction_idx
  ON public.payment_refunds (business_id, provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Función central de conciliación de un refund Wompi CONFIRMED.
--
-- Esta función NO hace HTTP. Recibe un estado confirmado por la Edge Function
-- después de haber consultado la API oficial de Wompi.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconcile_wompi_payment_refund_atomic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_refund public.payment_refunds%ROWTYPE;
  v_session public.payment_sessions%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_total_refunded numeric := 0;
  v_session_amount numeric := 0;
  v_sale_status text;
  v_shift_id text;
  v_cash_register_id uuid;
  v_payment_method text;
  v_cash_movement_id text;
  v_ledger_key text;
  v_existing_ledger public.cash_movements%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Solo se procesa la transición real PENDING -> CONFIRMED de Wompi.
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.provider <> 'wompi' THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' OR NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  IF NEW.provider_reference IS NULL
     OR btrim(NEW.provider_reference) = '' THEN
    RAISE EXCEPTION 'WOMPI_REFUND_PROVIDER_REFERENCE_REQUIRED';
  END IF;

  IF NEW.provider_transaction_id IS NULL
     OR btrim(NEW.provider_transaction_id) = '' THEN
    RAISE EXCEPTION 'WOMPI_REFUND_TRANSACTION_ID_REQUIRED';
  END IF;

  -- Lock del refund. Protege contra dos procesos intentando conciliar el mismo
  -- registro de manera simultánea.
  SELECT refund.*
  INTO v_refund
  FROM public.payment_refunds AS refund
  WHERE refund.id = NEW.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOMPI_REFUND_NOT_FOUND';
  END IF;

  -- La session es la fuente de verdad del importe externo.
  IF v_refund.session_id IS NULL THEN
    RAISE EXCEPTION 'WOMPI_REFUND_SESSION_REQUIRED';
  END IF;

  SELECT session.*
  INTO v_session
  FROM public.payment_sessions AS session
  WHERE session.id = v_refund.session_id
    AND session.business_id = v_refund.business_id
    AND session.provider = 'wompi'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOMPI_REFUND_SESSION_NOT_FOUND';
  END IF;

  IF v_session.sale_id IS NULL THEN
    RAISE EXCEPTION 'WOMPI_REFUND_SALE_REQUIRED';
  END IF;

  v_session_amount := COALESCE(v_session.amount, 0);

  IF v_session_amount <= 0 THEN
    RAISE EXCEPTION 'WOMPI_REFUND_SESSION_AMOUNT_INVALID';
  END IF;

  -- La suma incluye todos los confirmados salvo el propio refund, para que
  -- el nuevo monto pueda sumarse de forma determinista sin duplicarlo.
  SELECT COALESCE(SUM(r.amount), 0)
  INTO v_total_refunded
  FROM public.payment_refunds AS r
  WHERE r.session_id = v_session.id
    AND r.status = 'confirmed'
    AND r.id <> v_refund.id;

  v_total_refunded := v_total_refunded + v_refund.amount;

  IF v_total_refunded > v_session_amount + 0.005 THEN
    RAISE EXCEPTION 'WOMPI_REFUND_AMOUNT_EXCEEDS_SESSION';
  END IF;

  -- Lock de la venta antes de cambiar su estado.
  SELECT sale.*
  INTO v_sale
  FROM public.sales AS sale
  WHERE sale.id = v_session.sale_id
    AND sale.business_id = v_refund.business_id
    AND (
      sale.branch_id IS NULL
      OR v_refund.branch_id IS NULL
      OR sale.branch_id = v_refund.branch_id
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOMPI_REFUND_SALE_NOT_FOUND';
  END IF;

  -- Determina el estado final de la session/venta. En MIXED existe una parte
  -- de efectivo todavía pagada, por lo que la venta nunca se marca como
  -- completamente REFUNDED solo porque se devolvió toda la parte externa.
  IF v_total_refunded >= v_session_amount - 0.005 THEN
    IF COALESCE(v_session.cash_amount, 0) > 0 THEN
      v_sale_status := 'PARTIALLY_REFUNDED';
    ELSE
      v_sale_status := 'REFUNDED';
    END IF;

    UPDATE public.payment_sessions
    SET status = 'refunded',
        updated_at = v_now
    WHERE id = v_session.id;
  ELSE
    v_sale_status := 'PARTIALLY_REFUNDED';

    UPDATE public.payment_sessions
    SET status = 'partially_refunded',
        updated_at = v_now
    WHERE id = v_session.id;
  END IF;

  -- Actualiza el campo nuevo en la misma transición. El trigger recibe NEW,
  -- por eso no genera otro UPDATE de status y no entra en recursion.
  UPDATE public.payment_refunds
  SET provider_transaction_id = NEW.provider_transaction_id,
      metadata = COALESCE(NEW.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'ledgerReconciledAt', v_now,
          'ledgerReconciled', true
        ),
      confirmed_at = COALESCE(NEW.confirmed_at, v_now),
      updated_at = v_now
  WHERE id = NEW.id;

  -- La venta se actualiza sin pisar la información comercial existente.
  UPDATE public.sales
  SET data = v_sale.data
      || jsonb_build_object(
        'status', v_sale_status,
        'updatedAt', v_now,
        'lastExternalRefundId', v_refund.id::text,
        'lastExternalRefundAmount', v_refund.amount,
        'lastExternalRefundProvider', 'wompi',
        'lastExternalRefundProviderTransactionId', NEW.provider_transaction_id,
        'lastExternalRefundProviderRefundId', NEW.provider_reference
      ),
      version = v_sale.version + 1,
      updated_at = v_now
  WHERE id = v_sale.id
    AND version = v_sale.version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOMPI_REFUND_SALE_UPDATE_CONFLICT';
  END IF;

  -- -------------------------------------------------------------------------
  -- Ledger de caja:
  --
  -- Para un reembolso externo:
  --   amount     = monto económico revertido.
  --   cashAmount = 0 porque Wompi devuelve el dinero al medio electrónico,
  --                no extrae efectivo del cajón.
  --
  -- El movimiento sigue perteneciendo a un shift/register para que quede
  -- trazable en arqueos y reportes. Se usa primero la metadata de la session,
  -- luego la venta y finalmente un turno abierto como fallback seguro.
  -- -------------------------------------------------------------------------

  v_shift_id := NULLIF(
    COALESCE(
      v_session.metadata->>'posShiftId',
      v_sale.data->>'shiftId'
    ),
    ''
  );

  v_cash_register_id := NULLIF(
    COALESCE(
      v_session.metadata->>'posCashRegisterId',
      v_sale.data->>'cashRegisterId'
    ),
    ''
  )::uuid;

  IF v_shift_id IS NULL THEN
    SELECT s.id::text
    INTO v_shift_id
    FROM public.shifts AS s
    WHERE s.business_id = v_refund.business_id
      AND s.branch_id = v_refund.branch_id
      AND s.data->>'status' = 'OPEN'
    ORDER BY s.data->>'openedAt' ASC, s.id ASC
    LIMIT 1
    FOR UPDATE;
  ELSE
    PERFORM 1
    FROM public.shifts AS s
    WHERE s.id::text = v_shift_id
      AND s.business_id = v_refund.business_id
      AND s.branch_id = v_refund.branch_id
    FOR UPDATE;
  END IF;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'WOMPI_REFUND_SHIFT_REQUIRED';
  END IF;

  IF v_cash_register_id IS NULL THEN
    SELECT s.cash_register_id
    INTO v_cash_register_id
    FROM public.shifts AS s
    WHERE s.id::text = v_shift_id
      AND s.business_id = v_refund.business_id
      AND s.branch_id = v_refund.branch_id;
  END IF;

  IF v_cash_register_id IS NULL THEN
    RAISE EXCEPTION 'WOMPI_REFUND_CASH_REGISTER_REQUIRED';
  END IF;

  v_payment_method := upper(COALESCE(v_session.payment_method, 'CARD'));
  v_ledger_key := 'pos-refund-ledger-' || v_refund.id::text;

  SELECT cm.*
  INTO v_existing_ledger
  FROM public.cash_movements AS cm
  WHERE cm.business_id = v_refund.business_id
    AND cm.branch_id = v_refund.branch_id
    AND cm.idempotency_key = v_ledger_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_ledger.data->>'refundId' IS DISTINCT FROM v_refund.id::text THEN
      RAISE EXCEPTION 'WOMPI_REFUND_LEDGER_KEY_REUSED';
    END IF;
  ELSE
    INSERT INTO public.cash_movements (
      id,
      idempotency_key,
      business_id,
      branch_id,
      cash_register_id,
      shift_id,
      data
    )
    VALUES (
      gen_random_uuid(),
      v_ledger_key,
      v_refund.business_id,
      v_refund.branch_id,
      v_cash_register_id,
      v_shift_id,
      jsonb_build_object(
        'id', v_ledger_key,
        'idempotencyKey', v_ledger_key,
        'type', 'OUT',
        'amount', v_refund.amount,
        'cashAmount', 0,
        'paymentMethod', v_payment_method,
        'paymentVerificationSource', 'PROVIDER',
        'description', 'Reembolso Wompi venta POS ' || COALESCE(v_sale.data->>'code', v_sale.id::text),
        'saleId', v_sale.id::text,
        'refundId', v_refund.id::text,
        'provider', 'wompi',
        'providerTransactionId', NEW.provider_transaction_id,
        'providerRefundId', NEW.provider_reference,
        'shiftId', v_shift_id,
        'cashRegisterId', v_cash_register_id::text,
        'date', v_now,
        'createdAt', v_now,
        'businessId', v_refund.business_id::text,
        'branchId', v_refund.branch_id::text
      )
    )
    ON CONFLICT (business_id, branch_id, idempotency_key)
    DO NOTHING
    RETURNING id::text INTO v_cash_movement_id;

    IF v_cash_movement_id IS NULL THEN
      SELECT cm.id::text
      INTO v_cash_movement_id
      FROM public.cash_movements AS cm
      WHERE cm.business_id = v_refund.business_id
        AND cm.branch_id = v_refund.branch_id
        AND cm.idempotency_key = v_ledger_key
      FOR UPDATE;
    END IF;
  END IF;

  INSERT INTO public.subscription_audit_log (
    business_id,
    action,
    actor_type,
    actor_id,
    details
  )
  VALUES (
    v_refund.business_id,
    'POS_WOMPI_REFUND_RECONCILED',
    'payment_provider',
    v_refund.actor_id,
    jsonb_build_object(
      'refundId', v_refund.id::text,
      'saleId', v_sale.id::text,
      'sessionId', v_session.id::text,
      'amount', v_refund.amount,
      'currency', v_refund.currency,
      'providerTransactionId', NEW.provider_transaction_id,
      'providerRefundId', NEW.provider_reference,
      'sessionStatus', CASE
        WHEN v_total_refunded >= v_session_amount - 0.005
          THEN 'refunded'
        ELSE 'partially_refunded'
      END,
      'saleStatus', v_sale_status,
      'cashAmountImpact', 0,
      'cashLedgerId', v_ledger_key,
      'reconciledAt', v_now
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_wompi_payment_refund_atomic() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Trigger de reconciliación.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS payment_refunds_wompi_reconciliation ON public.payment_refunds;

CREATE TRIGGER payment_refunds_wompi_reconciliation
AFTER UPDATE OF status, provider_reference, metadata, confirmed_at
ON public.payment_refunds
FOR EACH ROW
WHEN (
  NEW.provider = 'wompi'
  AND OLD.status = 'pending'
  AND NEW.status = 'confirmed'
)
EXECUTE FUNCTION public.reconcile_wompi_payment_refund_atomic();

-- ---------------------------------------------------------------------------
-- 4. Helper explícito para una reconciliación server-side segura.
--
-- La Edge Function puede usar esta función en lugar de depender directamente
-- del trigger si necesita un resultado JSON inmediatamente. El trigger sigue
-- siendo la barrera idempotente final para cualquier escritura CONFIRMED.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconcile_wompi_refund_atomic(
  p_refund_id uuid,
  p_provider_transaction_id text,
  p_provider_refund_id text,
  p_provider_metadata jsonb DEFAULT '{}'::jsonb,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_refund public.payment_refunds%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'WOMPI_REFUND_RECONCILIATION_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(p_provider_transaction_id), '') IS NULL THEN
    RAISE EXCEPTION 'WOMPI_REFUND_TRANSACTION_ID_REQUIRED';
  END IF;

  IF NULLIF(btrim(p_provider_refund_id), '') IS NULL THEN
    RAISE EXCEPTION 'WOMPI_REFUND_PROVIDER_REF_REQUIRED';
  END IF;

  SELECT r.*
  INTO v_refund
  FROM public.payment_refunds AS r
  WHERE r.id = p_refund_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOMPI_REFUND_NOT_FOUND';
  END IF;

  IF v_refund.provider <> 'wompi' THEN
    RAISE EXCEPTION 'WOMPI_REFUND_PROVIDER_MISMATCH';
  END IF;

  IF v_refund.status = 'confirmed' THEN
    IF v_refund.provider_reference = p_provider_refund_id
       AND v_refund.provider_transaction_id = p_provider_transaction_id THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'status', 'confirmed',
        'refundId', v_refund.id::text
      );
    END IF;

    RAISE EXCEPTION 'WOMPI_REFUND_ALREADY_RECONCILED';
  END IF;

  IF v_refund.status <> 'pending' THEN
    RAISE EXCEPTION 'WOMPI_REFUND_STATE_INVALID';
  END IF;

  UPDATE public.payment_refunds
  SET status = 'confirmed',
      provider_reference = btrim(p_provider_refund_id),
      provider_transaction_id = btrim(p_provider_transaction_id),
      metadata = COALESCE(metadata, '{}'::jsonb)
        || COALESCE(p_provider_metadata, '{}'::jsonb),
      confirmed_at = p_now,
      updated_at = p_now
  WHERE id = p_refund_id
    AND status = 'pending';

  SELECT r.*
  INTO v_refund
  FROM public.payment_refunds AS r
  WHERE r.id = p_refund_id;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'status', v_refund.status,
    'refundId', v_refund.id::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_wompi_refund_atomic(uuid,text,text,jsonb,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_wompi_refund_atomic(uuid,text,text,jsonb,timestamptz) TO service_role;

COMMIT;
