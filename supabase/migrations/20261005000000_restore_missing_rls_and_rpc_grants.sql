BEGIN;

DO $$
DECLARE
  v_rule record;
  v_read_policy text;
  v_roles_literal text;
  v_scope_predicate text;
BEGIN
  FOR v_rule IN
    SELECT rules.table_name, rules.read_roles, rules.write_roles
    FROM (VALUES
      ('alerts', ARRAY['ADMIN','GERENTE','CAJERO','MESERO','COCINA','INVENTARIO','CONTADOR']::text[], NULL::text[]),
      ('app_users', ARRAY['ADMIN','GERENTE']::text[], ARRAY['ADMIN','GERENTE']::text[]),
      ('audit_logs', ARRAY['ADMIN','GERENTE','CONTADOR']::text[], NULL::text[]),
      ('business_snapshots', ARRAY['ADMIN','GERENTE','CONTADOR']::text[], NULL::text[]),
      ('categories', ARRAY['ADMIN','GERENTE','CAJERO','MESERO','COCINA','INVENTARIO']::text[], ARRAY['ADMIN','GERENTE']::text[]),
      ('customers', ARRAY['ADMIN','GERENTE','CAJERO','MESERO']::text[], ARRAY['ADMIN','GERENTE','CAJERO','MESERO']::text[]),
      ('notifications', ARRAY['ADMIN','GERENTE','CAJERO','MESERO','COCINA','INVENTARIO','CONTADOR']::text[], NULL::text[]),
      ('orders', ARRAY['ADMIN','GERENTE','CAJERO','MESERO','COCINA']::text[], ARRAY['ADMIN','GERENTE','CAJERO','MESERO']::text[]),
      ('pending_customer_operations', ARRAY['ADMIN','GERENTE','CAJERO','MESERO']::text[], ARRAY['ADMIN','GERENTE','CAJERO','MESERO']::text[]),
      ('pending_inventory_adjustments', ARRAY['ADMIN','GERENTE','INVENTARIO']::text[], ARRAY['ADMIN','GERENTE','INVENTARIO']::text[]),
      ('pending_sales', ARRAY['ADMIN','GERENTE','CAJERO','MESERO']::text[], ARRAY['ADMIN','GERENTE','CAJERO','MESERO']::text[]),
      ('pending_table_operations', ARRAY['ADMIN','GERENTE','CAJERO','MESERO']::text[], ARRAY['ADMIN','GERENTE','CAJERO','MESERO']::text[]),
      ('permissions', ARRAY['ADMIN','GERENTE']::text[], ARRAY['ADMIN']::text[]),
      ('purchase_orders', ARRAY['ADMIN','GERENTE','INVENTARIO']::text[], ARRAY['ADMIN','GERENTE','INVENTARIO']::text[]),
      ('receipts', ARRAY['ADMIN','GERENTE','CAJERO','CONTADOR']::text[], ARRAY['ADMIN','GERENTE','CAJERO']::text[]),
      ('roles', ARRAY['ADMIN','GERENTE']::text[], ARRAY['ADMIN']::text[]),
      ('shifts', ARRAY['ADMIN','GERENTE','CAJERO']::text[], NULL::text[]),
      ('suppliers', ARRAY['ADMIN','GERENTE','INVENTARIO']::text[], ARRAY['ADMIN','GERENTE','INVENTARIO']::text[]),
      ('tables', ARRAY['ADMIN','GERENTE','CAJERO','MESERO']::text[], ARRAY['ADMIN','GERENTE','CAJERO','MESERO']::text[]),
      ('waiters', ARRAY['ADMIN','GERENTE','MESERO']::text[], ARRAY['ADMIN','GERENTE']::text[])
    ) AS rules(table_name, read_roles, write_roles)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_rule.table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v_rule.table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', v_rule.table_name);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_rule.table_name);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_rule.table_name);

    v_scope_predicate := 'business_id IN (SELECT public.auth_business_ids())';
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_rule.table_name
        AND column_name = 'branch_id'
    ) THEN
      v_scope_predicate := v_scope_predicate ||
        ' AND (branch_id IS NULL OR branch_id = ANY(public.auth_branch_ids()))';
    END IF;

    v_read_policy := v_rule.table_name || '_tenant_read';
    v_roles_literal := quote_literal(v_rule.read_roles::text) || '::text[]';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_read_policy, v_rule.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
         %s
         AND public.has_business_role(business_id, %s)
       )',
      v_read_policy, v_rule.table_name, v_scope_predicate, v_roles_literal
    );

    IF v_rule.write_roles IS NOT NULL THEN
      v_roles_literal := quote_literal(v_rule.write_roles::text) || '::text[]';
      EXECUTE format(
        'GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated',
        v_rule.table_name
      );

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_rule.table_name || '_tenant_insert', v_rule.table_name);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (
           %s
           AND public.has_business_role(business_id, %s)
           AND public.is_business_subscription_active(business_id)
         )',
        v_rule.table_name || '_tenant_insert', v_rule.table_name, v_scope_predicate, v_roles_literal
      );

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_rule.table_name || '_tenant_update', v_rule.table_name);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
         USING (
           %s
           AND public.has_business_role(business_id, %s)
         )
         WITH CHECK (
           %s
           AND public.has_business_role(business_id, %s)
           AND public.is_business_subscription_active(business_id)
         )',
        v_rule.table_name || '_tenant_update', v_rule.table_name,
        v_scope_predicate, v_roles_literal, v_scope_predicate, v_roles_literal
      );

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_rule.table_name || '_tenant_delete', v_rule.table_name);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (
           %s
           AND public.has_business_role(business_id, %s)
           AND public.is_business_subscription_active(business_id)
         )',
        v_rule.table_name || '_tenant_delete', v_rule.table_name, v_scope_predicate, v_roles_literal
      );
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_verifications ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.sales FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sale_items FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cash_movements FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.shifts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_movements FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.kitchen_orders FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.kitchen_order_items FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payment_verifications FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM anon, authenticated;
GRANT SELECT ON public.sales, public.sale_items, public.cash_movements, public.shifts,
  public.inventory_movements, public.kitchen_orders, public.kitchen_order_items,
  public.payment_verifications, public.audit_logs TO authenticated;
