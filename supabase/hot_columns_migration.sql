-- ============================================================================
-- hot_columns_migration.sql
-- ----------------------------------------------------------------------------
-- CRÍTICO #3 del checklist de lanzamiento: sacar del `data jsonb` las
-- columnas que más se consultan en ventas e inventario (fecha, total,
-- producto, tipo de movimiento), para que el dashboard y los reportes no
-- se pongan lentos apenas un negocio acumule historial.
--
-- CÓMO SE HIZO (para no reescribir el schema cada vez que agregues un
-- campo, que es justo lo que la columna `data jsonb` evita — ver el
-- comentario de la sección 1 de schema.sql):
--
--   Columnas GENERADAS ("generated always as ... stored"). Postgres las
--   calcula solas a partir de `data` en cada INSERT/UPDATE — no hay que
--   tocar SalesEngine, InventoryEngine, SaleRepository ni MovementRepository
--   para que se llenen. Siguen siendo un espejo de `data`, nunca la fuente
--   de verdad (la fuente de verdad sigue siendo `data`, igual que hoy) —
--   simplemente quedan también disponibles como columnas reales, indexables
--   y filtrables/ordenables directo en SQL en vez de traer TODA la tabla a
--   JavaScript y filtrar ahí (que es lo que hace SupabaseRepository.findAll()
--   hoy: `select("data")` sin ningún filtro).
--
--   Esta migración es retroactiva: al agregar las columnas, Postgres las
--   calcula también para TODAS las filas que ya existían, no solo las
--   nuevas — no hace falta backfill aparte.
--
-- Aplicar con: pega TODO este archivo en el SQL Editor de Supabase y dale
-- "Run". Es re-corrible (usa IF NOT EXISTS / IF EXISTS en todos lados).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Postgres no deja usar el cast normal text -> timestamptz dentro de una
--    columna generada, aunque el texto ya venga con zona horaria explícita
--    (el ISO-8601 con "Z" que guarda SupabaseRepository.save()): el cast
--    está marcado como STABLE en vez de IMMUTABLE porque, en general,
--    depende de la configuración de zona horaria de la sesión. Como acá
--    SIEMPRE viene con offset explícito (nunca es ambiguo), es seguro
--    envolverlo en una función marcada IMMUTABLE a mano — es el patrón
--    estándar de Postgres para este error (42P17).
-- ----------------------------------------------------------------------------
create or replace function public.immutable_timestamptz(p_text text)
returns timestamptz
language sql
immutable
as $$
  select p_text::timestamptz;
$$;

-- ----------------------------------------------------------------------------
-- 1. sales — fecha y total de la venta.
-- ----------------------------------------------------------------------------
alter table sales
  add column if not exists sale_date timestamptz
  generated always as (public.immutable_timestamptz(data->>'createdAt')) stored;

alter table sales
  add column if not exists sale_total numeric
  generated always as (((data->>'total')::numeric)) stored;

-- Cubre el caso más común de reporte/dashboard: "ventas de este negocio
-- entre fecha X y fecha Y, de la más nueva a la más vieja".
create index if not exists sales_business_date_idx
  on sales (business_id, sale_date desc);

-- Cubre sumas/rankings por total (ej. "top ventas del día").
create index if not exists sales_business_total_idx
  on sales (business_id, sale_total);

-- ----------------------------------------------------------------------------
-- 2. inventory_movements (Kardex) — producto, tipo de movimiento y fecha.
-- ----------------------------------------------------------------------------
alter table inventory_movements
  add column if not exists movement_product_id text
  generated always as (data->>'productId') stored;

alter table inventory_movements
  add column if not exists movement_type text
  generated always as (data->>'type') stored;

alter table inventory_movements
  add column if not exists movement_date timestamptz
  generated always as (public.immutable_timestamptz(data->>'date')) stored;

-- Cubre "historial de kardex de ESTE producto" (lo que hoy se resuelve
-- trayendo TODOS los movimientos del negocio a JS y filtrando ahí).
create index if not exists inventory_movements_business_product_idx
  on inventory_movements (business_id, movement_product_id, movement_date desc);

-- Cubre "solo las salidas" / "solo las entradas" (reportes de mermas,
-- compras, etc.).
create index if not exists inventory_movements_business_type_idx
  on inventory_movements (business_id, movement_type);

-- ============================================================================
-- Verificación rápida después de correr esto:
--
--   select sale_date, sale_total from sales limit 5;
--   select movement_product_id, movement_type, movement_date
--     from inventory_movements limit 5;
--
-- Ambas deben venir con datos ya llenos (no NULL) si ya tenías ventas o
-- movimientos guardados antes de correr esta migración.
--
-- Nota: esto por sí solo ya acelera cualquier reporte que use estas
-- columnas en SQL directo (ver los métodos nuevos en SaleRepository y
-- MovementRepository). El Dashboard actual, si todavía trae todo con
-- findAll() y filtra en JavaScript, no se vuelve automáticamente más
-- rápido — el índice ayuda apenas empiece a usarlo. Eso es trabajo aparte
-- (no crítico para lanzar) que se puede ir migrando reporte por reporte.
-- ============================================================================