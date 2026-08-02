-- ============================================================================
-- fix_cocina_trackstock_migration.sql
-- ----------------------------------------------------------------------------
-- Corrige en masa los productos que YA existen en tu base de datos y que
-- quedaron atrapados por el bug reportado en el video del 2026-07-31:
-- un producto tipo "Cocina" (requiresKitchen = true) SIN receta -- como
-- "Caldo de Costilla" -- se guardaba con trackStock = true (o sin el campo
-- definido), así que Caja siempre le exigía stock disponible aunque el
-- propio formulario dijera "no maneja stock propio". Con stock 0 (el
-- formulario ni siquiera muestra el campo de stock para este tipo), la
-- venta quedaba bloqueada para siempre.
--
-- El fix de código (SalesEngine.ts, InventoryEngine.ts, InventoryDashboard.tsx)
-- ya arregla esto para productos NUEVOS o que vuelvas a guardar desde el
-- formulario. Este script arregla los que YA EXISTEN, sin que tengas que
-- abrir y volver a guardar cada uno a mano.
--
-- Qué hace exactamente: en la tabla `products`, para cada fila donde
--   - requiresKitchen = true          (es un producto de Cocina)
--   - NO tiene receta (recipe vacío o ausente)   -> no es "Cocina con receta"
--   - trackStock todavía no es exactamente false -> no se ha corregido
-- ...pone trackStock = false dentro del jsonb `data`, exactamente el mismo
-- valor que ahora guarda el formulario ya corregido para este tipo de
-- producto.
--
-- Qué NO toca:
--   - Productos "Inventario" (requiresKitchen = false): siguen exigiendo y
--     descontando stock exactamente igual que siempre.
--   - Productos "Cocina con receta" (tienen `recipe`): su propio stock
--     nunca se tocaba de todos modos -- se descuentan los ingredientes.
--   - Productos "Servicio" (trackStock ya en false): no cambian.
--   - El stock actual guardado en cada producto (`stock`): se deja tal
--     cual está: como ya no se exige/descuenta para estos productos, el
--     número deja de importar para la venta.
--
-- Cómo aplicar:
--   1. Corre primero el SELECT de la sección "PREVIEW" (más abajo) y
--      revisa que la lista de productos que muestra sea la que esperas
--      corregir (tus platos de Cocina sin receta: sopas, platos del día,
--      etc). Si ves algo que NO debería estar ahí, avísame antes de seguir.
--   2. Si la lista se ve bien, corre el UPDATE de la sección "APLICAR".
--   3. Es seguro correr el UPDATE más de una vez: la segunda vez no
--      encontrará filas que corregir (el WHERE ya las excluye).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PREVIEW — revisa esta lista ANTES de aplicar el UPDATE de más abajo.
-- ----------------------------------------------------------------------------
select
  id,
  business_id,
  data->>'name' as nombre,
  data->>'stock' as stock_actual,
  data->>'requiresKitchen' as requires_kitchen,
  data->>'trackStock' as track_stock_actual
from products
where coalesce((data->>'requiresKitchen')::boolean, false) = true
  and (
    data->'recipe' is null
    or jsonb_typeof(data->'recipe') <> 'array'
    or jsonb_array_length(data->'recipe') = 0
  )
  and coalesce((data->>'trackStock')::boolean, true) = true
order by data->>'name';

-- ----------------------------------------------------------------------------
-- APLICAR — corre esto solo después de revisar el PREVIEW de arriba.
-- ----------------------------------------------------------------------------
update products
set
  data = jsonb_set(data, '{trackStock}', 'false'::jsonb, true),
  updated_at = now()
where coalesce((data->>'requiresKitchen')::boolean, false) = true
  and (
    data->'recipe' is null
    or jsonb_typeof(data->'recipe') <> 'array'
    or jsonb_array_length(data->'recipe') = 0
  )
  and coalesce((data->>'trackStock')::boolean, true) = true;

-- ----------------------------------------------------------------------------
-- VERIFICAR — confirma que ya no quede ningún producto de Cocina sin
-- receta con trackStock distinto de false (debería devolver 0 filas).
-- ----------------------------------------------------------------------------
select id, data->>'name' as nombre
from products
where coalesce((data->>'requiresKitchen')::boolean, false) = true
  and (
    data->'recipe' is null
    or jsonb_typeof(data->'recipe') <> 'array'
    or jsonb_array_length(data->'recipe') = 0
  )
  and coalesce((data->>'trackStock')::boolean, true) = true;