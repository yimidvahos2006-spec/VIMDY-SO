-- La categoria solo se bloquea si tiene productos ACTIVOS.
-- El mensaje ahora incluye cuantos son: CATEGORY_IN_USE:<numero>.
-- Los desactivados (borrado suave) pasan a "uncategorized".
CREATE OR REPLACE FUNCTION public.block_category_delete_when_in_use()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  active_count integer;
BEGIN
  -- Borrado en cascada del negocio: el negocio ya no existe, no se bloquea.
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses AS business WHERE business.id = OLD.business_id
  ) THEN
    RETURN OLD;
  END IF;

  SELECT count(*) INTO active_count
  FROM public.products AS product
  WHERE product.business_id = OLD.business_id
    AND product.data->>'categoryId' = OLD.id::text
    AND COALESCE((product.data->>'active')::boolean, true);

  IF active_count > 0 THEN
    RAISE EXCEPTION 'CATEGORY_IN_USE:%', active_count
      USING ERRCODE = 'P0001',
            DETAIL = 'La categoria todavia tiene productos activos';
  END IF;

  UPDATE public.products AS product
  SET data = jsonb_set(product.data, '{categoryId}', to_jsonb('uncategorized'::text))
  WHERE product.business_id = OLD.business_id
    AND product.data->>'categoryId' = OLD.id::text;

  RETURN OLD;
END;
$function$;