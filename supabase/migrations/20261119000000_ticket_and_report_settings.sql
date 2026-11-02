-- ============================================================================
-- 20261119000000_ticket_and_report_settings.sql
-- ----------------------------------------------------------------------------
-- Configuración > Tickets y Reportes — Parte 1: base de datos y multi-sucursal.
--
-- QUÉ HACE
--   1) public.ticket_print_settings  — diseño/impresión del ticket de venta.
--   2) public.report_close_settings  — "Cierre inteligente por correo".
--   Ambas con branch_id OPCIONAL:
--        branch_id IS NULL      -> configuración GLOBAL del negocio (la heredan todas las sedes)
--        branch_id = <sucursal> -> OVERRIDE de esa sucursal (fila completa)
--   Herencia (fila completa, sin mezclar columnas):
--        override de la sucursal  ->  global del negocio  ->  (sin fila: defaults de la app)
--   Para volver a heredar, se borra el override de la sucursal.
--
-- SEGURIDAD
--   * RLS activo. Escribir (INSERT/UPDATE/DELETE): solo business_members.role = 'ADMIN'
--     (has_business_role, fuente de verdad del rol en el servidor) y, para
--     INSERT/UPDATE, suscripción activa (igual que el resto de tablas tenant).
--   * Leer ticket_print_settings: cualquier miembro del negocio (el cajero la
--     necesita para imprimir), con aislamiento por sucursal (auth_branch_ids()).
--   * Leer report_close_settings: solo ADMIN (contiene correos; mismo criterio
--     que daily_report_settings). El Edge Function usa service_role.
--   * FK compuesto (branch_id, business_id) -> branches(id, business_id): una
--     fila NO puede mezclar un negocio con la sucursal de otro, ni siquiera
--     escribiendo con service_role.
--   * Un trigger impide mover una fila de negocio/sucursal (id, business_id y
--     branch_id son inmutables) y mantiene updated_at / updated_by.
--
-- NO TOCA
--   * public.daily_report_settings (la usan hoy la pantalla y los Edge
--     Functions process-daily-report / whatsapp-webhook). Esta migración es
--     solo aditiva; el cambio de lectura se hace en una parte posterior.
--   * Único cambio sobre una tabla existente: un índice único (id, business_id)
--     en public.branches, necesario para el FK compuesto. id ya es PK, así que
--     el índice no puede fallar por datos existentes.
--
-- ROLLBACK (ver al final del archivo).
-- Migración NUEVA e idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Soporte del FK compuesto
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS branches_id_business_id_key
  ON public.branches (id, business_id);

-- ---------------------------------------------------------------------------
-- 1) Helper: lista de correos válida (minúsculas, sin duplicados, máx. p_max)
--    IMMUTABLE para poder usarse en un CHECK.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_valid_email_list(p_emails text[], p_max integer DEFAULT 5)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT p_emails IS NOT NULL
     AND cardinality(p_emails) <= p_max
     AND NOT EXISTS (
       SELECT 1
       FROM unnest(p_emails) AS e
       WHERE e IS NULL
          OR length(e) > 254
          OR e !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
     )
     AND cardinality(p_emails) = (SELECT count(DISTINCT e) FROM unnest(p_emails) AS e);
$function$;

COMMENT ON FUNCTION public.is_valid_email_list(text[], integer) IS
  'true si todos los correos están en minúsculas, tienen formato válido, no se repiten y no superan p_max.';

-- ---------------------------------------------------------------------------
-- 2) Trigger común: updated_at / updated_by y columnas de alcance inmutables
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settings_row_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      RAISE EXCEPTION 'SETTINGS_SCOPE_IMMUTABLE: no se puede mover una configuración a otro negocio o sucursal. Crea una nueva y borra la anterior.'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.created_at := OLD.created_at;
  END IF;

  NEW.updated_at := clock_timestamp();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) ticket_print_settings
