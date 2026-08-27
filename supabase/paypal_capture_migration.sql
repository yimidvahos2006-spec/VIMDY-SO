-- ============================================================================
-- VIMDY — PayPal: columna para el ID de captura (necesaria para reembolsar)
-- ----------------------------------------------------------------------------
-- Cómo usarlo: pega TODO este archivo en el "SQL Editor" de Supabase y dale
-- "Run". Seguro de correr varias veces (IF NOT EXISTS).
--
-- Por qué hace falta: PayPal identifica un pago por DOS ids distintos.
--   - `paypal_order_id` (ya existía) es el id de la ORDEN — se crea al
--     armar el checkout, antes de que el comprador pague.
--   - `paypal_capture_id` (nuevo, esta migración) es el id de la CAPTURA —
--     solo existe DESPUÉS de que paypal-webhook cobra de verdad la orden.
-- El endpoint de reembolso de PayPal (POST /v2/payments/captures/:id/refund)
-- exige el id de captura, no el de orden — sin esta columna, PayPalProvider
-- nunca podría reembolsar nada.
-- ============================================================================

alter table subscription_payments add column if not exists paypal_capture_id text;

create index if not exists subscription_payments_paypal_capture_id_idx
  on subscription_payments (paypal_capture_id);