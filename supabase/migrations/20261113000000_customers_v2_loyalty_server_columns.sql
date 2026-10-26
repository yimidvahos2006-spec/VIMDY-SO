-- ============================================================================
-- 20261113000000_customers_v2_loyalty_server_columns.sql
-- ----------------------------------------------------------------------------
-- Fase 1 (base de datos) de la fidelización de clientes.
--
-- QUÉ HACE
-- --------
-- Crea public.customers_v2: tabla con columnas REALES (no jsonb) para los
-- datos de contacto/identidad y, aparte, columnas de SERVIDOR con las métricas
-- de por vida del cliente. Las métricas y el nivel los calcula Postgres a
-- partir de public.sales; el navegador no puede escribirlos.
--
--   lifetime_spent           gasto neto de por vida (total - reembolsos)
--   lifetime_purchase_count  compras que cuentan (PAID/CLOSED con neto > 0)
--   first_purchase_at / last_purchase_at
--   lifetime_points          floor(lifetime_spent / 1000)   (1 punto por $1.000)
--   loyalty_tier             COLUMNA GENERADA desde lifetime_points:
--                            oro >= 500, plata >= 150, bronce en otro caso
--
-- Los umbrales y la fórmula son los MISMOS que ya usa la app hoy
-- (getLoyaltyInfo / loyaltyPointsPerCurrencyUnit = 0.001) y están espejados en
-- src/core/domain/customers/loyalty.ts; un test compara ambos.
--
-- QUÉ NO HACE (a propósito, queda para fases siguientes)
-- ------------------------------------------------------
--   * No toca public.customers ni ninguna migración histórica.
--   * No cambia la app: nada lee customers_v2 todavía.
--   * No normaliza teléfono/documento aquí: eso lo hace UNA sola vez el
--     dominio TypeScript (phone.ts / document.ts) y Postgres solo valida la
--     forma (CHECK) y hace cumplir la unicidad. El backfill deja
--     phone_e164 / document_key en NULL hasta que esa normalización corra.
--
-- DECISIONES QUE DEBES CONFIRMAR
-- ------------------------------
--   1. El nivel se deriva del gasto NETO de por vida: un reembolso grande
--      puede bajar a un cliente de nivel. (Si prefieres que el nivel nunca
--      baje, cambia a "máximo histórico" en una fase posterior.)
--   2. "total" incluye impuestos y propina (igual que hoy). 
--   3. Borrar un cliente queda limitado a ADMIN/GERENTE (hoy cualquier
--      miembro puede).
--   4. El trigger sobre sales NUNCA bloquea una venta: si el recálculo
--      falla, emite WARNING y la venta sigue. public.refresh_customers_v2_metrics
--      repara cualquier desvío.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Fórmula de puntos (única, inmutable, reutilizada por el recálculo)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customers_v2_points_for_spent(p_spent numeric)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_spent IS NULL OR p_spent <= 0 THEN 0::bigint
    ELSE floor(p_spent / 1000)::bigint
  END;
$function$;

COMMENT ON FUNCTION public.customers_v2_points_for_spent(numeric) IS
  'Puntos de fidelización de por vida: 1 punto por cada 1000 unidades de moneda de gasto neto (floor). Espejo de calculateLifetimePoints() en src/core/domain/customers/loyalty.ts.';

-- ---------------------------------------------------------------------------
-- 2) Tabla customers_v2
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,

  -- Datos que escribe la app -------------------------------------------------
  name text NOT NULL,
  email text,
  phone_raw text,
  phone_e164 text,
  document_type text,
  document_number text,
  document_key text,

  -- Columnas de SERVIDOR (solo las escribe Postgres) --------------------------
  lifetime_spent numeric(14,2) NOT NULL DEFAULT 0,
  lifetime_purchase_count integer NOT NULL DEFAULT 0,
  lifetime_points bigint NOT NULL DEFAULT 0,
  first_purchase_at timestamptz,
  last_purchase_at timestamptz,
  metrics_updated_at timestamptz,
  -- Puntos que traía el cliente en public.customers al migrar (solo auditoría
  -- del cutover; no se usa en ningún cálculo).
  legacy_points bigint,
  loyalty_tier text GENERATED ALWAYS AS (
    CASE
      WHEN lifetime_points >= 500 THEN 'oro'
      WHEN lifetime_points >= 150 THEN 'plata'
      ELSE 'bronce'
    END
  ) STORED,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customers_v2_name_valid
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT customers_v2_phone_e164_valid
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT customers_v2_document_type_valid
    CHECK (document_type IS NULL OR document_type IN ('CC', 'CE', 'NIT', 'PASSPORT', 'OTHER')),
  CONSTRAINT customers_v2_document_key_requires_identity
    CHECK (document_key IS NULL OR (document_type IS NOT NULL AND document_number IS NOT NULL)),
  CONSTRAINT customers_v2_metrics_non_negative
    CHECK (lifetime_spent >= 0 AND lifetime_purchase_count >= 0 AND lifetime_points >= 0),
  CONSTRAINT customers_v2_version_positive
    CHECK (version >= 1)
);

