-- 20260925130000_dashboard_final_hardening.sql
-- ============================================================================
-- VIMDY — DASHBOARD FINAL HARDENING
-- Migración de fuente de verdad. Es idempotente y segura para aplicar después
-- de la instalación manual.
--
-- Alcance:
--   1) Garantiza que cash_movements.data_date se sincronice desde data.date.
--   2) Añade el UNIQUE INDEX que usan los RPCs con ON CONFLICT (business,branch,key).
--   3) Mantiene updated_at de daily_report_settings automáticamente.
--   4) Permite consultar reportes históricos aunque una sucursal haya sido
--      archivada/inactivada, manteniendo siempre el aislamiento por negocio,
--      sucursal y rol.
--
-- Esta pieza NO depende del historial de migrations de la CLI.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. CASH: data_date siempre consistente con data.date
-- ---------------------------------------------------------------------------
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS data_date timestamptz;

-- El parser de PostgreSQL de este proyecto no expone pg_input_is_valid().
-- Usamos una función defensiva: cualquier timestamp inválido se convierte en
-- NULL en lugar de abortar el INSERT/UPDATE o la migración de backfill.
CREATE OR REPLACE FUNCTION public.vimdy_try_parse_timestamptz(
  p_value text
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;

  RETURN p_value::timestamptz;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.vimdy_try_parse_timestamptz(text) FROM PUBLIC;

-- Helper compatible con el PostgreSQL de Supabase: devuelve NULL si el texto
-- no se puede convertir a timestamptz. Así un dato histórico defectuoso no
-- aborta la migración ni una operación de caja.
CREATE OR REPLACE FUNCTION public.vimdy_try_timestamptz(p_value text)
RETURNS timestamptz
LANGUAGE plpgsql
STRICT
SET search_path = public
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
SET search_path = public
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

-- Backfill seguro de movimientos históricos que todavía no tengan data_date.
UPDATE public.cash_movements
SET data_date = public.vimdy_try_timestamptz(data->>'date')
WHERE data_date IS NULL
  AND data->>'date' IS NOT NULL;

CREATE INDEX IF NOT EXISTS cash_movements_date_idx
  ON public.cash_movements (data_date);

-- ---------------------------------------------------------------------------
-- 2. CASH: UNIQUE INDEX compatible con ON CONFLICT de los RPCs
-- ---------------------------------------------------------------------------
-- Los RPCs de Caja usan:
--   ON CONFLICT (business_id, branch_id, idempotency_key)
-- sin predicado. PostgreSQL no puede inferir aquí un índice UNIQUE parcial,
-- por eso la fuente de verdad debe ser un índice UNIQUE no parcial. Los NULL
-- siguen permitiendo múltiples filas, como requiere el modelo.
DROP INDEX IF EXISTS public.cash_movements_business_branch_idempotency_key_idx;

CREATE UNIQUE INDEX cash_movements_business_branch_idempotency_key_idx
  ON public.cash_movements (business_id, branch_id, idempotency_key);

-- El índice histórico global por idempotency_key ya no forma parte del contrato
-- multi-tenant y puede impedir la misma clave en negocios distintos.
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
-- 4. REPORTES HISTÓRICOS:
--    no se bloquean porque una sucursal esté archivada.
-- ---------------------------------------------------------------------------
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