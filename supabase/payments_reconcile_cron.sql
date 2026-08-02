-- ============================================================================
-- VIMDY — Programar payments-reconcile cada 10 minutos con pg_cron
-- ----------------------------------------------------------------------------
-- SOLO USA ESTE ARCHIVO si tu proyecto de Supabase NO tiene la opción de
-- "Cron Jobs" visible en Edge Functions / Integrations del dashboard. Si sí
-- la tiene, es más simple usar esa pantalla (ahí mismo se configura el
-- header x-reconcile-secret sin tocar SQL) y este archivo no hace falta.
--
-- Cómo usarlo:
--   1) Reemplaza los dos <<...>> de abajo por tus valores reales.
--   2) Pega TODO este archivo en el "SQL Editor" de Supabase y dale "Run".
--   3) Seguro de correr varias veces (unschedule + schedule, no duplica jobs).
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname = 'vimdy-payments-reconcile';

select cron.schedule(
  'vimdy-payments-reconcile',
  '*/10 * * * *', -- cada 10 minutos
  $$
  select net.http_post(
    url := '<<https://TU-PROYECTO.supabase.co/functions/v1/payments-reconcile>>',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reconcile-secret', '<<EL_MISMO_VALOR_QUE_PUSISTE_EN_RECONCILE_SECRET>>'
    ),
    body := '{}'::jsonb
  );
  $$
);