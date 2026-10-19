BEGIN;

-- CANCELLED debe ser un estado válido en la columna operativa del trabajo de impresión;
-- el índice de cola excluye los estados terminales y así no reimprime una comanda anulada.
ALTER TABLE public.kitchen_printer_jobs
  DROP CONSTRAINT IF EXISTS kitchen_printer_jobs_status_check;
ALTER TABLE public.kitchen_printer_jobs
  ADD CONSTRAINT kitchen_printer_jobs_status_check
  CHECK (status IN ('PENDING', 'PRINTING', 'PRINTED', 'FAILED', 'CANCELLED'));

CREATE OR REPLACE FUNCTION public.cancel_pending_sale_atomic(
  p_business_id uuid,
  p_branch_id uuid,
  p_sale_id uuid,
  p_expected_version integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_sale public.sales%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_movement record;
  v_movement_id uuid;
  v_stock numeric;
  v_restore_quantity numeric;
  v_now timestamptz := clock_timestamp();
  v_new_data jsonb;
  v_new_version integer;
  v_kitchen_cancelled boolean := false;
  v_audit_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'SALE_CANCEL_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_business_id IS NULL OR p_branch_id IS NULL OR p_sale_id IS NULL THEN
    RAISE EXCEPTION 'SALE_CANCEL_CONTEXT_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'SALE_CANCEL_VERSION_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(pg_catalog.btrim(p_reason), '') IS NULL OR pg_catalog.length(p_reason) > 500 THEN
    RAISE EXCEPTION 'SALE_CANCEL_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_members AS member
    WHERE member.business_id = p_business_id
      AND member.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'SALE_NOT_A_MEMBER' USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE(public.has_business_role(p_business_id, ARRAY['ADMIN', 'GERENTE', 'CAJERO']), false) THEN
    RAISE EXCEPTION 'SALE_CANCEL_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  PERFORM public.caja_assert_branch_access(p_business_id, p_branch_id);

  IF NOT COALESCE(public.is_business_subscription_active(p_business_id), false) THEN
    RAISE EXCEPTION 'SALE_SUBSCRIPTION_INACTIVE' USING ERRCODE = '42501';
  END IF;

  SELECT sale.*
  INTO v_sale
  FROM public.sales AS sale
  WHERE sale.id = p_sale_id
    AND sale.business_id = p_business_id
    AND sale.branch_id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Repetir una cancelación ya confirmada no debe restaurar stock otra vez.
  IF v_sale.data->>'status' = 'CANCELLED' THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'alreadyCancelled', true,
      'sale', v_sale.data || pg_catalog.jsonb_build_object('version', v_sale.version)
    );
  END IF;

  IF v_sale.data->>'status' IS DISTINCT FROM 'PENDING_PAYMENT' THEN
    RAISE EXCEPTION 'SALE_CANCEL_STATUS_INVALID' USING ERRCODE = '55000';
  END IF;

  IF v_sale.version <> p_expected_version THEN
    RAISE EXCEPTION 'OPTIMISTIC_LOCK_ERROR' USING ERRCODE = '40001';
  END IF;

  -- Los movimientos DECREASE contienen los productos reales requeridos,
  -- incluidas las recetas ya expandidas por create_sale_fulfillment_atomic.
  -- No se vuelve a calcular la receta: se restaura exactamente el Kardex.
  FOR v_movement IN
    SELECT
      movement.data->>'productId' AS product_id,
      pg_catalog.sum(
        CASE
          WHEN NULLIF(movement.data->>'delta', '') IS NOT NULL
            THEN pg_catalog.abs((movement.data->>'delta')::numeric)
          ELSE (movement.data->>'quantity')::numeric
        END
      ) AS restore_quantity
    FROM public.inventory_movements AS movement
    WHERE movement.business_id = p_business_id
      AND movement.branch_id = p_branch_id
      AND movement.data->>'saleId' = p_sale_id::text
      AND movement.data->>'type' = 'DECREASE'
      AND NULLIF(movement.data->>'productId', '') IS NOT NULL
    GROUP BY movement.data->>'productId'
    ORDER BY movement.data->>'productId'
  LOOP
    v_restore_quantity := v_movement.restore_quantity;

    IF v_restore_quantity IS NULL OR v_restore_quantity <= 0 THEN
      RAISE EXCEPTION 'SALE_CANCEL_INVENTORY_MOVEMENT_INVALID' USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_movement_id := public.vimdy_uuid_from_text(
        'cancel-' || p_sale_id::text || '-' || v_movement.product_id
      );
      PERFORM v_movement.product_id::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'SALE_CANCEL_INVENTORY_PRODUCT_ID_INVALID' USING ERRCODE = '22023';
    END;

    -- Un ID determinístico hace que un reintento no aplique un segundo aumento.
    IF NOT EXISTS (
      SELECT 1
      FROM public.inventory_movements AS existing_movement
      WHERE existing_movement.id = v_movement_id
    ) THEN
      SELECT product.*
      INTO v_product
      FROM public.products AS product
      WHERE product.id = v_movement.product_id::uuid
        AND product.business_id = p_business_id
        AND (product.branch_id = p_branch_id OR product.branch_id IS NULL)
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'SALE_CANCEL_INVENTORY_PRODUCT_NOT_FOUND: %', v_movement.product_id
          USING ERRCODE = 'P0002';
      END IF;

      v_stock := COALESCE(NULLIF(v_product.data->>'stock', '')::numeric, 0);

      UPDATE public.products AS product
      SET data = pg_catalog.jsonb_set(
          v_product.data,
          '{stock}',
          pg_catalog.to_jsonb(v_stock + v_restore_quantity),
          true
        ) || pg_catalog.jsonb_build_object('lastUpdated', v_now),
        version = product.version + 1,
        updated_at = v_now
      WHERE product.id = v_product.id
        AND product.business_id = p_business_id
        AND product.version = v_product.version;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'OPTIMISTIC_LOCK_ERROR' USING ERRCODE = '40001';
      END IF;

      INSERT INTO public.inventory_movements (
        id, business_id, branch_id, data, created_at, updated_at
      )
      VALUES (
        v_movement_id,
        p_business_id,
        p_branch_id,
        pg_catalog.jsonb_build_object(
          'id', v_movement_id::text,
          'productId', v_product.id::text,
          'productName', COALESCE(v_product.data->>'name', v_product.id::text),
          'quantity', v_restore_quantity,
          'delta', v_restore_quantity,
          'date', v_now,
          'type', 'INCREASE',
          'reason', 'Cancelación de venta pendiente: ' || pg_catalog.btrim(p_reason),
          'performedBy', v_actor_id::text,
          'saleId', p_sale_id::text,
          'operationId', 'cancel-' || p_sale_id::text,
          'branchId', p_branch_id::text
        ),
        v_now,
        v_now
      );
    END IF;
  END LOOP;

  -- La orden de cocina tiene el mismo UUID que la venta en el flujo atómico.
  UPDATE public.kitchen_orders AS kitchen_order
  SET data = pg_catalog.jsonb_set(
        kitchen_order.data,
        '{status}',
        pg_catalog.to_jsonb('CANCELADO'::text),
        true
      ) || pg_catalog.jsonb_build_object(
        'cancelReason', pg_catalog.btrim(p_reason),
        'cancelledAt', v_now,
        'cancelledBy', v_actor_id::text
      ),
      version = kitchen_order.version + 1,
      updated_at = v_now
  WHERE kitchen_order.id = p_sale_id
    AND kitchen_order.business_id = p_business_id
    AND kitchen_order.branch_id = p_branch_id
    AND kitchen_order.data->>'status' IN ('PENDIENTE', 'EN_PREPARACION')
  RETURNING true INTO v_kitchen_cancelled;

  IF v_kitchen_cancelled THEN
    UPDATE public.kitchen_order_items AS kitchen_item
    SET status = 'CANCELADO'
    WHERE kitchen_item.kitchen_order_id = p_sale_id
      AND pg_catalog.upper(kitchen_item.status) IN (
        'PENDING', 'PENDIENTE', 'EN_PREPARACION', 'PREPARANDO'
      );

  END IF;

  -- Cancelar igualmente cualquier trabajo de impresión aún en cola, aunque la
  -- comanda ya haya avanzado de estado. Así no se imprime una venta anulada.
  UPDATE public.kitchen_printer_jobs AS printer_job
  SET status = 'CANCELLED',
      data = pg_catalog.jsonb_set(
        printer_job.data,
        '{status}',
        pg_catalog.to_jsonb('CANCELADO'::text),
        true
      ) || pg_catalog.jsonb_build_object(
        'cancelReason', pg_catalog.btrim(p_reason),
        'cancelledAt', v_now
      ),
      updated_at = v_now
  WHERE printer_job.sale_id = p_sale_id
    AND printer_job.business_id = p_business_id
    AND printer_job.branch_id = p_branch_id
    AND printer_job.status IN ('PENDING', 'PRINTING')
    AND printer_job.data->>'status' IS DISTINCT FROM 'CANCELADO';

  v_new_data := pg_catalog.jsonb_set(
    v_sale.data,
    '{status}',
    pg_catalog.to_jsonb('CANCELLED'::text),
    true
  );
  v_new_data := pg_catalog.jsonb_set(
    v_new_data,
    '{notes}',
    pg_catalog.to_jsonb(
      CASE
        WHEN NULLIF(pg_catalog.btrim(v_sale.data->>'notes'), '') IS NULL
          THEN 'Anulada: ' || pg_catalog.btrim(p_reason)
        ELSE (v_sale.data->>'notes') || E'\nAnulada: ' || pg_catalog.btrim(p_reason)
      END
    ),
    true
  );
  v_new_data := v_new_data || pg_catalog.jsonb_build_object(
    'cancelReason', pg_catalog.btrim(p_reason),
    'cancelledAt', v_now,
    'cancelledBy', v_actor_id::text
  );

  UPDATE public.sales AS sale
  SET data = v_new_data,
      version = sale.version + 1,
      updated_at = v_now
  WHERE sale.id = p_sale_id
    AND sale.business_id = p_business_id
    AND sale.branch_id = p_branch_id
    AND sale.version = p_expected_version
  RETURNING sale.data, sale.version
  INTO v_new_data, v_new_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPTIMISTIC_LOCK_ERROR' USING ERRCODE = '40001';
  END IF;

  v_audit_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.audit_logs (
    id, business_id, branch_id, version, data, created_at, updated_at
  )
  VALUES (
    v_audit_id,
    p_business_id,
    p_branch_id,
    1,
    pg_catalog.jsonb_build_object(
      'id', v_audit_id::text,
      'actorId', v_actor_id::text,
      'action', 'SALE_CANCELLED_PENDING_PAYMENT',
      'module', 'sales',
      'entityId', p_sale_id::text,
      'description', 'Venta pendiente anulada: ' || pg_catalog.btrim(p_reason),
      'date', v_now,
      'result', 'SUCCESS'
    ),
    v_now,
    v_now
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'alreadyCancelled', false,
    'sale', v_new_data || pg_catalog.jsonb_build_object('version', v_new_version)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_pending_sale_atomic(uuid, uuid, uuid, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_pending_sale_atomic(uuid, uuid, uuid, integer, text)
  TO authenticated;

COMMIT;
