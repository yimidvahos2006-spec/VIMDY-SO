-- ============================================================================
-- 20261017000000_step6_revoke_legacy_refund_execute.sql
-- ----------------------------------------------------------------------------
-- Paso 6.9 CP3-B — Cierra el vector de ejecución directa por `authenticated`.
--
-- HALLAZGO (A6.8)
-- ----------------
-- public.refund_subscription_payment_server_side era ejecutable por
-- `authenticated` (y por extension, por cualquier ADMIN de cualquier negocio)
-- sin pasar por la ruta endurecida de refunds. Su cuerpo presenta defectos que
-- A6.8 confirming como REAL_FINANCIAL_RISK / HIGH:
--
--   1. SIN `FOR UPDATE`: dos refunds concurrentes leen el mismo saldo.
--   2. NO acumula `refunded_amount` ni consulta `payment_refunds`.
--   3. SIN `idempotency_key` ni `payload_hash`: nada impide repetir el refund.
--   4. BUG DE ESTADO: calcula `v_new_status` ('declined' / 'approved') pero
--      escribe `status = 'refunded'` INCONDICIONAL. Un refund PARCIAL deja la
--      suscripcion marcada como reembolsada por completo y bloquea refunds
--      posteriores legitimos (el guard `status <> 'approved'` los bloquea).
--      El audit registra `new_payment_status` que nunca se aplica.
--
-- ALCANCE DE ESTA MIGRACION
-- --------------------------
-- NO se elimina la funcion. NO se revoca `service_role`, porque
-- `supabase/functions/wompi-refund-transaction/index.ts:238` sigue llamandola
-- con el cliente admin (service_role). Ese uso queda PENDIENTE de migrar
-- (Wompi esta bloqueado: la API legacy V1 no permite mapear con fiabilidad
-- SUCCESS / REJECT / PENDING, y la doc oficial de Refunds V2 no documenta
-- idempotencia ni lookup para refunds).
--
-- El permiso por defecto ya fue retractado de PUBLIC y anon en Paso 8; aqui se
-- cierra el unico rol que quedaba con EXECUTE desde el navegador.
--
-- La ruta endurecida y unica para solicitar refunds de suscripcion es:
--   request_subscription_refund_atomic  (reserva saldo bajo FOR UPDATE,
--                                        valida tenant/RBAC/estado/ restante,
--                                        idempotency_key + payload_hash)
--   settle_subscription_refund_atomic   (service_role: confirma/rechaza,
--                                        calcula partially_refunded/refunded,
--                                        audita en la misma transaccion)
--
-- Migracion NUEVA: no modifica ninguna migracion historica.
-- ============================================================================

BEGIN;

REVOKE EXECUTE
  ON FUNCTION public.refund_subscription_payment_server_side(
    uuid,
    numeric,
    text,
    timestamptz
  )
  FROM authenticated;

COMMENT ON FUNCTION public.refund_subscription_payment_server_side(uuid, numeric, text, timestamptz) IS
  'Ruta LEGACY de reembolso de suscripcion. STEP6 CP3-B: EXECUTE retirado al rol authenticated para eliminar el vector de refund directo desde el navegador (sin FOR UPDATE, sin idempotency_key, sin payload_hash y con status=''refunded'' incondicional). Se conserva EXECUTE para service_role porque wompi-refund-transaction todavia la usa; esa dependencia esta pendiente de migrar a Refunds V2. El flujo soportado es request_subscription_refund_atomic + settle_subscription_refund_atomic.';

COMMIT;