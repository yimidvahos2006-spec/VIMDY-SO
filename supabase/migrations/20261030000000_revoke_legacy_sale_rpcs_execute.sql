BEGIN;

-- Funciones heredadas sin llamadores en src/. Se conservan para permitir
-- reversión administrativa, pero ningún rol cliente puede ejecutarlas.
REVOKE EXECUTE ON FUNCTION public.complete_payment_atomic(
  uuid, uuid, text, integer, text, numeric, numeric, numeric
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_sale_atomic(
  uuid, uuid, text, integer, numeric, text, text
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_sale_full_atomic(
  uuid, uuid, text, integer, numeric, text, text, jsonb, text, boolean
) FROM PUBLIC, anon, authenticated;

COMMIT;
