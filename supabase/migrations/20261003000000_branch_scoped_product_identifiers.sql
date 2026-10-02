BEGIN;

DROP INDEX IF EXISTS public.products_business_sku_unique;
DROP INDEX IF EXISTS public.products_business_barcode_unique;

CREATE UNIQUE INDEX products_branch_sku_unique
  ON public.products (business_id, branch_id, (data->>'sku'))
  WHERE branch_id IS NOT NULL
    AND NULLIF(pg_catalog.btrim(data->>'sku'), '') IS NOT NULL;

CREATE UNIQUE INDEX products_shared_business_sku_unique
  ON public.products (business_id, (data->>'sku'))
  WHERE branch_id IS NULL
    AND NULLIF(pg_catalog.btrim(data->>'sku'), '') IS NOT NULL;

CREATE UNIQUE INDEX products_branch_barcode_unique
  ON public.products (business_id, branch_id, (data->>'barcode'))
  WHERE branch_id IS NOT NULL
    AND NULLIF(pg_catalog.btrim(data->>'barcode'), '') IS NOT NULL;

CREATE UNIQUE INDEX products_shared_business_barcode_unique
  ON public.products (business_id, (data->>'barcode'))
  WHERE branch_id IS NULL
    AND NULLIF(pg_catalog.btrim(data->>'barcode'), '') IS NOT NULL;

COMMIT;
