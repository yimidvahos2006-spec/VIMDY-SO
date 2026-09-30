-- ============================================================================
-- VIMDY OS — Credenciales de pago por negocio
-- ----------------------------------------------------------------------------
-- Cada negocio puede guardar sus propias credenciales de Wompi/Nequi
-- en vez de usar las llaves globales de Supabase secrets.
--
-- Seguridad:
--   - Las columnas sensibles se guardan cifradas en base64 (cifrado
--     AES-GCM en la capa de aplicación / Edge Functions).
--   - RLS activo: cada negocio solo lee/escribe sus propias credenciales.
--   - Solo ADMIN puede ver/editar credenciales.
-- ============================================================================

create table if not exists business_payment_credentials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  provider text not null default 'wompi',
  public_key_encrypted text,
  private_key_encrypted text,
  integrity_secret_encrypted text,
  events_secret_encrypted text,
  is_active boolean not null default true,
  last_tested_at timestamptz,
  last_test_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists business_payment_credentials_business_provider_unique
  on business_payment_credentials (business_id, provider)
  where is_active = true;

create index if not exists business_payment_credentials_business_id_idx
  on business_payment_credentials (business_id);

alter table business_payment_credentials enable row level security;

drop policy if exists business_payment_credentials_admin_access on business_payment_credentials;
create policy business_payment_credentials_admin_access on business_payment_credentials
  for all
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
  )
  with check (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
  );

grant all on business_payment_credentials to service_role;
grant select on business_payment_credentials to authenticated;

-- Función para guardar credenciales (ya vienen cifradas desde la app)
create or replace function public.save_payment_credentials(
  p_business_id uuid,
  p_provider text,
  p_public_key text,
  p_private_key text,
  p_integrity_secret text,
  p_events_secret text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update business_payment_credentials
  set
    public_key_encrypted = p_public_key,
    private_key_encrypted = p_private_key,
    integrity_secret_encrypted = p_integrity_secret,
    events_secret_encrypted = p_events_secret,
    is_active = true,
    updated_at = now()
  where business_id = p_business_id and provider = p_provider
  returning id into v_id;

  if v_id is null then
    insert into business_payment_credentials (
      business_id, provider, public_key_encrypted, private_key_encrypted,
      integrity_secret_encrypted, events_secret_encrypted, is_active
    ) values (
      p_business_id, p_provider,
      p_public_key, p_private_key,
      p_integrity_secret, p_events_secret,
      true
    ) returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_payment_credentials from public, anon;
grant execute on function public.save_payment_credentials(uuid, text, text, text, text, text) to authenticated;

-- Función para obtener credenciales (devuelve texto cifrado; la Edge Function lo descifra)
create or replace function public.get_payment_credentials(
  p_business_id uuid,
  p_provider text
)
returns table (
  public_key text,
  private_key text,
  integrity_secret text,
  events_secret text
)
language sql
security definer
set search_path = public
as $$
  select
    public_key_encrypted as public_key,
    private_key_encrypted as private_key,
    integrity_secret_encrypted as integrity_secret,
    events_secret_encrypted as events_secret
  from business_payment_credentials
  where business_id = p_business_id and provider = p_provider and is_active = true;
$$;

revoke all on function public.get_payment_credentials(uuid, text) from public, anon;
grant execute on function public.get_payment_credentials(uuid, text) to service_role;

-- Función para probar credenciales
create or replace function public.test_payment_credentials(
  p_business_id uuid,
  p_provider text
)
returns table (
  success boolean,
  error_message text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from business_payment_credentials
    where business_id = p_business_id and provider = p_provider and is_active = true
  ) then
    return query select false, 'No hay credenciales guardadas para este proveedor.';
    return;
  end if;

  if exists (
    select 1 from business_payment_credentials
    where business_id = p_business_id and provider = p_provider and is_active = true
      and (public_key_encrypted is null or public_key_encrypted = '')
  ) then
    return query select false, 'Public key vacía.';
    return;
  end if;

  return query select true, 'Credenciales válidas (formato correcto).';
end;
$$;

revoke all on function public.test_payment_credentials(uuid, text) from public, anon;
grant execute on function public.test_payment_credentials(uuid, text) to authenticated;
