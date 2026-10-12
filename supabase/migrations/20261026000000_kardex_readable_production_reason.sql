-- Kardex legible para producción por tandas y transferencias.
--
-- Qué arregla:
--   * El Kardex mostraba códigos internos ("BATCH_PRODUCTION", "TRANSFER_OUT")
--     en vez de un texto que entienda el dueño.
--   * La referencia de la tanda (PROD-XXXXXXXX) que ve el usuario al producir
--     no quedaba guardada en el Kardex.
--   * Los movimientos de estas operaciones no guardaban stock anterior /
--     posterior (los demás movimientos del Kardex sí).
--
-- Solo cambia la función apply_inventory_operation_delta. Misma firma,
-- mismos permisos, misma lógica de stock. No toca datos existentes.

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_inventory_operation_delta(
  p_operation_id text,
  p_product_id uuid,
  p_branch_id uuid,
  p_delta numeric,
  p_reason text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_old_stock numeric;
  v_new_stock numeric;
  v_now timestamptz := clock_timestamp();
  v_movement_id uuid;
  v_movement_type text;
  v_reference text;
  v_reason text;
BEGIN
  IF p_delta = 0 OR p_delta::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'INVALID_INVENTORY_DELTA' USING ERRCODE = 'P0001';
  END IF;

  SELECT product.*
    INTO v_product
  FROM public.products AS product
  WHERE product.id = p_product_id
    AND product.branch_id IS NOT DISTINCT FROM p_branch_id
    AND product.data->>'trackStock' IS DISTINCT FROM 'false'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_STOCK_DISABLED' USING ERRCODE = 'P0002';
  END IF;

  v_old_stock := COALESCE(NULLIF(v_product.data->>'stock', '')::numeric, 0);
  v_new_stock := v_old_stock + p_delta;
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'P0001';
  END IF;

  v_movement_type := CASE WHEN p_delta < 0 THEN 'DECREASE' ELSE 'INCREASE' END;

  -- Misma referencia que muestra la app al producir: PROD- + 8 primeros
  -- caracteres del identificador de la operación, en mayúsculas.
  v_reference := 'PROD-' || pg_catalog.upper(pg_catalog.left(p_operation_id, 8));
  v_reason := CASE p_reason
    WHEN 'BATCH_PRODUCTION' THEN 'Producción por tanda ' || v_reference
    WHEN 'PRODUCTION_CONSUMPTION' THEN 'Producción por tanda ' || v_reference || ' (consumo de ingrediente)'
    WHEN 'TRANSFER_OUT' THEN 'Transferencia enviada a otra sucursal'
    WHEN 'TRANSFER_IN' THEN 'Transferencia recibida de otra sucursal'
    ELSE p_reason
  END;

  v_movement_id := pg_catalog.substr(
    pg_catalog.encode(
      extensions.digest(
        p_operation_id || ':' || p_product_id::text || ':' ||
        COALESCE(p_branch_id::text, 'null') || ':' || v_movement_type,
        'sha256'
      ),
      'hex'
    ),
    1,
    32
  )::uuid;

  UPDATE public.products
  SET data = v_product.data || pg_catalog.jsonb_build_object(
        'stock', v_new_stock,
        'lastUpdated', v_now
      ),
      version = v_product.version + 1,
      updated_at = v_now
  WHERE id = p_product_id;

  INSERT INTO public.inventory_movements (
    id, business_id, branch_id, version, data, created_at, updated_at
  )
  VALUES (
    v_movement_id,
    v_product.business_id,
    p_branch_id,
    1,
    pg_catalog.jsonb_build_object(
      'id', v_movement_id::text,
      'productId', p_product_id::text,
      'productName', v_product.data->>'name',
      'quantity', abs(p_delta),
      'date', v_now,
      'type', v_movement_type,
      'reason', v_reason,
      'performedBy', COALESCE(p_actor_id::text, 'Sistema'),
      'branchId', p_branch_id::text,
      'operationId', p_operation_id,
      'stockBefore', v_old_stock,
      'stockAfter', v_new_stock
    ),
    v_now,
    v_now
  );

  RETURN v_product.data || pg_catalog.jsonb_build_object(
    'id', p_product_id::text,
    'businessId', v_product.business_id::text,
    'branchId', p_branch_id::text,
    'version', v_product.version + 1,
    'stock', v_new_stock,
    'lastUpdated', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_inventory_operation_delta(
  text, uuid, uuid, numeric, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_inventory_operation_delta(
  text, uuid, uuid, numeric, text, uuid
) TO service_role;

COMMIT;