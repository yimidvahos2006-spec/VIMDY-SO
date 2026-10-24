-- =============================================================================
-- STOCK ENMASCARADO DURANTE UN CONTEO A CIEGAS ACTIVO (P0)
-- -----------------------------------------------------------------------------
-- HUECO QUE CIERRA
--   El conteo a ciegas ya no entrega cifras del sistema (migración
--   20261023120000), pero quien cuenta (INVENTARIO o GERENTE) seguía pudiendo
--   abrir Inventario o el POS y ver el stock exacto: el stock y el costo viven
--   dentro de products.data y cualquier miembro del negocio podía leerlos
--   directo (pantalla, DevTools, IndexedDB o Realtime).
--
-- REGLA (la decide el SERVIDOR, no la pantalla)
--   Un usuario está "enmascarado" cuando:
--     1) su rol puede contar pero NO ver diferencias
--        (inventory_count_can_count AND NOT inventory_count_can_see_differences;
--         hoy: GERENTE e INVENTARIO. ADMIN nunca se enmascara), y
--     2) existe un conteo a ciegas OPEN en ese negocio (cualquier sucursal) que
--        él abrió (data.createdByUserId = auth.uid()) o que le fue asignado
--        (data.assignedTo contiene su uid).
--   La máscara es por NEGOCIO (no por sucursal): es más estricta y permite que
--   la política RLS se evalúe una sola vez por consulta (ver sección 6).
--        Los conteos abiertos ANTES de esta migración no tienen
--        createdByUserId: por seguridad se enmascara a todo contador no-ADMIN
--        hasta que se cierren.
--
--   Mientras está enmascarado:
--     · inventory_products_read() le entrega cada producto SIN stock exacto ni
--       costo unitario: stock = valor "de banda" (nunca el real), más
--       stockMasked = true y stockStatus = AVAILABLE | LOW | OUT.
--     · La tabla products, el Kardex (inventory_movements) y la auditoría del
--       módulo inventario (audit_logs) quedan INVISIBLES para su sesión
--       (política RLS RESTRICTIVE): ni PostgREST, ni DevTools, ni Realtime le
--       devuelven filas con cifras reales.
--     · El POS sigue vendiendo: create_sale_fulfillment_atomic es SECURITY
--       DEFINER, descuenta el stock en el servidor y no depende de que el
--       usuario pueda leer la fila.
--     · Si su cliente devuelve una copia enmascarada al guardar un producto, el
--       trigger products_preserve_masked_fields conserva el stock y el costo
--       reales (nunca se guarda el valor de banda).
--
-- EFECTO SECUNDARIO ASUMIDO
--   Mientras tenga su conteo abierto, esa persona no puede editar productos ni
--   mover stock con su usuario (no ve las filas). Cierra el conteo (ADMIN) para
--   liberarlo.
--
-- PARA CAMBIAR QUIÉN SE ENMASCARA: edita los arrays de
--   inventory_count_can_count() / inventory_count_can_see_differences()
--   (migración 20261023120000) y espeja src/core/config/inventoryCountAccess.ts.
--
-- Aplicar DESPUÉS de 20261106000000. Es idempotente.
-- =============================================================================
begin;

-- -----------------------------------------------------------------------------
-- 1) El servidor sella QUIÉN abrió cada conteo (el cliente no puede falsearlo)
-- -----------------------------------------------------------------------------
create or replace function public.inventory_count_sessions_stamp_creator()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(new.data) = 'object' then
    -- Lo que venga del cliente se descarta siempre.
    new.data := new.data - 'createdByUserId';
    if auth.uid() is not null then
      new.data := new.data || jsonb_build_object('createdByUserId', auth.uid()::text);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_count_sessions_stamp_creator on public.inventory_count_sessions;
create trigger inventory_count_sessions_stamp_creator
  before insert on public.inventory_count_sessions
  for each row
  execute function public.inventory_count_sessions_stamp_creator();