COMMENT ON TABLE public.customers_v2 IS
  'Clientes con columnas reales. Las columnas lifetime_*, *_purchase_at, metrics_updated_at, legacy_points y loyalty_tier son de SERVIDOR: el navegador no tiene privilegio para escribirlas. Sucesora de public.customers (documental jsonb).';

-- Unicidad por negocio. Parcial: teléfono y documento son opcionales.
CREATE UNIQUE INDEX IF NOT EXISTS customers_v2_business_phone_uniq
  ON public.customers_v2 (business_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_v2_business_document_uniq
  ON public.customers_v2 (business_id, document_type, document_key)
  WHERE document_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS customers_v2_business_id_idx
  ON public.customers_v2 (business_id);

CREATE INDEX IF NOT EXISTS customers_v2_business_tier_idx
  ON public.customers_v2 (business_id, loyalty_tier);

-- El recálculo busca las ventas de UN cliente: sin este índice recorrería
-- todas las ventas del negocio en cada venta nueva.
CREATE INDEX IF NOT EXISTS sales_business_customer_idx
  ON public.sales (business_id, (data->>'customerId'))
  WHERE data->>'customerId' IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Privilegios: el navegador solo escribe las columnas "de la app"
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers_v2 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.customers_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.customers_v2 TO authenticated;
GRANT INSERT (id, business_id, branch_id, version, name, email, phone_raw, phone_e164,
              document_type, document_number, document_key)
  ON public.customers_v2 TO authenticated;
GRANT UPDATE (branch_id, version, name, email, phone_raw, phone_e164,
              document_type, document_number, document_key)
  ON public.customers_v2 TO authenticated;
GRANT ALL ON public.customers_v2 TO service_role;

DROP POLICY IF EXISTS customers_v2_tenant_read ON public.customers_v2;
CREATE POLICY customers_v2_tenant_read ON public.customers_v2
  FOR SELECT TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
  );

DROP POLICY IF EXISTS customers_v2_tenant_insert ON public.customers_v2;
CREATE POLICY customers_v2_tenant_insert ON public.customers_v2
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND public.is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS customers_v2_tenant_update ON public.customers_v2;
CREATE POLICY customers_v2_tenant_update ON public.customers_v2
  FOR UPDATE TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
  )
  WITH CHECK (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND public.is_business_subscription_active(business_id)
  );

DROP POLICY IF EXISTS customers_v2_tenant_delete ON public.customers_v2;
CREATE POLICY customers_v2_tenant_delete ON public.customers_v2
  FOR DELETE TO authenticated
  USING (
    business_id IN (SELECT public.auth_business_ids())
    AND (branch_id IS NULL OR branch_id = ANY (public.auth_branch_ids()))
    AND public.has_business_role(business_id, ARRAY['ADMIN', 'GERENTE']::text[])
    AND public.is_business_subscription_active(business_id)
  );

-- ---------------------------------------------------------------------------
-- 4) Versión (bloqueo optimista) y updated_at
-- ---------------------------------------------------------------------------
-- La versión solo sube cuando cambia algo que escribe la app. Un recálculo de
-- métricas NO la sube: si lo hiciera, cada venta invalidaría la edición que
-- el cajero tiene abierta y provocaría OptimisticLockError falsos.
CREATE OR REPLACE FUNCTION public.customers_v2_bump_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF ROW(NEW.branch_id, NEW.name, NEW.email, NEW.phone_raw, NEW.phone_e164,
         NEW.document_type, NEW.document_number, NEW.document_key)
     IS DISTINCT FROM
     ROW(OLD.branch_id, OLD.name, OLD.email, OLD.phone_raw, OLD.phone_e164,
         OLD.document_type, OLD.document_number, OLD.document_key)
  THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  ELSE
    NEW.version := OLD.version;
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS customers_v2_bump_version ON public.customers_v2;
CREATE TRIGGER customers_v2_bump_version
  BEFORE UPDATE ON public.customers_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.customers_v2_bump_version();

