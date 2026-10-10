-- ============================================================================
-- 20261019000000_formalize_hot_columns.sql
-- ----------------------------------------------------------------------------
-- A7.9 — Promueve las columnas generadas e índices de hot_columns_migration.sql
-- (que vivía FUERA de supabase/migrations/) a la cadena de migraciones oficial.
--
-- PROBLEMA:
--   process-daily-report/index.ts y MovementRepository.ts consultan columnas
--   SQL `movement_type`, `movement_date`, y `movement_product_id` en
--   `inventory_movements`. Estas columnas (y sus índices) solo existían en
--   `supabase/hot_columns_migration.sql`, un archivo standalone que NO forma
--   parte de la cadena de migraciones automatizadas. Una base limpia creada
--   solo con supabase/migrations/ no tenía esas columnas → queries fallaban
--   con "column does not exist" o retornaban 0 filas silenciosamente.
--
-- OBJETOS FORMALIZADOS (solo los necesarios por código ACTUAL):
--   1. inventory_movements.movement_product_id (text GENERATED ALWAYS AS data->>'productId')
--   2. inventory_movements.movement_type       (text GENERATED ALWAYS AS data->>'type')
--   3. inventory_movements.movement_date       (timestamptz GENERATED ALWAYS AS data->>'date')
--   4. Índice inventory_movements_business_product_idx
--   5. Índice inventory_movements_business_type_idx
--   6. Función immutable_timestamptz (requerida por movement_date)
--
-- DESCARTADOS (no tienen consumidores en src/ activo):
--   - sales.sale_date       → SaleRepository usa created_at (columna real)
--   - sales.sale_total      → SaleRepository usa data->>'total' directamente
--   - sales.sale_customer_id → SaleRepository usa data->>'customerId'
--   - Índices sales_business_date_idx, sales_business_total_idx
--   Estas columnas existen solo como comentarios históricos en SaleRepository.ts
--   y SalesEngine.ts:1404 (comentario que describe la VIEJA implementación).
--
-- La función immutable_timestamptz se reproduce con el MISMO cuerpo que
-- hot_columns_migration.sql (líneas 41-47). Se usa CREATE OR REPLACE para
-- ser idempotente en bases donde ya se aplicó manualmente.
--
-- Migracion NUEVA: no modifica ninguna migracion historica.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Función helper IMMUTABLE para cast text -> timestamptz dentro de
--    columnas GENERATED (Postgres exige funciones IMMUTABLE en GENERATED ...
--    STORED when the expression is not a simple cast).
--    El JSONB data->>'date' trae ISO-8601 con zona horaria explícita, por lo
--    que el cast es seguro (no depende de session timezone).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.immutable_timestamptz(p_text text)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_text::timestamptz;
$$;

-- ----------------------------------------------------------------------------
-- 2) Columnas generadas en inventory_movements, derivadas del JSONB data
--    Las migraciones de inventario insertan consistentemente estos keys:
--      'type'      → 'INCREASE' | 'DECREASE' | 'ADJUST'
--      'productId' → UUID en texto
--      'date'      → ISO-8601 timestamptz (now() o clock_timestamp())
--    Se usan IF NOT EXISTS para ser idempotentas en bases donde ya se
--    aplicó hot_columns_migration.sql manualmente.
-- ----------------------------------------------------------------------------
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS movement_product_id text
    GENERATED ALWAYS AS (data->>'productId') STORED;

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS movement_type text
    GENERATED ALWAYS AS (data->>'type') STORED;

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS movement_date timestamptz
    GENERATED ALWAYS AS (public.immutable_timestamptz(data->>'date')) STORED;

-- ----------------------------------------------------------------------------
-- 3) Índices para acelerar los queries de Kardex y reportes
--    (process-daily-report, MovementRepository.findByProduct, etc.)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS inventory_movements_business_product_idx
  ON public.inventory_movements (business_id, movement_product_id, movement_date DESC);

CREATE INDEX IF NOT EXISTS inventory_movements_business_type_idx
  ON public.inventory_movements (business_id, movement_type);

COMMIT;
