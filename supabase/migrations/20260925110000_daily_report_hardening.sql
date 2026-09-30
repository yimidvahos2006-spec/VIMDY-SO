BEGIN;

-- Seguridad: el reporte de cierre contiene información financiera y destinatarios.
-- Solo administración/gerencia/contabilidad puede leerlo desde el cliente.
DROP POLICY IF EXISTS daily_report_jobs_member_select ON public.daily_report_jobs;
DROP POLICY IF EXISTS daily_report_jobs_management_select ON public.daily_report_jobs;
CREATE POLICY daily_report_jobs_management_select ON public.daily_report_jobs
  FOR SELECT TO authenticated
  USING (
    (select public.has_business_role(business_id, ARRAY['ADMIN','GERENTE','CONTADOR']))
    AND EXISTS (
      SELECT 1
      FROM public.branches br
      JOIN public.business_members bm ON bm.business_id = br.business_id
      WHERE br.id = daily_report_jobs.branch_id
        AND br.business_id = daily_report_jobs.business_id
        AND br.active = true
        AND bm.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS daily_report_deliveries_member_select ON public.daily_report_deliveries;
DROP POLICY IF EXISTS daily_report_deliveries_management_select ON public.daily_report_deliveries;
CREATE POLICY daily_report_deliveries_management_select ON public.daily_report_deliveries
  FOR SELECT TO authenticated
  USING ((select public.has_business_role(business_id, ARRAY['ADMIN','GERENTE','CONTADOR'])));

-- El worker inmediato para un cierre de CAJERO necesita comprobar quién cerró el turno.
-- No cambia el contrato externo de close_shift_atomic; solo añade un campo al JSON existente.
CREATE OR REPLACE FUNCTION public.close_shift_atomic(
  p_shift_id uuid,
  p_counted_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(shift_id uuid,data jsonb,version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shift_business_id uuid;
  v_shift_branch_id uuid;
  v_shift_data jsonb;
  v_shift_version integer;
  v_status text;
  v_opened_at timestamptz;
  v_closed_at timestamptz := clock_timestamp();
  v_timezone text := 'UTC';
  v_business_day date;
  v_total_income numeric := 0;
  v_total_expense numeric := 0;
  v_total_cash_income numeric := 0;
  v_expected_amount numeric := 0;
  v_difference numeric := 0;
  v_income_by_method jsonb := '{}'::jsonb;
  v_new_data jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SHIFT_AUTH_REQUIRED'; END IF;
  IF p_counted_amount IS NULL OR p_counted_amount < 0 THEN RAISE EXCEPTION 'SHIFT_INVALID_COUNTED_AMOUNT'; END IF;

  SELECT s.business_id,s.branch_id,s.data,s.version
  INTO v_shift_business_id,v_shift_branch_id,v_shift_data,v_shift_version
  FROM public.shifts s WHERE s.id=p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_NOT_FOUND'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.business_members bm WHERE bm.business_id=v_shift_business_id AND bm.user_id=auth.uid()) THEN RAISE EXCEPTION 'SHIFT_NOT_A_MEMBER'; END IF;
  IF NOT public.has_business_role(v_shift_business_id,ARRAY['ADMIN','CAJERO']) THEN RAISE EXCEPTION 'SHIFT_FORBIDDEN'; END IF;
  IF v_shift_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id=v_shift_branch_id AND b.business_id=v_shift_business_id AND b.active=true) THEN RAISE EXCEPTION 'SHIFT_INVALID_BRANCH'; END IF;

  v_status:=v_shift_data->>'status';
  IF v_status='CLOSED' THEN RAISE EXCEPTION 'SHIFT_ALREADY_CLOSED'; END IF;
  IF v_status<>'OPEN' THEN RAISE EXCEPTION 'SHIFT_NOT_OPEN'; END IF;
  v_opened_at:=(v_shift_data->>'openedAt')::timestamptz;
  IF v_opened_at IS NULL THEN RAISE EXCEPTION 'SHIFT_INVALID_OPENED_AT'; END IF;

  SELECT COALESCE(b.timezone,'UTC') INTO v_timezone FROM public.businesses b WHERE b.id=v_shift_business_id;
  v_business_day := (v_closed_at AT TIME ZONE v_timezone)::date;

  SELECT COALESCE(SUM((cm.data->>'amount')::numeric) FILTER (WHERE cm.data->>'type'='IN'),0),
         COALESCE(SUM((cm.data->>'amount')::numeric) FILTER (WHERE cm.data->>'type'='OUT'),0),
         COALESCE(SUM(COALESCE((cm.data->>'cashAmount')::numeric,0)) FILTER (WHERE cm.data->>'type'='IN'),0)
  INTO v_total_income,v_total_expense,v_total_cash_income
  FROM public.cash_movements cm
  WHERE cm.business_id=v_shift_business_id AND cm.branch_id=v_shift_branch_id
    AND (cm.shift_id=p_shift_id::text OR (cm.shift_id IS NULL AND cm.data_date>=v_opened_at AND cm.data_date<=v_closed_at));

  SELECT COALESCE(jsonb_object_agg(method,total),'{}'::jsonb) INTO v_income_by_method
  FROM (
    SELECT COALESCE(cm.data->>'paymentMethod','CASH') method,SUM((cm.data->>'amount')::numeric) total
    FROM public.cash_movements cm
    WHERE cm.business_id=v_shift_business_id AND cm.branch_id=v_shift_branch_id
      AND (cm.shift_id=p_shift_id::text OR (cm.shift_id IS NULL AND cm.data_date>=v_opened_at AND cm.data_date<=v_closed_at))
      AND cm.data->>'type'='IN'
    GROUP BY COALESCE(cm.data->>'paymentMethod','CASH')
  ) methods;

  v_expected_amount=COALESCE((v_shift_data->>'openingAmount')::numeric,0)+v_total_cash_income-v_total_expense;
  v_difference=p_counted_amount-v_expected_amount;

  v_new_data=v_shift_data || jsonb_build_object(
    'status','CLOSED','totalIncome',v_total_income,'totalExpense',v_total_expense,
    'totalCashIncome',v_total_cash_income,'incomeByMethod',v_income_by_method,
    'expectedAmount',v_expected_amount,'countedAmount',p_counted_amount,
    'difference',v_difference,'closedAt',v_closed_at,'closedBy',auth.uid(),
    'closingNotes',p_notes
  );

  UPDATE public.shifts SET data=v_new_data,version=v_shift_version+1,updated_at=v_closed_at
  WHERE id=p_shift_id AND version=v_shift_version AND business_id=v_shift_business_id AND branch_id=v_shift_branch_id AND data->>'status'='OPEN';
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_CLOSE_CONFLICT'; END IF;

  INSERT INTO public.daily_report_jobs(
    business_id,branch_id,shift_id,business_date,opened_at,closed_at,data_cutoff_at,
    cash_expected,cash_counted,cash_difference,status,next_attempt_at
  ) VALUES (
    v_shift_business_id,v_shift_branch_id,p_shift_id,v_business_day,v_opened_at,v_closed_at,v_closed_at,
    v_expected_amount,p_counted_amount,v_difference,'PENDING',v_closed_at
  ) ON CONFLICT (shift_id) DO NOTHING;

  RETURN QUERY SELECT p_shift_id,v_new_data,v_shift_version+1;
END;
$$;

REVOKE ALL ON FUNCTION public.close_shift_atomic(uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_shift_atomic(uuid,numeric,text) TO authenticated;

COMMIT;
