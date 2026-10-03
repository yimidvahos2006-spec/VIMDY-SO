BEGIN;

CREATE OR REPLACE FUNCTION public.refund_sale_cash_atomic(
  p_business_id uuid,
  p_branch_id uuid,
  p_sale_id text,
  p_refund_id text,
  p_refund_items jsonb,
  p_reason text,
  p_cash_register_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_sale_id uuid;
  v_sale public.sales%ROWTYPE;
  v_business public.businesses%ROWTYPE;
  v_register public.cash_registers%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_existing public.payment_refunds%ROWTYPE;
  v_refund public.payment_refunds%ROWTYPE;
  v_sale_item record;
  v_request_item jsonb;
  v_refund_entry jsonb;
  v_refund_line jsonb;
  v_extra jsonb;
  v_requirement record;
  v_stock_product public.products%ROWTYPE;
  v_product_id uuid;
  v_product_qty numeric;
  v_refunded_qty numeric;
  v_request_qty numeric;
  v_original_qty numeric;
  v_item_subtotal numeric;
  v_line_refund_qty numeric;
  v_refund_subtotal numeric := 0;
  v_refund_tax numeric := 0;
  v_refund_discount numeric := 0;
  v_refund_amount numeric := 0;
  v_refunded_total numeric := 0;
  v_sale_subtotal numeric := 0;
  v_sale_total numeric := 0;
  v_inventory_type text;
  v_root_recipe jsonb;
  v_raw_requirements jsonb := '[]'::jsonb;
  v_all_fully_refunded boolean := true;
  v_currency text;
  v_currency_digits integer;
  v_cash_register_id uuid;
  v_shift_count integer;
  v_refund_status text;
  v_refund_record jsonb;
  v_new_data jsonb;
  v_cash_movement_id uuid;
  v_inventory_movement_id uuid;
  v_payload_hash text;
  v_current_stock numeric;
  v_new_stock numeric;
  v_movement_count integer;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'REFUND_AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF p_business_id IS NULL OR p_branch_id IS NULL THEN RAISE EXCEPTION 'REFUND_CONTEXT_REQUIRED'; END IF;
  IF NULLIF(btrim(p_refund_id), '') IS NULL OR length(p_refund_id) > 200 THEN
    RAISE EXCEPTION 'REFUND_IDEMPOTENCY_KEY_REQUIRED';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'REFUND_REASON_REQUIRED';
  END IF;
  IF jsonb_typeof(p_refund_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_refund_items) = 0
     OR jsonb_array_length(p_refund_items) > 100 THEN
    RAISE EXCEPTION 'REFUND_ITEMS_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_refund_items) AS item(value)
    GROUP BY item.value->>'productId'
    HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'REFUND_DUPLICATE_ITEM'; END IF;

  BEGIN
    v_sale_id := NULLIF(btrim(p_sale_id), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'SALE_ID_INVALID';
  END;
  IF v_sale_id IS NULL THEN RAISE EXCEPTION 'SALE_ID_REQUIRED'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_members AS member
    WHERE member.business_id = p_business_id AND member.user_id = v_actor_id
  ) THEN RAISE EXCEPTION 'REFUND_NOT_A_MEMBER' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN', 'GERENTE']) THEN
    RAISE EXCEPTION 'REFUND_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches AS branch
    WHERE branch.id = p_branch_id AND branch.business_id = p_business_id AND branch.active
  ) OR NOT p_branch_id = ANY (public.auth_branch_ids()) THEN
    RAISE EXCEPTION 'REFUND_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.id = v_sale_id
    AND sale.business_id = p_business_id
    AND sale.branch_id = p_branch_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;

  v_payload_hash := pg_catalog.encode(extensions.digest(
    jsonb_build_object(
      'saleId', v_sale_id,
      'items', p_refund_items,
      'reason', btrim(p_reason)
    )::text,
    'sha256'
  ), 'hex');

  SELECT refund.* INTO v_existing
  FROM public.payment_refunds AS refund
  WHERE refund.business_id = p_business_id
    AND refund.idempotency_key = p_refund_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.sale_id IS DISTINCT FROM v_sale_id
       OR v_existing.payload_hash IS DISTINCT FROM v_payload_hash
       OR v_existing.provider IS DISTINCT FROM 'cash' THEN
      RAISE EXCEPTION 'REFUND_IDEMPOTENCY_KEY_REUSED';
    END IF;
    SELECT count(*) INTO v_movement_count
    FROM public.cash_movements AS movement
    WHERE movement.business_id = p_business_id
      AND movement.branch_id = p_branch_id
      AND movement.idempotency_key = p_refund_id;
    IF v_movement_count <> 1 THEN RAISE EXCEPTION 'REFUND_RESULT_INCONSISTENT'; END IF;
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'refundId', v_existing.id,
      'refundAmount', v_existing.amount,
      'sale', v_sale.data || jsonb_build_object('version', v_sale.version),
      'cashMovementId', p_refund_id
    );
  END IF;

  IF v_sale.data->>'status' NOT IN ('PAID', 'CLOSED') THEN RAISE EXCEPTION 'SALE_NOT_PAID'; END IF;
  IF v_sale.data->>'paymentStatus' IS DISTINCT FROM 'CONFIRMED' THEN
    RAISE EXCEPTION 'REFUND_PAYMENT_NOT_CONFIRMED';
  END IF;
  IF v_sale.data->>'paymentMethod' IS DISTINCT FROM 'CASH' THEN
    RAISE EXCEPTION 'EXTERNAL_REFUND_REQUIRES_PROVIDER_CONFIRMATION';
  END IF;
  IF NULLIF(v_sale.data->>'invoiceId', '') IS NOT NULL THEN RAISE EXCEPTION 'SALE_HAS_INVOICE'; END IF;

  SELECT business.* INTO v_business
  FROM public.businesses AS business WHERE business.id = p_business_id;
  v_currency := COALESCE(v_business.currency, 'COP');
  v_inventory_type := v_business.inventory_type;
  v_currency_digits := CASE
    WHEN v_currency IN ('COP','CLP','BIF','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF') THEN 0
    ELSE 2
  END;

  v_sale_total := COALESCE(NULLIF(v_sale.data->>'total', '')::numeric, 0);
  v_sale_subtotal := COALESCE(NULLIF(v_sale.data->>'subtotal', '')::numeric, 0);
  IF v_sale_subtotal <= 0 OR v_sale_total <= 0 THEN RAISE EXCEPTION 'SALE_FINANCIAL_TOTAL_INVALID'; END IF;

  SELECT COALESCE(sum(NULLIF(refund.value->>'amount', '')::numeric), 0)
  INTO v_refunded_total
  FROM jsonb_array_elements(COALESCE(v_sale.data->'refunds', '[]'::jsonb)) AS refund(value);

  FOR v_request_item IN SELECT item.value FROM jsonb_array_elements(p_refund_items) AS item(value)
  LOOP
    IF jsonb_typeof(v_request_item) IS DISTINCT FROM 'object'
       OR NULLIF(v_request_item->>'productId', '') IS NULL
       OR NULLIF(v_request_item->>'quantity', '') IS NULL THEN
      RAISE EXCEPTION 'REFUND_ITEM_INVALID';
    END IF;
    BEGIN
      v_product_id := (v_request_item->>'productId')::uuid;
      v_request_qty := (v_request_item->>'quantity')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'REFUND_ITEM_INVALID';
    END;
    IF v_request_qty <= 0 THEN RAISE EXCEPTION 'INVALID_REFUND_QUANTITY'; END IF;

    v_original_qty := 0;
    v_item_subtotal := 0;
    FOR v_sale_item IN
      SELECT item.value
      FROM jsonb_array_elements(COALESCE(v_sale.data->'items', '[]'::jsonb)) AS item(value)
      WHERE item.value->>'productId' = v_product_id::text
    LOOP
      v_original_qty := v_original_qty + (v_sale_item.value->>'quantity')::numeric;
      v_item_subtotal := v_item_subtotal
        + (v_sale_item.value->>'price')::numeric * (v_sale_item.value->>'quantity')::numeric;
    END LOOP;
    IF v_original_qty <= 0 THEN RAISE EXCEPTION 'REFUND_ITEM_NOT_IN_SALE'; END IF;

    v_refunded_qty := 0;
    FOR v_refund_entry IN
      SELECT refund.value
      FROM jsonb_array_elements(COALESCE(v_sale.data->'refunds', '[]'::jsonb)) AS refund(value)
    LOOP
      SELECT v_refunded_qty + COALESCE(sum((line.value->>'quantity')::numeric), 0)
      INTO v_refunded_qty
      FROM jsonb_array_elements(COALESCE(v_refund_entry->'items', '[]'::jsonb)) AS line(value)
      WHERE line.value->>'productId' = v_product_id::text;
    END LOOP;
    IF v_request_qty > v_original_qty - v_refunded_qty THEN
      RAISE EXCEPTION 'REFUND_EXCEEDS_AVAILABLE';
    END IF;
    v_refund_subtotal := v_refund_subtotal + (v_item_subtotal / v_original_qty) * v_request_qty;

    IF v_inventory_type IS NOT NULL THEN
      FOR v_sale_item IN
        SELECT item.value
        FROM jsonb_array_elements(COALESCE(v_sale.data->'items', '[]'::jsonb)) AS item(value)
        WHERE item.value->>'productId' = v_product_id::text
      LOOP
        v_line_refund_qty := v_request_qty
          * (v_sale_item.value->>'quantity')::numeric / v_original_qty;
        SELECT product.* INTO v_stock_product
        FROM public.products AS product
        WHERE product.id = v_product_id
          AND product.business_id = p_business_id
          AND (product.branch_id = p_branch_id OR product.branch_id IS NULL);
        IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_PRODUCT_NOT_FOUND'; END IF;

        v_root_recipe := NULL;
        IF jsonb_typeof(v_sale_item.value->'selectedSize'->'recipe') = 'array'
           AND jsonb_array_length(v_sale_item.value->'selectedSize'->'recipe') > 0 THEN
          v_root_recipe := v_sale_item.value->'selectedSize'->'recipe';
        ELSE
          v_root_recipe := COALESCE(v_stock_product.data->'recipe', '[]'::jsonb);
        END IF;
        FOR v_extra IN
          SELECT extra.value
          FROM jsonb_array_elements(COALESCE(v_sale_item.value->'selectedExtras', '[]'::jsonb)) AS extra(value)
        LOOP
          IF jsonb_typeof(v_extra->'recipe') = 'array' THEN
            v_root_recipe := COALESCE(v_root_recipe, '[]'::jsonb) || (v_extra->'recipe');
          END IF;
        END LOOP;

        FOR v_requirement IN
          SELECT * FROM public.expand_sale_inventory_requirements(
            p_business_id, p_branch_id, v_product_id, v_line_refund_qty,
            v_inventory_type,
            CASE WHEN v_root_recipe = COALESCE(v_stock_product.data->'recipe', '[]'::jsonb)
              THEN NULL ELSE v_root_recipe END
          )
        LOOP
          IF v_requirement.recipe_cycle THEN RAISE EXCEPTION 'RECIPE_CYCLE'; END IF;
          IF v_requirement.missing_product THEN RAISE EXCEPTION 'RECIPE_INGREDIENT_NOT_FOUND'; END IF;
          IF v_requirement.depth_limit THEN RAISE EXCEPTION 'RECIPE_DEPTH_LIMIT'; END IF;
          IF v_requirement.invalid_recipe OR v_requirement.required_quantity <= 0 THEN
            RAISE EXCEPTION 'RECIPE_QUANTITY_INVALID';
          END IF;
          v_raw_requirements := v_raw_requirements || jsonb_build_array(
            jsonb_build_object('productId', v_requirement.product_id::text, 'quantity', v_requirement.required_quantity)
          );
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;

  v_all_fully_refunded := true;
  FOR v_product_id IN
    SELECT DISTINCT (item.value->>'productId')::uuid
    FROM jsonb_array_elements(COALESCE(v_sale.data->'items', '[]'::jsonb)) AS item(value)
  LOOP
    SELECT COALESCE(sum((item.value->>'quantity')::numeric), 0)
    INTO v_original_qty
    FROM jsonb_array_elements(COALESCE(v_sale.data->'items', '[]'::jsonb)) AS item(value)
    WHERE item.value->>'productId' = v_product_id::text;
    v_refunded_qty := 0;
    FOR v_refund_entry IN
      SELECT refund.value
      FROM jsonb_array_elements(COALESCE(v_sale.data->'refunds', '[]'::jsonb)) AS refund(value)
    LOOP
      SELECT v_refunded_qty + COALESCE(sum((line.value->>'quantity')::numeric), 0)
      INTO v_refunded_qty
      FROM jsonb_array_elements(COALESCE(v_refund_entry->'items', '[]'::jsonb)) AS line(value)
      WHERE line.value->>'productId' = v_product_id::text;
    END LOOP;
    SELECT v_refunded_qty + COALESCE(sum((item.value->>'quantity')::numeric), 0)
    INTO v_refunded_qty
    FROM jsonb_array_elements(p_refund_items) AS item(value)
    WHERE item.value->>'productId' = v_product_id::text;
    IF v_refunded_qty < v_original_qty THEN v_all_fully_refunded := false; END IF;
  END LOOP;

  IF v_all_fully_refunded THEN
    v_refund_amount := round(v_sale_total - v_refunded_total, v_currency_digits);
  ELSE
    v_refund_tax := round(COALESCE(NULLIF(v_sale.data->>'tax', '')::numeric, 0)
      * v_refund_subtotal / v_sale_subtotal, v_currency_digits);
    v_refund_discount := round(COALESCE(NULLIF(v_sale.data->>'discount', '')::numeric, 0)
      * v_refund_subtotal / v_sale_subtotal, v_currency_digits);
    v_refund_amount := round(GREATEST(v_refund_subtotal + v_refund_tax - v_refund_discount, 0), v_currency_digits);
  END IF;
  IF v_refund_amount <= 0 OR v_refund_amount > v_sale_total - v_refunded_total THEN
    RAISE EXCEPTION 'REFUND_AMOUNT_EXCEEDS_REMAINING';
  END IF;

  v_cash_register_id := COALESCE(
    p_cash_register_id,
    NULLIF(v_sale.data->>'cashRegisterId', '')::uuid
  );
  IF v_cash_register_id IS NULL THEN
    SELECT count(*) INTO v_shift_count
    FROM public.shifts AS shift
    WHERE shift.business_id = p_business_id
      AND shift.branch_id = p_branch_id
      AND shift.data->>'status' = 'OPEN';
    IF v_shift_count = 0 THEN RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT'; END IF;
    IF v_shift_count > 1 THEN RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED'; END IF;
    SELECT shift.cash_register_id INTO v_cash_register_id
    FROM public.shifts AS shift
    WHERE shift.business_id = p_business_id
      AND shift.branch_id = p_branch_id
      AND shift.data->>'status' = 'OPEN'
    LIMIT 1;
  END IF;

  SELECT register.* INTO v_register
  FROM public.cash_registers AS register
  WHERE register.id = v_cash_register_id
    AND register.business_id = p_business_id
    AND register.branch_id = p_branch_id
    AND register.active = true
    AND register.status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_REGISTER_CONTEXT_INVALID'; END IF;

  SELECT shift.* INTO v_shift
  FROM public.shifts AS shift
  WHERE shift.business_id = p_business_id
    AND shift.branch_id = p_branch_id
    AND shift.cash_register_id = v_cash_register_id
    AND shift.data->>'status' = 'OPEN'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT'; END IF;
  IF public.shift_cash_available(v_shift.id) + 0.005 < v_refund_amount THEN
    RAISE EXCEPTION 'CAJA_EFECTIVO_INSUFICIENTE';
  END IF;

  INSERT INTO public.payment_refunds (
    business_id, branch_id, sale_id, provider, idempotency_key, payload_hash,
    amount, currency, status, reason, actor_id, metadata, confirmed_at
  ) VALUES (
    p_business_id, p_branch_id, v_sale_id, 'cash', p_refund_id, v_payload_hash,
    v_refund_amount, v_currency, 'confirmed', btrim(p_reason), v_actor_id,
    jsonb_build_object('cashRegisterId', v_cash_register_id, 'shiftId', v_shift.id), v_now
  ) RETURNING * INTO v_refund;

  v_cash_movement_id := gen_random_uuid();
  INSERT INTO public.cash_movements (
    id, idempotency_key, business_id, branch_id, cash_register_id, shift_id, data
  ) VALUES (
    v_cash_movement_id, p_refund_id, p_business_id, p_branch_id, v_cash_register_id,
    v_shift.id::text,
    jsonb_build_object(
      'id', p_refund_id, 'idempotencyKey', p_refund_id, 'type', 'OUT',
      'amount', v_refund_amount, 'description', 'Reembolso venta ' || COALESCE(v_sale.data->>'code', p_sale_id),
      'date', v_now, 'createdAt', v_now, 'paymentMethod', 'CASH', 'cashAmount', v_refund_amount,
      'saleId', v_sale_id::text, 'refundId', v_refund.id::text,
      'cashRegisterId', v_cash_register_id::text, 'shiftId', v_shift.id::text,
      'businessId', p_business_id::text, 'branchId', p_branch_id::text,
      'userId', v_actor_id::text, 'paymentVerificationSource', 'CASH'
    )
  );

  FOR v_requirement IN
    SELECT (requirement.value->>'productId')::uuid AS product_id,
           sum((requirement.value->>'quantity')::numeric) AS quantity
    FROM jsonb_array_elements(v_raw_requirements) AS requirement(value)
    GROUP BY (requirement.value->>'productId')::uuid
    ORDER BY (requirement.value->>'productId')::uuid
  LOOP
    SELECT product.* INTO v_stock_product
    FROM public.products AS product
    WHERE product.id = v_requirement.product_id
      AND product.business_id = p_business_id
      AND (product.branch_id = p_branch_id OR product.branch_id IS NULL)
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_INVENTORY_PRODUCT_NOT_FOUND'; END IF;
    v_current_stock := COALESCE(NULLIF(v_stock_product.data->>'stock', '')::numeric, 0);
    v_new_stock := v_current_stock + v_requirement.quantity;
    UPDATE public.products AS product
    SET data = jsonb_set(v_stock_product.data, '{stock}', to_jsonb(v_new_stock), true)
          || jsonb_build_object('lastUpdated', v_now),
        version = v_stock_product.version + 1,
        updated_at = v_now
    WHERE product.id = v_requirement.product_id
      AND product.business_id = p_business_id
      AND product.version = v_stock_product.version
      AND (product.branch_id = p_branch_id OR product.branch_id IS NULL);
    IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_INVENTORY_UPDATE_CONFLICT'; END IF;

    v_inventory_movement_id := public.vimdy_uuid_from_text(
      'sale-refund:' || p_refund_id || ':' || v_requirement.product_id::text
    );
    INSERT INTO public.inventory_movements (id, business_id, branch_id, version, data, created_at, updated_at)
    VALUES (
      v_inventory_movement_id, p_business_id, p_branch_id, 1,
      jsonb_build_object(
        'id', v_inventory_movement_id::text, 'productId', v_requirement.product_id::text,
        'productName', COALESCE(v_stock_product.data->>'name', v_requirement.product_id::text),
        'quantity', v_requirement.quantity, 'delta', v_requirement.quantity,
        'date', v_now, 'type', 'INCREASE', 'reason', 'Reembolso venta ' || p_sale_id,
        'performedBy', v_actor_id::text, 'saleId', p_sale_id,
        'refundId', v_refund.id::text, 'operationId', p_refund_id
      ), v_now, v_now
    );
  END LOOP;

  v_refund_status := CASE WHEN v_all_fully_refunded THEN 'REFUNDED' ELSE v_sale.data->>'status' END;
  v_refund_record := jsonb_build_object(
    'id', p_refund_id, 'items', p_refund_items, 'amount', v_refund_amount,
    'reason', btrim(p_reason), 'actorId', v_actor_id::text, 'createdAt', v_now,
    'paymentMethod', 'CASH', 'idempotencyKey', p_refund_id
  );
  v_new_data := v_sale.data || jsonb_build_object(
    'status', v_refund_status,
    'refunds', COALESCE(v_sale.data->'refunds', '[]'::jsonb) || jsonb_build_array(v_refund_record),
    'updatedAt', v_now
  );
  UPDATE public.sales
  SET data = v_new_data,
      version = v_sale.version + 1,
      updated_at = v_now
  WHERE id = v_sale_id
    AND business_id = p_business_id
    AND branch_id = p_branch_id
    AND version = v_sale.version;
  IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_SALE_UPDATE_CONFLICT'; END IF;

  INSERT INTO public.audit_logs (id, business_id, branch_id, version, data, created_at, updated_at)
  VALUES (
    gen_random_uuid(), p_business_id, p_branch_id, 1,
    jsonb_build_object(
      'id', gen_random_uuid()::text, 'actorId', v_actor_id::text,
      'action', CASE WHEN v_all_fully_refunded THEN 'SALE_REFUNDED' ELSE 'SALE_PARTIALLY_REFUNDED' END,
      'module', 'sales', 'entityId', v_sale_id::text,
      'description', 'Reembolso CASH ' || v_refund_amount::text || ' ' || v_currency,
      'date', v_now, 'idempotencyKey', p_refund_id, 'result', 'SUCCESS',
      'refundId', v_refund.id::text
    ), v_now, v_now
  );

  RETURN jsonb_build_object(
    'success', true, 'idempotent', false, 'refundId', v_refund.id::text,
    'refundAmount', v_refund_amount, 'cashMovementId', p_refund_id,
    'sale', v_new_data || jsonb_build_object('version', v_sale.version + 1)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refund_sale_cash_atomic(uuid,uuid,text,text,jsonb,text,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_sale_cash_atomic(uuid,uuid,text,text,jsonb,text,uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.refund_sale_full_atomic(uuid,uuid,text,integer,numeric,text,text,text,jsonb,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_sale_atomic(uuid,uuid,text,integer,numeric,text,text,text)
  FROM PUBLIC, anon, authenticated;

COMMIT;