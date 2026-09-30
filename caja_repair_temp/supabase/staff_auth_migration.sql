-- ============================================================================
-- staff_auth_migration.sql
-- ----------------------------------------------------------------------------
-- CRÍTICO #1 del checklist de lanzamiento.
--
-- Antes: `app_users.data` guardaba un `passwordHash` (SHA-256 con salt,
-- generado y verificado en el navegador) para cajero/mesero/cocina.
-- Ahora: cajero/mesero/cocina son usuarios reales de Supabase Auth (igual
-- que el dueño), creados por la Edge Function create-staff-user. Auth guarda
-- la contraseña ya hasheada (bcrypt) y nunca la expone — `app_users` pasa a
-- ser solo el perfil (nombre, avatar, preferencias), nunca credenciales.
--
-- Esta migración:
--   1) Borra cualquier `passwordHash` que haya quedado guardado en filas
--      existentes de `app_users` (defensa en profundidad — ya no debería
--      escribirse nunca más, pero si quedó algo de antes, se limpia).
--   2) Dobla la nota en el propio schema para que quede claro que
--      `app_users.id` ahora es el mismo id que `auth.users.id` /
--      `business_members.user_id` para el personal creado desde ahora.
--
-- Aplicar con:
--   supabase db push   (o pegar en el SQL editor del panel de Supabase)
-- ============================================================================

update app_users
set data = data - 'passwordHash' - 'failedLoginAttempts' - 'lockedUntil'
where data ? 'passwordHash';

comment on table app_users is
  'Perfil de personal (nombre, avatar, preferencias) por negocio. NO guarda '
  'credenciales: cajero/mesero/cocina/admin son usuarios reales de Supabase '
  'Auth (ver business_members.role); esta tabla nunca debe volver a tener '
  'un passwordHash en su columna data.';