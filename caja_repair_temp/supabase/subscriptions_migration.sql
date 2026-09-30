-- ============================================================================
-- VIMDY — FASE 7: Sistema de suscripciones (migración)
-- ----------------------------------------------------------------------------
-- Cómo usarlo: pega TODO este archivo en el "SQL Editor" de Supabase y dale
-- "Run". Es seguro correrlo varias veces (usa IF NOT EXISTS / OR REPLACE).
--
-- `businesses` ya tenía `plan` ('trial' | 'monthly' | 'yearly') y
-- `trial_ends_at` desde el registro (ver register-business). Esta migración
-- agrega lo que falta para PASO 7 (preparar Wompi) y PASO 8 (Configuración
-- > Suscripción > Historial de pagos), sin tocar lo que ya funciona.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columnas nuevas en `businesses` para el ciclo de cobro.
--    `plan` sigue siendo la fuente de verdad de qué contrató el negocio
--    ('trial' | 'monthly' | 'yearly'). El estado "Suspendido" (🔴) NO se
--    guarda aquí: se calcula en el cliente (ver SubscriptionEngine.ts) a
--    partir de trial_ends_at/renewal_date/payment_status, para que nunca
--    quede desincronizado de la fecha real.
-- ----------------------------------------------------------------------------
alter table businesses add column if not exists renewal_date timestamptz;
alter table businesses add column if not exists next_charge_at timestamptz;
-- 'wompi_card' | 'wompi_pse' | 'wompi_nequi' | null (sin método todavía)
alter table businesses add column if not exists payment_method text;
-- 'none' | 'pending' | 'approved' | 'declined' | 'past_due'
alter table businesses add column if not exists payment_status text not null default 'none';

-- ----------------------------------------------------------------------------
-- 2. Historial de pagos — PASO 8 (Configuración > Suscripción). Vacía hasta
--    que Wompi esté aprobado; el webhook de Wompi (futuro) insertará una
--    fila aquí por cada cobro exitoso o fallido, y esta misma tabla es lo
--    que ya alimenta el "Historial de pagos" en Configuración.
-- ----------------------------------------------------------------------------
create table if not exists subscription_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  plan text not null,                 -- 'monthly' | 'yearly'
  amount numeric not null,
  currency text not null default 'COP',
  status text not null,               -- 'approved' | 'declined' | 'pending'
  payment_method text,                -- 'wompi_card' | 'wompi_pse' | 'wompi_nequi'
  -- Referencia de la transacción en Wompi (external reference / transaction id).
  -- Null hasta que exista una transacción real.
  wompi_reference text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists subscription_payments_business_id_idx
  on subscription_payments (business_id);

alter table subscription_payments enable row level security;

drop policy if exists subscription_payments_tenant_isolation on subscription_payments;
create policy subscription_payments_tenant_isolation on subscription_payments
  for select
  using (business_id in (select auth_business_ids()));

-- Solo el servidor (Edge Function del webhook de Wompi, futuro) inserta
-- pagos — el cliente nunca escribe su propio historial de pagos.
grant all on subscription_payments to service_role;
grant select on subscription_payments to authenticated;

-- ============================================================================
-- Listo. `businesses` queda con todo lo que PASO 7 pide (estado del plan,
-- tipo de plan, fecha de renovación, próximo cobro, método de pago, estado
-- del pago) y `subscription_payments` queda lista para que el webhook de
-- Wompi solo tenga que hacer un INSERT + UPDATE de businesses el día que la
-- cuenta sea aprobada. Ningún dato de negocio (ventas, inventario, clientes)
-- se toca ni se borra por esta migración.
-- ============================================================================