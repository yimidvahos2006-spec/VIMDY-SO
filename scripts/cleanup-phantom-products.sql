-- Cleanup script for phantom AI-imported products
-- Run this in the Supabase SQL Editor (Project > SQL Editor)

WITH target_business AS (
  SELECT id FROM businesses WHERE name ILIKE '%Chorizo antioqueño%' LIMIT 1
),
target_category AS (
  SELECT id FROM categories 
  WHERE business_id = (SELECT id FROM target_business) 
    AND name ILIKE '%Platos Principales%'
  LIMIT 1
),
phantom_products AS (
  SELECT p.id, p.name
  FROM products p
  WHERE p.business_id = (SELECT id FROM target_business)
    AND p.category_id = (SELECT id FROM target_category)
    AND p.price = 0
    AND p.stock = 0
)
SELECT id, name FROM phantom_products;

-- To delete them, uncomment the line below:
-- DELETE FROM products WHERE id IN (SELECT id FROM phantom_products);
