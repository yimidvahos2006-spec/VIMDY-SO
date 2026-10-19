-- VIMDY — tiempo real para la tabla de meseros.
-- Un mesero nuevo (o editado/quitado) debe aparecer en los demás dispositivos
-- sin recargar. Idempotente: si ya estaba publicada, no hace nada.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'waiters')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'waiters'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.waiters;
  END IF;
END
$$;