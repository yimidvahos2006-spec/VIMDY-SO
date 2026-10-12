-- =============================================================================
-- 20261025000003_restrict_subscription_rpcs_to_service_role.sql
-- Las funciones que cambian el estado de una suscripción (activar, renovar,
-- expirar, cancelar) eran ejecutables por cualquier ADMIN con sesión, directo
-- desde el navegador (/rest/v1/rpc/...) o vía la Edge Function legacy
-- "subscription-management". Con un pago en 'pending' (creado al abrir el
-- checkout) un administrador podía activar su propio plan SIN pagar.
--
-- Los únicos llamadores legítimos son los webhooks de proveedor y la
-- conciliación (payments-reconcile), que usan service_role. El frontend no las
-- invoca (src/infrastructure/supabase/subscriptionService.ts no se importa en
-- ningún lugar). Se retira EXECUTE a PUBLIC, anon y authenticated.
-- =============================================================================
REVOKE ALL ON FUNCTION public.activate_subscription_server_side(uuid, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_subscription_server_side(uuid, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_subscription_server_side(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_subscription_server_side(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.activate_subscription_server_side(uuid, text, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_subscription_server_side(uuid, text, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_subscription_server_side(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_subscription_server_side(uuid, timestamptz) TO service_role;