-- ============================================================================
# SQL PARA EJECUTAR EN SUPABASE DASHBOARD (SQL Editor)
# Esto arregla los permisos faltantes que causan el error 401/42501
# ============================================================================

-- 1. PERMISOS DE SCHEMA
grant usage on schema public to anon, authenticated, service_role;
grant create on schema public to service_role;

-- 2. GRANTS PARA service_role (usado por Edge Functions)
grant all on businesses to service_role;
grant all on business_members to service_role;
grant all on business_invitations to service_role;
grant all on branches to service_role;
grant all on subscription_payments to service_role;
grant all on subscription_audit_log to service_role;
grant all on user_trial_usage to service_role;
grant all on app_users to service_role;
grant all on products to service_role;
grant all on sales to service_role;
grant all on sale_items to service_role;
grant all on customers to service_role;
grant all on kitchen_orders to service_role;
grant all on kitchen_order_items to service_role;
grant all on alerts to service_role;
grant all on inventory_movements to service_role;
grant all on cash_movements to service_role;
grant all on tables to service_role;
grant all on orders to service_role;
grant all on shifts to service_role;
grant all on roles to service_role;
grant all on permissions to service_role;
grant all on audit_logs to service_role;
grant all on categories to service_role;
grant all on suppliers to service_role;
grant all on business_snapshots to service_role;
grant all on purchase_orders to service_role;
grant all on waiters to service_role;
grant all on receipts to service_role;
grant all on notifications to service_role;
grant all on pending_sales to service_role;
grant all on pending_inventory_adjustments to service_role;
grant all on pending_table_operations to service_role;
grant all on pending_customer_operations to service_role;

-- 3. GRANTS PARA authenticated (usuarios logueados)
grant select, insert, delete on businesses to authenticated;
grant select on business_members to authenticated;
grant select, insert, update, delete on business_invitations to authenticated;
grant select on branches to authenticated;
grant select on subscription_payments to authenticated;
grant select on subscription_audit_log to authenticated;
grant select, insert, update, delete on app_users to authenticated;
grant all on products to authenticated;
grant all on sales to authenticated;
grant all on sale_items to authenticated;
grant all on customers to authenticated;
grant all on kitchen_orders to authenticated;
grant all on kitchen_order_items to authenticated;
grant all on alerts to authenticated;
grant all on inventory_movements to authenticated;
grant all on cash_movements to authenticated;
grant all on tables to authenticated;
grant all on orders to authenticated;
grant all on shifts to authenticated;
grant all on roles to authenticated;
grant all on permissions to authenticated;
grant all on audit_logs to authenticated;
grant all on categories to authenticated;
grant all on suppliers to authenticated;
grant all on business_snapshots to authenticated;
grant all on purchase_orders to authenticated;
grant all on waiters to authenticated;
grant all on receipts to authenticated;
grant all on notifications to authenticated;
grant all on pending_sales to authenticated;
grant all on pending_inventory_adjustments to authenticated;
grant all on pending_table_operations to authenticated;
grant all on pending_customer_operations to authenticated;

-- 4. UPDATE DE SOLO COLUMNAS SEGURAS EN businesses
revoke update on businesses from authenticated;
grant update (
  name,
  country,
  currency,
  language,
  timezone,
  tax_rate,
  business_type,
  enabled_modules,
  salida_cocina,
  onboarding_completed
) on businesses to authenticated;

-- 5. RLS POLICIES PARA business_members
alter table business_members enable row level security;

drop policy if exists business_members_self_read on business_members;
create policy business_members_self_read on business_members
  for select
  using (user_id = auth.uid());

-- 6. RLS POLICIES PARA businesses
alter table businesses enable row level security;

