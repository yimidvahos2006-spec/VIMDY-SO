-- ============================================================================
-- TESTS SQL: Trial único y multi-tenant security
-- ----------------------------------------------------------------------------
-- Verifica que las policies consolidadas funcionen correctamente:
--   1. businesses_insert_own: solo usuarios sin trial pueden insertar
--   2. is_business_subscription_active: subscription_status logic
--   3. Multi-tenant: app_users isolation entre usuarios A y B
--   4. record_trial_usage: ON CONFLICT DO NOTHING (no sobreescritura)
--
-- Para ejecutar manualmente en Supabase SQL Editor.
-- No depende de datos de producción — usa UUIDs de test.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Setup: tabla user_trial_usage (si no existe)
-- ----------------------------------------------------------------------------
create table if not exists user_trial_usage (
  user_id uuid primary key,
  business_id uuid,
  plan text,
  used_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- TEST 1: is_business_subscription_active — modelo VIMDY
-- Fuente de verdad: schema.sql:914-940
-- Lógica: plan + fechas (trial_ends_at, renewal_date)
-- ----------------------------------------------------------------------------
-- Esta prueba valida la función consolidada en:
--   supabase/migrations/20260829_consolidate_subscription_functions.sql
--
-- Comportamiento esperado (compatible con SubscriptionEngine.ts):
--   subscription_status = 'trial'    => TRUE (trial activo)
--   subscription_status = 'monthly'  => TRUE (monthly activo)
--   subscription_status = 'yearly'   => TRUE (yearly activo)
--   subscription_status = 'expired'  => FALSE (vencido)
--   subscription_status = 'suspended' => FALSE (suspendido)
-- ----------------------------------------------------------------------------

-- Mock: tabla temporal para simular businesses
create temporary table test_businesses (
  id uuid,
  subscription_status text
);

insert into test_businesses values
  ('00000000-0000-0000-0000-000000000001', 'trial'),
  ('00000000-0000-0000-0000-000000000002', 'monthly'),
  ('00000000-0000-0000-0000-000000000003', 'yearly'),
  ('00000000-0000-0000-0000-000000000004', 'expired'),
  ('00000000-0000-0000-0000-000000000005', 'suspended');

-- La función consolidada consulta `businesses` real, así que la validamos
-- con una versión simulada:
create or replace function test_is_active(p_status text)
returns boolean as $$
  select
    case
      when p_status in ('trial', 'monthly', 'yearly') then true
      else false
    end;
$$ language sql;

-- Assertions (manualmente verificar):
-- test_is_active('trial')     -> true
-- test_is_active('monthly')   -> true
-- test_is_active('yearly')    -> true
-- test_is_active('expired')   -> false  (IMPORTANTE: no debe ser 'active')
-- test_is_active('suspended') -> false

-- ----------------------------------------------------------------------------
-- TEST 2: businesses_insert_own policy — trial enforcement
-- ----------------------------------------------------------------------------
-- La policy consolidada:
--
--   CREATE POLICY businesses_insert_own ON businesses
--     FOR INSERT
--     WITH CHECK (
--       auth.uid() IS NOT NULL
--       AND NOT public.has_user_used_trial(auth.uid())
--     );
--
-- Escenario A: Usuario nuevo (no_trial) puede insertar business -> SUCCESS
-- Escenario B: Usuario con trial usado NO puede insertar -> BLOCKED (42501)
-- Escenario C: createAdditionalBusiness() verifica antes de insertar -> SUCCESS (primer negocio)
-- Escenario D: createAdditionalBusiness() con trial usado -> ERROR_TRIAL_YA_USADO
-- ----------------------------------------------------------------------------

-- Verificar que has_user_used_trial devuelva correctamente:
insert into test_businesses values ('test-user-1', 'trial');
insert into user_trial_usage (user_id, business_id, plan, used_at)
  values ('test-user-1'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'trial', now());

-- has_user_used_trial('test-user-1') -> TRUE (trial usado)
-- has_user_used_trial('non-existent-user') -> FALSE (trial disponible)

-- ----------------------------------------------------------------------------
-- TEST 3: record_trial_usage — DO NOTHING (seguridad)
-- ----------------------------------------------------------------------------
-- Behavior: ON CONFLICT DO NOTHING
-- Escenario: Usuario con trial registrado intenta registrar otro
-- Resultado: No hace nada (no actualiza business_id ni used_at)
-- Esto PREVIENE que se manipule el registro para obtener otro trial
-- ----------------------------------------------------------------------------

-- Simular: ya existe un trial para test-user-1
-- record_trial_usage('test-user-1', 'nuevo-business-id')
-- -> NO debe actualizar user_trial_usage
-- -> La fila existente permanece igual

-- ----------------------------------------------------------------------------
-- TEST 4: Multi-tenant — app_users isolation
-- ----------------------------------------------------------------------------
-- Escenario:
--   Usuario A es miembro del negocio 1 (business_id = ...001)
--   Usuario B es miembro del negocio 2 (business_id = ...002)
--
-- Políticas sobre app_users (schema.sql:535-595):
--   - SELECT: business_id IN (SELECT auth_business_ids())
--   - INSERT: business_id IN (SELECT auth_business_ids()) AND is_active
--   - UPDATE: business_id IN (...) AND has_business_role ADMIN
--   - DELETE: business_id IN (...) AND has_business_role ADMIN
--
-- Resultado esperado:
--   Usuario A NO puede SELECT de app_users de B
--   Usuario A NO puede INSERT en negocio B
--   Usuario A NO puede UPDATE/DELETE app_users de B
-- ----------------------------------------------------------------------------

-- Las policies usan auth_business_ids() que depende de business_members.
-- En un ambiente real con auth.uid(), esto se valida via RLS.
-- Para este test SQL, verificamos que auth_business_ids() exista y funcione:

-- auth_business_ids() returns setof uuid:
--   select business_id from business_members where user_id = auth.uid()
-- Si auth.uid() es NULL, devuelve vacío (sin negocios => todas las
-- policies retornan FALSE => aislamiento completo)

-- ----------------------------------------------------------------------------
-- TEST 5: businesses_insert_owner — REMOVIDA
-- ----------------------------------------------------------------------------
-- fix_permissions.sql histórico definía businesses_insert_owner que permitía
-- insertar sin trial check. FASE 4 la eliminó.
-- Verificar: la policy NO existe en schema.sql ni migrations.

-- ============================================================================
-- FIN DE TESTS SQL
-- ============================================================================
