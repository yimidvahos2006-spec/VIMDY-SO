-- =================================================================
-- VIMDY - CORRECCIÓN DE INVENTARIO, RECETAS Y BORRADO EN CASCADA
-- Ruta del archivo: supabase/migrations/20261023_fix_inventory_recipes.sql
-- =================================================================

-- 1. Eliminar relaciones viejas para reconfigurar el borrado seguro
ALTER TABLE IF EXISTS product_recipes 
  DROP CONSTRAINT IF EXISTS product_recipes_product_id_fkey,
  DROP CONSTRAINT IF EXISTS product_recipes_ingredient_id_fkey;

-- 2. Asegurar borrado en cascada (si borras un producto, sus ingredientes temporales se eliminan)
ALTER TABLE IF EXISTS product_recipes
  ADD CONSTRAINT product_recipes_product_id_fkey 
  FOREIGN KEY (product_id) 
  REFERENCES products(id) 
  ON DELETE CASCADE;

ALTER TABLE IF EXISTS product_recipes
  ADD CONSTRAINT product_recipes_ingredient_id_fkey 
  FOREIGN KEY (ingredient_id) 
  REFERENCES inventory_items(id) 
  ON DELETE CASCADE;

-- 3. Función para descontar inventario en ventas (solo para productos con control de inventario)
CREATE OR REPLACE FUNCTION deduct_inventory_on_sale(p_product_id UUID, p_quantity NUMERIC)
RETURNS VOID AS $$
DECLARE
    r RECORD;
    v_track_inventory BOOLEAN;
BEGIN
    -- Verificar si el producto tiene activado el control de inventario
    SELECT track_inventory INTO v_track_inventory
    FROM products
    WHERE id = p_product_id;

    -- Si el producto NO controla inventario, terminamos la función sin hacer nada
    IF v_track_inventory IS NOT TRUE THEN
        RETURN;
    END IF;

    -- Si controla inventario, recorremos sus ingredientes y descontamos del stock
    FOR r IN 
        SELECT ingredient_id, quantity_required 
        FROM product_recipes 
        WHERE product_id = p_product_id
    LOOP
        -- Descontar el stock actual
        UPDATE inventory_items
        SET current_stock = current_stock - (r.quantity_required * p_quantity),
            updated_at = NOW()
        WHERE id = r.ingredient_id;

        -- Registrar movimiento en el KÁRDEX
        INSERT INTO kardex_movements (
            inventory_item_id,
            movement_type,
            quantity,
            reference_type,
            created_at
        )
        VALUES (
            r.ingredient_id,
            'SALE_OUT',
            (r.quantity_required * p_quantity),
            'POS_ORDER',
            NOW()
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;