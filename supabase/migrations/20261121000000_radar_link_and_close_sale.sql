-- =============================================================================
-- 20261121000000_radar_link_and_close_sale.sql
-- Radar Antifraude -> "Vincular y Cerrar Venta" (una sola transacción).
--
-- PROBLEMA
--   register_sale_payment_atomic() rechaza TRANSFER/QR si no existe una fila
--   CONFIRMED en payment_verifications (CAJA_PAYMENT_NOT_VERIFIED), y esa tabla
--   solo la escribe el servidor. El botón del Radar fijaba method='transfer' +
--   una referencia desde el navegador, así que la venta quedaba
--   PENDING_VERIFICATION y nunca se cerraba.
--
-- SOLUCIÓN
--   link_incoming_payment_and_close_sale() hace TODO en una transacción:
--     1. valida usuario, rol (ADMIN/GERENTE/CAJERO) y alcance de sucursal;
--     2. bloquea el pago del radar (FOR UPDATE) y exige status='pending';
--     3. bloquea la venta y exige MONTO EXACTO (pago = total de la venta);
--     4. crea la verificación CONFIRMED a partir del pago del radar (que solo
--        pudo insertar el backend con service_role);
--     5. llama register_sale_payment_atomic (caja + venta PAID, mismas reglas);
--     6. marca el pago como 'linked' con linked_sale_id.
--   Si cualquier paso falla, no queda nada a medias: el pago sigue 'pending'.
--   Un mismo pago jamás puede cerrar dos ventas (bloqueo + estado).
--
-- El inventario NO se toca aquí: create_sale_fulfillment_atomic ya lo descontó
-- (y mandó la comanda a cocina) al crear la venta. Descontarlo de nuevo
-- duplicaría el consumo.
--
-- Mismo patrón y mismos nombres de parámetros que register_sale_payment_atomic
-- para que el cliente solo cambie el nombre de la RPC. Idempotente.
-- =============================================================================

BEGIN;

-- 1) Columnas para distinguir transferencia bancaria vs Wompi y deduplicar webhooks.
ALTER TABLE public.incoming_payments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'transfer',
  ADD COLUMN IF NOT EXISTS provider_reference text;

ALTER TABLE public.incoming_payments
  DROP CONSTRAINT IF EXISTS incoming_payments_source_ck;
ALTER TABLE public.incoming_payments
  ADD CONSTRAINT incoming_payments_source_ck CHECK (source IN ('transfer', 'wompi'));

-- Un mismo evento del proveedor no puede entrar dos veces (reintentos de webhook).
CREATE UNIQUE INDEX IF NOT EXISTS incoming_payments_provider_ref_uidx
  ON public.incoming_payments (business_id, source, provider_reference)
  WHERE provider_reference IS NOT NULL;

-- 2) Endurecer RLS: desde el navegador solo se puede IGNORAR un pago.
--    "Vincular" ocurre únicamente por la RPC (SECURITY DEFINER).
DROP POLICY IF EXISTS incoming_payments_tenant_resolve ON public.incoming_payments;
CREATE POLICY incoming_payments_tenant_resolve ON public.incoming_payments
  FOR UPDATE
  USING (business_id IN (SELECT auth_business_ids()) AND status = 'pending')
  WITH CHECK (
    business_id IN (SELECT auth_business_ids())
    AND status = 'ignored'
    AND linked_sale_id IS NULL
  );

