-- ============================================================================
-- VIMDY OS — Migración: tabla electronic_invoices (facturación electrónica)
-- ----------------------------------------------------------------------------
-- Cómo usarlo:
--   1. Ve a tu proyecto en https://supabase.com -> "SQL Editor".
--   2. Pega TODO este archivo y dale "Run".
--
-- Es seguro correrlo aunque ya tengas datos: usa "if not exists" en todo.
--
-- QUÉ HACE ESTO Y POR QUÉ HACÍA FALTA:
--   Guarda cada documento electrónico emitido (factura, nota crédito, nota
--   débito) sin importar el proveedor real detrás (Factus hoy, otro
--   mañana). Misma forma genérica que el resto de "stores" de schema.sql
--   (products, sales, receipts, etc.): id, business_id, data jsonb.
--
--   Solo la Edge Function factus-invoice escribe acá (con la service role
--   key) — el navegador nunca hace INSERT/UPDATE directo, solo lee vía la
--   propia función. RLS igual queda activo por si en el futuro se agrega
--   una pantalla de "Historial de facturas" que sí lea directo con el JWT
--   del usuario.
-- ============================================================================

create table if not exists electronic_invoices (
  id text primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists electronic_invoices_business_id_idx on electronic_invoices (business_id);

alter table electronic_invoices enable row level security;

drop policy if exists electronic_invoices_tenant_isolation on electronic_invoices;
create policy electronic_invoices_tenant_isolation on electronic_invoices
  for all
  using (business_id in (select auth_business_ids()))
  with check (business_id in (select auth_business_ids()));