-- ---------------------------------------------------------------------------
-- 5) Recálculo de métricas desde public.sales (idempotente)
-- ---------------------------------------------------------------------------
-- Siempre recalcula DESDE LAS VENTAS, nunca suma incrementos: ejecutarlo
-- 1 o 100 veces da el mismo resultado, así que no puede acumular desvíos.
--
-- Reglas (espejo de calculateLoyaltyProfile en loyalty.ts):
--   * cuenta solo status PAID / CLOSED (mayúsculas/espacios ignorados);
--   * neto = total - SUM(refunds[].amount), con piso en 0;
--   * una venta con neto 0 (devuelta por completo) no cuenta como compra;
--   * valores sucios (texto, negativos, "NaN") valen 0 y NO abortan el cálculo.
--
-- p_customer_ids NULL = todos los clientes (backfill / reparación).
CREATE OR REPLACE FUNCTION public.refresh_customers_v2_metrics(p_customer_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_changed integer;
BEGIN
  WITH sale_net AS (
    SELECT
      s.business_id,
      s.data->>'customerId' AS customer_key,
      s.created_at,
      round(
        greatest(
          (CASE WHEN s.data->>'total' ~ '^[0-9]+([.][0-9]+)?$'
                THEN (s.data->>'total')::numeric ELSE 0 END)
          - COALESCE((
              SELECT sum(
                       CASE WHEN r->>'amount' ~ '^[0-9]+([.][0-9]+)?$'
                            THEN (r->>'amount')::numeric ELSE 0 END)
              FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(s.data->'refunds') = 'array'
                          THEN s.data->'refunds' ELSE '[]'::jsonb END) AS r
            ), 0),
          0),
        2) AS net
    FROM public.sales AS s
    WHERE upper(btrim(COALESCE(s.data->>'status', ''))) IN ('PAID', 'CLOSED')
      AND s.data->>'customerId' IS NOT NULL
      AND (
        p_customer_ids IS NULL
        OR s.data->>'customerId' = ANY (
             SELECT x::text FROM unnest(p_customer_ids) AS x)
      )
  ),
  agg AS (
    SELECT
      c.id,
      COALESCE(sum(n.net), 0)::numeric(14,2) AS spent,
      count(n.net)::integer AS purchases,
      min(n.created_at) AS first_at,
      max(n.created_at) AS last_at
    FROM public.customers_v2 AS c
    LEFT JOIN sale_net AS n
      ON n.customer_key = c.id::text
     AND n.business_id = c.business_id
     AND n.net > 0
    WHERE p_customer_ids IS NULL OR c.id = ANY (p_customer_ids)
    GROUP BY c.id
  )
  UPDATE public.customers_v2 AS c
  SET lifetime_spent = agg.spent,
      lifetime_purchase_count = agg.purchases,
      lifetime_points = public.customers_v2_points_for_spent(agg.spent),
      first_purchase_at = agg.first_at,
      last_purchase_at = agg.last_at,
      metrics_updated_at = now()
  FROM agg
  WHERE agg.id = c.id
    AND (
      c.lifetime_spent IS DISTINCT FROM agg.spent
      OR c.lifetime_purchase_count IS DISTINCT FROM agg.purchases
      OR c.lifetime_points IS DISTINCT FROM public.customers_v2_points_for_spent(agg.spent)
      OR c.first_purchase_at IS DISTINCT FROM agg.first_at
      OR c.last_purchase_at IS DISTINCT FROM agg.last_at
    );

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_customers_v2_metrics(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_customers_v2_metrics(uuid[]) TO service_role;

COMMENT ON FUNCTION public.refresh_customers_v2_metrics(uuid[]) IS
  'Recalcula desde public.sales las métricas de por vida de customers_v2 (gasto neto de reembolsos, compras, primera/última compra, puntos). Idempotente. NULL = todos. Solo service_role y el trigger de sales (SECURITY DEFINER).';

-- ---------------------------------------------------------------------------
-- 6) Trigger sobre public.sales: mantiene las métricas al día
-- ---------------------------------------------------------------------------
-- NUNCA debe tumbar una venta: cualquier error se convierte en WARNING.
CREATE OR REPLACE FUNCTION public.sales_refresh_customer_v2_metrics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ids uuid[] := ARRAY[]::uuid[];
  v_old text;
  v_new text;
  v_sale_id text;
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.data->>'customerId' IS NOT DISTINCT FROM NEW.data->>'customerId'
       AND OLD.data->>'status'     IS NOT DISTINCT FROM NEW.data->>'status'
       AND OLD.data->>'total'      IS NOT DISTINCT FROM NEW.data->>'total'
       AND OLD.data->'refunds'     IS NOT DISTINCT FROM NEW.data->'refunds'
    THEN
      RETURN NEW;
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_old := nullif(btrim(OLD.data->>'customerId'), '');
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_new := nullif(btrim(NEW.data->>'customerId'), '');
    END IF;

    -- 'CLIENTE_GENERAL' y cualquier valor que no sea uuid se ignoran.
    IF v_old ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_ids := v_ids || v_old::uuid;
    END IF;
    IF v_new ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND v_new IS DISTINCT FROM v_old THEN
      v_ids := v_ids || v_new::uuid;
    END IF;

    IF array_length(v_ids, 1) IS NOT NULL THEN
      PERFORM public.refresh_customers_v2_metrics(v_ids);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_sale_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
    RAISE WARNING 'customers_v2 metrics refresh failed for sale %: % (%)', v_sale_id, SQLERRM, SQLSTATE;
  END;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

