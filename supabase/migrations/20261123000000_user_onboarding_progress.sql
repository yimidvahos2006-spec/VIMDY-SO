-- ============================================================================
-- VIMDY — Bot Guía de 3 minutos: tabla user_onboarding_progress
-- ----------------------------------------------------------------------------
-- * Cambio aditivo: crea una tabla nueva, no toca ninguna tabla existente.
-- * Idempotente: se puede correr más de una vez sin romper nada.
-- * Multi-tenant: business_id (igual que el resto de VIMDY OS) + RLS.
-- * Una fila por (persona, negocio, tour). Cada persona solo ve y escribe LA
--   SUYA: ningún rol (ni ADMIN) lee el progreso de otro usuario.
-- * Sin chequeo de suscripción: el tour no es un dato del negocio, y nunca
--   debe romperse porque el plan venció.
-- * Backfill: las personas que YA operan un negocio con el onboarding
--   terminado se marcan como 'completed' para que, al desplegar esto, no les
--   aparezca un tour de bienvenida. Quien entre después (nuevo negocio, nuevo
--   cajero invitado) sí lo recibe.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.user_onboarding_progress (
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  tour_id         text NOT NULL DEFAULT 'first_minutes_v1'
                  CONSTRAINT user_onboarding_progress_tour_id_check
                  CHECK (char_length(tour_id) BETWEEN 1 AND 64),
  status          text NOT NULL DEFAULT 'in_progress'
                  CONSTRAINT user_onboarding_progress_status_check
                  CHECK (status IN ('in_progress', 'completed', 'skipped')),
  current_step    text
                  CONSTRAINT user_onboarding_progress_current_step_check
                  CHECK (current_step IS NULL OR char_length(current_step) <= 64),
  completed_steps text[] NOT NULL DEFAULT '{}'::text[]
                  CONSTRAINT user_onboarding_progress_completed_steps_check
                  CHECK (cardinality(completed_steps) <= 20),
  completed_at    timestamptz,
  skipped_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, business_id, tour_id)
);

COMMENT ON TABLE public.user_onboarding_progress IS
  'Progreso del tour guiado de bienvenida por persona y negocio. Cada usuario solo accede a su propia fila (RLS).';

-- Mantiene updated_at sin confiar en el cliente.
CREATE OR REPLACE FUNCTION public.user_onboarding_progress_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS user_onboarding_progress_touch ON public.user_onboarding_progress;
CREATE TRIGGER user_onboarding_progress_touch
  BEFORE UPDATE ON public.user_onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION public.user_onboarding_progress_touch();

ALTER TABLE public.user_onboarding_progress ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_onboarding_progress FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.user_onboarding_progress TO authenticated;
GRANT ALL ON public.user_onboarding_progress TO service_role;

-- (select auth.uid()) evita reevaluar la función por cada fila.
DROP POLICY IF EXISTS user_onboarding_progress_select ON public.user_onboarding_progress;
CREATE POLICY user_onboarding_progress_select ON public.user_onboarding_progress
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND business_id IN (SELECT public.auth_business_ids())
  );

DROP POLICY IF EXISTS user_onboarding_progress_insert ON public.user_onboarding_progress;
CREATE POLICY user_onboarding_progress_insert ON public.user_onboarding_progress
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND business_id IN (SELECT public.auth_business_ids())
  );

DROP POLICY IF EXISTS user_onboarding_progress_update ON public.user_onboarding_progress;
CREATE POLICY user_onboarding_progress_update ON public.user_onboarding_progress
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND business_id IN (SELECT public.auth_business_ids())
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND business_id IN (SELECT public.auth_business_ids())
  );

-- Sin policy de DELETE a propósito: "repetir el tour" es un UPDATE a in_progress.

-- Backfill: quien ya opera un negocio con onboarding terminado no recibe el tour.
INSERT INTO public.user_onboarding_progress
  (user_id, business_id, tour_id, status, completed_at)
SELECT m.user_id, m.business_id, 'first_minutes_v1', 'completed', now()
FROM public.business_members AS m
JOIN public.businesses AS b ON b.id = m.business_id
WHERE b.onboarding_completed = true
ON CONFLICT (user_id, business_id, tour_id) DO NOTHING;

COMMIT;