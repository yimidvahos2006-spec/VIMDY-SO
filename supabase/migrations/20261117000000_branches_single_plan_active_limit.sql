-- ============================================================================
-- Sucursales: límite del plan de 1 sede aplicado EN LA BASE DE DATOS.
--
-- Hasta ahora el límite solo lo aplicaba la pantalla (Configuración > Operación
-- > Sucursales). Quien llamara a la base directamente podía crear más sedes.
--
-- Regla (businesses.plan_tier, ver migración 20261114000000):
--   - 'multi'  -> sin límite de sucursales activas.
--   - 'single' (o cualquier otro valor / sin dato) -> máximo 1 sucursal ACTIVA.
--
-- Qué bloquea:
--   - INSERT de una sucursal activa cuando el negocio ya tiene una activa.
--   - UPDATE que REACTIVA una sucursal (active false -> true) o la MUEVE a otro
--     negocio, si con eso el negocio pasaría de 1 activa.
--
-- Qué NO toca (a propósito):
--   - Negocios que HOY ya tienen 2+ activas en plan single: no se desactiva ni
--     se borra nada. Pueden seguir editando nombre/teléfono y desactivar sedes;
--     solo no podrán sumar otra activa.
--   - Sucursales inactivas: no cuentan para el límite y se pueden crear.
--   - Cambiar el nombre, dirección, teléfono o principal de una sucursal.
--
-- Dos personas creando a la vez no se pueden saltar el límite: la verificación
-- se serializa por negocio con un candado que dura hasta el fin de la
-- transacción.
--
-- Cómo aplicarla: pega TODO este archivo en Supabase > SQL Editor > Run.
-- Es segura de correr más de una vez.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_branch_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tier text;
  v_other_active integer;
BEGIN
  -- Una sucursal inactiva no suma al límite.
  IF NEW.active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Ya estaba activa en el mismo negocio: no cambia la cuenta (permite seguir
  -- editando negocios que hoy ya superan el límite).
  IF TG_OP = 'UPDATE'
     AND OLD.active IS TRUE
     AND OLD.business_id = NEW.business_id THEN
    RETURN NEW;
  END IF;

  -- Una persona a la vez por negocio: evita que dos altas simultáneas pasen
  -- las dos la verificación.
  PERFORM pg_advisory_xact_lock(hashtextextended('branches_plan_limit:' || NEW.business_id::text, 0));

  SELECT plan_tier INTO v_tier
  FROM public.businesses
  WHERE id = NEW.business_id;

  -- Ante la duda (negocio sin dato o valor desconocido) se trata como plan single.
  IF v_tier = 'multi' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_other_active
  FROM public.branches
  WHERE business_id = NEW.business_id
    AND active
    AND id <> NEW.id;

  IF v_other_active >= 1 THEN
    RAISE EXCEPTION
      'BRANCH_PLAN_LIMIT: tu plan incluye 1 sucursal activa. Pasa a Multi-Sucursal para tener más sedes activas.'
      USING ERRCODE = 'check_violation',
            HINT = 'Desactiva la otra sucursal o cambia al plan Multi-Sucursal.';
  END IF;

  RETURN NEW;
END;
$$;

-- Es una función interna del trigger: nadie la llama a mano.
REVOKE ALL ON FUNCTION public.enforce_branch_plan_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS branches_enforce_plan_limit ON public.branches;
CREATE TRIGGER branches_enforce_plan_limit
  BEFORE INSERT OR UPDATE OF active, business_id ON public.branches
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_branch_plan_limit();

COMMIT;

-- ============================================================================
-- VERIFICACIÓN (corre cada bloque por separado, después de aplicar lo de arriba)
-- ============================================================================

-- 1) El candado quedó instalado. Debe devolver 1 fila con enabled = 'O'.
--   SELECT tgname, tgenabled FROM pg_trigger
--   WHERE tgrelid = 'public.branches'::regclass AND tgname = 'branches_enforce_plan_limit';

-- 2) Negocios en plan single que YA tienen más de 1 sucursal activa (no se
--    tocaron; solo para que los conozcas). Lo normal es que no devuelva filas.
--   SELECT b.id, b.name, count(*) AS sucursales_activas
--   FROM public.businesses b
--   JOIN public.branches br ON br.business_id = b.id AND br.active
--   WHERE b.plan_tier = 'single'
--   GROUP BY b.id, b.name
--   HAVING count(*) > 1;

-- 3) Prueba real SIN dejar rastro (termina en ROLLBACK). Cambia el id por el de
--    un negocio en plan single que ya tenga 1 sucursal activa. Debe fallar con
--    "BRANCH_PLAN_LIMIT"; si te deja insertar, avísame.
--   BEGIN;
--   INSERT INTO public.branches (business_id, name)
--   VALUES ('PEGA-AQUI-EL-ID-DEL-NEGOCIO', 'Prueba limite plan');
--   ROLLBACK;

-- ============================================================================
-- IMPORTANTE ANTES DE TENER CLIENTES MULTI-SUCURSAL
-- Nada en el sistema escribe todavía businesses.plan_tier = 'multi' (los
-- webhooks de pago no lo hacen). Mientras eso no exista, TODO negocio queda en
-- 'single' y este candado le impedirá tener 2 sedes activas, aunque haya
-- pagado Multi-Sucursal. Para activar Multi-Sucursal a mano a un cliente:
--   UPDATE public.businesses SET plan_tier = 'multi' WHERE id = 'ID-DEL-NEGOCIO';
-- ============================================================================