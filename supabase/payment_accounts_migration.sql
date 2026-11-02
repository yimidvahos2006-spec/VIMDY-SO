-- ============================================================================
-- VIMDY OS — Migración: Cuentas de cobro y QR por negocio (v2: Wompi + etiquetas)
-- ----------------------------------------------------------------------------
-- Cómo usarlo:
--   1. Supabase -> "SQL Editor" -> New query.
--   2. Pega TODO este archivo y dale "Run".
--   3. Sirve tanto si ya corriste la versión anterior como si es la primera
--      vez: es idempotente (puedes correrlo las veces que quieras).
--
-- Qué hace:
--   * Crea business_payment_accounts si no existe.
--   * Agrega Wompi a las plataformas permitidas (Nequi, Bancolombia,
--     Daviplata, Bre-B, Wompi).
--   * Agrega la columna `label` (ej. "Caja 1", "Barra") para distinguir
--     varias cuentas de la misma plataforma.
--   * Varias cuentas de la misma plataforma SÍ están permitidas; lo único
--     que no se permite es repetir exactamente la misma (plataforma + número).
--   * RLS por negocio: todos los miembros ven las cuentas; solo el ADMIN
--     crea, activa/desactiva o elimina.
-- ============================================================================

create table if not exists business_payment_accounts (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  bank_name        text not null,
  account_number   text not null check (length(trim(account_number)) between 3 and 40),
  holder_name      text,
  label            text,
  -- true = QR universal / multi-cuenta (ej. Bre-B); false = cuenta o QR único.
  is_universal_qr  boolean not null default false,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Para tablas creadas con la versión anterior.
alter table business_payment_accounts add column if not exists label text;

-- Lista de plataformas permitidas (ahora incluye Wompi).
alter table business_payment_accounts
  drop constraint if exists business_payment_accounts_bank_name_check;
alter table business_payment_accounts
  add constraint business_payment_accounts_bank_name_check
  check (bank_name in ('Nequi', 'Bancolombia', 'Daviplata', 'Bre-B', 'Wompi'));

alter table business_payment_accounts
  drop constraint if exists business_payment_accounts_label_length_check;
alter table business_payment_accounts
  add constraint business_payment_accounts_label_length_check
  check (label is null or length(label) <= 40);

-- No se repite la misma cuenta, pero sí puede haber varias por plataforma.
create unique index if not exists business_payment_accounts_unique
  on business_payment_accounts (business_id, bank_name, account_number);

create index if not exists business_payment_accounts_business_idx
  on business_payment_accounts (business_id);

alter table business_payment_accounts enable row level security;

drop policy if exists business_payment_accounts_read on business_payment_accounts;
create policy business_payment_accounts_read on business_payment_accounts
  for select
  using (business_id in (select auth_business_ids()));

drop policy if exists business_payment_accounts_admin_write on business_payment_accounts;
create policy business_payment_accounts_admin_write on business_payment_accounts
  for all
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
  )
  with check (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
  );

revoke all on business_payment_accounts from anon;
grant select, insert, update, delete on business_payment_accounts to authenticated;

-- Verificación 1: debe listar las 5 plataformas dentro de la condición.
select pg_get_constraintdef(oid) as plataformas_permitidas
from pg_constraint
where conname = 'business_payment_accounts_bank_name_check';

-- Verificación 2: debe devolver 2 filas (las dos políticas).
select policyname from pg_policies
where tablename = 'business_payment_accounts'
order by policyname;