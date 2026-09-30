-- ============================================================================
-- VIMDY — DASHBOARD FINAL HARDENING v3 (POST-INSTALL)
-- Ejecutar UNA sola vez en Supabase SQL Editor.
-- Compatible con PostgreSQL 15+ (no usa pg_input_is_valid).
--
-- Alcance:
--   1) Mantener cash_movements.data_date sincronizada con data.date.
--   2) Backfill seguro de data_date sin abortar por fechas JSON inválidas.
--   3) Crear el índice UNIQUE compuesto que usan los RPCs de Caja.
--   4) Mantener updated_at de daily_report_settings automáticamente.
--   5) Mantener RLS de reportes restringida a ADMIN/GERENTE/CONTADOR.
--
-- IMPORTANTE:
--   PostgreSQL 15 no dispone de pg_input_is_valid(text, regtype). Se utiliza
--   una función PL/pgSQL con EXCEPTION para hacer el cast de forma segura.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. CASH: data_date siempre consistente con data.date
-- ---------------------------------------------------------------------------
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS data_date timestamptz;

-- Helper compatible con PostgreSQL 15: devuelve NULL si el texto no es una
-- fecha válida. No hace fallar el cierre ni un backfill histórico.
CREATE OR REPLACE FUNCTION public.vimdy_try_timestamptz(p_value text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
BEGIN
  RETURN p_value::timestamptz;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_cash_movements_data_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.data_date := public.vimdy_try_timestamptz(NEW.data->>'date');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cash_movements_data_date_sync
  ON public.cash_movements;

CREATE TRIGGER cash_movements_data_date_sync
BEFORE INSERT OR UPDATE OF data
ON public.cash_movements
FOR EACH ROW
EXECUTE FUNCTION public.sync_cash_movements_data_date();

-- Backfill seguro: los valores no parseables quedan NULL, sin abortar toda la
-- transacción. Los movimientos con shift_id siguen pudiendo ser asociados al
-- turno directamente por los RPCs/reporte.
UPDATE public.cash_movements
SET data_date = public.vimdy_try_timestamptz(data->>'date')
WHERE data_date IS NULL
  AND data->>'date' IS NOT NULL;

CREATE INDEX IF NOT EXISTS cash_movements_date_idx
  ON public.cash_movements (data_date);

-- ---------------------------------------------------------------------------
-- 2. CASH: UNIQUE compuesto compatible con ON CONFLICT de los RPCs
-- ---------------------------------------------------------------------------
-- Un índice UNIQUE normal ya permite múltiples NULL en idempotency_key, por lo
-- que no necesita predicate. Esto permite que
-- ON CONFLICT (business_id, branch_id, idempotency_key) haga inferencia directa.
CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_business_branch_idempotency_idx
  ON public.cash_movements (business_id, branch_id, idempotency_key);

-- El índice global anterior ya no es necesario para el contrato multi-tenant.
-- Se elimina DESPUÉS de crear el índice compuesto.
DROP INDEX IF EXISTS public.cash_movements_idempotency_key_idx;

-- ---------------------------------------------------------------------------
-- 3. REPORT SETTINGS: updated_at automático
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_daily_report_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_report_settings_updated_at
  ON public.daily_report_settings;

CREATE TRIGGER daily_report_settings_updated_at
BEFORE UPDATE
ON public.daily_report_settings
FOR EACH ROW
EXECUTE FUNCTION public.touch_daily_report_settings_updated_at();

-- ---------------------------------------------------------------------------
-- 4. REPORTES: RLS final para lectura desde el cliente
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS daily_report_jobs_member_select
  ON public.daily_report_jobs;
DROP POLICY IF EXISTS daily_report_jobs_management_select
  ON public.daily_report_jobs;

CREATE POLICY daily_report_jobs_management_select
ON public.daily_report_jobs
FOR SELECT TO authenticated
USING (
  (select public.has_business_role(
    business_id,
    ARRAY['ADMIN','GERENTE','CONTADOR']
  ))
  AND EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = daily_report_jobs.business_id
      AND bm.user_id = (select auth.uid())
  )
  AND EXISTS (
    SELECT 1
    FROM public.branches br
    WHERE br.id = daily_report_jobs.branch_id
      AND br.business_id = daily_report_jobs.business_id
  )
);

DROP POLICY IF EXISTS daily_report_deliveries_member_select
  ON public.daily_report_deliveries;
DROP POLICY IF EXISTS daily_report_deliveries_management_select
  ON public.daily_report_deliveries;

CREATE POLICY daily_report_deliveries_management_select
ON public.daily_report_deliveries
FOR SELECT TO authenticated
USING (
  (select public.has_business_role(
    business_id,
    ARRAY['ADMIN','GERENTE','CONTADOR']
  ))
  AND EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = daily_report_deliveries.business_id
      AND bm.user_id = (select auth.uid())
  )
);

COMMIT;