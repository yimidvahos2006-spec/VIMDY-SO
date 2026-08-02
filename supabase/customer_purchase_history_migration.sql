-- ============================================================================
-- customer_purchase_history_migration.sql
-- ----------------------------------------------------------------------------
-- FASE 3 (Optimización) — punto "velocidad de carga": CustomerEngine.
-- getCustomerProfile() hoy trae TODAS las ventas del negocio con
-- saleRepository.findAll() y filtra por customerId en JavaScript. Esto se
-- llama, entre otros lugares, cada vez que se elige un cliente en Caja
-- (PosCustomer.tsx) — justo en hora pico, es el peor momento para que
-- tarde. Mismo patrón que hot_columns_migration.sql (sale_date/sale_total):
-- se saca customerId del `data jsonb` a una columna generada e indexada,
-- para que SaleRepository pueda pedirle a Postgres solo las ventas de ESE
-- cliente en vez de traer la tabla completa.
--
-- Retroactiva (Postgres la calcula sola para las filas que ya existen) y
-- re-corrible (usa IF NOT EXISTS en todos lados).
--
-- Aplicar con: pega TODO este archivo en el SQL Editor de Supabase y dale
-- "Run".
-- ============================================================================

alter table sales
  add column if not exists sale_customer_id text
  generated always as (data->>'customerId') stored;

-- Cubre "historial de compras de ESTE cliente, de la más nueva a la más
-- vieja" — lo que hoy resuelve CustomerEngine.getCustomerProfile() trayendo
-- TODA la tabla de ventas del negocio a JavaScript y filtrando ahí.
create index if not exists sales_business_customer_idx
  on sales (business_id, sale_customer_id, sale_date desc);

-- ============================================================================
-- Verificación rápida después de correr esto:
--
--   select sale_customer_id, sale_date, sale_total from sales limit 5;
--
-- Debe venir con sale_customer_id ya lleno (no NULL, salvo en ventas viejas
-- guardadas sin cliente asignado) si ya tenías ventas guardadas antes de
-- correr esta migración.
-- ============================================================================