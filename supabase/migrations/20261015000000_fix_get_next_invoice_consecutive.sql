-- ============================================================================
-- 20261015000000_fix_get_next_invoice_consecutive.sql
-- ----------------------------------------------------------------------------
-- Correccion de una regresion introducida en Paso 8
-- (20261014000000_step8_security_hardening.sql).
--
-- QUE ROMPIO
-- ----------
-- 1) get_next_invoice_consecutive(uuid)
--    Paso 8 aplico `ALTER FUNCTION ... SET search_path = ''` sin cualificar las
--    referencias del cuerpo. Con el search_path vacio, `FROM businesses` dejo de
--    resolver y la funcion fallo con:
--        ERROR: relation "businesses" does not exist
--    Es decir, la numeracion de facturas electronicas DIAN quedo rota.
--
-- 2) get_next_invoice_consecutive()  -- overload SIN argumentos
--    Paso 8 la CREO. No existia en ninguna migracion previa (verificado con
--    git log -S: el unico origen es la migracion de Paso 8). Ademas se le dio
--    un cuerpo que usa nextval('public.invoice_number_seq'), y esa secuencia
--    NO EXISTE: el esquema public no tiene ninguna relacion de tipo 'S'.
--    Nadie la consume: el unico llamador real es
--    supabase/functions/dian-invoice/index.ts, que usa la variante uuid.
--
-- MECANISMO REAL DE NUMERACION (recuperado de git)
-- ----------------------------------------------
-- No hay secuencia. El consecutivo vive en la TABLA:
--     businesses.invoice_consecutive_current
-- con rango businesses.invoice_consecutive_from .. invoice_consecutive_to y
-- prefijo businesses.invoice_prefix. El lock es `FOR UPDATE` sobre la fila del
-- negocio, lo que serializa a dos emisores concurrentes.
--
-- ORIGEN: commit 7398a91f, archivo supabase/migrations/20260916000002_dian_hardening.sql
--
-- QUE HACE ESTA MIGRACION
-- -----------------------
-- 1. Restaura get_next_invoice_consecutive(uuid) con el cuerpo ORIGINAL intacto,
--    conservando SET search_path = '' y cualificando `public.businesses`.
--    La semantica funcional no cambia: mismos defaults, mismo LPAD, mismos
--    errores (DIAN_NOT_CONFIGURED, NUMERATION_EXHAUSTED), mismo lock.
-- 2. Elimina el overload sin argumentos, que nunca existio y no tiene consumidor.
--
-- Se mantiene el hardening de Paso 8:
--   * search_path vacio,
--   * SECURITY DEFINER,
--   * sin recreacion de permisos: el overload uuid conserva el
--     `GRANT EXECUTE TO authenticated, service_role` historico y NO se
--     reabre el acceso a PUBLIC ni a anon.
--
-- Migracion NUEVA: no se modifica ninguna migracion historica.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Restaurar la sobrecarga real (uuid) con search_path fijo y tabla calificada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_next_invoice_consecutive(p_business_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  prefix_value text;
  current_num numeric;
  from_num numeric;
  to_num numeric;
  next_num numeric;
  formatted_num text;
BEGIN
  -- Lock the business row to prevent race conditions
  PERFORM 1 FROM public.businesses
  WHERE id = p_business_id
  AND electronic_invoicing_enabled = true
  AND electronic_invoicing_provider = 'dian'
  FOR UPDATE;

  SELECT
    COALESCE(invoice_prefix, 'FV'),
    invoice_consecutive_current,
    invoice_consecutive_from,
    invoice_consecutive_to
  INTO
    prefix_value, current_num, from_num, to_num
  FROM public.businesses
  WHERE id = p_business_id
  AND electronic_invoicing_enabled = true
  AND electronic_invoicing_provider = 'dian'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DIAN_NOT_CONFIGURED: el negocio no tiene facturación DIAN habilitada';
  END IF;

  from_num := COALESCE(from_num, 1);
  to_num := COALESCE(to_num, 999999999);
  current_num := COALESCE(current_num, from_num - 1);

  next_num := current_num + 1;

  IF next_num < from_num THEN
    next_num := from_num;
  END IF;

  IF next_num > to_num THEN
    RAISE EXCEPTION 'NUMERATION_EXHAUSTED: el rango de numeración (%-%) está agotado.', from_num, to_num;
  END IF;

  formatted_num := prefix_value || LPAD(next_num::text, 8, '0');

  UPDATE public.businesses
  SET invoice_consecutive_current = next_num
  WHERE id = p_business_id;

  RETURN formatted_num;
END;
$$;

COMMENT ON FUNCTION public.get_next_invoice_consecutive(uuid) IS
  'Consecutivo de factura electronica DIAN. Usa businesses.invoice_consecutive_current (no hay secuencia) con lock FOR UPDATE sobre la fila del negocio. search_path vacio por hardening de Paso 8; cuerpo identico al original de 20260916000002_dian_hardening.sql.';

-- El permiso historico se mantiene; no se reabre PUBLIC ni anon.
REVOKE ALL ON FUNCTION public.get_next_invoice_consecutive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_next_invoice_consecutive(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Eliminar el overload sin argumentos (creado en Paso 8, sin consumidor)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_next_invoice_consecutive();

COMMIT;