-- 3) RPC principal.
CREATE OR REPLACE FUNCTION public.link_incoming_payment_and_close_sale(
  p_incoming_payment_id uuid,
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
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_ip            public.incoming_payments%ROWTYPE;
  v_sale_total    numeric;
  v_sale_status   text;
  v_reference     text;
  -- Un pago del radar más viejo que esto no puede cerrar una venta nueva
  -- (evita reciclar una transferencia vieja que quedó pendiente).
  v_max_age       interval := interval '2 hours';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'RADAR_AUTH_REQUIRED'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = p_business_id AND bm.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'RADAR_NOT_A_MEMBER'; END IF;

  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','GERENTE','CAJERO']) THEN
    RAISE EXCEPTION 'RADAR_FORBIDDEN';
  END IF;

  IF NOT (p_branch_id = ANY (public.auth_branch_ids())) THEN
    RAISE EXCEPTION 'RADAR_BRANCH_FORBIDDEN';
  END IF;

  IF p_payment_method IS DISTINCT FROM 'TRANSFER' THEN
    RAISE EXCEPTION 'RADAR_METHOD_NOT_SUPPORTED';
  END IF;

  -- Pago del radar: bloqueado hasta el final de la transacción.
  SELECT ip.* INTO v_ip
  FROM public.incoming_payments ip
  WHERE ip.id = p_incoming_payment_id
    AND ip.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'RADAR_PAYMENT_NOT_FOUND'; END IF;
  IF v_ip.status <> 'pending' THEN RAISE EXCEPTION 'RADAR_PAYMENT_ALREADY_USED'; END IF;
  IF v_ip.created_at < clock_timestamp() - v_max_age THEN
    RAISE EXCEPTION 'RADAR_PAYMENT_EXPIRED';
  END IF;

  -- Venta: bloqueada, de la misma sucursal y aún por cobrar.
  SELECT (s.data->>'total')::numeric, s.data->>'status'
    INTO v_sale_total, v_sale_status
  FROM public.sales s
  WHERE s.id = p_sale_id::uuid
    AND s.business_id = p_business_id
    AND s.branch_id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;
  IF v_sale_status NOT IN ('PENDING_PAYMENT', 'OPEN') THEN
    RAISE EXCEPTION 'SALE_INVALID_STATE';
  END IF;

  -- MONTO EXACTO: ni menos (venta sin cubrir) ni más (excedente sin devolver).
  IF abs(v_ip.amount - v_sale_total) > 0.005 THEN
    RAISE EXCEPTION 'RADAR_AMOUNT_MISMATCH'
      USING DETAIL = format('transferencia %s, venta %s', v_ip.amount, v_sale_total);
  END IF;
  IF abs(p_total - v_sale_total) > 0.005 THEN
    RAISE EXCEPTION 'CAJA_SALE_TOTAL_MISMATCH';
  END IF;

  v_reference := 'radar-' || v_ip.id::text;

  -- Verificación CONFIRMED derivada del pago del radar (solo existe porque el
  -- backend con service_role lo insertó; el navegador no puede fabricarlo).
  INSERT INTO public.payment_verifications AS pv (
    business_id, branch_id, sale_id, payment_id, method, amount,
    provider, provider_reference, status, verified_at, metadata
  ) VALUES (
    p_business_id, p_branch_id, p_sale_id, p_payment_id, 'TRANSFER', v_sale_total,
    'radar-' || v_ip.source, v_reference, 'CONFIRMED', clock_timestamp(),
    jsonb_build_object(
      'incomingPaymentId', v_ip.id,
      'bank',              v_ip.bank_name,
      'sender',            v_ip.sender_name,
      'source',            v_ip.source,
      'linkedBy',          auth.uid()
    )
  )
  ON CONFLICT (business_id, branch_id, payment_id) DO UPDATE
    SET status = 'CONFIRMED',
        amount = EXCLUDED.amount,
        provider = EXCLUDED.provider,
        provider_reference = EXCLUDED.provider_reference,
        verified_at = EXCLUDED.verified_at,
        metadata = pv.metadata || EXCLUDED.metadata
    WHERE pv.status IN ('PENDING', 'REJECTED', 'EXPIRED');

  -- Reclamar el pago ANTES de cobrar: si el cobro falla, todo se revierte.
  UPDATE public.incoming_payments ip
     SET status = 'linked',
         linked_sale_id = p_sale_id,
         resolved_by = auth.uid(),
         resolved_at = clock_timestamp()
   WHERE ip.id = v_ip.id AND ip.status = 'pending';

  -- Caja + venta PAID con TODAS las reglas existentes (turno, sucursal,
  -- idempotencia, verificación, referencia).
  RETURN QUERY
  SELECT * FROM public.register_sale_payment_atomic(
    p_sale_id             => p_sale_id,
    p_business_id         => p_business_id,
    p_branch_id           => p_branch_id,
    p_payment_id          => p_payment_id,
    p_change_id           => NULL,
    p_payment_method      => 'TRANSFER',
    p_total               => v_sale_total,
    p_cash_amount         => 0,
    p_received            => v_sale_total,
    p_change              => 0,
    p_reference           => v_reference,
    p_cash_register_id    => p_cash_register_id,
    p_verification_source => 'PROVIDER',
    p_shift_id            => p_shift_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_incoming_payment_and_close_sale(
  uuid, text, uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, text, uuid, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_incoming_payment_and_close_sale(
  uuid, text, uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, text, uuid, text, uuid
) TO authenticated;

COMMIT;