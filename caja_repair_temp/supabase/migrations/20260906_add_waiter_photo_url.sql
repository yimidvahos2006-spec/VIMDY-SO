-- Agregar columna opcional de foto a meseros
ALTER TABLE public.waiters
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

COMMENT ON COLUMN public.waiters.photo_url IS 'URL o data URL opcional de la foto del mesero.';