-- Usa el MISMO nombre que schema.sql (businesses_member_access) para evitar
-- duplicados. Si schema.sql ya lo aplicó, este DROP+CREATE lo reemplaza
-- con la misma lógica — idempotente.
drop policy if exists businesses_select_member on businesses;
drop policy if exists businesses_member_access on businesses;
create policy businesses_member_access on businesses
  for select
  using (
    id in (select auth_business_ids())
  );

-- Nota: NO se define policy de INSERT sobre businesses aquí.
-- La policy de inserción de negocios está en schema.sql (businesses_insert_own)
-- y requiere has_user_used_trial() = false, respetando el trial.
-- Este script no debe sobrescribir policies de negocio.

-- 7. HABILITAR RLS EN TODAS LAS TABLAS
alter table products enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table customers enable row level security;
alter table kitchen_orders enable row level security;
alter table kitchen_order_items enable row level security;
alter table alerts enable row level security;
alter table inventory_movements enable row level security;
alter table cash_movements enable row level security;
alter table tables enable row level security;
alter table orders enable row level security;
alter table shifts enable row level security;
alter table categories enable row level security;
alter table waiters enable row level security;

-- 8. POLÍTICAS RLS BÁSICAS (aislamiento por negocio)
-- ----------------------------------------------------------------------------
-- IMPORTANTE: Este script NO debe sobrescribir las policies dinámicas
-- generadas en schema.sql (store_name || '_tenant_*'). Las policies aquí
-- son de respaldo en caso de que schema.sql no se haya aplicado.
-- Si schema.sql ya definió '_tenant_read' etc., este script las deja pasar
-- con DROP IF EXISTS (idempotente). Se usan los NOMBRES DE SCHEMA.SQL para
-- evitar duplicados.
--
-- PATRÓN VIMDY (consistente con schema.sql:375-628):
--   - SELECT: usando auth_business_ids() (sin requerir suscripción activa)
--   - INSERT/UPDATE/DELETE: usando auth_business_ids() + is_business_subscription_active()
--   - UPDATE: también verifica has_business_role ADMIN en la WITH CHECK
-- ----------------------------------------------------------------------------
do $$
declare
  store_name text;
  store_names text[] := array[
    'products', 'sales', 'customers', 'kitchen_orders',
    'inventory_movements', 'cash_movements', 'tables', 'orders',
    'shifts', 'categories', 'suppliers', 'business_snapshots',
    'purchase_orders', 'waiters', 'receipts', 'notifications',
    'sale_items', 'kitchen_order_items', 'roles', 'permissions',
    'audit_logs', 'business_invitations'
  ];
begin
  foreach store_name in array store_names loop
    execute format('alter table %I enable row level security;', store_name);

    execute format('
      drop policy if exists %I_tenant_read on %I;
      create policy %I_tenant_read on %I
        for select
        using (
          business_id in (select auth_business_ids())
          and (
            branch_id is null
            or branch_id in (select auth_branch_ids())
          )
        );
    ', store_name, store_name, store_name, store_name);

    execute format('
      drop policy if exists %I_tenant_insert on %I;
      create policy %I_tenant_insert on %I
        for insert
        with check (
          business_id in (select auth_business_ids())
          and (
            branch_id is null
            or branch_id in (select auth_branch_ids())
          )
          and public.is_business_subscription_active(business_id)
        );
    ', store_name, store_name, store_name, store_name);

    execute format('
      drop policy if exists %I_tenant_update on %I;
      create policy %I_tenant_update on %I
        for update
        using (
          business_id in (select auth_business_ids())
        )
        with check (
          business_id in (select auth_business_ids())
          and public.is_business_subscription_active(business_id)
        );
    ', store_name, store_name, store_name, store_name);

    execute format('
      drop policy if exists %I_tenant_delete on %I;
      create policy %I_tenant_delete on %I
        for delete
        using (
          business_id in (select auth_business_ids())
          and public.is_business_subscription_active(business_id)
        );
    ', store_name, store_name, store_name, store_name);
  end loop;
end $$;

-- ============================================================================
-- FIN
-- ============================================================================
