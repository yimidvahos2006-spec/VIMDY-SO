-- Ajustes del negocio que antes solo vivían en memoria (se perdían al recargar
-- o al entrar desde otro equipo): NIT, teléfono, WhatsApp de pedidos, meta
-- diaria, impresión automática, stock negativo, asistente IA, etc.
-- Se guardan en UNA columna jsonb; nombre, país, moneda, idioma, zona horaria
-- e IVA siguen en sus columnas propias.
-- Es un cambio aditivo: no toca datos existentes.

alter table public.businesses
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.businesses
  drop constraint if exists businesses_settings_valid;

alter table public.businesses
  add constraint businesses_settings_valid
  check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 20000);

-- La tabla usa permisos por columna: hay que darle permiso a la nueva.
grant select (settings) on public.businesses to authenticated;
grant update (settings) on public.businesses to authenticated;