REVOKE ALL ON FUNCTION public.sales_refresh_customer_v2_metrics() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sales_refresh_customer_v2_metrics ON public.sales;
CREATE TRIGGER sales_refresh_customer_v2_metrics
  AFTER INSERT OR UPDATE OR DELETE ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.sales_refresh_customer_v2_metrics();

-- ---------------------------------------------------------------------------
-- 7) Backfill desde public.customers (conserva el mismo id) — re-ejecutable
-- ---------------------------------------------------------------------------
-- El id se conserva a propósito: public.sales.data->>'customerId' ya apunta a
-- ese uuid, así que las métricas cuadran sin reescribir ninguna venta.
-- phone_e164 y document_key quedan en NULL: los llena el script de
-- normalización (dominio TypeScript) que también reporta los duplicados reales.
--
-- Es una función (y no solo un INSERT suelto) porque habrá que volver a
-- correrla justo antes del cutover: los clientes que se creen en
-- public.customers después de esta migración todavía no existen en v2.
-- Idempotente: no pisa filas ya migradas (ON CONFLICT DO NOTHING).
CREATE OR REPLACE FUNCTION public.backfill_customers_v2_from_legacy()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_inserted integer;
BEGIN
  INSERT INTO public.customers_v2 (
    id, business_id, branch_id, name, email, phone_raw,
    document_type, document_number, legacy_points, created_at
  )
  SELECT
    c.id,
    c.business_id,
    c.branch_id,
    left(COALESCE(NULLIF(btrim(c.data->>'name'), ''), 'Cliente sin nombre'), 200),
    NULLIF(btrim(c.data->>'email'), ''),
    NULLIF(btrim(c.data->>'phone'), ''),
    CASE WHEN c.data->>'documentType' IN ('CC', 'CE', 'NIT', 'PASSPORT', 'OTHER')
         THEN c.data->>'documentType' END,
    CASE WHEN c.data->>'documentType' IN ('CC', 'CE', 'NIT', 'PASSPORT', 'OTHER')
         THEN NULLIF(btrim(c.data->>'documentNumber'), '') END,
    CASE WHEN c.data->>'points' ~ '^[0-9]{1,15}$' THEN (c.data->>'points')::bigint END,
    c.created_at
  FROM public.customers AS c
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.refresh_customers_v2_metrics(NULL);
  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.backfill_customers_v2_from_legacy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_customers_v2_from_legacy() TO service_role;

COMMENT ON FUNCTION public.backfill_customers_v2_from_legacy() IS
  'Copia a customers_v2 los clientes de public.customers que aun no existen alli (mismo id) y recalcula metricas. Idempotente. Devuelve cuantos inserto. Solo service_role.';

SELECT public.backfill_customers_v2_from_legacy();

COMMIT;