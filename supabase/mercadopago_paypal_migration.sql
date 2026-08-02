-- ============================================================================
-- VIMDY — Mercado Pago + PayPal: columnas de conciliación en subscription_payments
-- ----------------------------------------------------------------------------
-- Cómo usarlo: pega TODO este archivo en el "SQL Editor" de Supabase y dale
-- "Run". Seguro de correr varias veces (IF NOT EXISTS).
--
-- subscriptions_migration.sql ya creó `subscription_payments` con
-- `wompi_reference` (única referencia que existía porque solo había un
-- proveedor). Cada proveedor nuevo necesita SU PROPIA columna de referencia
-- porque el formato de id es distinto en cada uno (Wompi: `reference` de
-- texto libre; Mercado Pago: `external_reference` de la preferencia; PayPal:
-- `id` de la orden) y los tres deben poder coexistir en la misma tabla sin
-- pisarse.
-- ============================================================================

alter table subscription_payments add column if not exists mercadopago_reference text;
alter table subscription_payments add column if not exists paypal_order_id text;

create index if not exists subscription_payments_mercadopago_reference_idx
  on subscription_payments (mercadopago_reference);

create index if not exists subscription_payments_paypal_order_id_idx
  on subscription_payments (paypal_order_id);

-- `businesses.payment_method` y `subscription_payments.payment_method` seguían
-- el patrón 'wompi_card' | 'wompi_pse' | 'wompi_nequi'. Se documenta acá (no
-- hay CHECK constraint que tocar) el vocabulario nuevo que agregan estas dos
-- integraciones, para que quede en un solo lugar:
--   'mercadopago_wallet' | 'mercadopago_card' | 'mercadopago_bank_transfer'
--   'paypal'
-- Ver PaymentMethod en src/core/entities/SubscriptionTypes.ts (ya actualizado).