-- performance_indexes_migration.sql
-- ---------------------------------------------------------------------------
-- Índices críticos para rendimiento con miles de usuarios.
-- Generados a partir de la auditoría de lentitud de VIMDY.
-- Seguro de ejecutar múltiples veces (usa CREATE INDEX IF NOT EXISTS).
-- ---------------------------------------------------------------------------

-- 1. branch_id faltante en TODAS las tablas genéricas
-- applyScope filtra por branch_id en casi todas las queries; sin índice,
-- Postgres hace seq scan dentro del índice de business_id.
DO $$
DECLARE
  store_name text;
  store_names text[] := array[
    'products', 'sales', 'customers', 'kitchen_orders', 'alerts',
    'inventory_movements', 'cash_movements', 'tables', 'orders',
    'shifts', 'roles', 'permissions', 'audit_logs', 'categories', 'suppliers',
    'business_snapshots', 'purchase_orders', 'waiters', 'receipts', 'notifications'
  ];
BEGIN
  FOREACH store_name IN ARRAY store_names LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (branch_id);', store_name || '_branch_id_idx', store_name);
  END LOOP;
END $$;

-- 2. business_members(business_id, role): lo usa has_business_role() en CADA
-- policy de RLS de cada tabla. Sin índice compuesto, cada operación CRUD
-- hace index scan por user_id + filtro manual.
CREATE INDEX IF NOT EXISTS business_members_business_role_idx ON business_members (business_id, role);

-- 3. audit_logs: filtrados por actor_id, action y module en AuditEngine.
-- Hoy trae toda la tabla y filtra en JS.
CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx ON audit_logs ((data->>'actorId'));
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs ((data->>'action'));
CREATE INDEX IF NOT EXISTS audit_logs_module_idx ON audit_logs ((data->>'module'));

-- 4. sales.status: filtrado en JS en DashboardEngine, SalesEngine, reportes.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_status text GENERATED ALWAYS AS (data->>'status') STORED;
CREATE INDEX IF NOT EXISTS sales_business_status_idx ON sales (business_id, sale_status);

-- 5. orders.status: filtrado en JS en OrderEngine, KitchenEngine.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_status text GENERATED ALWAYS AS (data->>'status') STORED;
CREATE INDEX IF NOT EXISTS orders_business_status_idx ON orders (business_id, order_status);

-- 6. tables.status: filtrado en JS en TableEngine.
ALTER TABLE tables ADD COLUMN IF NOT EXISTS table_status text GENERATED ALWAYS AS (data->>'status') STORED;
CREATE INDEX IF NOT EXISTS tables_business_status_idx ON tables (business_id, table_status);

-- 7. kitchen_orders.status: filtrado en JS en KitchenEngine.
ALTER TABLE kitchen_orders ADD COLUMN IF NOT EXISTS kitchen_status text GENERATED ALWAYS AS (data->>'status') STORED;
CREATE INDEX IF NOT EXISTS kitchen_orders_business_status_idx ON kitchen_orders (business_id, kitchen_status);

-- 8. shifts.status: filtrado en JS en ShiftEngine.getCurrentShift().
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS shift_status text GENERATED ALWAYS AS (data->>'status') STORED;
CREATE INDEX IF NOT EXISTS shifts_business_status_idx ON shifts (business_id, shift_status);

-- 9. waiters.active: filtrado en JS en WaiterEngine.listActive().
ALTER TABLE waiters ADD COLUMN IF NOT EXISTS waiter_active boolean GENERATED ALWAYS AS ((data->>'active')::boolean) STORED;
CREATE INDEX IF NOT EXISTS waiters_business_active_idx ON waiters (business_id, waiter_active);

-- 10. purchase_orders.status: filtrado en JS en PurchaseOrderEngine.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS po_status text GENERATED ALWAYS AS (data->>'status') STORED;
CREATE INDEX IF NOT EXISTS purchase_orders_business_status_idx ON purchase_orders (business_id, po_status);

-- 11. receipts: filtrados por customerId, saleId y fecha en ReceiptEngine.
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS receipt_customer_id text GENERATED ALWAYS AS (data->>'customerId') STORED;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS receipt_sale_id text GENERATED ALWAYS AS (data->>'saleId') STORED;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS receipt_created_at timestamptz GENERATED ALWAYS AS (public.immutable_timestamptz(data->>'createdAt')) STORED;
CREATE INDEX IF NOT EXISTS receipts_business_customer_idx ON receipts (business_id, receipt_customer_id);
CREATE INDEX IF NOT EXISTS receipts_business_sale_idx ON receipts (business_id, receipt_sale_id);
CREATE INDEX IF NOT EXISTS receipts_business_created_at_idx ON receipts (business_id, receipt_created_at);

-- 12. notifications: filtrados por tipo y leídas en notificationStore.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_type text GENERATED ALWAYS AS (data->>'type') STORED;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_read boolean GENERATED ALWAYS AS ((data->>'read')::boolean) STORED;
CREATE INDEX IF NOT EXISTS notifications_business_type_idx ON notifications (business_id, notification_type);
CREATE INDEX IF NOT EXISTS notifications_business_read_idx ON notifications (business_id, notification_read);

-- 13. categories: búsquedas por nombre en CategoryEngine y deduplicación.
CREATE INDEX IF NOT EXISTS categories_name_idx ON categories ((data->>'name'));

-- 14. suppliers: búsquedas por nombre en SupplierEngine.
CREATE INDEX IF NOT EXISTS suppliers_name_idx ON suppliers ((data->>'name'));
