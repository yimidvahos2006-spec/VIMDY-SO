-- ============================================================================
-- 20261119000100_ticket_print_table_footer_toggles.sql
-- ----------------------------------------------------------------------------
-- Configuración > Tickets y Reportes — Parte 3: toggles "Mesa" y "Pie de página".
--
-- QUÉ HACE (solo aditivo; NO edita la migración 20261119000000)
--   1) Agrega show_table y show_footer a public.ticket_print_settings
--      (NOT NULL DEFAULT true: las filas existentes quedan con el mismo
--      comportamiento visible de hoy).
--   2) Reemplaza upsert_ticket_print_settings para guardar las dos columnas.
--      Las claves nuevas son OPCIONALES en el JSON (si faltan se asume true),
--      así una versión anterior de la app que aún no las envía sigue guardando.
--   3) Reemplaza resolve_ticket_print_settings (misma lógica; se re-declara por
--      seguridad ante el cambio del tipo de fila).
--
-- Mantiene SECURITY INVOKER + RLS vigente + GRANTs idénticos a la migración base.
-- ROLLBACK al final.
-- ============================================================================

BEGIN;

ALTER TABLE public.ticket_print_settings
  ADD COLUMN IF NOT EXISTS show_table  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_footer boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.upsert_ticket_print_settings(
  p_business_id uuid,
  p_branch_id   uuid,
  p_settings    jsonb
)
RETURNS public.ticket_print_settings
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_new        public.ticket_print_settings;
  v_row        public.ticket_print_settings;
  v_show_table  boolean;
  v_show_footer boolean;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'SETTINGS_BUSINESS_REQUIRED: falta el negocio.' USING ERRCODE = '22023';
  END IF;
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object'
     OR NOT (p_settings ?& ARRAY[
       'template', 'paper_width', 'accent_color', 'show_logo', 'show_qr', 'show_address',
       'show_phone', 'show_email', 'show_cashier', 'show_customer', 'show_tax',
       'show_discount', 'footer_message'
     ]) THEN
    RAISE EXCEPTION 'SETTINGS_INCOMPLETE: envía la configuración completa del ticket.' USING ERRCODE = '22023';
  END IF;

  v_new := jsonb_populate_record(NULL::public.ticket_print_settings, p_settings);
  -- Claves nuevas opcionales: si no vienen, true (comportamiento histórico).
  v_show_table  := COALESCE(v_new.show_table, true);
  v_show_footer := COALESCE(v_new.show_footer, true);

  IF p_branch_id IS NULL THEN
    INSERT INTO public.ticket_print_settings AS t (
      business_id, branch_id, template, paper_width, accent_color, show_logo, show_qr,
      show_address, show_phone, show_email, show_cashier, show_customer, show_tax,
      show_discount, show_table, show_footer, footer_message
    ) VALUES (
      p_business_id, NULL, v_new.template, v_new.paper_width, v_new.accent_color, v_new.show_logo,
      v_new.show_qr, v_new.show_address, v_new.show_phone, v_new.show_email, v_new.show_cashier,
      v_new.show_customer, v_new.show_tax, v_new.show_discount, v_show_table, v_show_footer,
      v_new.footer_message
    )
    ON CONFLICT (business_id) WHERE branch_id IS NULL DO UPDATE SET
      template = EXCLUDED.template, paper_width = EXCLUDED.paper_width,
      accent_color = EXCLUDED.accent_color, show_logo = EXCLUDED.show_logo,
      show_qr = EXCLUDED.show_qr, show_address = EXCLUDED.show_address,
      show_phone = EXCLUDED.show_phone, show_email = EXCLUDED.show_email,
      show_cashier = EXCLUDED.show_cashier, show_customer = EXCLUDED.show_customer,
      show_tax = EXCLUDED.show_tax, show_discount = EXCLUDED.show_discount,
      show_table = EXCLUDED.show_table, show_footer = EXCLUDED.show_footer,
      footer_message = EXCLUDED.footer_message
    RETURNING t.* INTO v_row;
  ELSE
    INSERT INTO public.ticket_print_settings AS t (
      business_id, branch_id, template, paper_width, accent_color, show_logo, show_qr,
      show_address, show_phone, show_email, show_cashier, show_customer, show_tax,
      show_discount, show_table, show_footer, footer_message
    ) VALUES (
      p_business_id, p_branch_id, v_new.template, v_new.paper_width, v_new.accent_color, v_new.show_logo,
      v_new.show_qr, v_new.show_address, v_new.show_phone, v_new.show_email, v_new.show_cashier,
      v_new.show_customer, v_new.show_tax, v_new.show_discount, v_show_table, v_show_footer,
      v_new.footer_message
    )
    ON CONFLICT (branch_id) WHERE branch_id IS NOT NULL DO UPDATE SET
      template = EXCLUDED.template, paper_width = EXCLUDED.paper_width,
      accent_color = EXCLUDED.accent_color, show_logo = EXCLUDED.show_logo,
      show_qr = EXCLUDED.show_qr, show_address = EXCLUDED.show_address,
      show_phone = EXCLUDED.show_phone, show_email = EXCLUDED.show_email,
      show_cashier = EXCLUDED.show_cashier, show_customer = EXCLUDED.show_customer,
      show_tax = EXCLUDED.show_tax, show_discount = EXCLUDED.show_discount,
      show_table = EXCLUDED.show_table, show_footer = EXCLUDED.show_footer,
      footer_message = EXCLUDED.footer_message
    RETURNING t.* INTO v_row;
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_ticket_print_settings(
  p_business_id uuid,
  p_branch_id   uuid DEFAULT NULL
)
RETURNS SETOF public.ticket_print_settings
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT t.*
  FROM public.ticket_print_settings AS t
  WHERE t.business_id = p_business_id
    AND (t.branch_id IS NULL OR t.branch_id = p_branch_id)
  ORDER BY (t.branch_id IS NULL)   -- false (override) primero
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.upsert_ticket_print_settings(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_ticket_print_settings(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_ticket_print_settings(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_ticket_print_settings(uuid, uuid) TO authenticated, service_role;

COMMIT;

-- ============================================================================
-- ROLLBACK (pierde solo los dos toggles; restaurar las funciones desde
-- 20261119000000 si se revierte):
--   ALTER TABLE public.ticket_print_settings
--     DROP COLUMN IF EXISTS show_table, DROP COLUMN IF EXISTS show_footer;
-- ============================================================================