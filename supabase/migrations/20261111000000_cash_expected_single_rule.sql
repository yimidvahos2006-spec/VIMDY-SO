-- ============================================================================
-- 20261111000000_cash_expected_single_rule.sql
-- ----------------------------------------------------------------------------
-- UNA SOLA REGLA PARA EL EFECTIVO ESPERADO EN CAJA (pantalla = cierre = disponible)
--
-- PROBLEMA (encontrado leyendo el código):
--   * El cierre histórico y la pantalla restaban TODA salida (OUT.amount),
--     aunque la salida no sacara efectivo del cajón. Ejemplo real: el reembolso
--     de Wompi se guarda como OUT con cashAmount = 0 (el dinero vuelve a la
--     tarjeta, no sale del cajón) y aun así bajaba el "esperado" -> falso sobrante.
--   * shift_cash_available() (la que valida retiros, gastos y reembolsos en
--     efectivo) usaba OTRA fórmula: respetaba cashAmount en las salidas, pero a
--     un ingreso con tarjeta sin cashAmount le sumaba el monto completo.
--   * incomeByMethod: la pantalla agrupaba "sin método" como CASH y el cierre
--     lo dejaba fuera.
--
-- REGLA ÚNICA (vive aquí, en el servidor):
--   parte en efectivo de un movimiento =
--       cashAmount, si viene informado;
--       si no: el monto completo cuando el medio es CASH o no tiene medio;
--       en cualquier otro medio (tarjeta, transferencia, QR...): 0.
--   efecto en el cajón = +parte (IN)  /  -parte (OUT).
--   esperado = fondo inicial + efectivo que entró - efectivo que salió.
--
-- QUÉ HACE ESTA MIGRACIÓN:
--   1. Crea cash_json_number, cash_movement_cash_portion, cash_movement_cash_effect.
--   2. Crea caja_shift_cash_totals(shift)  -> UNA sola consulta de totales (uso interno).
--   3. Crea get_shift_cash_summary(shift)  -> la que lee la pantalla (con permisos).
--   4. Reemplaza caja_internal_close_shift_atomic para que cierre con esa misma consulta
--      y guarde también totalCashExpense en el cierre.
--   5. Reemplaza shift_cash_available para que use esa misma consulta.
--
-- NO TOCA los cierres ya guardados (la historia no se reescribe). Para ver cuáles
-- cierres viejos habrían dado distinto, corre DESPUÉS supabase/diagnostics/cash_expected_history_check.sql
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public.caja_internal_close_shift_atomic(uuid,numeric,text)') IS NULL THEN
    RAISE EXCEPTION 'FALTA caja_internal_close_shift_atomic: aplica primero 20261029000000_caja_branch_scope_rpc_hardening.sql';
  END IF;
  IF to_regprocedure('public.caja_assert_branch_access(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'FALTA caja_assert_branch_access: aplica primero 20261029000000_caja_branch_scope_rpc_hardening.sql';
  END IF;
  IF to_regprocedure('public.shift_cash_available(uuid)') IS NULL THEN
    RAISE EXCEPTION 'FALTA shift_cash_available: aplica primero 20260928193000_caja_enterprise_v4_operational.sql';
  END IF;
END;
$guard$;

-- ---------------------------------------------------------------------------
-- 1. Regla única (funciones puras, sin acceso a tablas)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cash_json_number(p_value jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN NULL
    WHEN jsonb_typeof(p_value) = 'number' THEN (p_value #>> '{}')::numeric
    WHEN jsonb_typeof(p_value) = 'string'
         AND btrim(p_value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN btrim(p_value #>> '{}')::numeric
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.cash_movement_cash_portion(p_data jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_data IS NULL THEN 0
    WHEN public.cash_json_number(p_data->'cashAmount') IS NOT NULL
      THEN public.cash_json_number(p_data->'cashAmount')
    WHEN COALESCE(p_data->>'paymentMethod', '') IN ('', 'CASH')
      THEN COALESCE(public.cash_json_number(p_data->'amount'), 0)
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION public.cash_movement_cash_effect(p_data jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE p_data->>'type'
    WHEN 'IN'  THEN  public.cash_movement_cash_portion(p_data)
    WHEN 'OUT' THEN -public.cash_movement_cash_portion(p_data)
    ELSE 0
  END
$$;

-- ---------------------------------------------------------------------------
-- 2. Totales del turno: LA consulta que usan cierre, disponible y pantalla
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caja_shift_cash_totals(p_shift_id uuid)
RETURNS TABLE(
  opening_amount numeric,
  total_income numeric,
  total_expense numeric,
  total_cash_income numeric,
  total_cash_expense numeric,
  expected_amount numeric,
  income_by_method jsonb,
  movement_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH s AS (
    SELECT sh.id, sh.business_id, sh.branch_id,
           COALESCE(public.cash_json_number(sh.data->'openingAmount'), 0) AS opening
    FROM public.shifts sh
    WHERE sh.id = p_shift_id
  ),
  mv AS (
    SELECT cm.data->>'type' AS mtype,
           COALESCE(public.cash_json_number(cm.data->'amount'), 0) AS amt,
           public.cash_movement_cash_portion(cm.data) AS cash_part,
           COALESCE(NULLIF(cm.data->>'paymentMethod', ''), 'CASH') AS method
    FROM public.cash_movements cm
    JOIN s ON cm.business_id = s.business_id
          AND cm.branch_id = s.branch_id
          AND cm.shift_id = s.id::text
  ),
  t AS (
    SELECT
      COALESCE(SUM(amt)       FILTER (WHERE mtype = 'IN'),  0) AS ti,
      COALESCE(SUM(amt)       FILTER (WHERE mtype = 'OUT'), 0) AS te,
      COALESCE(SUM(cash_part) FILTER (WHERE mtype = 'IN'),  0) AS tci,
      COALESCE(SUM(cash_part) FILTER (WHERE mtype = 'OUT'), 0) AS tce,
      COUNT(*)::integer AS n
    FROM mv
  ),
  bm AS (
    SELECT COALESCE(jsonb_object_agg(x.method, x.total), '{}'::jsonb) AS j
    FROM (
      SELECT method, SUM(amt) AS total
      FROM mv
      WHERE mtype = 'IN'
      GROUP BY method
    ) x
  )
  SELECT s.opening, t.ti, t.te, t.tci, t.tce,
         s.opening + t.tci - t.tce,
         bm.j, t.n
  FROM s, t, bm
$$;

REVOKE ALL ON FUNCTION public.caja_shift_cash_totals(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Lo que lee la pantalla (misma consulta, con permisos y sucursal)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_shift_cash_summary(p_shift_id uuid)
RETURNS TABLE(
  shift_id uuid,
  opening_amount numeric,
  total_income numeric,
  total_expense numeric,
  total_cash_income numeric,
  total_cash_expense numeric,
  expected_amount numeric,
  income_by_method jsonb,
  movement_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'CAJA_AUTH_REQUIRED';
  END IF;

  SELECT s.business_id, s.branch_id
    INTO v_business_id, v_branch_id
  FROM public.shifts AS s
  WHERE s.id = p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_NOT_FOUND'; END IF;

  PERFORM public.caja_assert_branch_access(v_business_id, v_branch_id);

  IF NOT public.has_business_role(v_business_id, ARRAY['ADMIN','GERENTE','CAJERO']) THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT p_shift_id, c.opening_amount, c.total_income, c.total_expense,
         c.total_cash_income, c.total_cash_expense, c.expected_amount,
         c.income_by_method, c.movement_count
  FROM public.caja_shift_cash_totals(p_shift_id) c;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_shift_cash_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shift_cash_summary(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. El cierre histórico usa la misma consulta
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caja_internal_close_shift_atomic(
  p_shift_id uuid,
  p_counted_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(shift_id uuid, data jsonb, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_closed_at timestamptz := clock_timestamp();
  v_total_income numeric := 0;
  v_total_expense numeric := 0;
  v_total_cash_income numeric := 0;
  v_total_cash_expense numeric := 0;
  v_expected_amount numeric := 0;
  v_difference numeric := 0;
  v_income_by_method jsonb := '{}'::jsonb;
  v_new_data jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SHIFT_AUTH_REQUIRED'; END IF;
  IF p_counted_amount IS NULL OR p_counted_amount < 0
     OR p_counted_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'SHIFT_INVALID_COUNTED_AMOUNT';
  END IF;

  SELECT * INTO v_shift FROM public.shifts s WHERE s.id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_NOT_FOUND'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = v_shift.business_id AND bm.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'SHIFT_NOT_A_MEMBER'; END IF;
  IF NOT public.has_business_role(v_shift.business_id, ARRAY['ADMIN','GERENTE','CAJERO']) THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = v_shift.branch_id AND b.business_id = v_shift.business_id AND b.active = true
  ) THEN RAISE EXCEPTION 'SHIFT_INVALID_BRANCH'; END IF;
  IF v_shift.data->>'status' = 'CLOSED' THEN RAISE EXCEPTION 'SHIFT_ALREADY_CLOSED'; END IF;
  IF v_shift.data->>'status' <> 'OPEN' THEN RAISE EXCEPTION 'SHIFT_NOT_OPEN'; END IF;
  IF v_shift.cash_register_id IS NULL THEN RAISE EXCEPTION 'SHIFT_CASH_REGISTER_REQUIRED'; END IF;
  IF NOT public.has_business_role(v_shift.business_id, ARRAY['ADMIN','GERENTE'])
     AND NULLIF(v_shift.data->>'cashierId', '')::uuid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'SHIFT_OWNER_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_movements cm
    WHERE cm.business_id = v_shift.business_id
      AND cm.branch_id = v_shift.branch_id
      AND cm.cash_register_id = v_shift.cash_register_id
      AND cm.shift_id IS NULL
      AND cm.data_date >= (v_shift.data->>'openedAt')::timestamptz
  ) THEN
    RAISE EXCEPTION 'SHIFT_HAS_UNASSIGNED_MOVEMENTS';
  END IF;

  -- REGLA ÚNICA DE EFECTIVO: el mismo cálculo que ve la pantalla
  -- (get_shift_cash_summary) y que usa shift_cash_available().
  SELECT c.total_income, c.total_expense, c.total_cash_income, c.total_cash_expense,
         c.expected_amount, c.income_by_method
    INTO v_total_income, v_total_expense, v_total_cash_income, v_total_cash_expense,
         v_expected_amount, v_income_by_method
  FROM public.caja_shift_cash_totals(v_shift.id) c;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_NOT_FOUND'; END IF;

  v_difference := p_counted_amount - v_expected_amount;

  v_new_data := v_shift.data || jsonb_build_object(
    'status', 'CLOSED',
    'closedAt', v_closed_at,
    'closingNotes', p_notes,
    'totalIncome', v_total_income,
    'totalExpense', v_total_expense,
    'totalCashIncome', v_total_cash_income,
    'totalCashExpense', v_total_cash_expense,
    'incomeByMethod', v_income_by_method,
    'expectedAmount', v_expected_amount,
    'countedAmount', p_counted_amount,
    'difference', v_difference
  );

  UPDATE public.shifts
  SET data = v_new_data, version = v_shift.version + 1, updated_at = v_closed_at
  WHERE public.shifts.id = v_shift.id AND public.shifts.version = v_shift.version;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_CLOSE_CONFLICT'; END IF;

  INSERT INTO public.daily_report_jobs(
    business_id, branch_id, shift_id, business_date, opened_at, closed_at,
    data_cutoff_at, cash_expected, cash_counted, cash_difference, status, next_attempt_at
  )
  SELECT
    v_shift.business_id,
    v_shift.branch_id,
    v_shift.id,
    (v_closed_at AT TIME ZONE COALESCE(
      (SELECT timezone FROM public.businesses WHERE id = v_shift.business_id), 'UTC'
    ))::date,
    NULLIF(v_shift.data->>'openedAt', '')::timestamptz,
    v_closed_at,
    v_closed_at,
    v_expected_amount,
    p_counted_amount,
    v_difference,
    'PENDING',
    v_closed_at
  WHERE NOT EXISTS (
    SELECT 1 FROM public.daily_report_jobs drj WHERE drj.shift_id = v_shift.id
  );

  RETURN QUERY SELECT v_shift.id, v_new_data, v_shift.version + 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.caja_internal_close_shift_atomic(uuid, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. El "efectivo disponible" (retiros, gastos, reembolsos) usa la misma consulta
--    (si el turno no existe devuelve NULL, igual que antes)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shift_cash_available(p_shift_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.expected_amount
  FROM public.caja_shift_cash_totals(p_shift_id) c
$$;

REVOKE ALL ON FUNCTION public.shift_cash_available(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 6. Verificación: si algo quedó abierto o mal, la migración se aborta.
-- ---------------------------------------------------------------------------
DO $verify$
BEGIN
  -- La regla, probada con los casos que causaban la discrepancia.
  IF public.cash_movement_cash_effect('{"type":"OUT","amount":8000,"cashAmount":0,"paymentMethod":"CARD"}'::jsonb) <> 0 THEN
    RAISE EXCEPTION 'REGLA_CAJA: un reembolso electronico (cashAmount 0) no debe sacar efectivo';
  END IF;
  IF public.cash_movement_cash_effect('{"type":"IN","amount":10000,"paymentMethod":"CARD"}'::jsonb) <> 0 THEN
    RAISE EXCEPTION 'REGLA_CAJA: un ingreso con tarjeta sin cashAmount no debe sumar efectivo';
  END IF;
  IF public.cash_movement_cash_effect('{"type":"IN","amount":10000}'::jsonb) <> 10000 THEN
    RAISE EXCEPTION 'REGLA_CAJA: un ingreso sin medio ni cashAmount es efectivo completo';
  END IF;
  IF public.cash_movement_cash_effect('{"type":"OUT","amount":5000,"paymentMethod":"CASH","cashAmount":5000}'::jsonb) <> -5000 THEN
    RAISE EXCEPTION 'REGLA_CAJA: un retiro en efectivo debe restar su monto';
  END IF;
  IF public.cash_movement_cash_effect('{"type":"IN","amount":20000,"paymentMethod":"MIXED","cashAmount":12000}'::jsonb) <> 12000 THEN
    RAISE EXCEPTION 'REGLA_CAJA: un pago MIXED suma solo su parte en efectivo';
  END IF;

  -- Permisos: la consulta interna no puede ser llamada desde el navegador.
  IF has_function_privilege('authenticated', 'public.caja_shift_cash_totals(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.caja_shift_cash_totals(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CAJA_TOTALS_OPEN: caja_shift_cash_totals no debe ser ejecutable por clientes';
  END IF;
  IF has_function_privilege('anon', 'public.get_shift_cash_summary(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CAJA_SUMMARY_OPEN: anon puede ejecutar get_shift_cash_summary';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_shift_cash_summary(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CAJA_SUMMARY_CLOSED: authenticated no puede ejecutar get_shift_cash_summary';
  END IF;
  IF has_function_privilege('authenticated', 'public.caja_internal_close_shift_atomic(uuid,numeric,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CAJA_CLOSE_INTERNAL_OPEN: la funcion interna de cierre no debe ser ejecutable por clientes';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;