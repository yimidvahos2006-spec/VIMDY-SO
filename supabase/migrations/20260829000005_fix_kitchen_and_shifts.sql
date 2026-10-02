-- 1. Asegurar configuración por defecto para la salida de cocina (KDS / Impresora)
CREATE TABLE IF NOT EXISTS kitchen_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL,
    default_printer_id VARCHAR(255) DEFAULT 'KITCHEN_MAIN',
    auto_print_on_order BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar configuración por defecto para entorno de desarrollo / tests
INSERT INTO kitchen_settings (store_id, default_printer_id, auto_print_on_order)
VALUES ('00000000-0000-0000-0000-000000000000', 'TEST_PRINTER', true)
ON CONFLICT DO NOTHING;

-- 2. Asegurar campos de tolerancia y redondeo en la tabla de turnos y pagos
ALTER TABLE shifts 
ADD COLUMN IF NOT EXISTS total_discrepancy DECIMAL(12,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'OPEN';

ALTER TABLE sales
ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'COMPLETED';

-- 3. Índice para acelerar el filtrado de comandes en KDS
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS order_status text GENERATED ALWAYS AS (data->>'status') STORED;

CREATE INDEX IF NOT EXISTS idx_orders_kitchen_status 
ON orders (business_id, order_status, created_at) 
WHERE order_status NOT IN ('CANCELADO', 'ENTREGADO');