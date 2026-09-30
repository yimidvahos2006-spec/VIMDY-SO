-- ============================================================================
-- VIMDY OS — CAJA DIAGNOSTIC (READ ONLY)
-- ----------------------------------------------------------------------------
-- Ejecutar DESPUÉS de aplicar las migraciones de Caja y ANTES de los tests.
-- No modifica datos ni crea usuarios.
--
-- Resultado esperado: todos los checks críticos = PASS.
-- ============================================================================

WITH checks AS (
  SELECT
    '00 cash_registers existe' AS check_name,
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'cash_registers'
    ) AS pass

  UNION ALL
  SELECT
    '00B payment_verifications existe',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'payment_verifications'
    )

  UNION ALL
  SELECT
    '01 cash_movements.idempotency_key existe' AS check_name,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'cash_movements'
        AND column_name = 'idempotency_key'
        AND data_type = 'text'
    ) AS pass

  UNION ALL
  SELECT
    '02 cash_movements.data_date existe como timestamptz normal',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'cash_movements'
        AND column_name = 'data_date'
        AND data_type = 'timestamp with time zone'
        AND is_generated = 'NEVER'
    )

  UNION ALL
  SELECT
    '03 trigger cash_movements_data_date_sync existe',
    EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE t.tgname = 'cash_movements_data_date_sync'
        AND c.relname = 'cash_movements'
        AND n.nspname = 'public'
        AND NOT t.tgisinternal
    )

  UNION ALL
  SELECT
    '04 sync_cash_movements_data_date es plpgsql',
    EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public'
        AND p.proname = 'sync_cash_movements_data_date'
        AND l.lanname = 'plpgsql'
    )

  UNION ALL
  SELECT
    '05 índice composite de idempotencia existe',
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'cash_movements_business_branch_idempotency_key_idx'
    )

  UNION ALL
  SELECT
    '06 índice global antiguo de idempotencia NO existe',
    NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'cash_movements_idempotency_key_idx'
    )

  UNION ALL
  SELECT
    '07 índice de fecha existe',
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'cash_movements_date_idx'
    )

  UNION ALL
  SELECT
    '08 índice de saleId existe',
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'cash_movements_sale_idx'
    )

  UNION ALL
  SELECT
    '09 índice único de turno abierto por caja existe',
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'shifts_single_open_per_cash_register'
    )

  UNION ALL
  SELECT
    '10 register_movement_atomic existe con firma exacta',
    to_regprocedure('public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)') IS NOT NULL

  UNION ALL
  SELECT
    '11 close_shift_atomic existe con firma exacta',
    to_regprocedure('public.close_shift_atomic(uuid,numeric,text)') IS NOT NULL

  UNION ALL
  SELECT
    '11B register_sale_payment_atomic existe con shift_id',
    to_regprocedure('public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text,uuid,text,uuid)') IS NOT NULL

  UNION ALL
  SELECT
    '12 register_movement_atomic usa plpgsql',
    EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure('public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)')
        AND n.nspname = 'public'
        AND l.lanname = 'plpgsql'
    )

  UNION ALL
  SELECT
    '13 close_shift_atomic usa plpgsql',
    EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure('public.close_shift_atomic(uuid,numeric,text)')
        AND n.nspname = 'public'
        AND l.lanname = 'plpgsql'
    )

  UNION ALL
  SELECT
    '14 register_movement_atomic es SECURITY DEFINER',
    COALESCE((
      SELECT p.prosecdef
      FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)')
    ), false)

  UNION ALL
  SELECT
    '15 close_shift_atomic es SECURITY DEFINER',
    COALESCE((
      SELECT p.prosecdef
      FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.close_shift_atomic(uuid,numeric,text)')
    ), false)

  UNION ALL
  SELECT
    '16 register_movement_atomic fija search_path=public',
    COALESCE((
      SELECT p.proconfig @> ARRAY['search_path=public']
      FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)')
    ), false)

  UNION ALL
  SELECT
    '17 close_shift_atomic fija search_path=public',
    COALESCE((
      SELECT p.proconfig @> ARRAY['search_path=public']
      FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.close_shift_atomic(uuid,numeric,text)')
    ), false)

  UNION ALL
  SELECT
    '18 authenticated puede ejecutar register_movement_atomic',
    CASE
      WHEN to_regprocedure('public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)') IS NULL THEN false
      ELSE has_function_privilege(
        'authenticated',
        to_regprocedure('public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)'),
        'EXECUTE'
      )
    END

  UNION ALL
  SELECT
    '19 authenticated puede ejecutar close_shift_atomic',
    CASE
      WHEN to_regprocedure('public.close_shift_atomic(uuid,numeric,text)') IS NULL THEN false
      ELSE has_function_privilege(
        'authenticated',
        to_regprocedure('public.close_shift_atomic(uuid,numeric,text)'),
        'EXECUTE'
      )
    END

  UNION ALL
  SELECT
    '20 register_movement_atomic NO es ejecutable por PUBLIC',
    CASE
      WHEN to_regprocedure('public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)') IS NULL THEN false
      ELSE NOT has_function_privilege(
        'public',
        to_regprocedure('public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)'),
        'EXECUTE'
      )
    END

  UNION ALL
  SELECT
    '21 close_shift_atomic NO es ejecutable por PUBLIC',
    CASE
      WHEN to_regprocedure('public.close_shift_atomic(uuid,numeric,text)') IS NULL THEN false
      ELSE NOT has_function_privilege(
        'public',
        to_regprocedure('public.close_shift_atomic(uuid,numeric,text)'),
        'EXECUTE'
      )
    END

  UNION ALL
  SELECT
    '22 no existen duplicados de idempotency_key por business+branch',
    NOT EXISTS (
      SELECT 1
      FROM public.cash_movements
      WHERE idempotency_key IS NOT NULL
        AND branch_id IS NOT NULL
      GROUP BY business_id, branch_id, idempotency_key
      HAVING count(*) > 1
    )

  UNION ALL
  SELECT
    '23 no existen múltiples turnos OPEN por business+branch+cash_register',
    NOT EXISTS (
      SELECT 1
      FROM public.shifts
      WHERE data->>'status' = 'OPEN'
        AND cash_register_id IS NOT NULL
      GROUP BY business_id, branch_id, cash_register_id
      HAVING count(*) > 1
    )

  UNION ALL
  SELECT
    '24 cash_movements y shifts son read-only para authenticated',
    has_table_privilege('authenticated', 'public.cash_movements', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.cash_movements', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.cash_movements', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.cash_movements', 'DELETE')
      AND has_table_privilege('authenticated', 'public.shifts', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.shifts', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.shifts', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.shifts', 'DELETE')

  UNION ALL
  SELECT
    '25 payment_verifications CONFIRMED requiere timestamp y referencia',
    EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.conname = 'payment_verifications_confirmed_consistency_ck'
        AND t.relname = 'payment_verifications'
        AND n.nspname = 'public'
    )

  UNION ALL
  SELECT
    '26 existe al menos un usuario real para ejecutar el harness SQL',
    EXISTS (SELECT 1 FROM auth.users LIMIT 1)
)
SELECT
  check_name,
  CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS status
FROM checks
ORDER BY check_name;
