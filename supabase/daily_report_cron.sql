-- ============================================================================
-- VIMDY — BACKSTOP DEL REPORTE DIARIO (VAULT)
-- Fuente de verdad del Cron. No contiene secretos en claro.
-- Requiere en Vault:
--   vimdy_daily_report_url
--   vimdy_daily_report_worker_secret
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'vimdy-daily-report-worker';

SELECT cron.schedule(
  'vimdy-daily-report-worker',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'vimdy_daily_report_url'
      LIMIT 1
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-daily-report-secret', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'vimdy_daily_report_worker_secret'
        LIMIT 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $cron$
);