--    Espejo de PrintSettings (src/core/store/printSettingsStore.ts).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_print_settings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id      uuid,
  template       text NOT NULL DEFAULT 'moderno',
  paper_width    text NOT NULL DEFAULT '80mm',
  accent_color   text NOT NULL DEFAULT 'cyan',
  show_logo      boolean NOT NULL DEFAULT true,
  show_qr        boolean NOT NULL DEFAULT true,
  show_address   boolean NOT NULL DEFAULT true,
  show_phone     boolean NOT NULL DEFAULT true,
  show_email     boolean NOT NULL DEFAULT false,
  show_cashier   boolean NOT NULL DEFAULT true,
  show_customer  boolean NOT NULL DEFAULT true,
  show_tax       boolean NOT NULL DEFAULT true,
  show_discount  boolean NOT NULL DEFAULT true,
  footer_message text NOT NULL DEFAULT E'Gracias por su compra\n¡Los esperamos nuevamente!',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT ticket_print_settings_branch_fk
    FOREIGN KEY (branch_id, business_id)
    REFERENCES public.branches (id, business_id) ON DELETE CASCADE,
  CONSTRAINT ticket_print_settings_template_valid
    CHECK (template IN ('clasico', 'moderno', 'restaurante', 'supermercado', 'cafeteria')),
  CONSTRAINT ticket_print_settings_paper_width_valid
    CHECK (paper_width IN ('58mm', '80mm', 'a4')),
  CONSTRAINT ticket_print_settings_accent_color_valid
    CHECK (accent_color IN ('cyan', 'green', 'red', 'slate')),
  CONSTRAINT ticket_print_settings_footer_len
    CHECK (char_length(footer_message) <= 240)
);

-- Una fila global por negocio y una por sucursal.
CREATE UNIQUE INDEX IF NOT EXISTS ticket_print_settings_business_global_uidx
  ON public.ticket_print_settings (business_id) WHERE branch_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ticket_print_settings_branch_uidx
  ON public.ticket_print_settings (branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ticket_print_settings_business_idx
  ON public.ticket_print_settings (business_id);

DROP TRIGGER IF EXISTS ticket_print_settings_guard ON public.ticket_print_settings;
CREATE TRIGGER ticket_print_settings_guard
  BEFORE INSERT OR UPDATE ON public.ticket_print_settings
  FOR EACH ROW EXECUTE FUNCTION public.settings_row_guard();

COMMENT ON TABLE public.ticket_print_settings IS
  'Diseño del ticket de venta. branch_id NULL = global del negocio; con valor = override de esa sucursal (fila completa). Escribe solo ADMIN.';

-- ---------------------------------------------------------------------------
-- 4) report_close_settings  ("Cierre inteligente por correo")
--    Mismo contrato que daily_report_settings, sin el canal WhatsApp (la
--    pantalla actual no lo expone).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_close_settings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id              uuid,
  enabled                boolean NOT NULL DEFAULT true,
  send_on_shift_close    boolean NOT NULL DEFAULT true,
  email_enabled          boolean NOT NULL DEFAULT true,
  email_recipients       text[] NOT NULL DEFAULT '{}'::text[],
  email_fallback_enabled boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT report_close_settings_branch_fk
    FOREIGN KEY (branch_id, business_id)
    REFERENCES public.branches (id, business_id) ON DELETE CASCADE,
  CONSTRAINT report_close_settings_emails_valid
    CHECK (public.is_valid_email_list(email_recipients, 5))
);

