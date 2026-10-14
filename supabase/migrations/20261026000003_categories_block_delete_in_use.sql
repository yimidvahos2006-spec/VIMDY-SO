-- ============================================================================
-- 20261026000003_categories_block_delete_in_use.sql
-- ----------------------------------------------------------------------------
-- Una categoria que todavia tiene productos NO se puede borrar.
--
-- La app ya lo revisaba, pero solo con los productos de la sucursal activa y
-- con datos que pueden estar desactualizados. Ahora la base de datos tambien
-- lo exige, mire quien mire y desde donde se borre: ningun producto queda
-- "huerfano" apuntando a una categoria que ya no existe.
--
-- Importante: si se borra el NEGOCIO completo (borrado en cascada), no se
-- bloquea nada: sus categorias y productos se van juntos.
--
-- Es seguro correrlo mas de una vez.
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

  IF EXISTS (
    SELECT 1
    FROM public.products AS product
    WHERE product.business_id = OLD.business_id
      AND product.data->>'categoryId' = OLD.id::text
  ) THEN
    RAISE EXCEPTION 'CATEGORY_IN_USE: la categoria todavia tiene productos'
      USING ERRCODE = 'P0001';
  END IF;

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

COMMIT;