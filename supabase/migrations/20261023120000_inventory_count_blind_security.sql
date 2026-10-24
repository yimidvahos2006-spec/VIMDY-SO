-- =============================================================================
-- CONTEO A CIEGAS — SEGURIDAD EN EL BACKEND (P0)
-- -----------------------------------------------------------------------------
-- PROBLEMA
--   Hasta hoy la pantalla "ocultaba" el stock del sistema y las diferencias,
--   pero la tabla inventory_count_sessions se leía completa desde el navegador
--   (systemStockAtStart / systemStockAtCount / systemStockAtClose / difference
--   viajaban dentro del JSON de cada sesión). Cualquiera con DevTools, o un
--   rol como INVENTARIO, podía verlas.
--
-- SOLUCIÓN
--   1) La tabla queda CERRADA: nadie (anon/authenticated) la lee ni la escribe
--      directo. Toda operación pasa por funciones SECURITY DEFINER.
--   2) El SERVIDOR decide qué se entrega según business_members.role:
--        · Ven diferencias / stock del sistema : roles en
--          inventory_count_can_see_differences()   (por defecto: ADMIN)
--        · Pueden contar (sin ver nada del sistema): roles en
--          inventory_count_can_count()              (ADMIN, GERENTE, INVENTARIO)
--      Quien cuenta recibe cada línea con SOLO: productId, name, unit,
--      categoryId, counted, countedAt. Nunca stock, diferencias, costos ni motivos.
--   3) El servidor toma las "fotos" de stock (al abrir, al guardar cada cantidad
--      y al cerrar) leyendo la tabla products en ese instante. El cliente ya no
--      envía ni puede falsear ninguna cifra del sistema.
--   4) Solo los roles de inventory_count_can_see_differences() pueden revisar
--      las diferencias y cerrar/aplicar el conteo.
--   5) Un rol que no puede ver diferencias NO puede abrir conteos "no ciegos":
--      el servidor fuerza blind = true.
--
-- SUPUESTOS (verificar antes de aplicar; no tuve acceso a schema.sql):
--   · public.inventory_count_sessions(id, business_id, branch_id, data jsonb,
--     version int, updated_at)   — el mismo molde que usa SupabaseRepository.
--   · public.products(id, business_id, branch_id, data jsonb) con data->>'stock'.
--   · public.business_members(user_id, business_id, role).
--   · Existe public.adjust_stock_with_kardex_and_fields(...) con los parámetros
--     que ya usa ProductRepository.adjustStockWithKardex.
--   · business_id / branch_id / user_id son uuid.
--
-- PARA CAMBIAR QUIÉN VE LAS DIFERENCIAS: edita SOLO el array de
-- inventory_count_can_see_differences() (y espeja el cambio en
-- src/core/config/inventoryCountAccess.ts).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) Utilidades internas
-- -----------------------------------------------------------------------------
create or replace function public.inventory_count_now_iso()
returns text
language sql
stable
as $$
  select to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

