-- ============================================================================
-- VIMDY OS — Funciones auxiliares para monitoreo de base de datos
-- ----------------------------------------------------------------------------
-- Funciones SQL que usa ops-monitor para obtener métricas del sistema.
-- No modifican datos, solo consultan estadísticas de PostgreSQL.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tamaño de la base de datos actual (wrapper sin conflicto de nombre)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_db_size_bytes()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT pg_database_size(current_database());
$$;

REVOKE ALL ON FUNCTION get_db_size_bytes() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_db_size_bytes() TO service_role, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Ratio de cache hit (porcentaje de lecturas servidas desde cache)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_cache_hit_ratio()
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN (sum(blks_hit) + sum(blks_read)) = 0 THEN 99.0
      ELSE round((sum(blks_hit)::numeric / (sum(blks_hit) + sum(blks_read))::numeric) * 100, 1)
    END
  FROM pg_stat_database
  WHERE datname = current_database();
$$;

REVOKE ALL ON FUNCTION get_cache_hit_ratio() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_cache_hit_ratio() TO service_role, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Métricas completas de base de datos (JSON)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_db_metrics()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'db_size_bytes', get_db_size_bytes(),
    'db_size_mb', round(get_db_size_bytes() / 1048576.0, 2),
    'active_connections', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()),
    'max_connections', 200,
    'cache_hit_ratio', (SELECT get_cache_hit_ratio()),
    'database_name', current_database()
  );
$$;

REVOKE ALL ON FUNCTION get_db_metrics() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_db_metrics() TO service_role, authenticated;

-- ============================================================================
-- FIN DE MIGRACIÓN
-- ============================================================================