-- Un rol puede ser enmascarado si cuenta pero no ve diferencias.
create or replace function public.inventory_count_is_masked_role(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.inventory_count_can_count(p_business_id)
     and not public.inventory_count_can_see_differences(p_business_id);
$$;

-- -----------------------------------------------------------------------------
-- 2) ¿En qué negocios está enmascarado este usuario AHORA?
--    (evaluado siempre en el servidor, con auth.uid() de la sesión)
--    Devuelve un conjunto pequeño: sirve tanto para la política RLS (una sola
--    evaluación por consulta) como para las funciones de lectura.
-- -----------------------------------------------------------------------------
create or replace function public.inventory_count_masked_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct s.business_id
  from public.inventory_count_sessions s
  where auth.uid() is not null
    and s.data ->> 'status' = 'OPEN'
    -- Quien no ve diferencias siempre abre conteos ciegos; "blind" ausente = ciego.
    and (s.data -> 'blind') is distinct from 'false'::jsonb
    and public.inventory_count_is_masked_role(s.business_id)
    and (
      -- conteo anterior a esta migración: se enmascara a todo contador (falla cerrado)
      coalesce(s.data ->> 'createdByUserId', '') = ''
      or s.data ->> 'createdByUserId' = auth.uid()::text
      or (
        jsonb_typeof(s.data -> 'assignedTo') = 'array'
        and (s.data -> 'assignedTo') ? auth.uid()::text
      )
    );
$$;

create or replace function public.inventory_count_user_is_masked(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_business_id is not null
     and p_business_id in (select public.inventory_count_masked_business_ids());
$$;

-- Acelera la búsqueda de conteos abiertos (la tabla crece con el historial).
create index if not exists inventory_count_sessions_open_idx
  on public.inventory_count_sessions (business_id)
  where (data ->> 'status') = 'OPEN';

-- -----------------------------------------------------------------------------
-- 3) Cómo se ve un producto enmascarado
--    stock  -> valor de banda (nunca el real):
--                OUT = 0 · LOW = stock mínimo · AVAILABLE = stock mínimo + 1
--              Así el cliente (que sigue usando product.stock para los badges
--              "agotado / bajo") conserva el estado correcto sin saber la cifra.
--    purchasePrice se elimina. minStock se conserva (no es una cifra de stock).
--    Mismo criterio que getStockStatus() del cliente.
-- -----------------------------------------------------------------------------
create or replace function public.inventory_mask_product_data(p_data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_stock numeric := case when jsonb_typeof(p_data -> 'stock') = 'number' then (p_data ->> 'stock')::numeric else 0 end;
  v_min numeric := case when jsonb_typeof(p_data -> 'minStock') = 'number' then (p_data ->> 'minStock')::numeric else 0 end;
  v_price numeric := case when jsonb_typeof(p_data -> 'price') = 'number' then (p_data ->> 'price')::numeric else 0 end;
  v_ignored boolean := (p_data -> 'trackStock') = 'false'::jsonb
                       or (v_price <= 0 and (p_data -> 'isIngredient') is distinct from 'true'::jsonb);
  v_status text;
  v_band numeric;
begin
  if jsonb_typeof(p_data) is distinct from 'object' then
    return p_data;
  end if;

  if v_ignored then
    v_status := 'AVAILABLE';
  elsif v_stock <= 0 then
    v_status := 'OUT';
  elsif v_stock <= v_min then
    v_status := 'LOW';
  else
    v_status := 'AVAILABLE';
  end if;

  v_band := case v_status
              when 'OUT' then 0
              when 'LOW' then greatest(v_min, 0)
              else greatest(v_min, 0) + 1
            end;

  return (p_data - 'stock' - 'purchasePrice' - 'stockMasked' - 'stockStatus')
         || jsonb_build_object('stock', v_band, 'stockMasked', true, 'stockStatus', v_status);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) Lectura de productos con la máscara aplicada por el servidor
--    Mismo alcance que la política products_tenant_read (negocio + sucursal).
--    Paginado por id (keyset): el cliente pide de a 1000.
-- -----------------------------------------------------------------------------
create or replace function public.inventory_products_read(
  p_business_id uuid,
  p_branch_id uuid default null,
  p_product_ids text[] default null,
  p_after_id text default null,
  p_limit integer default 1000
)
returns table (id text, branch_id uuid, version integer, data jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_masked boolean;
  v_branches uuid[];
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 1000);
begin
  if auth.uid() is null then
    raise exception 'PRODUCTS_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_business_id is null
     or p_business_id not in (select public.auth_business_ids()) then
    raise exception 'PRODUCTS_FORBIDDEN' using errcode = '42501';
  end if;

  v_masked := public.inventory_count_user_is_masked(p_business_id);
  v_branches := public.auth_branch_ids();   -- una vez, no por fila

  return query
    select
      p.id,
      p.branch_id,
      p.version,
      case when v_masked then public.inventory_mask_product_data(p.data) else p.data end
    from public.products p
    where p.business_id = p_business_id
      and (p_branch_id is null or p.branch_id = p_branch_id)
      and (p.branch_id is null or p.branch_id = any (v_branches))
      and (p_product_ids is null or p.id = any (p_product_ids))
      and (p_after_id is null or p.id > p_after_id)
    order by p.id
    limit v_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) Si el cliente devuelve una copia enmascarada, NO se pisa el stock real