create or replace function public.inventory_count_member_role(p_business_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select upper(btrim(m.role::text))
  from public.business_members m
  where m.user_id = auth.uid()
    and m.business_id = p_business_id
  limit 1;
$$;

-- Quién PUEDE contar (y solo cuenta: no recibe cifras del sistema).
create or replace function public.inventory_count_can_count(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.inventory_count_member_role(p_business_id) = any (array['ADMIN', 'GERENTE', 'INVENTARIO']),
    false
  );
$$;

-- Quién VE el stock del sistema y las diferencias, y puede cerrar el conteo.
create or replace function public.inventory_count_can_see_differences(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.inventory_count_member_role(p_business_id) = any (array['ADMIN']),
    false
  );
$$;

-- Presenta una sesión. p_full = false => lista blanca: no sale NINGUNA cifra del sistema.
create or replace function public.inventory_count_present(
  p_id text,
  p_version integer,
  p_data jsonb,
  p_full boolean
)
returns jsonb
language sql
stable
as $$
  select case
    when p_full then
      coalesce(p_data, '{}'::jsonb) || jsonb_build_object('id', p_id, 'version', p_version)
    else
      jsonb_build_object('id', p_id, 'version', p_version)
      || coalesce((
           select jsonb_object_agg(k, p_data -> k)
           from unnest(array['status', 'blind', 'scopeLabel', 'kind', 'createdAt',
                             'createdBy', 'prepared', 'closedAt', 'closedBy']) as k
           where p_data ? k
         ), '{}'::jsonb)
      || jsonb_build_object('lines', coalesce((
           select jsonb_agg(
                    coalesce((
                      select jsonb_object_agg(k, l.value -> k)
                      from unnest(array['productId', 'name', 'unit', 'categoryId', 'countedAt']) as k
                      where l.value ? k
                    ), '{}'::jsonb)
                    || jsonb_build_object('counted', l.value -> 'counted')
                    order by l.ord
                  )
           from jsonb_array_elements(coalesce(p_data -> 'lines', '[]'::jsonb))
                with ordinality as l(value, ord)
         ), '[]'::jsonb))
  end;
$$;

create or replace function public.inventory_count_product_stock(
  p_business_id uuid,
  p_branch_id uuid,
  p_product_id text
)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((p.data ->> 'stock')::numeric, 0)
  from public.products p
  where p.id::text = p_product_id
    and p.business_id = p_business_id
    and (p_branch_id is null or p.branch_id = p_branch_id)
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 1) LISTAR
-- -----------------------------------------------------------------------------
create or replace function public.inventory_count_list(
  p_business_id uuid,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_full boolean;
begin
  if auth.uid() is null or not public.inventory_count_can_count(p_business_id) then
    raise exception 'COUNT_FORBIDDEN';
  end if;
  v_full := public.inventory_count_can_see_differences(p_business_id);

  return coalesce((
    select jsonb_agg(
             public.inventory_count_present(s.id::text, s.version, s.data, v_full)
             order by s.data ->> 'createdAt' desc
           )
    from public.inventory_count_sessions s
    where s.business_id = p_business_id
      and (p_branch_id is null or s.branch_id = p_branch_id)
  ), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) OBTENER UNA
-- -----------------------------------------------------------------------------
create or replace function public.inventory_count_get(
  p_business_id uuid,
  p_session_id text,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_full boolean;
  v_row public.inventory_count_sessions%rowtype;
begin
  if auth.uid() is null or not public.inventory_count_can_count(p_business_id) then
    raise exception 'COUNT_FORBIDDEN';
  end if;
  v_full := public.inventory_count_can_see_differences(p_business_id);

  select * into v_row
  from public.inventory_count_sessions s
  where s.id::text = p_session_id
    and s.business_id = p_business_id
    and (p_branch_id is null or s.branch_id = p_branch_id);

  if not found then
    return null;
  end if;
  return public.inventory_count_present(v_row.id::text, v_row.version, v_row.data, v_full);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) ABRIR (el servidor elige los productos y toma la foto inicial)
-- -----------------------------------------------------------------------------
create or replace function public.inventory_count_start(
  p_business_id uuid,
  p_branch_id uuid,
  p_kind text,
  p_scope jsonb,
  p_scope_label text,
  p_blind boolean,
  p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_full boolean;
  v_blind boolean;
  v_mode text := coalesce(p_scope ->> 'mode', 'all');
  v_limit integer := 20;
  v_lines jsonb;
  v_id uuid := gen_random_uuid();
  v_data jsonb;
  v_row public.inventory_count_sessions%rowtype;
begin
  if auth.uid() is null or not public.inventory_count_can_count(p_business_id) then
    raise exception 'COUNT_FORBIDDEN';
  end if;
  v_full := public.inventory_count_can_see_differences(p_business_id);

  if p_kind is null or p_kind not in ('todo', 'insumos', 'productos') then
    raise exception 'COUNT_INVALID_INPUT';
  end if;
  if v_mode not in ('all', 'category', 'top') then
    raise exception 'COUNT_INVALID_INPUT';
  end if;
  if v_mode = 'category' and coalesce(p_scope ->> 'categoryId', '') = '' then
    raise exception 'COUNT_INVALID_INPUT';
  end if;
  if v_mode = 'top' and jsonb_typeof(p_scope -> 'limit') = 'number' then
    v_limit := greatest(1, floor((p_scope ->> 'limit')::numeric)::integer);
  end if;

  -- Quien no puede ver diferencias NUNCA abre un conteo "no ciego".
  v_blind := coalesce(p_blind, true) or not v_full;

  with base as (
    select
      p.id::text as pid,
      p.data as d,
      coalesce((p.data ->> 'stock')::numeric, 0) as stock,
      coalesce((p.data ->> 'purchasePrice')::numeric, 0) as cost
    from public.products p
    where p.business_id = p_business_id
      and (p_branch_id is null or p.branch_id = p_branch_id)
      and (p.data -> 'active') is distinct from 'false'::jsonb
      and (p.data -> 'trackStock') is distinct from 'false'::jsonb
      and (
        p_kind = 'todo'
        or (p_kind = 'insumos' and (p.data -> 'isIngredient') = 'true'::jsonb)
        or (p_kind = 'productos' and (p.data -> 'isIngredient') is distinct from 'true'::jsonb)
      )
      and (v_mode <> 'category' or p.data ->> 'categoryId' = p_scope ->> 'categoryId')
  ),
  picked as (
    select * from base
    order by
      case when v_mode = 'top' then greatest(stock, 0) * cost end desc nulls last,
      lower(coalesce(d ->> 'name', ''))
    limit (case when v_mode = 'top' then v_limit else null end)
  )
  select jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'productId', pid,
             'name', d ->> 'name',
             'unit', d ->> 'unit',
             'categoryId', d ->> 'categoryId',
             'systemStockAtStart', stock,
             'unitCost', case when jsonb_typeof(d -> 'purchasePrice') = 'number'
                              then (d ->> 'purchasePrice')::numeric end
           ))
           || jsonb_build_object('counted', null)
           order by lower(coalesce(d ->> 'name', ''))
         )
    into v_lines
  from picked;

  if v_lines is null or jsonb_array_length(v_lines) = 0 then
    raise exception 'COUNT_NO_PRODUCTS';
  end if;

  v_data := jsonb_build_object(
    'id', v_id::text,
    'status', 'OPEN',
    'blind', v_blind,
    'scopeLabel', coalesce(p_scope_label, ''),
    'kind', p_kind,
    'createdAt', public.inventory_count_now_iso(),
    'createdBy', coalesce(p_created_by, ''),
    'lines', v_lines
  );

  insert into public.inventory_count_sessions (id, business_id, branch_id, data, version, updated_at)
  values (v_id, p_business_id, p_branch_id, v_data, 1, now())
  returning * into v_row;

  return public.inventory_count_present(v_row.id::text, v_row.version, v_row.data, v_full);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) GUARDAR LO CONTADO
