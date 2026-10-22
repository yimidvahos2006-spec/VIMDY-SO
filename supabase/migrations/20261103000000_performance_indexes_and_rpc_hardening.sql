-- ============================================================================
-- 20261103000000_performance_indexes_and_rpc_hardening.sql
-- ----------------------------------------------------------------------------
-- Auditoria de Supabase (22 oct 2026) antes del primer cliente grande.
--
-- 1) RENDIMIENTO: 64 llaves foraneas sin indice (alertas del linter 0001).
--    Con muchas ventas (ej. sale_items.sale_id, kitchen_order_items,
--    inventory_movements.branch_id) historial, reportes y Kardex se vuelven
--    lentos. Se crean indices simples sobre cada columna. Cambio ADITIVO:
--    no toca datos ni tablas, IF NOT EXISTS lo hace repetible.
--
-- 2) SEGURIDAD (RPC visibles a usuarios con sesion):
--    * get_db_metrics / get_db_size_bytes / get_cache_hit_ratio revelaban
--      tamano de la base, conexiones y cache a cualquier usuario autenticado.
--      Solo las usa ops-monitor con la clave de administrador (service_role).
--    * has_user_used_trial(p_user_id) dejaba preguntar por CUALQUIER usuario.
--      Ahora solo responde por el usuario de la sesion (service_role y la
--      politica businesses_insert_own, que pasa auth.uid(), siguen igual).
--
-- NO incluido a proposito: has_business_role sigue ejecutable por anon porque
-- 20+ politicas con rol {public} la evaluan; revocarla romperia esas
-- consultas. Se corrige aparte cambiando esas politicas a TO authenticated.
-- ============================================================================
BEGIN;

