-- ============================================================================
-- caja_diagnostic.sql — Diagnóstico de esquema antes de ejecutar tests
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor para verificar el estado del esquema
-- antes de correr caja_concurrency.test.sql. Solo lectura (SELECT).
-- NO modifica datos financieros.
-- ============================================================================

-- 1. ¿Existe cash_movements.idempotency_key?
SELECT 'cash_movements.idempotency_key' AS check_name,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'cash_movements' AND column_name = 'idempotency_key') AS exists_flag;

-- 2. ¿Existe cash_movements.data_date?
SELECT 'cash_movements.data_date' AS check_name,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'cash_movements' AND column_name = 'data_date') AS exists_flag;

-- 3. ¿Existe el índice composite (nuevo)?
SELECT 'composite_idempotency_idx' AS check_name,
  COUNT(*) AS exists_flag
FROM pg_indexes
WHERE indexname = 'cash_movements_business_branch_idempotency_idx';

-- 4. ¿Existe el índice antiguo (debe ser eliminado por la migration final)?
SELECT 'old_idempotency_idx' AS check_name,
  COUNT(*) AS exists_flag
FROM pg_indexes
WHERE indexname = 'cash_movements_idempotency_key_idx';

-- 5. ¿Existe el índice de fechas?
SELECT 'cash_date_idx' AS check_name,
  COUNT(*) AS exists_flag
FROM pg_indexes
WHERE indexname = 'cash_movements_date_idx';

-- 6. ¿Existe el índice de sale?
SELECT 'cash_sale_idx' AS check_name,
  COUNT(*) AS exists_flag
FROM pg_indexes
WHERE indexname = 'cash_movements_sale_idx';

-- 7. ¿Existe el constraint shifts_single_open?
SELECT 'shifts_single_open_constraint' AS check_name,
  COUNT(*) AS exists_flag
FROM pg_indexes
WHERE indexname = 'shifts_single_open_per_business_branch';

-- 8. ¿Existe register_movement_atomic()?
SELECT 'register_movement_atomic_function' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'register_movement_atomic' AND n.nspname = 'public'
  ) AS exists_flag;

-- 9. ¿Existe close_shift_atomic()?
SELECT 'close_shift_atomic_function' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'close_shift_atomic' AND n.nspname = 'public'
  ) AS exists_flag;

-- 10. ¿Existe has_business_role()?
SELECT 'has_business_role_function' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'has_business_role' AND n.nspname = 'public'
  ) AS exists_flag;

-- 11. ¿Puede authenticated ejecutar register_movement_atomic?
SELECT 'authenticated_can_execute_register' AS check_name,
  has_function_privilege(
    'authenticated',
    'register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz)'::regprocedure,
    'EXECUTE'
  ) AS exists_flag;

-- 12. ¿Puede authenticated ejecutar close_shift_atomic?
SELECT 'authenticated_can_execute_close' AS check_name,
  has_function_privilege(
    'authenticated',
    'close_shift_atomic(uuid,numeric,text)'::regprocedure,
    'EXECUTE'
  ) AS exists_flag;

-- 13. ¿Existe el usuario de prueba en auth.users?
SELECT 'test_user_exists' AS check_name,
  EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  ) AS exists_flag;

-- 14. ¿Cuántas migraciones están aplicadas?
SELECT 'applied_migrations_count' AS check_name,
  COUNT(*) AS exists_flag
FROM supabase.schema_migrations
WHERE version LIKE '2026%';

-- 15. Migration order (alphabetical, as applied by Supabase)
SELECT version, inserted_at
FROM supabase.schema_migrations
WHERE version LIKE '202609%'
ORDER BY version;