--    El cliente manda SOLO [{productId, counted}]. La "foto" del sistema la pone
--    el servidor leyendo products en este mismo instante.
-- -----------------------------------------------------------------------------
create or replace function public.inventory_count_save(
  p_business_id uuid,
  p_session_id text,
  p_counts jsonb,
  p_recounted_ids text[] default '{}'::text[],
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_full boolean;
  v_row public.inventory_count_sessions%rowtype;
  v_data jsonb;
  v_incoming jsonb;
  v_new_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_pid text;
  v_val jsonb;
  v_counted numeric;
  v_stock numeric;
  v_now text := public.inventory_count_now_iso();
  v_recounted text[] := coalesce(p_recounted_ids, '{}'::text[]);
begin
  if auth.uid() is null or not public.inventory_count_can_count(p_business_id) then
    raise exception 'COUNT_FORBIDDEN';
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'array' then
    raise exception 'COUNT_INVALID_INPUT';
  end if;
  v_full := public.inventory_count_can_see_differences(p_business_id);

  select * into v_row
  from public.inventory_count_sessions s
  where s.id::text = p_session_id
    and s.business_id = p_business_id
    and (p_branch_id is null or s.branch_id = p_branch_id)
  for update;

  if not found then
    raise exception 'COUNT_SESSION_NOT_FOUND';
  end if;
  v_data := v_row.data;
  if v_data ->> 'status' = 'CLOSED' then
    raise exception 'COUNT_SESSION_CLOSED';
  end if;
  if coalesce((v_data ->> 'prepared')::boolean, false) then
    raise exception 'COUNT_SESSION_CLOSING';
  end if;

  select coalesce(jsonb_object_agg(e ->> 'productId', coalesce(e -> 'counted', 'null'::jsonb)), '{}'::jsonb)
    into v_incoming
  from jsonb_array_elements(p_counts) e
  where e ? 'productId';

  -- Se recorren las líneas GUARDADAS (el cliente no puede agregar ni quitar productos).
  for v_line in
    select l.value
    from jsonb_array_elements(coalesce(v_data -> 'lines', '[]'::jsonb)) with ordinality as l(value, ord)
    order by l.ord
  loop
    v_pid := v_line ->> 'productId';

    if v_incoming ? v_pid then
      v_val := v_incoming -> v_pid;

      if jsonb_typeof(v_val) = 'null' then
        v_line := (v_line - 'systemStockAtCount' - 'countedAt') || jsonb_build_object('counted', null);

      elsif jsonb_typeof(v_val) = 'number' then
        v_counted := (v_val #>> '{}')::numeric;
        if v_counted < 0 then
          raise exception 'COUNT_INVALID_VALUE';
        end if;

        if (v_line ->> 'counted') is not null
           and (v_line ->> 'counted')::numeric = v_counted
           and v_line ? 'systemStockAtCount'
           and not (v_pid = any (v_recounted)) then
          -- Misma cantidad y sin reescribir: conserva la foto que ya tenía.
          v_line := v_line || jsonb_build_object('counted', v_counted);
        else
          v_line := (v_line - 'systemStockAtCount' - 'countedAt') || jsonb_build_object('counted', v_counted);
          v_stock := public.inventory_count_product_stock(p_business_id, p_branch_id, v_pid);
          if v_stock is not null then
            v_line := v_line || jsonb_build_object('systemStockAtCount', v_stock, 'countedAt', v_now);
          end if;
        end if;

      else
        raise exception 'COUNT_INVALID_VALUE';
      end if;
    end if;

    v_new_lines := v_new_lines || jsonb_build_array(v_line);
  end loop;

  update public.inventory_count_sessions s
     set data = jsonb_set(v_data, '{lines}', v_new_lines),
         version = s.version + 1,
         updated_at = now()
   where s.id = v_row.id
  returning * into v_row;

  return public.inventory_count_present(v_row.id::text, v_row.version, v_row.data, v_full);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) REVISAR DIFERENCIAS (solo roles con permiso de ver diferencias)
-- -----------------------------------------------------------------------------
create or replace function public.inventory_count_review(
  p_business_id uuid,
  p_session_id text,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.inventory_count_sessions%rowtype;
  v_data jsonb;
  v_frozen boolean;
  v_result jsonb := '[]'::jsonb;
  v_line jsonb;
  v_pid text;
  v_counted numeric;
  v_stock_now numeric;
  v_system numeric;
  v_diff numeric;
  v_has_snapshot boolean;
  v_entry jsonb;
begin
  if auth.uid() is null or not public.inventory_count_can_see_differences(p_business_id) then
    raise exception 'COUNT_FORBIDDEN';
  end if;

  select * into v_row
  from public.inventory_count_sessions s
  where s.id::text = p_session_id
    and s.business_id = p_business_id
    and (p_branch_id is null or s.branch_id = p_branch_id);
  if not found then
    raise exception 'COUNT_SESSION_NOT_FOUND';
  end if;
  v_data := v_row.data;
  v_frozen := (v_data ->> 'status') = 'CLOSED' or coalesce((v_data ->> 'prepared')::boolean, false);

  for v_line in
    select l.value
    from jsonb_array_elements(coalesce(v_data -> 'lines', '[]'::jsonb)) with ordinality as l(value, ord)
    order by l.ord
  loop
    if jsonb_typeof(v_line -> 'counted') <> 'number' then
      continue;
    end if;
    v_pid := v_line ->> 'productId';
    v_counted := (v_line ->> 'counted')::numeric;
    v_has_snapshot := v_line ? 'systemStockAtCount';

    if v_frozen then
      -- Cierre ya calculado: se muestra lo guardado.
      if not (v_line ? 'difference') then
        continue;
      end if;
      v_system := coalesce(
        (v_line ->> 'systemStockAtCount')::numeric,
        (v_line ->> 'systemStockAtClose')::numeric,
        (v_line ->> 'systemStockAtStart')::numeric,
        0
      );
      v_stock_now := coalesce((v_line ->> 'systemStockAtClose')::numeric, v_system);
      v_diff := (v_line ->> 'difference')::numeric;
    else
      v_stock_now := public.inventory_count_product_stock(p_business_id, p_branch_id, v_pid);
      if v_stock_now is null then
        continue; -- el producto ya no existe
      end if;
      v_system := coalesce((v_line ->> 'systemStockAtCount')::numeric, v_stock_now);
      v_diff := round(v_counted - v_system, 4);
    end if;

    v_entry := jsonb_build_object(
      'productId', v_pid,
      'name', v_line ->> 'name',
      'counted', v_counted,
      'systemStock', v_system,
      'hasCountSnapshot', v_has_snapshot,
      'stockNow', v_stock_now,
      'movedSince', round(v_stock_now - v_system, 4),
      'difference', v_diff,
      'value', round(v_diff * coalesce((v_line ->> 'unitCost')::numeric, 0), 4)
    );
    if v_line ? 'unit' then
      v_entry := v_entry || jsonb_build_object('unit', v_line -> 'unit');
    end if;
    if v_line ? 'reason' then
      v_entry := v_entry || jsonb_build_object('reason', v_line -> 'reason');
    end if;
    v_result := v_result || jsonb_build_array(v_entry);
  end loop;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) CERRAR Y APLICAR (solo roles con permiso de ver diferencias)
--    Mismo comportamiento que el motor anterior: prepara una sola vez (diferencias
--    + id de movimiento por línea), aplica con Kardex, y solo cierra si todo se aplicó.
-- -----------------------------------------------------------------------------
create or replace function public.inventory_count_close(
  p_business_id uuid,
  p_session_id text,
  p_performed_by text,
  p_reasons jsonb default '{}'::jsonb,
  p_allow_negative boolean default false,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.inventory_count_sessions%rowtype;
  v_data jsonb;
  v_lines jsonb;
  v_new_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_pid text;
  v_counted numeric;
  v_stock_now numeric;
  v_system numeric;
  v_diff numeric;
  v_reason text;
  v_failures jsonb := '[]'::jsonb;
  v_short text;
  v_branch uuid;
  v_delta numeric;
  v_type text;
  v_text text;
  v_loss text;
  v_mid text;
  v_extra jsonb;
  v_now text;
  v_reasons jsonb := case when jsonb_typeof(p_reasons) = 'object' then p_reasons else '{}'::jsonb end;
  v_allowed_reasons constant text[] := array['MERMA', 'VENCIDO', 'CONSUMO_INTERNO', 'ROBO', 'ERROR', 'DAÑO', 'AJUSTE_ADMINISTRATIVO', 'OTRO'];
begin
  if auth.uid() is null or not public.inventory_count_can_see_differences(p_business_id) then
    raise exception 'COUNT_FORBIDDEN';
  end if;

  select * into v_row
  from public.inventory_count_sessions s
  where s.id::text = p_session_id
    and s.business_id = p_business_id
    and (p_branch_id is null or s.branch_id = p_branch_id)
  for update;
  if not found then
    raise exception 'COUNT_SESSION_NOT_FOUND';
  end if;
  v_data := v_row.data;
  if v_data ->> 'status' = 'CLOSED' then
    raise exception 'COUNT_SESSION_CLOSED';
  end if;

  v_now := public.inventory_count_now_iso();

  -- 1) Preparar (solo la primera vez): fija diferencias e ids de movimiento.
  if not coalesce((v_data ->> 'prepared')::boolean, false) then
    for v_line in
      select l.value
      from jsonb_array_elements(coalesce(v_data -> 'lines', '[]'::jsonb)) with ordinality as l(value, ord)
      order by l.ord
    loop
      v_pid := v_line ->> 'productId';
      if jsonb_typeof(v_line -> 'counted') = 'number' then
        v_counted := (v_line ->> 'counted')::numeric;
        v_stock_now := public.inventory_count_product_stock(p_business_id, p_branch_id, v_pid);
        if v_stock_now is not null then
          v_system := coalesce((v_line ->> 'systemStockAtCount')::numeric, v_stock_now);
          v_diff := round(v_counted - v_system, 4);
          v_line := v_line || jsonb_build_object('systemStockAtClose', v_stock_now, 'difference', v_diff);
          if v_diff < 0 then
            v_reason := v_reasons ->> v_pid;
            if v_reason is null or not (v_reason = any (v_allowed_reasons)) then
              v_reason := 'AJUSTE_ADMINISTRATIVO';
            end if;
            v_line := v_line || jsonb_build_object('reason', v_reason);
          end if;
          if v_diff <> 0 then
            v_line := v_line || jsonb_build_object(
              'movementId',
              coalesce(v_line ->> 'movementId', gen_random_uuid()::text)
            );
          end if;
        end if;
      end if;
      v_new_lines := v_new_lines || jsonb_build_array(v_line);
    end loop;

    v_data := jsonb_set(jsonb_set(v_data, '{lines}', v_new_lines), '{prepared}', 'true'::jsonb);
    update public.inventory_count_sessions s
       set data = v_data, version = s.version + 1, updated_at = now()
     where s.id = v_row.id
    returning * into v_row;
    v_data := v_row.data;
  end if;

  -- 2) Aplicar al inventario con Kardex (cada movimiento lleva su id: reintentar no duplica).
  v_lines := coalesce(v_data -> 'lines', '[]'::jsonb);
  v_short := left(v_row.id::text, 8);
  v_branch := coalesce(p_branch_id, v_row.branch_id);

  for v_line in
    select l.value
    from jsonb_array_elements(v_lines) with ordinality as l(value, ord)
    order by l.ord
  loop
    v_diff := coalesce((v_line ->> 'difference')::numeric, 0);
    v_mid := v_line ->> 'movementId';
    if v_diff = 0 or v_mid is null then
      continue;
    end if;
    v_pid := v_line ->> 'productId';
    v_extra := jsonb_build_object('lastUpdated', v_now);

    if v_diff > 0 then
      v_type := 'INCREASE';
      v_delta := v_diff;
      v_text := 'Conteo ' || v_short || ': sobraba';
      v_loss := null;
    else
      v_type := 'DECREASE';
      v_delta := v_diff; -- ya negativo
      v_text := 'Conteo ' || v_short || ': faltaba';
      v_loss := coalesce(v_line ->> 'reason', 'AJUSTE_ADMINISTRATIVO');
    end if;

    begin
      -- EXECUTE + %L: los literales toman el tipo exacto de cada parámetro
      -- (uuid/text/numeric) sin depender de cómo esté declarada la función.
      execute format(
        'select public.adjust_stock_with_kardex_and_fields('
        || 'p_product_id => %L, p_delta => %L, p_reason => %L, p_type => %L, '
        || 'p_performed_by => %L, p_supplier_id => null, p_supplier_name => null, '
        || 'p_loss_category => %L, p_movement_id => %L, p_branch_id => %L, '
        || 'p_allow_negative => %L, p_extra_fields => %L)',
        v_pid, v_delta, v_text, v_type,
        p_performed_by, v_loss, v_mid, v_branch,
        coalesce(p_allow_negative, false), v_extra::text
      );
    exception when others then
      v_failures := v_failures || jsonb_build_array(
        jsonb_build_object('name', v_line ->> 'name', 'error', sqlerrm)
      );
    end;
  end loop;

  -- 3) Solo se cierra si todo se aplicó; si no, queda abierta para reintentar.
  if jsonb_array_length(v_failures) = 0 then
    v_data := v_data
      || jsonb_build_object('status', 'CLOSED', 'closedAt', v_now, 'closedBy', coalesce(p_performed_by, ''));
    update public.inventory_count_sessions s
       set data = v_data, version = s.version + 1, updated_at = now()
     where s.id = v_row.id
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'session', public.inventory_count_present(v_row.id::text, v_row.version, v_row.data, true),
    'failures', v_failures
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) CERRAR LA TABLA: ningún acceso directo desde el navegador
-- -----------------------------------------------------------------------------
alter table public.inventory_count_sessions enable row level security;

