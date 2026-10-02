-- Recreate tenant read policies removed when auth_branch_ids() was dropped
-- with CASCADE. Financial writes remain server-side through atomic RPCs.
DO $$
DECLARE
  v_table text;
  v_read_tables text[] := ARRAY[
    'sales',
    'inventory_movements',
    'cash_movements',
    'kitchen_orders'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_read_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_tenant_read', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated, service_role
       USING (
         business_id IN (SELECT public.auth_business_ids())
         AND (branch_id IS NULL OR branch_id = ANY(public.auth_branch_ids()))
       )',
      v_table || '_tenant_read',
      v_table
    );
  END LOOP;
END;
$$;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_tenant_read ON public.products;
CREATE POLICY products_tenant_read ON public.products
  FOR SELECT TO authenticated, service_role
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY(public.auth_branch_ids()))
  );

DROP POLICY IF EXISTS products_tenant_insert ON public.products;
CREATE POLICY products_tenant_insert ON public.products
  FOR INSERT TO authenticated, service_role
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY(public.auth_branch_ids()))
    AND public.has_business_role(business_id, ARRAY['ADMIN', 'GERENTE'])
    AND public.is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS products_tenant_update ON public.products;
CREATE POLICY products_tenant_update ON public.products
  FOR UPDATE TO authenticated, service_role
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY(public.auth_branch_ids()))
    AND public.has_business_role(business_id, ARRAY['ADMIN', 'GERENTE'])
  )
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY(public.auth_branch_ids()))
    AND public.has_business_role(business_id, ARRAY['ADMIN', 'GERENTE'])
    AND public.is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS products_tenant_delete ON public.products;
CREATE POLICY products_tenant_delete ON public.products
  FOR DELETE TO authenticated, service_role
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY(public.auth_branch_ids()))
    AND public.has_business_role(business_id, ARRAY['ADMIN', 'GERENTE'])
    AND public.is_business_subscription_active(business_id)
  );

ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_items_tenant_read ON public.sale_items;
CREATE POLICY sale_items_tenant_read ON public.sale_items
  FOR SELECT TO authenticated, service_role
  USING (
    EXISTS (
      SELECT 1
      FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND s.business_id IN (SELECT public.auth_business_ids())
        AND (s.branch_id IS NULL OR s.branch_id = ANY(public.auth_branch_ids()))
    )
  );

ALTER TABLE public.kitchen_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kitchen_order_items_tenant_read ON public.kitchen_order_items;
CREATE POLICY kitchen_order_items_tenant_read ON public.kitchen_order_items
  FOR SELECT TO authenticated, service_role
  USING (
    EXISTS (
      SELECT 1
      FROM public.kitchen_orders ko
      WHERE ko.id = kitchen_order_items.kitchen_order_id
        AND ko.business_id IN (SELECT public.auth_business_ids())
        AND (ko.branch_id IS NULL OR ko.branch_id = ANY(public.auth_branch_ids()))
    )
  );

ALTER TABLE public.kitchen_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kitchen_settings_branch_read ON public.kitchen_settings;
CREATE POLICY kitchen_settings_branch_read ON public.kitchen_settings
  FOR SELECT TO authenticated, service_role
  USING (store_id = ANY(public.auth_branch_ids()));
