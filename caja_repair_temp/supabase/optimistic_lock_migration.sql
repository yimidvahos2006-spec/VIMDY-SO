-- ============================================================================
-- optimistic_lock_migration.sql
-- ----------------------------------------------------------------------------
-- CRÍTICO #6 del checklist de lanzamiento — "Bloqueo optimista (o versión)
-- en las actualizaciones". Hoy dos personas pueden editar el MISMO registro
-- (ej. la misma mesa, la misma comanda) casi al mismo tiempo y el segundo
-- guardado pisa el del primero sin que nadie se entere.
--
-- Cómo se resuelve: cada fila de las tablas "genéricas" (las que ya tienen
-- `id, business_id, data jsonb, created_at, updated_at`, creadas en el
-- bloque `do $$ ... $$` de schema.sql) recibe una columna `version` que
-- arranca en 1. Cada UPDATE desde la app (ver SupabaseRepository.update())
-- exige que la fila siga en la versión que el cliente leyó por última vez
-- (`where id = ... and version = <la que leí>`) y, si coincide, sube la
-- versión en el mismo UPDATE. Si la fila ya cambió de versión (alguien más
-- guardó primero), el UPDATE afecta 0 filas y la app lo detecta y lanza
-- OptimisticLockError en vez de sobreescribir a ciegas.
--
-- Es la misma técnica en TODAS las tablas porque todas comparten la misma
-- forma genérica — no hace falta un enfoque distinto por tabla.
--
-- Cómo aplicar: pega este archivo completo en el "SQL Editor" de Supabase
-- y dale "Run". Es seguro correrlo más de una vez (usa `if not exists`).
-- ============================================================================

do $$
declare
  store_name text;
  store_names text[] := array[
    -- Las mismas tablas "genéricas" que ya crea schema.sql (incluye
    -- app_users, que es el directorio de empleados — NO auth.users).
    'products', 'sales', 'customers', 'kitchen_orders', 'alerts',
    'inventory_movements', 'cash_movements', 'tables', 'orders',
    'shifts', 'roles', 'permissions', 'audit_logs', 'categories', 'suppliers',
    'business_snapshots', 'purchase_orders', 'waiters', 'receipts',
    'notifications', 'app_users'
  ];
begin
  foreach store_name in array store_names loop
    -- Si la tabla no existe todavía en este proyecto (ej. no has corrido
    -- alguna migración opcional), simplemente se ignora esa tabla.
    if to_regclass(store_name) is not null then
      execute format(
        'alter table %I add column if not exists version integer not null default 1;',
        store_name
      );
    end if;
  end loop;
end $$;

-- Nota: no hace falta backfill manual — `add column ... default 1` ya deja
-- todas las filas existentes en version = 1, que es exactamente lo que
-- espera el cliente la primera vez que las lee (ver SupabaseRepository).