do $$
declare
  r record;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'inventory_count_sessions'
  loop
    execute format('drop policy %I on public.inventory_count_sessions', r.policyname);
  end loop;
end
$$;

create policy inventory_count_sessions_no_direct_access
  on public.inventory_count_sessions
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on table public.inventory_count_sessions from anon, authenticated;

-- Si la tabla estaba en Realtime, quien escuchara recibiría filas completas.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'inventory_count_sessions'
  ) then
    execute 'alter publication supabase_realtime drop table public.inventory_count_sessions';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 8) PERMISOS DE EJECUCIÓN
--    Solo las 6 funciones públicas son invocables por usuarios autenticados.
--    Los helpers internos no se exponen por la API.
-- -----------------------------------------------------------------------------
revoke all on function public.inventory_count_now_iso() from public, anon, authenticated;
revoke all on function public.inventory_count_member_role(uuid) from public, anon, authenticated;
revoke all on function public.inventory_count_can_count(uuid) from public, anon, authenticated;
revoke all on function public.inventory_count_can_see_differences(uuid) from public, anon, authenticated;
revoke all on function public.inventory_count_present(text, integer, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.inventory_count_product_stock(uuid, uuid, text) from public, anon, authenticated;

revoke all on function public.inventory_count_list(uuid, uuid) from public, anon;
revoke all on function public.inventory_count_get(uuid, text, uuid) from public, anon;
revoke all on function public.inventory_count_start(uuid, uuid, text, jsonb, text, boolean, text) from public, anon;
revoke all on function public.inventory_count_save(uuid, text, jsonb, text[], uuid) from public, anon;
revoke all on function public.inventory_count_review(uuid, text, uuid) from public, anon;
revoke all on function public.inventory_count_close(uuid, text, text, jsonb, boolean, uuid) from public, anon;

grant execute on function public.inventory_count_list(uuid, uuid) to authenticated;
grant execute on function public.inventory_count_get(uuid, text, uuid) to authenticated;
grant execute on function public.inventory_count_start(uuid, uuid, text, jsonb, text, boolean, text) to authenticated;
grant execute on function public.inventory_count_save(uuid, text, jsonb, text[], uuid) to authenticated;
grant execute on function public.inventory_count_review(uuid, text, uuid) to authenticated;
grant execute on function public.inventory_count_close(uuid, text, text, jsonb, boolean, uuid) to authenticated;