-- -----------------------------------------------------------------------------
create or replace function public.products_preserve_masked_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(new.data) is distinct from 'object' then
    return new;
  end if;

  if tg_op = 'UPDATE' and (new.data -> 'stockMasked') = 'true'::jsonb then
    -- La copia que llegó trae valores de banda: stock y costo reales se conservan.
    new.data := (new.data - 'stock' - 'purchasePrice')
                || coalesce((
                     select jsonb_object_agg(k, old.data -> k)
                     from unnest(array['stock', 'purchasePrice']) as k
                     where old.data ? k
                   ), '{}'::jsonb);
  end if;

  -- Banderas derivadas: nunca se guardan en la base.
  new.data := new.data - 'stockMasked' - 'stockStatus';
  return new;
end;
$$;

drop trigger if exists products_preserve_masked_fields on public.products;
create trigger products_preserve_masked_fields
  before insert or update on public.products
  for each row
  execute function public.products_preserve_masked_fields();

-- -----------------------------------------------------------------------------
-- 6) Cerrar la lectura directa para quien está enmascarado
--    RESTRICTIVE = se suma a las políticas existentes (no las reemplaza).
--    products: sin filas reales para su sesión (ni API, ni Realtime).
--    inventory_movements: el Kardex trae stockBefore / stockAfter exactos.
--    OJO rendimiento: la subconsulta NO depende de la fila, así Postgres la
--    calcula una vez por consulta (no una vez por producto).
-- -----------------------------------------------------------------------------
drop policy if exists products_hide_while_blind_count on public.products;
create policy products_hide_while_blind_count on public.products
  as restrictive
  for select
  to authenticated
  using (business_id not in (select public.inventory_count_masked_business_ids()));

-- La auditoría del módulo de inventario guarda cambios de costo
-- ("costo: $3.000 → $3.500"): se oculta solo ese módulo, el resto sigue visible.
drop policy if exists audit_logs_hide_inventory_while_blind_count on public.audit_logs;
create policy audit_logs_hide_inventory_while_blind_count on public.audit_logs
  as restrictive
  for select
  to authenticated
  using (
    business_id not in (select public.inventory_count_masked_business_ids())
    or lower(coalesce(data ->> 'module', '')) not in ('inventario', 'inventory')
  );

drop policy if exists inventory_movements_hide_while_blind_count on public.inventory_movements;
create policy inventory_movements_hide_while_blind_count on public.inventory_movements
  as restrictive
  for select
  to authenticated
  using (business_id not in (select public.inventory_count_masked_business_ids()));

-- -----------------------------------------------------------------------------
-- 7) Permisos de ejecución
--    Las políticas RLS se evalúan con los permisos del usuario, por eso
--    inventory_count_user_is_masked debe ser ejecutable por authenticated.
--    No revelan nada ajeno: solo contestan por quien llama.
-- -----------------------------------------------------------------------------
revoke all on function public.inventory_count_sessions_stamp_creator() from public, anon, authenticated;
revoke all on function public.inventory_count_is_masked_role(uuid) from public, anon, authenticated;
revoke all on function public.inventory_mask_product_data(jsonb) from public, anon, authenticated;
revoke all on function public.products_preserve_masked_fields() from public, anon, authenticated;

revoke all on function public.inventory_count_masked_business_ids() from public, anon;
revoke all on function public.inventory_count_user_is_masked(uuid) from public, anon;
revoke all on function public.inventory_products_read(uuid, uuid, text[], text, integer) from public, anon;

grant execute on function public.inventory_count_masked_business_ids() to authenticated;
grant execute on function public.inventory_count_user_is_masked(uuid) to authenticated;
grant execute on function public.inventory_products_read(uuid, uuid, text[], text, integer) to authenticated;

commit;