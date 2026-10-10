-- ============================================================================
-- 20260927220000_cash_movements_shift_id.sql
-- ----------------------------------------------------------------------------
-- PROBLEMA:
--   20260927230000_caja_enterprise_v2.sql crea un índice sobre
--   public.cash_movements (..., shift_id) y varias funciones leen esa
--   columna, pero ninguna migración anterior la crea. En producción existe
--   (agregada a mano), pero una base nueva construida solo con
--   supabase/migrations/ falla con:
--     ERROR: column "shift_id" does not exist (SQLSTATE 42703)
--
-- SOLUCIÓN:
--   Migración guardián con fecha anterior a v2. Usa IF NOT EXISTS:
--     - En producción: no-op (la columna ya existe).
--     - En una base nueva: crea la columna.
--
-- TIPO:
--   text, NO generada, sin constraints. Es la definición real en producción
--   (verificada con information_schema.columns).
--
-- Migración NUEVA: no modifica ninguna migración histórica.
-- ============================================================================

ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS shift_id text;