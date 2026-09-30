-- VIMDY — Fix daily-report worker RPC authorization
--
-- Root cause:
-- The worker call reaches PostgREST using the service-role credential, but the
-- old RPCs tried to reconstruct that caller identity from the request JWT claim
-- setting. In this deployment path that setting is not reliable, even though
-- the request is legitimately authorized as the service_role database role.
--
-- Security model used here:
--   * SECURITY DEFINER remains enabled.
--   * EXECUTE is revoked from PUBLIC.
--   * EXECUTE is granted ONLY to service_role.
-- Therefore the Data API/PostgREST authorization layer is the gate for these
-- privileged worker RPCs. No user role receives EXECUTE.
--
-- This also works with Supabase's current secret-key based service-role access,
-- where there may not be a user JWT claim available to inspect.

CREATE OR REPLACE FUNCTION public.claim_daily_report_jobs(
  p_business_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_shift_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS SETOF public.daily_report_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
    FROM public.daily_report_jobs j
    WHERE (
      (j.status IN ('PENDING','RETRY','PARTIAL','WAITING_CONFIGURATION') AND j.next_attempt_at <= clock_timestamp())
      OR (j.status = 'PROCESSING' AND j.locked_until IS NOT NULL AND j.locked_until < clock_timestamp())
    )
    AND (p_business_id IS NULL OR j.business_id = p_business_id)
    AND (p_branch_id IS NULL OR j.branch_id = p_branch_id)
    AND (p_shift_id IS NULL OR j.shift_id = p_shift_id)
    ORDER BY j.next_attempt_at, j.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 50))
  )
  UPDATE public.daily_report_jobs j
  SET status = 'PROCESSING',
      attempts = j.attempts + 1,
      locked_until = clock_timestamp() + interval '2 minutes',
      updated_at = clock_timestamp()
  WHERE j.id IN (SELECT id FROM candidates)
  RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_daily_report_deliveries(
  p_job_id uuid,
  p_limit integer DEFAULT 20
)
RETURNS SETOF public.daily_report_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
    FROM public.daily_report_deliveries d
    WHERE d.job_id = p_job_id
      AND (
        (d.status IN ('PENDING','RETRY') AND d.next_attempt_at <= clock_timestamp())
        OR (d.status = 'PROCESSING' AND d.locked_until IS NOT NULL AND d.locked_until < clock_timestamp())
      )
    ORDER BY d.next_attempt_at, d.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 50))
  )
  UPDATE public.daily_report_deliveries d
  SET status = 'PROCESSING',
      attempts = d.attempts + 1,
      locked_until = clock_timestamp() + interval '2 minutes',
      updated_at = clock_timestamp()
  WHERE d.id IN (SELECT id FROM candidates)
  RETURNING d.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_daily_report_jobs(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_daily_report_jobs(uuid,uuid,uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_daily_report_deliveries(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_daily_report_deliveries(uuid,integer) TO service_role;

-- Defensive privilege assertion for auditing.
DO $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.claim_daily_report_jobs(uuid,uuid,uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'DAILY_REPORT_WORKER_PRIVILEGE_MISSING';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.claim_daily_report_deliveries(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'DAILY_REPORT_DELIVERY_WORKER_PRIVILEGE_MISSING';
  END IF;
END;
$$;