CREATE UNIQUE INDEX IF NOT EXISTS report_close_settings_business_global_uidx
  ON public.report_close_settings (business_id) WHERE branch_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS report_close_settings_branch_uidx
  ON public.report_close_settings (branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS report_close_settings_business_idx
  ON public.report_close_settings (business_id);

DROP TRIGGER IF EXISTS report_close_settings_guard ON public.report_close_settings;
CREATE TRIGGER report_close_settings_guard
  BEFORE INSERT OR UPDATE ON public.report_close_settings
  FOR EACH ROW EXECUTE FUNCTION public.settings_row_guard();

COMMENT ON TABLE public.report_close_settings IS
  'Cierre inteligente por correo. branch_id NULL = global del negocio; con valor = override de esa sucursal (fila completa). Lee y escribe solo ADMIN (service_role para el Edge Function).';

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.ticket_print_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_close_settings ENABLE ROW LEVEL SECURITY;

-- 5a) ticket_print_settings -------------------------------------------------
DROP POLICY IF EXISTS ticket_print_settings_member_select ON public.ticket_print_settings;
CREATE POLICY ticket_print_settings_member_select ON public.ticket_print_settings
  FOR SELECT TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
  );

DROP POLICY IF EXISTS ticket_print_settings_admin_insert ON public.ticket_print_settings;
CREATE POLICY ticket_print_settings_admin_insert ON public.ticket_print_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.has_business_role(business_id, ARRAY['ADMIN']::text[]))
    AND (SELECT public.is_business_subscription_active(business_id))
  );

DROP POLICY IF EXISTS ticket_print_settings_admin_update ON public.ticket_print_settings;
CREATE POLICY ticket_print_settings_admin_update ON public.ticket_print_settings
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_business_role(business_id, ARRAY['ADMIN']::text[])))
  WITH CHECK (
    (SELECT public.has_business_role(business_id, ARRAY['ADMIN']::text[]))
    AND (SELECT public.is_business_subscription_active(business_id))
  );

DROP POLICY IF EXISTS ticket_print_settings_admin_delete ON public.ticket_print_settings;
CREATE POLICY ticket_print_settings_admin_delete ON public.ticket_print_settings
  FOR DELETE TO authenticated
  USING ((SELECT public.has_business_role(business_id, ARRAY['ADMIN']::text[])));

-- 5b) report_close_settings -------------------------------------------------
DROP POLICY IF EXISTS report_close_settings_admin_select ON public.report_close_settings;
CREATE POLICY report_close_settings_admin_select ON public.report_close_settings
  FOR SELECT TO authenticated
  USING ((SELECT public.has_business_role(business_id, ARRAY['ADMIN']::text[])));

DROP POLICY IF EXISTS report_close_settings_admin_insert ON public.report_close_settings;
CREATE POLICY report_close_settings_admin_insert ON public.report_close_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.has_business_role(business_id, ARRAY['ADMIN']::text[]))
    AND (SELECT public.is_business_subscription_active(business_id))
  );

DROP POLICY IF EXISTS report_close_settings_admin_update ON public.report_close_settings;
CREATE POLICY report_close_settings_admin_update ON public.report_close_settings
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_business_role(business_id, ARRAY['ADMIN']::text[])))
  WITH CHECK (
    (SELECT public.has_business_role(business_id, ARRAY['ADMIN']::text[]))
    AND (SELECT public.is_business_subscription_active(business_id))
  );

DROP POLICY IF EXISTS report_close_settings_admin_delete ON public.report_close_settings;
CREATE POLICY report_close_settings_admin_delete ON public.report_close_settings
  FOR DELETE TO authenticated
  USING ((SELECT public.has_business_role(business_id, ARRAY['ADMIN']::text[])));

-- 5c) GRANTs. En este proyecto las tablas nuevas NO reciben permisos
--     automáticos; sin esto la app falla con "permission denied" y
--     get_grant_gaps() / ops-monitor avisan. Las policies deciden QUÉ filas.
REVOKE ALL ON public.ticket_print_settings FROM PUBLIC, anon;
REVOKE ALL ON public.report_close_settings FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_print_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_close_settings TO authenticated;
GRANT ALL ON public.ticket_print_settings TO service_role;
GRANT ALL ON public.report_close_settings TO service_role;