GRANT ALL ON public.sales, public.sale_items, public.cash_movements, public.shifts,
  public.inventory_movements, public.kitchen_orders, public.kitchen_order_items,
  public.payment_verifications, public.audit_logs TO service_role;
REVOKE ALL ON public.sales, public.sale_items, public.cash_movements, public.shifts,
  public.inventory_movements, public.kitchen_orders, public.kitchen_order_items,
  public.payment_verifications, public.audit_logs FROM anon;

DO $$
DECLARE
  v_rule record;
  v_scope_predicate text;
BEGIN
  FOR v_rule IN
    SELECT rules.table_name, rules.read_roles
    FROM (VALUES
      ('sales', ARRAY['ADMIN','GERENTE','CAJERO','CONTADOR']::text[]),
      ('sale_items', ARRAY['ADMIN','GERENTE','CAJERO','CONTADOR']::text[]),
      ('cash_movements', ARRAY['ADMIN','GERENTE','CAJERO','CONTADOR']::text[]),
      ('shifts', ARRAY['ADMIN','GERENTE','CAJERO']::text[]),
      ('inventory_movements', ARRAY['ADMIN','GERENTE','INVENTARIO']::text[]),
      ('kitchen_orders', ARRAY['ADMIN','GERENTE','CAJERO','MESERO','COCINA']::text[]),
      ('kitchen_order_items', ARRAY['ADMIN','GERENTE','CAJERO','MESERO','COCINA']::text[]),
      ('payment_verifications', ARRAY['ADMIN','GERENTE','CAJERO']::text[]),
      ('audit_logs', ARRAY['ADMIN','GERENTE','CONTADOR']::text[])
    ) AS rules(table_name, read_roles)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_rule.table_name || '_tenant_read', v_rule.table_name);
    IF v_rule.table_name = 'sale_items' THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
           EXISTS (
             SELECT 1 FROM public.sales s
             WHERE s.id = sale_items.sale_id
               AND s.business_id IN (SELECT public.auth_business_ids())
               AND (s.branch_id IS NULL OR s.branch_id = ANY(public.auth_branch_ids()))
               AND public.has_business_role(s.business_id, %L::text[])
           )
         )',
        v_rule.table_name || '_tenant_read', v_rule.table_name, v_rule.read_roles::text
      );
    ELSIF v_rule.table_name = 'kitchen_order_items' THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
           EXISTS (
             SELECT 1 FROM public.kitchen_orders ko
             WHERE ko.id = kitchen_order_items.kitchen_order_id
               AND ko.business_id IN (SELECT public.auth_business_ids())
               AND (ko.branch_id IS NULL OR ko.branch_id = ANY(public.auth_branch_ids()))
               AND public.has_business_role(ko.business_id, %L::text[])
           )
         )',
        v_rule.table_name || '_tenant_read', v_rule.table_name, v_rule.read_roles::text
      );
    ELSE
      v_scope_predicate := 'business_id IN (SELECT public.auth_business_ids())';
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = v_rule.table_name
          AND column_name = 'branch_id'
      ) THEN
        v_scope_predicate := v_scope_predicate ||
          ' AND (branch_id IS NULL OR branch_id = ANY(public.auth_branch_ids()))';
      END IF;
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
           %s
           AND public.has_business_role(business_id, %L::text[])
         )',
        v_rule.table_name || '_tenant_read', v_rule.table_name, v_scope_predicate, v_rule.read_roles::text
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.open_shift_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text,uuid,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_shift_atomic(uuid,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_shift_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text,uuid,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_shift_atomic(uuid,numeric,text) TO authenticated, service_role;

ALTER FUNCTION public.open_shift_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text) SET search_path = pg_catalog;
ALTER FUNCTION public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text) SET search_path = pg_catalog;
ALTER FUNCTION public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text,uuid,text,uuid) SET search_path = pg_catalog;
ALTER FUNCTION public.close_shift_atomic(uuid,numeric,text) SET search_path = pg_catalog;

COMMIT;
