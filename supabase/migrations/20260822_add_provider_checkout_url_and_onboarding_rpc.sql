-- ============================================================================
-- VIMDY OS — Schema migration: agregar provider_checkout_url y RPC
-- de onboarding server-side.
-- ============================================================================

-- 1) Columna para guardar la URL de checkout real del proveedor
--    (Wompi / MercadoPago / PayPal). Permite reutilizar pagos pendientes
--    sin reconstruir la URL de memoria.
alter table subscription_payments
  add column if not exists provider_checkout_url text;

-- 2) RPC para marcar onboarding como completado desde el cliente,
--    validando membresía del usuario. Reemplaza el UPDATE directo
--    que antes estaba permitido por GRANT.
create or replace function public.mark_onboarding_completed_server_side(p_business_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if not exists (
      select 1 from business_members
      where business_id = p_business_id
        and user_id = auth.uid()
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  update businesses
  set onboarding_completed = true
  where id = p_business_id
    and onboarding_completed = false;

  return found;
end;
$$;

revoke all on function public.mark_onboarding_completed_server_side(uuid) from public, anon;
grant execute on function public.mark_onboarding_completed_server_side(uuid) to authenticated, service_role;