-- ---------------------------------------------------------------------------
-- 6) Escritura atómica (upsert por alcance) y resolución con herencia.
--    SECURITY INVOKER: la RLS de las tablas decide quién puede escribir/leer.
--    Se usa RPC porque el upsert de PostgREST no puede apuntar a un índice
--    único PARCIAL (global vs. sucursal).
-- ---------------------------------------------------------------------------

-- 6a) ticket_print_settings -------------------------------------------------
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
  v_new public.ticket_print_settings;
  v_row public.ticket_print_settings;
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

  IF p_branch_id IS NULL THEN
    INSERT INTO public.ticket_print_settings AS t (
      business_id, branch_id, template, paper_width, accent_color, show_logo, show_qr,
      show_address, show_phone, show_email, show_cashier, show_customer, show_tax,
      show_discount, footer_message
    ) VALUES (
      p_business_id, NULL, v_new.template, v_new.paper_width, v_new.accent_color, v_new.show_logo,
      v_new.show_qr, v_new.show_address, v_new.show_phone, v_new.show_email, v_new.show_cashier,
      v_new.show_customer, v_new.show_tax, v_new.show_discount, v_new.footer_message
    )
    ON CONFLICT (business_id) WHERE branch_id IS NULL DO UPDATE SET
      template = EXCLUDED.template, paper_width = EXCLUDED.paper_width,
      accent_color = EXCLUDED.accent_color, show_logo = EXCLUDED.show_logo,
      show_qr = EXCLUDED.show_qr, show_address = EXCLUDED.show_address,
      show_phone = EXCLUDED.show_phone, show_email = EXCLUDED.show_email,
      show_cashier = EXCLUDED.show_cashier, show_customer = EXCLUDED.show_customer,
      show_tax = EXCLUDED.show_tax, show_discount = EXCLUDED.show_discount,
      footer_message = EXCLUDED.footer_message
    RETURNING t.* INTO v_row;
  ELSE
    INSERT INTO public.ticket_print_settings AS t (
      business_id, branch_id, template, paper_width, accent_color, show_logo, show_qr,
      show_address, show_phone, show_email, show_cashier, show_customer, show_tax,
      show_discount, footer_message
    ) VALUES (
      p_business_id, p_branch_id, v_new.template, v_new.paper_width, v_new.accent_color, v_new.show_logo,
      v_new.show_qr, v_new.show_address, v_new.show_phone, v_new.show_email, v_new.show_cashier,
      v_new.show_customer, v_new.show_tax, v_new.show_discount, v_new.footer_message
    )
    ON CONFLICT (branch_id) WHERE branch_id IS NOT NULL DO UPDATE SET
      template = EXCLUDED.template, paper_width = EXCLUDED.paper_width,
      accent_color = EXCLUDED.accent_color, show_logo = EXCLUDED.show_logo,
      show_qr = EXCLUDED.show_qr, show_address = EXCLUDED.show_address,
      show_phone = EXCLUDED.show_phone, show_email = EXCLUDED.show_email,
      show_cashier = EXCLUDED.show_cashier, show_customer = EXCLUDED.show_customer,
      show_tax = EXCLUDED.show_tax, show_discount = EXCLUDED.show_discount,
      footer_message = EXCLUDED.footer_message
    RETURNING t.* INTO v_row;
  END IF;

  RETURN v_row;
END;
$function$;

-- Efectiva para una sucursal: override -> global -> (0 filas = defaults de la app).
-- Devuelve lo que la RLS deja ver al llamador.
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

