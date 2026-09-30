-- ============================================================================
-- VIMDY OS — Migración: Cash Hardening (Fase de Cierre)
-- ----------------------------------------------------------------------------
-- Agrega:
-- 1. Columna idempotency_key en cash_movements + índice único
--    (permite ON CONFLICT sobre text, no sobre uuid).
-- 2. Constraint único para garantizar SOLO UN turno abierto por sucursal
--    (previene race condition en ShiftEngine.openShift()).
-- 3. Función RPC register_movement_atomic() — inserción atómica de movimientos
--    de caja con idempotencia por ID determinístico.
-- 4. Índices para consultas de fecha y por venta.
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

DO $$
DECLARE
  duplicate_open_count integer;
BEGIN
  SELECT count(*)
  INTO duplicate_open_count
  FROM (
    SELECT business_id, branch_id
    FROM public.shifts
    WHERE data->>'status' = 'OPEN'
    GROUP BY business_id, branch_id
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_open_count > 0 THEN
    RAISE EXCEPTION
      'CAJA_MIGRATION_ABORTED: existen % combinaciones business/branch con más de un turno OPEN. Resolver manualmente antes de aplicar esta migración.',
      duplicate_open_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS shifts_single_open_per_business_branch
  ON public.shifts (business_id, branch_id)
  WHERE (data->>'status') = 'OPEN';

COMMENT ON INDEX shifts_single_open_per_business_branch IS
  'Garantiza que solo exista un turno abierto por sucursal. ShiftEngine.openShift() hace upsert; si este índice falla, otro cajero abrió el turno primero.';

-- ----------------------------------------------------------------------------
-- 3. RPC register_movement_atomic()
-- ----------------------------------------------------------------------------
-- La RPC segura vive en 20260923190000_caja_final_hardening.sql, que por
-- orden lexicográfico se aplica antes que esta migración. Esta migración NO
-- vuelve a crearla: evita que una definición antigua insegura la sobrescriba.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 4. Índices para consultas de fecha y por venta
-- ----------------------------------------------------------------------------
-- data_date ya fue creada como columna normal y sincronizada por trigger en
-- 20260923190000_caja_final_hardening.sql. Aquí solo se asegura su existencia
-- para instalaciones parciales y se crean los índices complementarios.
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS data_date timestamptz;

CREATE INDEX IF NOT EXISTS cash_movements_date_idx
  ON public.cash_movements (data_date);

CREATE INDEX IF NOT EXISTS cash_movements_sale_idx
  ON public.cash_movements (business_id, branch_id)
  WHERE data->>'saleId' IS NOT NULL;
