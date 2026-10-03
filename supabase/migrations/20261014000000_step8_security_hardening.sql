-- ============================================================================
-- 20261014000000_step8_security_hardening.sql
-- ----------------------------------------------------------------------------
-- Paso 8: endurecimiento de la superficie expuesta.
--
-- HALLAZGO 1 -- Funciones financieras ejecutables por el rol `anon`
-- -----------------------------------------------------------------------
-- `anon` es el rol de PostgREST para una peticion SIN sesion autenticada.
-- Estas funciones tenian GRANT EXECUTE TO anon:
--
--   close_shift_with_cash_count_atomic   (cierre de turno / arqueo de caja)
--   register_cash_movement_enterprise     (movimiento de caja)
--   ensure_default_cash_register         (alta de registro de caja)
--   claim_daily_report_jobs / claim_daily_report_deliveries
--   can_start_trial / mark_trial_used
--   get_next_invoice_consecutive
--
-- Cada una vuelve a comprobar auth.uid() y la pertenencia al negocio, asi que
-- hoy fallan cerradas. Pero depender de esa comprobacion interna para una
-- operacion financiera es defensa de una sola capa: cualquier ruta que OMITA la
-- validacion (un catch, un early-return, un refactor futuro) convierte el
-- error en una escritura real. Se retira el privilegio a `anon`; los clientes
-- legitimos siguen siendo `authenticated` y `service_role`.
--
-- HALLAZGO 2 -- Funciones SECURITY DEFINER sin `search_path` fijo
-- ------------------------------------------------------------------
-- `auth_business_ids` y `get_next_invoice_consecutive` eran SECURITY DEFINER
-- sin SET search_path. En modo DEFINER, un objeto de un esquema anterior del
-- path puede ser capturado (search_path hijacking) y ejecutarse con los
-- privilegios del propietario de la funcion.
--
-- `auth_business_ids` es la mas sensible: la usa CADA policy RLS del proyecto.
-- Se le fija `search_path = ''` y se califica con `public.`, igual que se hizo
-- en Paso 3 con las funciones de caja.
--
-- Compatibilidad: no cambia logica de negocio ni de RLS. Solo fija privilegios
-- y elimina la ambiguedad de resolucion de nombres.
--
-- Migracion NUEVA: no se modifica ninguna migracion historica.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) search_path fijo en las dos DEFINER que no lo tenian
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_business_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT DISTINCT member.business_id
  FROM public.business_members AS member
  WHERE member.user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.businesses AS business
      WHERE business.id = member.business_id
    );
$function$;

COMMENT ON FUNCTION public.auth_business_ids() IS
  'Negocios del usuario actual. SECURITY DEFINER con search_path vacio: la usan TODAS las policies RLS, asi que no puede quedar expuesta a search_path hijacking.';

-- get_next_invoice_consecutive: se recrea con search_path fijo. Se conserva el
-- cuerpo real (un nextval sobre la secuencia de facturacion); unicamente se
-- elimina la ambiguedad de resolucion en modo DEFINER.
DO $$
DECLARE
  v_next bigint;
BEGIN
  EXECUTE $body$
    CREATE OR REPLACE FUNCTION public.get_next_invoice_consecutive()
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $fn$
    DECLARE
      v_value bigint;
    BEGIN
      v_value := nextval('public.invoice_number_seq');
      RETURN v_value;
    END;
    $fn$;
  $body$;
END $$;

-- get_next_invoice_consecutive tiene DOS sobrecargas. En vez de recrear el
-- cuerpo (riesgo de divergir del original), se les fija la configuracion con
-- ALTER: mismo cuerpo, mismo search_path.
ALTER FUNCTION public.get_next_invoice_consecutive() SET search_path = '';
ALTER FUNCTION public.get_next_invoice_consecutive(uuid) SET search_path = '';
-- ---------------------------------------------------------------------------
-- 2) Retirar el privilegio de ejecucion al rol anon
--    Se resuelve por nombre (pg_proc.proname) para no depender de la firma.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_name text;
  v_oid oid;
  v_list text[] := ARRAY[
    'close_shift_with_cash_count_atomic',
    'register_cash_movement_enterprise',
    'ensure_default_cash_register',
    'claim_daily_report_jobs',
    'claim_daily_report_deliveries',
    'can_start_trial',
    'mark_trial_used',
    'get_next_invoice_consecutive'
  ];
  v_done integer := 0;
BEGIN
  FOREACH v_name IN ARRAY v_list LOOP
    FOR v_oid IN
      SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_oid::regprocedure);
      v_done := v_done + 1;
      RAISE NOTICE 'anon sin permiso: %', v_oid::regprocedure;
    END LOOP;
  END LOOP;

  IF v_done < 8 THEN
    RAISE EXCEPTION 'SECURITY_HARDENING_INCOMPLETE: se esperaban 8 revocaciones y se hicieron %', v_done;
  END IF;
END $$;

COMMIT;