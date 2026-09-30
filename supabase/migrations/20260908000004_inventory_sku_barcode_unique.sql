-- ============================================================================
-- INVENTORY UNIQUE CONSTRAINTS — SKU y barcode
-- ============================================================================
-- Alcance:
--   SKU: único por negocio (business_id). Se usa para identificar el mismo
--   producto entre sucursales (transferencias), por lo que no debe repetirse
--   dentro del mismo negocio.
--   Barcode: único por negocio (business_id). Un código de barras representa
--   el mismo producto físico en todas las sucursales.
--
-- Se usan índices parciales porque sku/barcode pueden ser NULL.
-- ============================================================================

-- SKU único por negocio
create unique index if not exists products_business_sku_unique
  on public.products (business_id, (data->>'sku'))
  where (data->>'sku') IS NOT NULL AND (data->>'sku')::text <> '';
-- Barcode único por negocio
create unique index if not exists products_business_barcode_unique
  on public.products (business_id, (data->>'barcode'))
  where (data->>'barcode') IS NOT NULL AND (data->>'barcode')::text <> '';
