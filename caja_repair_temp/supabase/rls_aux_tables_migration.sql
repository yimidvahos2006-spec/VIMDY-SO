-- ============================================================================
-- VIMDY OS — RLS policies para tablas auxiliares sin políticas
-- ----------------------------------------------------------------------------
-- Las tablas sale_items, kitchen_order_items y las pending_* tienen RLS
-- activado pero sin políticas. Esta migración agrega políticas de aislamiento
-- multi-tenant igual que el resto de tablas del schema.
--
-- Aplicar: pega en SQL Editor de Supabase.
-- ============================================================================

-- sale_items
drop policy if exists sale_items_tenant_read on sale_items;
create policy sale_items_tenant_read on sale_items
  for select
  using (
    sale_id in (select id from sales where business_id in (select auth_business_ids()))
  );

drop policy if exists sale_items_tenant_insert on sale_items;
create policy sale_items_tenant_insert on sale_items
  for insert
  with check (
    sale_id in (select id from sales where business_id in (select auth_business_ids()))
  );

-- kitchen_order_items
drop policy if exists kitchen_order_items_tenant_read on kitchen_order_items;
create policy kitchen_order_items_tenant_read on kitchen_order_items
  for select
  using (
    kitchen_order_id in (
      select id from kitchen_orders where business_id in (select auth_business_ids())
    )
  );

drop policy if exists kitchen_order_items_tenant_insert on kitchen_order_items;
create policy kitchen_order_items_tenant_insert on kitchen_order_items
  for insert
  with check (
    kitchen_order_id in (
      select id from kitchen_orders where business_id in (select auth_business_ids())
    )
  );

-- pending_sales
drop policy if exists pending_sales_tenant_read on pending_sales;
create policy pending_sales_tenant_read on pending_sales
  for select
  using (business_id in (select auth_business_ids()));

drop policy if exists pending_sales_tenant_insert on pending_sales;
create policy pending_sales_tenant_insert on pending_sales
  for insert
  with check (business_id in (select auth_business_ids()));

drop policy if exists pending_sales_tenant_update on pending_sales;
create policy pending_sales_tenant_update on pending_sales
  for update
  using (business_id in (select auth_business_ids()))
  with check (business_id in (select auth_business_ids()));

drop policy if exists pending_sales_tenant_delete on pending_sales;
create policy pending_sales_tenant_delete on pending_sales
  for delete
  using (business_id in (select auth_business_ids()));

-- pending_inventory_adjustments
drop policy if exists pending_inventory_adjustments_tenant_read on pending_inventory_adjustments;
create policy pending_inventory_adjustments_tenant_read on pending_inventory_adjustments
  for select
  using (business_id in (select auth_business_ids()));

drop policy if exists pending_inventory_adjustments_tenant_insert on pending_inventory_adjustments;
create policy pending_inventory_adjustments_tenant_insert on pending_inventory_adjustments
  for insert
  with check (business_id in (select auth_business_ids()));

drop policy if exists pending_inventory_adjustments_tenant_update on pending_inventory_adjustments;
create policy pending_inventory_adjustments_tenant_update on pending_inventory_adjustments
  for update
  using (business_id in (select auth_business_ids()))
  with check (business_id in (select auth_business_ids()));

drop policy if exists pending_inventory_adjustments_tenant_delete on pending_inventory_adjustments;
create policy pending_inventory_adjustments_tenant_delete on pending_inventory_adjustments
  for delete
  using (business_id in (select auth_business_ids()));

-- pending_table_operations
drop policy if exists pending_table_operations_tenant_read on pending_table_operations;
create policy pending_table_operations_tenant_read on pending_table_operations
  for select
  using (business_id in (select auth_business_ids()));

drop policy if exists pending_table_operations_tenant_insert on pending_table_operations;
create policy pending_table_operations_tenant_insert on pending_table_operations
  for insert
  with check (business_id in (select auth_business_ids()));

drop policy if exists pending_table_operations_tenant_update on pending_table_operations;
create policy pending_table_operations_tenant_update on pending_table_operations
  for update
  using (business_id in (select auth_business_ids()))
  with check (business_id in (select auth_business_ids()));

drop policy if exists pending_table_operations_tenant_delete on pending_table_operations;
create policy pending_table_operations_tenant_delete on pending_table_operations
  for delete
  using (business_id in (select auth_business_ids()));

-- pending_customer_operations
drop policy if exists pending_customer_operations_tenant_read on pending_customer_operations;
create policy pending_customer_operations_tenant_read on pending_customer_operations
  for select
  using (business_id in (select auth_business_ids()));

drop policy if exists pending_customer_operations_tenant_insert on pending_customer_operations;
create policy pending_customer_operations_tenant_insert on pending_customer_operations
  for insert
  with check (business_id in (select auth_business_ids()));

drop policy if exists pending_customer_operations_tenant_update on pending_customer_operations;
create policy pending_customer_operations_tenant_update on pending_customer_operations
  for update
  using (business_id in (select auth_business_ids()))
  with check (business_id in (select auth_business_ids()));

drop policy if exists pending_customer_operations_tenant_delete on pending_customer_operations;
create policy pending_customer_operations_tenant_delete on pending_customer_operations
  for delete
  using (business_id in (select auth_business_ids()));
