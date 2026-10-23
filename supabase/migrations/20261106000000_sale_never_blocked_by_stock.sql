-- Venta sin bloqueo por stock insuficiente.
-- Reemplaza create_sale_fulfillment_atomic: se quita el INSUFFICIENT_STOCK.
-- Si un insumo queda en 0 o negativo, la venta pasa, el stock baja (puede ser negativo)
-- y el Kardex guarda stockBefore, stockAfter y negative=true cuando queda bajo cero.
-- Lo demas de la funcion es identico a 20260930193000. Ajustes (stock negativo) sigue
-- mandando solo en ajustes manuales y produccion por tandas.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_sale_fulfillment_atomic(
  p_business_id uuid,
  p_branch_id uuid,
  p_idempotency_key text,
  p_sale jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_business public.businesses%ROWTYPE;
  v_sale_id uuid;
  v_sale_type text;
  v_table_id uuid;
  v_customer_id uuid;
  v_waiter_id uuid;
  v_delivery_address text;
  v_sale_code text;
  v_sale_items jsonb := '[]'::jsonb;
  v_kitchen_items jsonb := '[]'::jsonb;
  v_sale_data jsonb;
  v_kitchen_data jsonb;
  v_printer_job_id uuid;
  v_request_hash text;
  v_existing_hash text;
  v_existing_sale_id uuid;
  v_existing_sale_data jsonb;
  v_existing_kitchen_data jsonb;
  v_item jsonb;
  v_sale_item jsonb;
  v_product_data jsonb;
  v_product_id uuid;
  v_locked_product_id uuid;
  v_sale_item_id uuid;
  v_line_quantity numeric;
  v_base_price numeric;
  v_size_delta numeric;
  v_extra_delta numeric;
  v_unit_price numeric;
  v_line_subtotal numeric;
  v_line_tax_rate numeric;
  v_line_tax numeric;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_discount numeric := 0;
  v_tip numeric := 0;
  v_delivery_fee numeric := 0;
  v_total numeric := 0;
  v_discount_type text;
  v_discount_value numeric;
  v_tip_type text;
  v_tip_value numeric;
  v_currency_digits integer;
  v_size_id text;
  v_selected_size jsonb;
  v_extra_ids jsonb;
  v_selected_extras jsonb;
  v_extra jsonb;
  v_extra_id text;
  v_root_recipe jsonb;
  v_requirement record;
  v_raw_requirements jsonb := '[]'::jsonb;
  v_grouped_requirements jsonb := '[]'::jsonb;
  v_stock_product_data jsonb;
  v_stock numeric;
  v_now timestamptz := clock_timestamp();
  v_priority text;
  v_kitchen_enabled boolean;
  v_kds_enabled boolean;
  v_printer_enabled boolean;
  v_output_mode text;
  v_error_code text;
  v_error_message text;
  v_error_detail text;
  v_audit_id uuid;
  v_item_index integer := 0;
  v_sent_quantity numeric;
  v_pending_quantity numeric;
BEGIN
  BEGIN
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'SALE_AUTH_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF p_business_id IS NULL OR p_branch_id IS NULL THEN
      RAISE EXCEPTION 'SALE_BUSINESS_BRANCH_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(btrim(p_idempotency_key), '') IS NULL OR length(p_idempotency_key) > 200 THEN
      RAISE EXCEPTION 'SALE_IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_sale) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'SALE_PAYLOAD_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.business_members AS member
      WHERE member.business_id = p_business_id AND member.user_id = v_actor_id
    ) THEN
      RAISE EXCEPTION 'SALE_NOT_A_MEMBER' USING ERRCODE = '42501';
    END IF;
    IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN', 'CAJERO', 'GERENTE']) THEN
      RAISE EXCEPTION 'SALE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_business_subscription_active(p_business_id) THEN
      RAISE EXCEPTION 'SALE_SUBSCRIPTION_INACTIVE' USING ERRCODE = '42501';
    END IF;
    SELECT business.* INTO v_business
    FROM public.businesses AS business
    WHERE business.id = p_business_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'SALE_BUSINESS_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_business.inventory_type IS NOT NULL
       AND v_business.inventory_type NOT IN ('ingredientes', 'productos', 'ambos') THEN
      RAISE EXCEPTION 'SALE_INVENTORY_CONFIG_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.branches AS branch
      WHERE branch.id = p_branch_id AND branch.business_id = p_business_id AND branch.active = true
    ) THEN
      RAISE EXCEPTION 'SALE_INVALID_BRANCH' USING ERRCODE = '42501';
    END IF;

    v_sale_type := upper(COALESCE(p_sale->>'type', ''));
    IF v_sale_type NOT IN ('QUICK', 'TABLE', 'DELIVERY') THEN
      RAISE EXCEPTION 'SALE_TYPE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_sale->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_sale->'items') < 1
       OR jsonb_array_length(p_sale->'items') > 100 THEN
      RAISE EXCEPTION 'SALE_ITEMS_INVALID' USING ERRCODE = '22023';
    END IF;
    v_sale_id := COALESCE(NULLIF(p_sale->>'id', '')::uuid, gen_random_uuid());
    v_table_id := NULLIF(p_sale->>'tableId', '')::uuid;
    v_delivery_address := NULLIF(btrim(p_sale->>'deliveryAddress'), '');
    v_priority := COALESCE(p_sale->>'priority', 'NORMAL');
    IF v_priority NOT IN ('NORMAL', 'HIGH', 'URGENT') THEN
      RAISE EXCEPTION 'SALE_PRIORITY_INVALID' USING ERRCODE = '22023';
    END IF;
    IF v_sale_type = 'TABLE' THEN
      IF NOT v_business.tables_enabled OR v_table_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.tables AS table_row
        WHERE table_row.id = v_table_id AND table_row.business_id = p_business_id
          AND table_row.branch_id = p_branch_id
          AND table_row.data->>'status' NOT IN ('FREE', 'CLOSED')
      ) THEN RAISE EXCEPTION 'SALE_TABLE_INVALID' USING ERRCODE = 'P0001'; END IF;
    ELSIF v_table_id IS NOT NULL THEN
      RAISE EXCEPTION 'SALE_TABLE_NOT_ALLOWED' USING ERRCODE = '22023';
    END IF;
    IF v_sale_type = 'DELIVERY' THEN
      IF v_delivery_address IS NULL THEN RAISE EXCEPTION 'SALE_DELIVERY_ADDRESS_REQUIRED' USING ERRCODE = '22023'; END IF;
      IF NOT ('domicilio' = ANY(v_business.sales_channels)) THEN RAISE EXCEPTION 'SALE_DELIVERY_CHANNEL_DISABLED' USING ERRCODE = '42501'; END IF;
    END IF;
    IF COALESCE(NULLIF(p_sale->>'deliveryFee', '')::numeric, 0) <> 0 THEN
      RAISE EXCEPTION 'SALE_DELIVERY_FEE_NOT_CONFIGURED' USING ERRCODE = '22023';
    END IF;

    v_customer_id := CASE
      WHEN NULLIF(p_sale->>'customerId', '') IS NULL OR p_sale->>'customerId' = 'CLIENTE_GENERAL' THEN NULL
      ELSE (p_sale->>'customerId')::uuid
    END;
    IF v_customer_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.customers AS customer
      WHERE customer.id = v_customer_id AND customer.business_id = p_business_id
        AND (customer.branch_id = p_branch_id OR customer.branch_id IS NULL)
    ) THEN RAISE EXCEPTION 'SALE_CUSTOMER_INVALID' USING ERRCODE = '42501'; END IF;

    v_waiter_id := NULLIF(p_sale->>'waiterId', '')::uuid;
    IF v_waiter_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.waiters AS waiter
      WHERE waiter.id = v_waiter_id AND waiter.business_id = p_business_id
        AND (waiter.branch_id = p_branch_id OR waiter.branch_id IS NULL)
        AND COALESCE((waiter.data->>'active')::boolean, true)
    ) THEN RAISE EXCEPTION 'SALE_WAITER_INVALID' USING ERRCODE = '42501'; END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_business_id::text || ':' || p_branch_id::text || ':' || p_idempotency_key, 0)
    );
    v_request_hash := pg_catalog.encode(extensions.digest(p_sale::text, 'sha256'), 'hex');

    SELECT operation.payload_hash, operation.sale_id
      INTO v_existing_hash, v_existing_sale_id
    FROM public.sale_fulfillment_operations AS operation
    WHERE operation.business_id = p_business_id AND operation.branch_id = p_branch_id
      AND operation.idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF FOUND THEN
      IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
        RAISE EXCEPTION 'SALE_IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001';
      END IF;
      SELECT sale.data || jsonb_build_object('version', sale.version)
        INTO v_existing_sale_data
      FROM public.sales AS sale
      WHERE sale.id = v_existing_sale_id AND sale.business_id = p_business_id AND sale.branch_id = p_branch_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'SALE_IDEMPOTENCY_RESULT_MISSING' USING ERRCODE = 'P0001'; END IF;
      SELECT order_row.data INTO v_existing_kitchen_data
      FROM public.kitchen_orders AS order_row
      WHERE order_row.id = v_existing_sale_id AND order_row.business_id = p_business_id AND order_row.branch_id = p_branch_id;
      SELECT job.id INTO v_printer_job_id
      FROM public.kitchen_printer_jobs AS job
      WHERE job.business_id = p_business_id AND job.branch_id = p_branch_id AND job.sale_id = v_existing_sale_id;
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'idempotencyKey', p_idempotency_key,
        'sale', v_existing_sale_data, 'kitchenOrder', v_existing_kitchen_data, 'printerJobId', v_printer_job_id);
    END IF;

    FOR v_locked_product_id IN
      SELECT DISTINCT (item.value->>'productId')::uuid
      FROM jsonb_array_elements(p_sale->'items') AS item(value)
      ORDER BY 1
    LOOP
      PERFORM 1 FROM public.products AS product
      WHERE product.id = v_locked_product_id AND product.business_id = p_business_id
        AND (product.branch_id = p_branch_id OR product.branch_id IS NULL)
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    END LOOP;

    v_currency_digits := CASE
      WHEN v_business.currency IN ('COP', 'CLP', 'BIF', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 0
      ELSE 2
    END;
    v_kitchen_enabled := COALESCE(v_business.kitchen_enabled, false);
    v_output_mode := CASE
      WHEN NOT v_kitchen_enabled THEN 'none'
      ELSE COALESCE(
        NULLIF(v_business.kitchen_output_mode, ''),
        CASE
          WHEN COALESCE(v_business.kds_enabled, false) AND COALESCE(v_business.printer_enabled, false) THEN 'both'
          WHEN COALESCE(v_business.printer_enabled, false) THEN 'printer'
          WHEN COALESCE(v_business.kds_enabled, false) THEN 'kds'
          ELSE 'none'
        END
      )
    END;
    IF v_output_mode NOT IN ('none', 'kds', 'printer', 'both') THEN
      RAISE EXCEPTION 'SALE_KITCHEN_CONFIG_INVALID' USING ERRCODE = '22023';
    END IF;
    v_kds_enabled := v_kitchen_enabled AND v_output_mode IN ('kds', 'both');
    v_printer_enabled := v_kitchen_enabled AND v_output_mode IN ('printer', 'both');

    v_sale_code := 'VTA-' || to_char(v_now, 'YYYYMMDDHH24MISS') || '-' || upper(substr(v_sale_id::text, 1, 6));
    v_sale_items := '[]'::jsonb;
    v_raw_requirements := '[]'::jsonb;
    v_subtotal := 0;
    v_tax := 0;

    FOR v_item IN
      SELECT entry.value
      FROM jsonb_array_elements(p_sale->'items') WITH ORDINALITY AS entry(value, ordinal)
      ORDER BY entry.ordinal
    LOOP
      IF NULLIF(v_item->>'productId', '') IS NULL OR NULLIF(v_item->>'quantity', '') IS NULL THEN
        RAISE EXCEPTION 'SALE_ITEM_INVALID' USING ERRCODE = '22023';
      END IF;
      v_product_id := (v_item->>'productId')::uuid;
      v_line_quantity := (v_item->>'quantity')::numeric;
      IF v_line_quantity <= 0 OR v_line_quantity > 10000 THEN
        RAISE EXCEPTION 'SALE_QUANTITY_INVALID' USING ERRCODE = '22023';
      END IF;
      SELECT product.data INTO v_product_data
      FROM public.products AS product
      WHERE product.id = v_product_id AND product.business_id = p_business_id
        AND (product.branch_id = p_branch_id OR product.branch_id IS NULL)
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      IF NOT COALESCE((v_product_data->>'active')::boolean, true) THEN RAISE EXCEPTION 'PRODUCT_INACTIVE' USING ERRCODE = 'P0001'; END IF;
      IF COALESCE((v_product_data->>'isIngredient')::boolean, false) THEN RAISE EXCEPTION 'INGREDIENT_NOT_SELLABLE' USING ERRCODE = 'P0001'; END IF;
      v_base_price := COALESCE(NULLIF(v_product_data->>'price', '')::numeric, -1);
      IF v_base_price < 0 THEN RAISE EXCEPTION 'PRODUCT_PRICE_INVALID' USING ERRCODE = 'P0001'; END IF;

      v_size_id := NULLIF(v_item->>'selectedSizeId', '');
      v_selected_size := NULL;
      v_size_delta := 0;
      IF v_size_id IS NOT NULL THEN
        SELECT option.value INTO v_selected_size
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_product_data->'sizes')='array' THEN v_product_data->'sizes' ELSE '[]'::jsonb END) AS option(value)
        WHERE option.value->>'id' = v_size_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_SIZE_INVALID' USING ERRCODE = 'P0001'; END IF;
        v_size_delta := COALESCE(NULLIF(v_selected_size->>'priceDelta', '')::numeric, 0);
      END IF;

      v_extra_ids := COALESCE(v_item->'selectedExtraIds', '[]'::jsonb);
      IF jsonb_typeof(v_extra_ids) IS DISTINCT FROM 'array' OR jsonb_array_length(v_extra_ids) > 20 THEN
        RAISE EXCEPTION 'PRODUCT_EXTRAS_INVALID' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_extra_ids) AS extra_id(value) GROUP BY extra_id.value HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'PRODUCT_EXTRA_DUPLICATE' USING ERRCODE = '22023';
      END IF;
      v_selected_extras := '[]'::jsonb;
      v_extra_delta := 0;
      v_root_recipe := CASE
        WHEN v_selected_size IS NOT NULL AND jsonb_typeof(v_selected_size->'recipe')='array' AND jsonb_array_length(v_selected_size->'recipe') > 0
          THEN v_selected_size->'recipe'
        ELSE COALESCE(v_product_data->'recipe', '[]'::jsonb)
      END;
      FOR v_extra_id IN SELECT jsonb_array_elements_text(v_extra_ids)
      LOOP
        SELECT option.value INTO v_extra
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_product_data->'extras')='array' THEN v_product_data->'extras' ELSE '[]'::jsonb END) AS option(value)
        WHERE option.value->>'id' = v_extra_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_EXTRA_INVALID' USING ERRCODE = 'P0001'; END IF;
        v_selected_extras := v_selected_extras || jsonb_build_array(v_extra);
        v_extra_delta := v_extra_delta + COALESCE(NULLIF(v_extra->>'priceDelta', '')::numeric, 0);
        IF jsonb_typeof(v_extra->'recipe')='array' THEN v_root_recipe := v_root_recipe || v_extra->'recipe'; END IF;
      END LOOP;

      v_unit_price := round(v_base_price + v_size_delta + v_extra_delta, v_currency_digits);
      IF v_unit_price < 0 THEN RAISE EXCEPTION 'SALE_UNIT_PRICE_INVALID' USING ERRCODE = 'P0001'; END IF;
      v_line_subtotal := v_unit_price * v_line_quantity;
      v_line_tax_rate := COALESCE(NULLIF(v_product_data->>'taxRate', '')::numeric, v_business.tax_rate);
      IF v_line_tax_rate > 1 THEN v_line_tax_rate := v_line_tax_rate / 100; END IF;
      IF v_line_tax_rate < 0 OR v_line_tax_rate > 1 THEN RAISE EXCEPTION 'SALE_TAX_RATE_INVALID' USING ERRCODE = 'P0001'; END IF;
      v_line_tax := round(v_line_subtotal * v_line_tax_rate, v_currency_digits);
      v_subtotal := v_subtotal + v_line_subtotal;
      v_tax := v_tax + v_line_tax;
      v_sale_item_id := gen_random_uuid();
      v_sale_item := jsonb_build_object(
        'saleItemId', v_sale_item_id::text, 'productId', v_product_id::text,
        'quantity', v_line_quantity, 'price', v_unit_price,
        'note', NULLIF(left(COALESCE(v_item->>'note',''), 500), ''),
        'requiresKitchen', COALESCE((v_product_data->>'requiresKitchen')::boolean, true),
        'selectedSizeId', v_size_id, 'selectedSize', v_selected_size,
        'selectedExtraIds', v_extra_ids, 'selectedExtras', v_selected_extras,
        'unit', v_product_data->>'unit', 'taxRate', v_line_tax_rate * 100,
        'unitCostAtSale', NULLIF(v_product_data->>'purchasePrice','')::numeric,
        'costUnreliableAtSale', NULLIF(v_product_data->>'purchasePrice','') IS NULL
      );
      v_sale_items := v_sale_items || jsonb_build_array(v_sale_item);

      IF v_business.inventory_type IS NOT NULL THEN
        FOR v_requirement IN SELECT * FROM public.expand_sale_inventory_requirements(
          p_business_id, p_branch_id, v_product_id, v_line_quantity,
          v_business.inventory_type,
          CASE WHEN v_root_recipe = COALESCE(v_product_data->'recipe','[]'::jsonb) THEN NULL ELSE v_root_recipe END
        ) LOOP
          IF v_requirement.recipe_cycle THEN RAISE EXCEPTION 'RECIPE_CYCLE' USING ERRCODE = 'P0001'; END IF;
          IF v_requirement.missing_product THEN RAISE EXCEPTION 'RECIPE_INGREDIENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
          IF v_requirement.depth_limit THEN RAISE EXCEPTION 'RECIPE_DEPTH_LIMIT' USING ERRCODE = 'P0001'; END IF;
          IF v_requirement.invalid_recipe OR v_requirement.required_quantity <= 0 THEN RAISE EXCEPTION 'RECIPE_QUANTITY_INVALID' USING ERRCODE = 'P0001'; END IF;
          v_raw_requirements := v_raw_requirements || jsonb_build_array(jsonb_build_object('productId',v_requirement.product_id::text,'quantity',v_requirement.required_quantity));
        END LOOP;
      END IF;
    END LOOP;

    v_subtotal := round(v_subtotal, v_currency_digits);
    v_tax := round(v_tax, v_currency_digits);
    v_discount_type := upper(COALESCE(p_sale->'discount'->>'type',''));
    v_discount_value := COALESCE(NULLIF(p_sale->'discount'->>'value','')::numeric,0);
    IF v_discount_value < 0 THEN RAISE EXCEPTION 'SALE_DISCOUNT_INVALID' USING ERRCODE = '22023'; END IF;
    IF v_discount_value > 0 THEN
      IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','GERENTE']) THEN RAISE EXCEPTION 'SALE_DISCOUNT_FORBIDDEN' USING ERRCODE = '42501'; END IF;
      IF v_discount_type = 'PERCENT' AND v_discount_value <= 100 THEN
        v_discount := round(v_subtotal * v_discount_value / 100, v_currency_digits);
      ELSIF v_discount_type = 'FIXED' THEN
        v_discount := round(LEAST(v_discount_value,v_subtotal), v_currency_digits);
      ELSE RAISE EXCEPTION 'SALE_DISCOUNT_INVALID' USING ERRCODE = '22023'; END IF;
    END IF;
    v_tip_type := upper(COALESCE(p_sale->'tip'->>'type',''));
    v_tip_value := COALESCE(NULLIF(p_sale->'tip'->>'value','')::numeric,0);
    IF v_tip_value < 0 THEN RAISE EXCEPTION 'SALE_TIP_INVALID' USING ERRCODE = '22023'; END IF;
    IF v_tip_value > 0 THEN
      IF v_tip_type = 'PERCENT' AND v_tip_value <= 100 THEN
        v_tip := round(v_subtotal * v_tip_value / 100, v_currency_digits);
      ELSIF v_tip_type = 'FIXED' THEN
        v_tip := round(v_tip_value, v_currency_digits);
      ELSE RAISE EXCEPTION 'SALE_TIP_INVALID' USING ERRCODE = '22023'; END IF;
    END IF;
    v_total := round(GREATEST(v_subtotal + v_tax - v_discount + v_delivery_fee + v_tip,0),v_currency_digits);
    IF v_total <= 0 THEN RAISE EXCEPTION 'SALE_TOTAL_INVALID' USING ERRCODE = 'P0001'; END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('productId', grouped.product_id::text, 'quantity', grouped.quantity) ORDER BY grouped.product_id),'[]'::jsonb)
      INTO v_grouped_requirements
    FROM (
      SELECT (row.value->>'productId')::uuid AS product_id, sum((row.value->>'quantity')::numeric) AS quantity
      FROM jsonb_array_elements(v_raw_requirements) AS row(value)
      GROUP BY (row.value->>'productId')::uuid
    ) AS grouped;

    v_sale_code := 'VTA-' || to_char(v_now,'YYYYMMDDHH24MISS') || '-' || upper(substr(v_sale_id::text,1,6));
    v_sale_data := jsonb_build_object(
      'id',v_sale_id::text,'code',v_sale_code,'businessId',p_business_id::text,'branchId',p_branch_id::text,
      'customerId',COALESCE(v_customer_id::text,'CLIENTE_GENERAL'),'cashierId',v_actor_id::text,'waiterId',v_waiter_id::text,
      'tableId',v_table_id::text,'items',v_sale_items,'subtotal',v_subtotal,'tax',v_tax,'discount',v_discount,
      'deliveryFee',v_delivery_fee,'tip',v_tip,'total',v_total,'type',v_sale_type,'status','PENDING_PAYMENT',
      'paymentStatus','PENDING_VERIFICATION','fulfillmentStatus','FULFILLED','deliveryAddress',v_delivery_address,
      'notes',left(COALESCE(p_sale->>'notes',''),500),'priority',v_priority,'createdAt',v_now,'updatedAt',v_now
    );

    INSERT INTO public.sale_fulfillment_operations (business_id,branch_id,idempotency_key,payload_hash,sale_id,actor_id)
    VALUES (p_business_id,p_branch_id,p_idempotency_key,v_request_hash,v_sale_id,v_actor_id);
    INSERT INTO public.sales (id,business_id,branch_id,version,data,created_at,updated_at)
    VALUES (v_sale_id,p_business_id,p_branch_id,1,v_sale_data,v_now,v_now);

    FOR v_sale_item IN SELECT item.value FROM jsonb_array_elements(v_sale_items) AS item(value)
    LOOP
      INSERT INTO public.sale_items (id,sale_id,product_id,quantity,unit_price,subtotal,notes)
      VALUES ((v_sale_item->>'saleItemId')::uuid,v_sale_id,(v_sale_item->>'productId')::uuid,
        (v_sale_item->>'quantity')::numeric,(v_sale_item->>'price')::numeric,
        (v_sale_item->>'price')::numeric*(v_sale_item->>'quantity')::numeric,NULLIF(v_sale_item->>'note',''));
    END LOOP;

    FOR v_requirement IN
      SELECT (row.value->>'productId')::uuid AS product_id,(row.value->>'quantity')::numeric AS quantity
      FROM jsonb_array_elements(v_grouped_requirements) AS row(value)
      ORDER BY (row.value->>'productId')::uuid
    LOOP
      SELECT product.data INTO v_stock_product_data FROM public.products AS product
      WHERE product.id=v_requirement.product_id AND product.business_id=p_business_id
        AND (product.branch_id=p_branch_id OR product.branch_id IS NULL)
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      v_stock := COALESCE(NULLIF(v_stock_product_data->>'stock','')::numeric,0);
      -- La venta NUNCA se bloquea por falta de stock: el stock puede quedar en negativo y el Kardex lo marca.
      UPDATE public.products
      SET data=jsonb_set(v_stock_product_data,'{stock}',to_jsonb(v_stock-v_requirement.quantity),true)||jsonb_build_object('lastUpdated',v_now),
          version=version+1,updated_at=v_now
      WHERE id=v_requirement.product_id AND business_id=p_business_id
        AND (branch_id=p_branch_id OR branch_id IS NULL);
      v_sale_item_id := pg_catalog.md5(p_idempotency_key||':'||v_requirement.product_id::text||':DECREASE')::uuid;
      INSERT INTO public.inventory_movements (id,business_id,branch_id,data,created_at,updated_at)
      VALUES (v_sale_item_id,p_business_id,p_branch_id,
        jsonb_build_object('id',v_sale_item_id::text,'productId',v_requirement.product_id::text,
          'productName',COALESCE(v_stock_product_data->>'name',v_requirement.product_id::text),
          'quantity',v_requirement.quantity,'delta',-v_requirement.quantity,'date',v_now,
          'type','DECREASE','reason','SALE '||v_sale_code,'performedBy',v_actor_id::text,
          'saleId',v_sale_id::text,'operationId',p_idempotency_key,
          'stockBefore',v_stock,'stockAfter',v_stock-v_requirement.quantity,
          'negative',(v_stock-v_requirement.quantity)<0),v_now,v_now);
    END LOOP;

    IF v_kitchen_enabled AND v_output_mode <> 'none' THEN
      FOR v_sale_item IN SELECT item.value FROM jsonb_array_elements(v_sale_items) AS item(value)
      LOOP
        IF COALESCE((v_sale_item->>'requiresKitchen')::boolean,false) THEN
          v_pending_quantity := (v_sale_item->>'quantity')::numeric;
          IF v_sale_type='TABLE' AND v_table_id IS NOT NULL THEN
            SELECT COALESCE(sum((prior_item.value->>'quantity')::numeric),0) INTO v_sent_quantity
            FROM public.kitchen_orders AS prior_order
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(prior_order.data->'items','[]'::jsonb)) AS prior_item(value)
            WHERE prior_order.business_id=p_business_id AND prior_order.branch_id=p_branch_id
              AND prior_order.data->>'tableId'=v_table_id::text
              AND prior_order.data->>'status'<>'CANCELADO'
              AND prior_item.value->>'productId'=v_sale_item->>'productId';
            v_pending_quantity := GREATEST(v_pending_quantity-v_sent_quantity,0);
          END IF;
          IF v_pending_quantity>0 THEN
            v_kitchen_items := v_kitchen_items || jsonb_build_array(jsonb_set(v_sale_item,'{quantity}',to_jsonb(v_pending_quantity),true));
          END IF;
        END IF;
      END LOOP;

      IF jsonb_array_length(v_kitchen_items)>0 THEN
        v_kitchen_data := jsonb_build_object(
          'id',v_sale_id::text,'businessId',p_business_id::text,'branchId',p_branch_id::text,
          'saleId',v_sale_id::text,'tableId',v_table_id::text,'waiterId',v_waiter_id::text,
          'origin',CASE WHEN v_sale_type='TABLE' THEN 'Mesa '||v_table_id::text WHEN v_sale_type='DELIVERY' THEN 'Domicilio' ELSE 'Mostrador' END,
          'notes',left(COALESCE(p_sale->>'notes',''),500),'priority',v_priority,
          'items',v_kitchen_items,'status','PENDIENTE','createdAt',v_now
        );
        INSERT INTO public.kitchen_orders (id,business_id,branch_id,version,data,created_at,updated_at)
        VALUES (v_sale_id,p_business_id,p_branch_id,1,v_kitchen_data,v_now,v_now);
        INSERT INTO public.kitchen_order_items (kitchen_order_id,sale_item_id,status,notes)
        SELECT v_sale_id,(item.value->>'saleItemId')::uuid,'pending',NULLIF(item.value->>'note','')
        FROM jsonb_array_elements(v_kitchen_items) AS item(value);

        IF v_printer_enabled THEN
          v_printer_job_id := gen_random_uuid();
          INSERT INTO public.kitchen_printer_jobs (id,business_id,branch_id,sale_id,kitchen_order_id,data,created_at,updated_at)
          VALUES (v_printer_job_id,p_business_id,p_branch_id,v_sale_id,v_sale_id,
            jsonb_build_object('id',v_printer_job_id::text,'saleId',v_sale_id::text,'kitchenOrderId',v_sale_id::text,
              'status','PENDING','order',v_kitchen_data,'createdAt',v_now),v_now,v_now);
        END IF;
      END IF;
    END IF;

    v_audit_id := gen_random_uuid();
    INSERT INTO public.audit_logs (id,business_id,branch_id,version,data,created_at,updated_at)
    VALUES (v_audit_id,p_business_id,p_branch_id,1,
      jsonb_build_object('id',v_audit_id::text,'actorId',v_actor_id::text,'action','SALE_CREATED','module','sales',
        'entityId',v_sale_id::text,'description','Venta '||v_sale_code||' creada server-side.','date',v_now,
        'operationId',p_idempotency_key,'idempotencyKey',p_idempotency_key,'result','SUCCESS'),v_now,v_now);

    RETURN jsonb_build_object('success',true,'idempotent',false,'idempotencyKey',p_idempotency_key,
      'sale',v_sale_data||jsonb_build_object('version',1),'kitchenOrder',v_kitchen_data,'printerJobId',v_printer_job_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_code=RETURNED_SQLSTATE,v_error_message=MESSAGE_TEXT,v_error_detail=PG_EXCEPTION_DETAIL;
    IF v_actor_id IS NOT NULL AND p_business_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.business_members AS member WHERE member.business_id=p_business_id AND member.user_id=v_actor_id
    ) THEN
      v_audit_id := gen_random_uuid();
      INSERT INTO public.audit_logs (id,business_id,branch_id,version,data,created_at,updated_at)
      VALUES (v_audit_id,p_business_id,
        CASE WHEN EXISTS (SELECT 1 FROM public.branches WHERE id=p_branch_id AND business_id=p_business_id) THEN p_branch_id ELSE NULL END,
        1,jsonb_build_object('id',v_audit_id::text,'actorId',v_actor_id::text,'action','SALE_FULFILLMENT_FAILED',
          'module','sales','entityId',v_sale_id::text,'description','Venta rechazada por create_sale_fulfillment_atomic.',
          'date',clock_timestamp(),'idempotencyKey',p_idempotency_key,'result','FAILED','errorCode',v_error_code,
          'error',v_error_message,'detail',v_error_detail),clock_timestamp(),clock_timestamp());
    END IF;
    RETURN jsonb_build_object('success',false,'idempotent',false,'idempotencyKey',p_idempotency_key,
      'code',v_error_code,'error',v_error_message);
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_fulfillment_atomic(uuid,uuid,text,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_sale_fulfillment_atomic(uuid,uuid,text,jsonb) TO authenticated;

COMMIT;