-- 6b) report_close_settings -------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_report_close_settings(
  p_business_id uuid,
  p_branch_id   uuid,
  p_settings    jsonb
)
RETURNS public.report_close_settings
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_new public.report_close_settings;
  v_row public.report_close_settings;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'SETTINGS_BUSINESS_REQUIRED: falta el negocio.' USING ERRCODE = '22023';
  END IF;
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object'
     OR NOT (p_settings ?& ARRAY[
       'enabled', 'send_on_shift_close', 'email_enabled', 'email_recipients',
       'email_fallback_enabled'
     ]) THEN
    RAISE EXCEPTION 'SETTINGS_INCOMPLETE: envía la configuración completa del cierre.' USING ERRCODE = '22023';
  END IF;

  v_new := jsonb_populate_record(NULL::public.report_close_settings, p_settings);

  IF p_branch_id IS NULL THEN
    INSERT INTO public.report_close_settings AS t (
      business_id, branch_id, enabled, send_on_shift_close, email_enabled,
      email_recipients, email_fallback_enabled
    ) VALUES (
      p_business_id, NULL, v_new.enabled, v_new.send_on_shift_close, v_new.email_enabled,
      v_new.email_recipients, v_new.email_fallback_enabled
    )
    ON CONFLICT (business_id) WHERE branch_id IS NULL DO UPDATE SET
      enabled = EXCLUDED.enabled, send_on_shift_close = EXCLUDED.send_on_shift_close,
      email_enabled = EXCLUDED.email_enabled, email_recipients = EXCLUDED.email_recipients,
      email_fallback_enabled = EXCLUDED.email_fallback_enabled
    RETURNING t.* INTO v_row;
  ELSE
    INSERT INTO public.report_close_settings AS t (
      business_id, branch_id, enabled, send_on_shift_close, email_enabled,
      email_recipients, email_fallback_enabled
    ) VALUES (
      p_business_id, p_branch_id, v_new.enabled, v_new.send_on_shift_close, v_new.email_enabled,
      v_new.email_recipients, v_new.email_fallback_enabled
    )
    ON CONFLICT (branch_id) WHERE branch_id IS NOT NULL DO UPDATE SET
      enabled = EXCLUDED.enabled, send_on_shift_close = EXCLUDED.send_on_shift_close,
      email_enabled = EXCLUDED.email_enabled, email_recipients = EXCLUDED.email_recipients,
      email_fallback_enabled = EXCLUDED.email_fallback_enabled
    RETURNING t.* INTO v_row;
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_report_close_settings(
  p_business_id uuid,
  p_branch_id   uuid DEFAULT NULL
)
RETURNS SETOF public.report_close_settings
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT t.*
  FROM public.report_close_settings AS t
  WHERE t.business_id = p_business_id
    AND (t.branch_id IS NULL OR t.branch_id = p_branch_id)
  ORDER BY (t.branch_id IS NULL)
  LIMIT 1;
$function$;

-- 6c) Permisos de ejecución
REVOKE ALL ON FUNCTION public.upsert_ticket_print_settings(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_ticket_print_settings(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_report_close_settings(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_report_close_settings(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_ticket_print_settings(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_ticket_print_settings(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_report_close_settings(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_report_close_settings(uuid, uuid) TO authenticated, service_role;

-- is_valid_email_list y settings_row_guard son internas: no se exponen por RPC.
REVOKE ALL ON FUNCTION public.is_valid_email_list(text[], integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settings_row_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_email_list(text[], integer) TO authenticated, service_role;

COMMIT;

-- ============================================================================
-- ROLLBACK (solo si hiciera falta; borra las configuraciones guardadas):
--   DROP FUNCTION IF EXISTS public.resolve_report_close_settings(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.upsert_report_close_settings(uuid, uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.resolve_ticket_print_settings(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.upsert_ticket_print_settings(uuid, uuid, jsonb);
--   DROP TABLE IF EXISTS public.report_close_settings;
--   DROP TABLE IF EXISTS public.ticket_print_settings;
--   DROP FUNCTION IF EXISTS public.settings_row_guard();
--   DROP FUNCTION IF EXISTS public.is_valid_email_list(text[], integer);
--   DROP INDEX IF EXISTS public.branches_id_business_id_key;
-- ============================================================================