-- VIMDY — Realtime completo.
-- Hasta ahora solo products, categories, suppliers, inventory_movements y waiters
-- estaban en la publicación supabase_realtime; el resto de tablas que la app
-- escucha (ventas, cocina, mesas, caja, clientes...) nunca avisaba a otros
-- dispositivos. Idempotente: solo agrega lo que falte y existe.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'products','categories','suppliers','inventory_movements','waiters',
    'sales','customers','kitchen_orders','alerts','notifications','receipts',
    'cash_movements','tables','orders','shifts','roles','permissions',
    'app_users','audit_logs','businesses','business_snapshots'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t)
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
       ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', t);
    END IF;
  END LOOP;
END
$$;
