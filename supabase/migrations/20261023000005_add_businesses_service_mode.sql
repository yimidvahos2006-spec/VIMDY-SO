ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS service_mode text;

COMMENT ON COLUMN public.businesses.service_mode IS
  'Modo de servicio: counter | table_service | both. NULL = derivar de tables_enabled.';