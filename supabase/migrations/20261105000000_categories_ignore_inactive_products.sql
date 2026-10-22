-- ============================================================================
-- 20261105000000_categories_ignore_inactive_products.sql
-- ----------------------------------------------------------------------------
-- Antes: el bloqueo de borrar categorias contaba TODOS los productos, tambien
-- los desactivados (borrado suave, active=false). Esos productos no se ven en
-- la pantalla, y la categoria quedaba "con productos" sin que nadie los viera.
--
-- Ahora:
--   1. Si la categoria solo tiene productos DESACTIVADOS, se puede borrar y
--      esos productos pasan solos a 'uncategorized' (Sin categoria), en la
--      misma transaccion. El historial de ventas y kardex no se toca.
--   2. Si tiene al menos un producto ACTIVO, se sigue bloqueando (CATEGORY_IN_USE).
--   3. Indice para que la revision sea rapida aunque haya muchos productos.
--   4. REPLICA IDENTITY FULL en products y categories, para que los avisos
--      en tiempo real de borrado lleguen completos a los otros equipos.
--
-- Es seguro correrlo mas de una vez. No borra ni cambia ningun dato existente.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.block_category_delete_when_in_use()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Borrado en cascada del negocio: el negocio ya no existe, no se bloquea.
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses AS business WHERE business.id = OLD.business_id
  ) THEN
    RETURN OLD;
  END IF;

  -- Solo cuentan los productos ACTIVOS (sin el campo active = activo).
  IF EXISTS (
    SELECT 1
    FROM public.products AS product
    WHERE product.business_id = OLD.business_id
      AND product.data->>'categoryId' = OLD.id::text
      AND COALESCE((product.data->>'active')::boolean, true)
  ) THEN
    RAISE EXCEPTION 'CATEGORY_IN_USE: la categoria todavia tiene productos activos'
      USING ERRCODE = 'P0001';
  END IF;

  -- Los desactivados (borrado suave) pasan a "Sin categoria", sin perder historial.
  UPDATE public.products AS product
  SET data = jsonb_set(product.data, '{categoryId}', to_jsonb('uncategorized'::text))
  WHERE product.business_id = OLD.business_id
    AND product.data->>'categoryId' = OLD.id::text;

  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.block_category_delete_when_in_use() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_category_delete_when_in_use() FROM anon;
REVOKE ALL ON FUNCTION public.block_category_delete_when_in_use() FROM authenticated;

DROP TRIGGER IF EXISTS trg_block_category_delete_in_use ON public.categories;
CREATE TRIGGER trg_block_category_delete_in_use
  BEFORE DELETE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.block_category_delete_when_in_use();

CREATE INDEX IF NOT EXISTS idx_products_business_category
  ON public.products (business_id, (data->>'categoryId'));

ALTER TABLE public.products REPLICA IDENTITY FULL;
ALTER TABLE public.categories REPLICA IDENTITY FULL;

COMMIT;
