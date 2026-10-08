-- ============================================================================
-- 20261006000001_validate_business_type
-- ============================================================================
-- Valida el tipo de negocio elegido por el Paso 1 de onboarding.
-- Mantiene los valores legacy existentes y rechaza cualquier valor nuevo
-- que no pertenezca al catálogo de VIMDY.
-- ============================================================================

ALTER TABLE "public"."businesses"
  DROP CONSTRAINT IF EXISTS "businesses_business_type_check";

ALTER TABLE "public"."businesses"
  ADD CONSTRAINT "businesses_business_type_check"
  CHECK (
    business_type IS NULL
    OR business_type IN (
      'restaurante',
      'cafeteria',
      'pizzeria',
      'asadero',
      'bar',
      'panaderia',
      'heladeria',
      'food_truck',
      'comida_rapida',
      'negocio_bebidas',
      'pasteleria',
      'reposteria',
      'jugueria',
      'catering',
      'comedor',
      'cadena',
      'tienda',
      'hotel',
      'minimercado',
      'pequeno_supermercado',
      'negocio_productos',
      'negocio_servicios',
      'otro'
    )
  );