-- ============================================================================
-- 20260910_business_type_label
-- ----------------------------------------------------------------------------
-- Agrega la columna business_type_label a businesses, para almacenar el
-- nombre real del negocio cuando el usuario elige "Otro" (otro tipo de
-- negocio). Null para todos los tipos fijos.
-- ============================================================================

alter table businesses add column if not exists business_type_label text;
comment on column businesses.business_type_label is
  'Nombre real del negocio cuando business_type = ''otro'' (ej. "Empanadas El Buen Sabor"). Null para el resto de tipos.';
