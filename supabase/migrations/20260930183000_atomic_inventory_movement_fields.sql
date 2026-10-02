BEGIN;

CREATE OR REPLACE FUNCTION public.adjust_stock_with_kardex_and_fields(
  p_product_id text,
  p_delta numeric,
  p_reason text,
  p_type text,
  p_performed_by text,
  p_supplier_id uuid,
  p_supplier_name text,
  p_loss_category text,
  p_movement_id text,
  p_branch_id uuid,
  p_allow_negative boolean,
  p_extra_fields jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_product jsonb;
BEGIN
  v_product := public.adjust_stock_with_kardex(
    p_product_id,
    p_delta,
    p_reason,
    p_type,
    p_performed_by,
    p_supplier_id,
    p_supplier_name,
    p_loss_category,
    p_movement_id,
    p_branch_id,
    p_allow_negative
  );

  IF p_extra_fields IS NOT NULL AND p_extra_fields <> '{}'::jsonb THEN
    v_product := public.adjust_product_stock(
      p_product_id,
      0,
      p_extra_fields,
      p_allow_negative,
      p_branch_id
    );
  END IF;

  RETURN v_product;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock_with_kardex_and_fields(
  text, numeric, text, text, text, uuid, text, text, text, uuid, boolean, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock_with_kardex_and_fields(
  text, numeric, text, text, text, uuid, text, text, text, uuid, boolean, jsonb
) TO authenticated;

COMMENT ON FUNCTION public.adjust_stock_with_kardex_and_fields(
  text, numeric, text, text, text, uuid, text, text, text, uuid, boolean, jsonb
) IS
  'Atomically applies stock delta, appends Kardex movement, and updates product metadata in the same transaction.';

COMMIT;
