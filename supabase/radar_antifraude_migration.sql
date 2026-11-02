-- ============================================================================
-- VIMDY OS — Migración: Radar Antifraude (incoming_payments)
-- ----------------------------------------------------------------------------
-- Cómo usarlo:
--   1. Supabase -> "SQL Editor" -> New query.
--   2. Pega TODO este archivo y dale "Run".
--   3. Es idempotente: puedes correrlo varias veces sin romper nada.
--
-- Qué crea:
--   * Tabla incoming_payments: cada transferencia detectada (Nequi,
--     Bancolombia, Daviplata, Bre-B) que llega desde el lector de
--     notificaciones / webhook.
--   * RLS por negocio (mismo patrón que el resto del proyecto:
--     business_id in (select auth_business_ids())).
--   * Realtime activado (supabase_realtime + REPLICA IDENTITY FULL).
--
-- NOTA sobre "store_id": en VIMDY el identificador del negocio se llama
-- business_id en TODAS las tablas y en realtimeSync.ts, así que esta tabla
-- usa business_id para que RLS y el filtro de Realtime funcionen igual.
--
-- QUIÉN INSERTA: solo el backend (Edge Function / webhook con service_role,
-- que se salta RLS). El navegador NO puede insertar: así nadie puede
-- fabricar una transferencia falsa desde el frontend.
-- ============================================================================

create table if not exists incoming_payments (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  bank_name      text not null,
  amount         numeric(14, 2) not null check (amount > 0),
  sender_name    text,
  raw_message    text,
  created_at     timestamptz not null default now(),

  -- Estado del match con una venta (lo cambia el cajero desde la alerta).
  status         text not null default 'pending'
                 check (status in ('pending', 'linked', 'ignored')),
  linked_sale_id text,
  resolved_by    uuid references auth.users(id),
  resolved_at    timestamptz
);

create index if not exists incoming_payments_business_created_idx
  on incoming_payments (business_id, created_at desc);

create index if not exists incoming_payments_business_pending_idx
  on incoming_payments (business_id, created_at desc)
  where status = 'pending';

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table incoming_payments enable row level security;

drop policy if exists incoming_payments_tenant_read on incoming_payments;
create policy incoming_payments_tenant_read on incoming_payments
  for select
  using (business_id in (select auth_business_ids()));

-- El cajero solo puede cambiar el estado (vincular / ignorar) de pagos de su
-- negocio. Un pago ya resuelto no se puede volver a tocar (evita usar la
-- misma transferencia para dos ventas).
drop policy if exists incoming_payments_tenant_resolve on incoming_payments;
create policy incoming_payments_tenant_resolve on incoming_payments
  for update
  using (business_id in (select auth_business_ids()) and status = 'pending')
  with check (business_id in (select auth_business_ids()));

-- Sin política de INSERT ni DELETE para usuarios: solo service_role.

-- El rol authenticated solo necesita leer y actualizar (RLS hace el resto).
revoke all on incoming_payments from anon;
grant select, update on incoming_payments to authenticated;

-- ----------------------------------------------------------------------------
-- Realtime (mismo mecanismo que supabase/realtime_migration.sql)
-- ----------------------------------------------------------------------------
alter table incoming_payments replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'incoming_payments'
  ) then
    alter publication supabase_realtime add table incoming_payments;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Verificación: debe devolver 1 fila (incoming_payments).
-- ----------------------------------------------------------------------------
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'incoming_payments';

-- ----------------------------------------------------------------------------
-- PRUEBA MANUAL (opcional): reemplaza el UUID por tu business_id real
-- (select id, name from businesses;) y ejecútalo con la caja abierta.
-- La alerta debe aparecer sola en la pantalla de Caja.
-- ----------------------------------------------------------------------------
-- insert into incoming_payments (business_id, bank_name, amount, sender_name, raw_message)
-- values (
--   '00000000-0000-0000-0000-000000000000',
--   'Nequi', 25000, 'JUAN PEREZ',
--   'Te llegaron $25.000 de JUAN PEREZ por Nequi'
-- );