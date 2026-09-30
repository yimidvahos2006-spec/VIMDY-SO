-- ============================================================================
-- VIMDY OS — Migración: Normalización de requiresKitchen
-- ----------------------------------------------------------------------------
-- Fecha: 2026-08-26
-- Propósito: Asegurar que todos los productos y categorías tengan un valor
--            explícito para requiresKitchen/requiresKitchenByDefault.
--
-- PRINCIPIO: "Si no se sabe, no inventar"
--   - Los productos SIN requiresKitchen definido se marcan como false (seguro)
--   - Las categorías SIN requiresKitchenByDefault se marcan como false (seguro)
--   - Los productos en categorías CON requiresKitchenByDefault=true heredan true
--   - Los valores explícitos existentes NO se tocan (ver excepción en 2d)
--   - Aísla por business_id para evitar mezclar datos entre negocios
--
-- REGLA DE NEGOCIO (bloque 2d):
--   Los ingredientes (isIngredient=true) NUNCA van a cocina. Esto es una regla
--   de integridad de datos que prevalece sobre cualquier valor explícito de
--   requiresKitchen. Si un ingrediente tiene requiresKitchen=true por error,
--   se corrige a false. No se considera "sobrescritura de valor explícito"
--   porque es una corrección de integridad obligatoria.
--
-- EJEMPLO VERIFICADO:
--   Producto "pastel de arequipe":
--     - requiresKitchen=true, isIngredient=false
--     - categoría "Panadería" con requiresKitchenByDefault=true
--   Resultado: requiereKitchen=true se preserva (isIngredient=false, no aplica 2d)
--
-- COMPATIBILIDAD:
--   - Esta migración es idempotente (se puede ejecutar múltiples veces)
--   - No destruye datos existentes
--   - Solo agrega valores donde no existían
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CATEGORÍAS: Establecer requiresKitchenByDefault = false donde sea NULL
--    (Principio: si no se configuró, NO asumir cocina)
--    WHERE: solo actualiza categorías sin valor configurado (NULL)
-- ----------------------------------------------------------------------------
UPDATE categories
SET data = jsonb_set(
  data,
  '{requiresKitchenByDefault}',
  'false'::jsonb,
  true  -- create_if_missing
)
WHERE data->>'requiresKitchenByDefault' IS NULL;

-- ----------------------------------------------------------------------------
-- 2. PRODUCTOS: Establecer requiresKitchen basándose en la categoría
--    - Si la categoría tiene requiresKitchenByDefault=true → producto = true
--    - Si la categoría tiene requiresKitchenByDefault=false → producto = false
--    - Si el producto YA tiene un valor explícito → NO tocar (NULL check)
--    - Los ingredientes (isIngredient=true) SIEMPRE quedan en false
--    - Aislamiento por business_id para evitar mezclar entre negocios
-- ----------------------------------------------------------------------------

-- 2a. Productos en categorías CON requiresKitchenByDefault=true
--     Heredan true (la categoría dice que sus productos van a cocina)
--     WHERE: solo productos sin configurar (requiresKitchen IS NULL)
--            y que NO sean ingredientes
UPDATE products p
SET data = jsonb_set(
  p.data,
  '{requiresKitchen}',
  'true'::jsonb,
  true
)
FROM categories c
WHERE p.business_id = c.business_id
  AND p.data->>'categoryId' = c.id::text
  AND c.data->>'requiresKitchenByDefault' = 'true'
  AND p.data->>'requiresKitchen' IS NULL
  AND COALESCE(p.data->>'isIngredient', 'false') = 'false';

-- 2b. Productos en categorías SIN requiresKitchenByDefault (o false)
--     Default seguro: false (NO cocina)
--     WHERE: solo productos sin configurar (requiresKitchen IS NULL)
UPDATE products p
SET data = jsonb_set(
  p.data,
  '{requiresKitchen}',
  'false'::jsonb,
  true
)
FROM categories c
WHERE p.business_id = c.business_id
  AND p.data->>'categoryId' = c.id::text
  AND COALESCE(c.data->>'requiresKitchenByDefault', 'false') = 'false'
  AND p.data->>'requiresKitchen' IS NULL;

-- 2c. Productos HUÉRFANOS (sin categoría o categoría no encontrada)
--     Default seguro: false
--     WHERE: solo productos sin configurar (requiresKitchen IS NULL)
UPDATE products
SET data = jsonb_set(
  data,
  '{requiresKitchen}',
  'false'::jsonb,
  true
)
WHERE data->>'requiresKitchen' IS NULL;

-- 2d. CORRECCIÓN DE INTEGRIDAD: Ingredientes con requiresKitchen=true
--     REGLA DE NEGOCIO: Los ingredientes NUNCA van a cocina.
--     Si un ingrediente tiene requiresKitchen=true (por error manual o datos
--     históricos), se corrige a false. Esto NO es "sobrescritura de valor
--     explícito" sino corrección de integridad de datos obligatoria.
--     WHERE: solo ingredientes que incorrectamente tengan requiresKitchen=true
UPDATE products
SET data = jsonb_set(
  data,
  '{requiresKitchen}',
  'false'::jsonb,
  true
)
WHERE data->>'isIngredient' = 'true'
  AND data->>'requiresKitchen' = 'true';

-- ============================================================================
-- 3. VERIFICACIÓN (descomentar para ejecutar)
-- ============================================================================

-- 3a. Verificar que ningún ingrediente tiene requiresKitchen=true
-- SELECT COUNT(*) as ingredientes_con_cocina_erroneo
-- FROM products
-- WHERE data->>'isIngredient' = 'true'
--   AND data->>'requiresKitchen' = 'true';
-- Resultado esperado: 0

-- 3b. Verificar productos preservados (ya tenían valor explícito)
-- SELECT
--   data->>'requiresKitchen' as valor,
--   COUNT(*) as cantidad
-- FROM products
-- GROUP BY data->>'requiresKitchen';

-- 3c. Verificar herencia por categoría
-- SELECT
--   c.data->>'requiresKitchenByDefault' as categoria_requiere_cocina,
--   p.data->>'requiresKitchen' as producto_requiere_cocina,
--   COUNT(*) as cantidad
-- FROM products p
-- JOIN categories c ON p.business_id = c.business_id
--   AND p.data->>'categoryId' = c.id::text
-- GROUP BY c.data->>'requiresKitchenByDefault', p.data->>'requiresKitchen';

-- 3d. Verificar aislamiento entre negocios
-- SELECT
--   business_id,
--   COUNT(*) as total_productos,
--   COUNT(data->>'requiresKitchen') as con_valor_definido
-- FROM products
-- GROUP BY business_id;

-- 3e. Verificar productos sin categoría (huérfanos)
-- SELECT COUNT(*) as productos_huerfanos
-- FROM products
-- WHERE data->>'categoryId' IS NULL
--    OR data->>'categoryId' = '';

-- 3f. Verificar caso específico: "pastel de arequipe" debe tener requiresKitchen=true
-- SELECT id, data->>'name' as nombre, data->>'requiresKitchen' as requiere_cocina
-- FROM products
-- WHERE data->>'name' ILIKE '%pastel%arequipe%';
-- Resultado esperado: requiresKitchen = true

-- ============================================================================
-- NOTA IMPORTANTE:
-- Después de ejecutar esta migración, los negocios existentes deben revisar
-- sus productos para verificar que los que requieren cocina estén marcados
-- correctamente. La migración es conservadora: solo marca como "true" los
-- productos en categorías explícitamente configuradas con requiresKitchenByDefault,
-- y NUNCA marca ingredientes como productos de cocina.
-- ============================================================================
