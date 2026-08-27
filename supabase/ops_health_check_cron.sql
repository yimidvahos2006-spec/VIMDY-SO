-- ============================================================================
-- VIMDY — Programar ops-health-check cada 15 minutos con pg_cron
-- ----------------------------------------------------------------------------
-- SIN ESTE ARCHIVO, la función ops-health-check (ver
-- supabase/functions/ops-health-check/index.ts) existe pero JAMÁS se
-- ejecuta sola — alguien tendría que llamarla a mano cada vez. Este cron es
-- lo que la vuelve real: cada 15 minutos revisa errores recientes y pagos
-- atascados, y te avisa por webhook SOLO si hay algo raro.
--
-- SOLO USA ESTE ARCHIVO si tu proyecto de Supabase NO tiene la opción de
-- "Cron Jobs" visible en Edge Functions / Integrations del dashboard. Si sí
-- la tiene, es más simple usar esa pantalla (ahí mismo se configura el
-- header x-ops-secret sin tocar SQL) y este archivo no hace falta.
--
-- Cómo usarlo:
--   1) Reemplaza los dos <<...>> de abajo por tus valores reales (el mismo
--      OPS_SECRET que ya configuraste con `supabase secrets set`).
--   2) Pega TODO este archivo en el "SQL Editor" de Supabase y dale "Run".
--   3) Seguro de correr varias veces (unschedule + schedule, no duplica jobs).
--
-- Nota: el intervalo (15 min) coincide con OPS_ERROR_WINDOW_MINUTES en el
-- propio index.ts — si cambias uno, revisa si tiene sentido cambiar el otro.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname = 'vimdy-ops-health-check';

select cron.schedule(
  'vimdy-ops-health-check',
  '*/15 * * * *', -- cada 15 minutos
  $$
  select net.http_post(
    url := '<<https://TU-PROYECTO.supabase.co/functions/v1/ops-health-check>>',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ops-secret', '<<EL_MISMO_VALOR_QUE_PUSISTE_EN_OPS_SECRET>>'
    ),
    body := '{}'::jsonb
  );
  $$
);