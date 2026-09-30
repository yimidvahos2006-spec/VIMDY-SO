-- ============================================================================
-- VIMDY OS — Migración: Cash Hardening (Fase de Cierre)
-- ----------------------------------------------------------------------------
-- Agrega:
-- 1. Columna idempotency_key en cash_movements + índice único
--    (permite ON CONFLICT sobre text, no sobre uuid).
-- 2. Constraint único para garantizar SOLO UN turno abierto por sucursal
--    (previene race condition en ShiftEngine.openShift()).
-- 3. Índices para consultas de fecha y por venta.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columna idempotency_key en cash_movements
-- ----------------------------------------------------------------------------
-- cash_movements.id es uuid (generado por gen_random_uuid() en el schema base).
-- Pero los IDs determinísticos de CashEngine son strings como
-- "sale-payment-<saleId>", que no son uuid válidos. Solución: agregar una
-- columna idempotency_key (text, única) y usar ON CONFLICT sobre ella.
ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_idempotency_key_idx
  ON cash_movements (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN cash_movements.idempotency_key IS
  'Clave idempotente determinística (ej. sale-payment-<saleId>). Si se inserta un movimiento con el mismo idempotency_key, hace upsert en vez de duplicar — previene doble conteo de caja en reintentos de red.';

-- ----------------------------------------------------------------------------
-- 2. Constraint: SOLO UN SHIFT ABIERTO POR SUCURSAL
-- ----------------------------------------------------------------------------
-- Previo a la constraint, limpiamos turnos duplicados (más antiguo gana, el
-- resto se cancela) para que el índice único pueda crearse sin conflictos.
WITH open_shifts AS (
  SELECT
    id,
    data->>'openedAt' as opened_at_raw,
    row_number() OVER (
      PARTITION BY business_id, branch_id
      ORDER BY (data->>'openedAt')::timestamptz ASC
    ) as rn
  FROM shifts
  WHERE (data->>'status') = 'OPEN'
),
duplicates AS (
  UPDATE shifts s
  SET data = jsonb_set(s.data, '{status}', '"CANCELLED"'::jsonb, false)
  FROM open_shifts os
  WHERE s.id = os.id AND os.rn > 1
  RETURNING 1
)
SELECT COUNT(*) as cancelled_duplicate_open_shifts FROM duplicates;

CREATE UNIQUE INDEX IF NOT EXISTS shifts_single_open_per_business_branch
  ON shifts (business_id, branch_id)
  WHERE (data->>'status') = 'OPEN';

COMMENT ON INDEX shifts_single_open_per_business_branch IS
  'Garantiza que solo exista un turno abierto por sucursal. ShiftEngine.openShift() hace upsert; si este índice falla, otro cajero abrió el turno primero.';

-- ----------------------------------------------------------------------------
-- 3. Índices para consultas de fecha y por venta
-- ----------------------------------------------------------------------------
-- Nota: PostgreSQL requiere que las expresiones de índice sean IMMUTABLE.
-- Un CAST(data->>'date' AS timestamptz) no es inmutable. Se usa una columna
-- data_date (timestamptz) sincronizada por trigger definido en la migración
-- 20260923190000_caja_final_hardening.sql.
ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS data_date timestamptz;

CREATE INDEX IF NOT EXISTS cash_movements_date_idx
  ON cash_movements (data_date);

CREATE INDEX IF NOT EXISTS cash_movements_sale_idx
  ON cash_movements (business_id, branch_id)
  WHERE data->>'saleId' IS NOT NULL;