-- 1) Indices de llaves foraneas ----------------------------------------------
CREATE INDEX IF NOT EXISTS idx_alerts_branch_id ON public.alerts (branch_id);
CREATE INDEX IF NOT EXISTS idx_app_users_branch_id ON public.app_users (branch_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_branch_id ON public.audit_logs (branch_id);
CREATE INDEX IF NOT EXISTS idx_business_invitations_invited_by ON public.business_invitations (invited_by);
CREATE INDEX IF NOT EXISTS idx_business_members_business_id ON public.business_members (business_id);
CREATE INDEX IF NOT EXISTS idx_business_snapshots_branch_id ON public.business_snapshots (branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_counts_branch_id ON public.cash_drawer_counts (branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_counts_cash_register_id ON public.cash_drawer_counts (cash_register_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_counts_shift_id ON public.cash_drawer_counts (shift_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_branch_id ON public.cash_movements (branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_cash_register_id ON public.cash_movements (cash_register_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_transfers_branch_id ON public.cash_register_transfers (branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_transfers_from_cash_register_id ON public.cash_register_transfers (from_cash_register_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_transfers_from_shift_id ON public.cash_register_transfers (from_shift_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_transfers_to_cash_register_id ON public.cash_register_transfers (to_cash_register_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_transfers_to_shift_id ON public.cash_register_transfers (to_shift_id);
CREATE INDEX IF NOT EXISTS idx_cash_registers_branch_id ON public.cash_registers (branch_id);
CREATE INDEX IF NOT EXISTS idx_categories_branch_id ON public.categories (branch_id);
CREATE INDEX IF NOT EXISTS idx_customers_branch_id ON public.customers (branch_id);
CREATE INDEX IF NOT EXISTS idx_daily_report_deliveries_business_id ON public.daily_report_deliveries (business_id);
CREATE INDEX IF NOT EXISTS idx_daily_report_jobs_branch_id ON public.daily_report_jobs (branch_id);
CREATE INDEX IF NOT EXISTS idx_electronic_invoices_certificate_id ON public.electronic_invoices (certificate_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batch_operations_branch_id ON public.inventory_batch_operations (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_branch_id ON public.inventory_count_sessions (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_id ON public.inventory_movements (branch_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_order_items_kitchen_order_id ON public.kitchen_order_items (kitchen_order_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_order_items_sale_item_id ON public.kitchen_order_items (sale_item_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_branch_id ON public.kitchen_orders (branch_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_printer_jobs_branch_id ON public.kitchen_printer_jobs (branch_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_printer_jobs_kitchen_order_id ON public.kitchen_printer_jobs (kitchen_order_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_printer_jobs_sale_id ON public.kitchen_printer_jobs (sale_id);
CREATE INDEX IF NOT EXISTS idx_notifications_branch_id ON public.notifications (branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_branch_id ON public.orders (branch_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_actor_id ON public.payment_refunds (actor_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_branch_id ON public.payment_refunds (branch_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_sale_id ON public.payment_refunds (sale_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_session_id ON public.payment_refunds (session_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_subscription_payment_id ON public.payment_refunds (subscription_payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_actor_id ON public.payment_sessions (actor_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_branch_id ON public.payment_sessions (branch_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_sale_id ON public.payment_sessions (sale_id);
CREATE INDEX IF NOT EXISTS idx_payment_verifications_branch_id ON public.payment_verifications (branch_id);
CREATE INDEX IF NOT EXISTS idx_pending_customer_operations_business_id ON public.pending_customer_operations (business_id);
CREATE INDEX IF NOT EXISTS idx_pending_inventory_adjustments_business_id ON public.pending_inventory_adjustments (business_id);
CREATE INDEX IF NOT EXISTS idx_pending_sales_branch_id ON public.pending_sales (branch_id);
CREATE INDEX IF NOT EXISTS idx_pending_sales_business_id ON public.pending_sales (business_id);
CREATE INDEX IF NOT EXISTS idx_pending_table_operations_business_id ON public.pending_table_operations (business_id);
CREATE INDEX IF NOT EXISTS idx_permissions_branch_id ON public.permissions (branch_id);
CREATE INDEX IF NOT EXISTS idx_products_branch_id ON public.products (branch_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_branch_id ON public.purchase_orders (branch_id);
CREATE INDEX IF NOT EXISTS idx_receipts_branch_id ON public.receipts (branch_id);
CREATE INDEX IF NOT EXISTS idx_roles_branch_id ON public.roles (branch_id);
CREATE INDEX IF NOT EXISTS idx_sale_fulfillment_operations_actor_id ON public.sale_fulfillment_operations (actor_id);
CREATE INDEX IF NOT EXISTS idx_sale_fulfillment_operations_branch_id ON public.sale_fulfillment_operations (branch_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON public.sale_items (product_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON public.sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_branch_id ON public.sales (branch_id);
CREATE INDEX IF NOT EXISTS idx_shifts_branch_id ON public.shifts (branch_id);
CREATE INDEX IF NOT EXISTS idx_shifts_cash_register_id ON public.shifts (cash_register_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_branch_id ON public.suppliers (branch_id);
CREATE INDEX IF NOT EXISTS idx_system_errors_user_id ON public.system_errors (user_id);
CREATE INDEX IF NOT EXISTS idx_tables_branch_id ON public.tables (branch_id);
CREATE INDEX IF NOT EXISTS idx_user_trial_usage_business_id ON public.user_trial_usage (business_id);
CREATE INDEX IF NOT EXISTS idx_waiters_branch_id ON public.waiters (branch_id);

-- 2) Endurecer RPC de metricas -----------------------------------------------
REVOKE ALL ON FUNCTION public.get_db_metrics() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_db_size_bytes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_cache_hit_ratio() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_db_metrics() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_db_size_bytes() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cache_hit_ratio() TO service_role;

-- 3) has_user_used_trial: solo el propio usuario -------------------------------
CREATE OR REPLACE FUNCTION public.has_user_used_trial(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1
    FROM public.user_trial_usage
    WHERE user_id = p_user_id
      AND ((SELECT auth.uid()) IS NULL OR (SELECT auth.uid()) = p_user_id)
  );
$function$;

REVOKE ALL ON FUNCTION public.has_user_used_trial(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_user_used_trial(uuid) TO authenticated, service_role;

COMMIT;