-- ============================================================================
-- 20261011000000_step4_inventory_adjust_rbac_tenant_isolation.sql
-- ----------------------------------------------------------------------------
-- Cierra un defecto CRITICO de seguridad y aislamiento en el ajuste de stock.
--
-- Defecto
-- -------
-- public.adjust_stock_with_kardex (y su wrapper
-- adjust_stock_with_kardex_and_fields, que la delega) eran:
--
--   * SECURITY INVOKER
--   * GRANT EXECUTE TO authenticated
--   * SIN comprobacion de pertenencia al negocio
--   * SIN comprobacion de rol
--   * SIN comprobacion de sucursal autorizada
--
-- La RPC localizaba el producto unicamente por su id (mas un branch_id opcional
-- que el propio caller fornecia) y escribia stock + inventory_movements. Como no
-- derivaba el negocio de auth.uid(), cualquier usuario autenticado del sistema
-- podia modificar el inventario de CUALQUIER negocio.
--
-- Demostracion empirica (antes de esta migracion), con un unico usuario que era
-- ADMIN del negocio A y MESERO del negocio B:
--
--   PERFORM adjust_stock_with_kardex(<producto del negocio A>, 999, ...);
--   -- sin error: stock del negocio A paso de 10 a 1009
--
-- Violaba las reglas 8 (business isolation, branch isolation, RLS y RBAC) del
-- Paso 4. El batch equivalente adjust_stock_batch_with_kardex SI estaba
-- endurecido (ADMIN/GERENTE/INVENTARIO + sucursal), asi que la asimetria era
-- solo en el camino de producto individual.
--
-- Correccion
-- ---------
-- Sederiva el negocio desde el producto real y se exige:
--   1. auth.uid() no nulo,
--   2. pertenencia al negocio del producto,
--   3. rol ADMIN, GERENTE o INVENTARIO,
--   4. suscripcion activa,
--   5. la sucursal del producto este entre las autorizadas del actor.
-- service_role conserva acceso (usado por el backend y por las pruebas que
-- ya dependian de el), igual que en transfer_stock_atomic.
--
-- El resto de la semantica NO cambia: mismo calculo de stock, mismo
-- idempotency_key por movement_id, mismo INSERT en inventory_movements, misma
-- delegacion en adjust_product_stock (que sigue aplicando INSUFFICIENT_STOCK).
--
-- Migracion NUEVA: no se modifica 20261004000000 (historica).
-- ============================================================================

BEGIN;

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
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product_id uuid;
  v_movement_id uuid;
  v_product public.products%ROWTYPE;
  v_updated jsonb;
  v_actor_id uuid := auth.uid();
  v_role text := auth.role();
BEGIN
  BEGIN
    v_product_id := p_product_id::uuid;
    v_movement_id := COALESCE(p_movement_id::uuid, pg_catalog.gen_random_uuid());
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_INVENTORY_IDENTIFIER' USING ERRCODE = 'P0001';
  END;

  -- El negocio se deriva del producto, nunca de un parametro del caller.
  SELECT product.*
    INTO v_product
  FROM public.products AS product
  WHERE product.id = v_product_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- La sucursal efectiva es la del producto. Si el caller envia otra, se
  -- descarta: no se puede redirigir la escritura hacia otra sucursal.
  IF p_branch_id IS NOT NULL
     AND v_product.branch_id IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION 'INVENTORY_BRANCH_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF v_role IS DISTINCT FROM 'service_role' THEN
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'INVENTORY_AUTH_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.business_members AS member
      WHERE member.business_id = v_product.business_id
        AND member.user_id = v_actor_id
    ) THEN
      RAISE EXCEPTION 'INVENTORY_NOT_A_MEMBER' USING ERRCODE = '42501';
    END IF;
    IF NOT public.has_business_role(
      v_product.business_id, ARRAY['ADMIN', 'GERENTE', 'INVENTARIO']
    ) THEN
      RAISE EXCEPTION 'INVENTORY_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_business_subscription_active(v_product.business_id) THEN
      RAISE EXCEPTION 'INVENTORY_SUBSCRIPTION_INACTIVE' USING ERRCODE = '42501';
    END IF;
    IF v_product.branch_id IS NOT NULL
       AND NOT COALESCE(v_product.branch_id = ANY (public.auth_branch_ids()), false) THEN
      RAISE EXCEPTION 'INVENTORY_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
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
    v_product.branch_id
  );

  INSERT INTO public.inventory_movements (
    id, business_id, branch_id, data
  )
  VALUES (
    v_movement_id,
    v_product.business_id,
    v_product.branch_id,
    pg_catalog.jsonb_build_object(
      'id', v_movement_id::text,
      'productId', v_product_id::text,
      'productName', v_product.data->>'name',
      'quantity', pg_catalog.abs(p_delta),
      'date', pg_catalog.now(),
      'type', p_type,
      'reason', p_reason,
      'performedBy', COALESCE(p_performed_by, v_actor_id::text),
      'supplierId', p_supplier_id,
      'supplierName', p_supplier_name,
      'lossCategory', p_loss_category,
      'branchId', v_product.branch_id
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
) TO authenticated, service_role;

COMMENT ON FUNCTION public.adjust_stock_with_kardex(
  text, numeric, text, text, text, uuid, text, text, text, uuid, boolean
) IS 'Ajuste de stock de un producto con rastro en inventory_movements. Server-authoritative: el negocio se deriva del producto y exige pertenencia + rol ADMIN/GERENTE/INVENTARIO + sucursal autorizada. service_role conserva acceso.';

COMMIT;