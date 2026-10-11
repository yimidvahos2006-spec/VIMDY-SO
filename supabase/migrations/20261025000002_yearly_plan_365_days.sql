-- =============================================================================
-- 20261025000002_yearly_plan_365_days.sql
-- Precio anual = $599.000 (10 meses de $59.900): "2 meses gratis" => 12 meses de
-- acceso (365 días). Antes el plan anual otorgaba 420 días (14 meses), que con el
-- precio nuevo regalaba 4 meses. Solo cambia la duración de pagos FUTUROS; las
-- suscripciones ya activas conservan su fecha de renovación.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_plan_period_days(p_plan text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_plan = 'monthly' THEN
    RETURN 30;
  ELSIF p_plan = 'yearly' THEN
    RETURN 365;
  END IF;
  RAISE EXCEPTION 'Plan inválido: %', p_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.get_plan_period_days(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plan_period_days(text) TO authenticated, service_role;