BEGIN;

CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_product_id text,
  p_delta numeric,
  p_extra_fields jsonb DEFAULT '{}'::jsonb,
  p_allow_negative boolean DEFAULT false,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_product_id uuid;
  v_updated jsonb;
BEGIN
  BEGIN
    v_product_id := p_product_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
  END;

  UPDATE public.products AS product
  SET data = pg_catalog.jsonb_set(
        product.data,
        '{stock}',
        pg_catalog.to_jsonb(
          COALESCE(NULLIF(product.data->>'stock', '')::numeric, 0) + p_delta
        )
      ) || COALESCE(p_extra_fields, '{}'::jsonb),
      updated_at = pg_catalog.now()
  WHERE product.id = v_product_id
    AND (p_branch_id IS NULL OR product.branch_id IS NOT DISTINCT FROM p_branch_id)
    AND (
      p_allow_negative
      OR COALESCE(NULLIF(product.data->>'stock', '')::numeric, 0) + p_delta >= 0
    )
  RETURNING product.data INTO v_updated;

  IF v_updated IS NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.products AS product
      WHERE product.id = v_product_id
        AND (p_branch_id IS NULL OR product.branch_id IS NOT DISTINCT FROM p_branch_id)
    ) THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_product_stock(text, numeric, jsonb, boolean, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_product_stock(text, numeric, jsonb, boolean, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.adjust_stock_with_kardex(
  p_product_id text,
  p_delta numeric,
  p_reason text,
  p_type text,
  p_performed_by text DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_supplier_name text DEFAULT NULL,
  p_loss_category text DEFAULT NULL,
  p_movement_id text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_allow_negative boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_product_id uuid;
  v_movement_id uuid;
  v_product public.products%ROWTYPE;
  v_updated jsonb;
BEGIN
  BEGIN
    v_product_id := p_product_id::uuid;
    v_movement_id := COALESCE(p_movement_id::uuid, pg_catalog.gen_random_uuid());
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_INVENTORY_IDENTIFIER' USING ERRCODE = 'P0001';
  END;

  SELECT product.*
    INTO v_product
  FROM public.products AS product
  WHERE product.id = v_product_id
    AND (p_branch_id IS NULL OR product.branch_id IS NOT DISTINCT FROM p_branch_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_movements AS movement
    WHERE movement.id = v_movement_id
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.inventory_movements AS movement
      WHERE movement.id = v_movement_id
        AND movement.business_id = v_product.business_id
        AND movement.data->>'productId' = v_product_id::text
    ) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_product.data;
  END IF;

  v_updated := public.adjust_product_stock(
    v_product_id::text,
    p_delta,
    '{}'::jsonb,
    p_allow_negative,
    p_branch_id
  );

  INSERT INTO public.inventory_movements (
    id, business_id, branch_id, data
  )
  VALUES (
    v_movement_id,
    v_product.business_id,
    p_branch_id,
    pg_catalog.jsonb_build_object(
      'id', v_movement_id::text,
      'productId', v_product_id::text,
      'productName', v_product.data->>'name',
      'quantity', pg_catalog.abs(p_delta),
      'date', pg_catalog.now(),
      'type', p_type,
      'reason', p_reason,
      'performedBy', p_performed_by,
      'supplierId', p_supplier_id,
      'supplierName', p_supplier_name,
      'lossCategory', p_loss_category,
      'branchId', p_branch_id
    )
  );

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock_with_kardex(
  text, numeric, text, text, text, uuid, text, text, text, uuid, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock_with_kardex(
  text, numeric, text, text, text, uuid, text, text, text, uuid, boolean
) TO authenticated;

COMMIT;
