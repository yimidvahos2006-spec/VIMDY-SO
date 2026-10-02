-- ============================================================================
-- VIMDY OS — CAJA ENTERPRISE V2
-- ============================================================================
-- Objetivo: cerrar las brechas reales que quedaban en Caja sin inventar
-- relaciones financieras históricas.
--
-- 1) Caja física persistente: Empresa -> Sucursal -> Caja -> Turno.
-- 2) Un turno abierto por caja física (no por toda la sucursal).
-- 3) Movimientos y cobros nuevos quedan ligados estrictamente a caja + turno.
-- 4) El cierre calcula ÚNICAMENTE por shift_id; nunca usa ventanas de fecha.
-- 5) Pagos CARD requieren confirmación externa de terminal; TRANSFER/QR
--    requieren evidencia del proveedor. Una referencia sola NO confirma.
-- 6) Mantiene close_shift_atomic -> daily_report_jobs -> Dashboard/WhatsApp.
-- 7) No se reasignan movimientos históricos ambiguos.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. CAJAS FÍSICAS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cash_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  version integer NOT NULL DEFAULT 1,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_registers_business_branch_code_idx
  ON public.cash_registers (business_id, branch_id, code);

CREATE INDEX IF NOT EXISTS cash_registers_business_branch_active_idx
  ON public.cash_registers (business_id, branch_id, active)
  WHERE active = true;

ALTER TABLE public.cash_registers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.cash_registers TO authenticated;
REVOKE DELETE ON public.cash_registers FROM authenticated;

DROP POLICY IF EXISTS cash_registers_select_member ON public.cash_registers;
CREATE POLICY cash_registers_select_member
ON public.cash_registers
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = cash_registers.business_id
      AND bm.user_id = (select auth.uid())
  )
);

DROP POLICY IF EXISTS cash_registers_insert_admin ON public.cash_registers;
CREATE POLICY cash_registers_insert_admin
ON public.cash_registers
FOR INSERT TO authenticated
WITH CHECK (
  public.has_business_role(business_id, ARRAY['ADMIN'])
  AND EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = cash_registers.branch_id
      AND b.business_id = cash_registers.business_id
      AND b.active = true
  )
);

DROP POLICY IF EXISTS cash_registers_update_admin ON public.cash_registers;
CREATE POLICY cash_registers_update_admin
ON public.cash_registers
FOR UPDATE TO authenticated
USING (public.has_business_role(business_id, ARRAY['ADMIN']))
WITH CHECK (
  public.has_business_role(business_id, ARRAY['ADMIN'])
  AND EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = cash_registers.branch_id
      AND b.business_id = cash_registers.business_id
  )
);

DROP POLICY IF EXISTS cash_registers_delete_blocked ON public.cash_registers;
CREATE POLICY cash_registers_delete_blocked
ON public.cash_registers
FOR DELETE TO authenticated
USING (false);

-- Mantener columnas físicas sincronizadas con el JSON que usa SupabaseRepository.
CREATE OR REPLACE FUNCTION public.sync_cash_register_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.business_id := COALESCE(NEW.business_id, NULLIF(NEW.data->>'businessId','')::uuid);
  NEW.branch_id := COALESCE(NEW.branch_id, NULLIF(NEW.data->>'branchId','')::uuid);
  NEW.code := COALESCE(NULLIF(NEW.code,''), NULLIF(NEW.data->>'code',''));
  NEW.name := COALESCE(NULLIF(NEW.name,''), NULLIF(NEW.data->>'name',''));
  NEW.active := COALESCE((NEW.data->>'active')::boolean, NEW.active);
  NEW.status := COALESCE(NULLIF(NEW.data->>'status',''), NEW.status);
  NEW.data := jsonb_set(NEW.data, '{id}', to_jsonb(NEW.id::text), true);
  NEW.data := jsonb_set(NEW.data, '{cashRegisterId}', to_jsonb(NEW.id::text), true);
  NEW.data := jsonb_set(NEW.data, '{businessId}', to_jsonb(NEW.business_id::text), true);
  NEW.data := jsonb_set(NEW.data, '{branchId}', to_jsonb(NEW.branch_id::text), true);
  NEW.data := jsonb_set(NEW.data, '{code}', to_jsonb(NEW.code), true);
  NEW.data := jsonb_set(NEW.data, '{name}', to_jsonb(NEW.name), true);
  NEW.data := jsonb_set(NEW.data, '{active}', to_jsonb(NEW.active), true);
  NEW.data := jsonb_set(NEW.data, '{status}', to_jsonb(NEW.status), true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_cash_register_columns ON public.cash_registers;
CREATE TRIGGER trg_sync_cash_register_columns
BEFORE INSERT OR UPDATE OF data, business_id, branch_id, code, name, active, status
ON public.cash_registers
FOR EACH ROW
EXECUTE FUNCTION public.sync_cash_register_columns();

-- ---------------------------------------------------------------------------
-- 1.1 VERIFICACIONES DE PAGOS DIGITALES
-- ---------------------------------------------------------------------------
-- La confirmación de TRANSFER/QR solo puede provenir de una evidencia
-- creada por un proceso de servidor/proveedor (Edge Function/webhook).
-- El cliente autenticado puede LEER su negocio, pero no insertar ni alterar
-- verificaciones. Esto evita que una llamada directa a una RPC pueda fingir
-- p_verification_source='PROVIDER'.
CREATE TABLE IF NOT EXISTS public.payment_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  sale_id text NOT NULL,
  payment_id text NOT NULL,
  method text NOT NULL CHECK (method IN ('TRANSFER','QR')),
  amount numeric NOT NULL CHECK (amount > 0),
  provider text NOT NULL,
  provider_reference text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','REJECTED','EXPIRED')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_verifications_business_branch_payment_idx
  ON public.payment_verifications (business_id, branch_id, payment_id);

CREATE INDEX IF NOT EXISTS payment_verifications_sale_status_idx
  ON public.payment_verifications (business_id, branch_id, sale_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS payment_verifications_provider_reference_unique_idx
  ON public.payment_verifications (business_id, branch_id, provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

ALTER TABLE public.payment_verifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.payment_verifications TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payment_verifications FROM authenticated;

DROP POLICY IF EXISTS payment_verifications_select_member ON public.payment_verifications;
CREATE POLICY payment_verifications_select_member
ON public.payment_verifications
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = payment_verifications.business_id
      AND bm.user_id = (select auth.uid())
  )
);

-- ---------------------------------------------------------------------------
-- 2. RELACIÓN TURNO -> CAJA Y MOVIMIENTO -> CAJA
-- ---------------------------------------------------------------------------
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS cash_register_id uuid;

ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS cash_register_id uuid;

DO $$ BEGIN
  ALTER TABLE public.shifts
    ADD CONSTRAINT shifts_cash_register_fk
    FOREIGN KEY (cash_register_id) REFERENCES public.cash_registers(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.cash_movements
    ADD CONSTRAINT cash_movements_cash_register_fk
    FOREIGN KEY (cash_register_id) REFERENCES public.cash_registers(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS shifts_business_branch_register_status_idx
  ON public.shifts (business_id, branch_id, cash_register_id)
  WHERE (data->>'status') = 'OPEN';

CREATE INDEX IF NOT EXISTS cash_movements_business_branch_register_shift_idx
  ON public.cash_movements (business_id, branch_id, cash_register_id, shift_id)
  WHERE shift_id IS NOT NULL;

-- Idempotencia aislada por negocio + sucursal: una misma clave puede existir
-- en negocios distintos sin interferirse.
CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_business_branch_idempotency_key_idx
  ON public.cash_movements (business_id, branch_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
DROP INDEX IF EXISTS public.cash_movements_idempotency_key_idx;

-- La constraint anterior era por sucursal completa. Se reemplaza por caja física.
DROP INDEX IF EXISTS public.shifts_single_open_per_business_branch;
CREATE UNIQUE INDEX IF NOT EXISTS shifts_single_open_per_cash_register
  ON public.shifts (business_id, branch_id, cash_register_id)
  WHERE (data->>'status') = 'OPEN' AND cash_register_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_cash_register_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.cash_register_id IS NULL AND NULLIF(NEW.data->>'cashRegisterId','') IS NOT NULL THEN
    NEW.cash_register_id := (NEW.data->>'cashRegisterId')::uuid;
  END IF;

  IF NEW.cash_register_id IS NOT NULL THEN
    NEW.data := jsonb_set(NEW.data, '{cashRegisterId}', to_jsonb(NEW.cash_register_id::text), true);
  END IF;

  IF TG_TABLE_NAME = 'cash_movements' THEN
    IF NEW.shift_id IS NOT NULL THEN
      NEW.data := jsonb_set(NEW.data, '{shiftId}', to_jsonb(NEW.shift_id), true);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_cash_register_link_shifts ON public.shifts;
CREATE TRIGGER trg_sync_cash_register_link_shifts
BEFORE INSERT OR UPDATE OF data, cash_register_id
ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.sync_cash_register_link();

DROP TRIGGER IF EXISTS trg_sync_cash_register_link_movements ON public.cash_movements;
CREATE TRIGGER trg_sync_cash_register_link_movements
BEFORE INSERT OR UPDATE OF data, cash_register_id, shift_id
ON public.cash_movements
FOR EACH ROW EXECUTE FUNCTION public.sync_cash_register_link();

-- Solo los turnos que están ABIERTO ahora y todavía no tienen caja reciben
-- la caja principal de su sucursal. No se reasigna ningún turno histórico cerrado.
WITH open_unassigned AS (
  SELECT s.id, r.id AS cash_register_id
  FROM public.shifts s
  JOIN public.cash_registers r
    ON r.business_id = s.business_id
   AND r.branch_id = s.branch_id
   AND r.active = true
   AND r.code = 'MAIN'
  WHERE s.cash_register_id IS NULL
    AND s.data->>'status' = 'OPEN'
), chosen AS (
  SELECT id, cash_register_id,
         row_number() OVER (PARTITION BY id ORDER BY cash_register_id) AS rn
  FROM open_unassigned
)
UPDATE public.shifts s
SET cash_register_id = c.cash_register_id,
    data = jsonb_set(s.data, '{cashRegisterId}', to_jsonb(c.cash_register_id::text), true),
    updated_at = clock_timestamp()
FROM chosen c
WHERE c.rn = 1 AND s.id = c.id;

-- ---------------------------------------------------------------------------
-- 3. CAJA PRINCIPAL / DESACTIVACIÓN SEGURA
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_cash_register(
  p_business_id uuid,
  p_branch_id uuid
)
RETURNS TABLE(data jsonb, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.cash_registers%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CASH_REGISTER_AUTH_REQUIRED'; END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','CAJERO']) THEN
    RAISE EXCEPTION 'CASH_REGISTER_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = p_business_id AND bm.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'CASH_REGISTER_NOT_A_MEMBER'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id AND b.business_id = p_business_id AND b.active = true
  ) THEN RAISE EXCEPTION 'CASH_REGISTER_INVALID_BRANCH'; END IF;

  INSERT INTO public.cash_registers(
    business_id, branch_id, code, name, active, status, version, data, updated_at
  ) VALUES (
    p_business_id, p_branch_id, 'MAIN', 'Caja principal', true, 'ACTIVE', 1,
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'businessId', p_business_id::text,
      'branchId', p_branch_id::text,
      'code', 'MAIN',
      'name', 'Caja principal',
      'active', true,
      'status', 'ACTIVE',
      'primary', true,
      'createdAt', v_now,
      'updatedAt', v_now
    ),
    v_now
  )
  ON CONFLICT (business_id, branch_id, code)
  DO UPDATE SET
    active = true,
    status = 'ACTIVE',
    updated_at = v_now,
    data = jsonb_set(
      jsonb_set(cash_registers.data, '{active}', 'true'::jsonb, true),
      '{status}', '"ACTIVE"'::jsonb, true
    )
  RETURNING * INTO v_row;

  RETURN QUERY SELECT v_row.data, v_row.version;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_default_cash_register(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_default_cash_register(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.deactivate_cash_register_atomic(
  p_cash_register_id uuid
)
RETURNS TABLE(data jsonb, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.cash_registers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CASH_REGISTER_AUTH_REQUIRED'; END IF;
  SELECT * INTO v_row FROM public.cash_registers WHERE id = p_cash_register_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CASH_REGISTER_NOT_FOUND'; END IF;
  IF NOT public.has_business_role(v_row.business_id, ARRAY['ADMIN']) THEN RAISE EXCEPTION 'CASH_REGISTER_FORBIDDEN'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.cash_register_id = p_cash_register_id
      AND s.business_id = v_row.business_id
      AND s.branch_id = v_row.branch_id
      AND s.data->>'status' = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'CASH_REGISTER_HAS_OPEN_SHIFT';
  END IF;

  UPDATE public.cash_registers
  SET active = false,
      status = 'INACTIVE',
      version = v_row.version + 1,
      updated_at = clock_timestamp(),
      data = v_row.data || jsonb_build_object('active', false, 'status', 'INACTIVE', 'updatedAt', clock_timestamp())
  WHERE id = p_cash_register_id AND version = v_row.version;

  SELECT * INTO v_row FROM public.cash_registers WHERE id = p_cash_register_id;
  RETURN QUERY SELECT v_row.data, v_row.version;
END;
$$;

REVOKE ALL ON FUNCTION public.deactivate_cash_register_atomic(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_cash_register_atomic(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. APERTURA DE TURNO ATÓMICA POR CAJA FÍSICA
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.open_shift_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text);
CREATE OR REPLACE FUNCTION public.open_shift_atomic(
  p_shift_id uuid,
  p_business_id uuid,
  p_branch_id uuid,
  p_cash_register_id uuid,
  p_cashier_id uuid,
  p_opening_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(data jsonb, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_data jsonb;
  v_version integer := 1;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SHIFT_AUTH_REQUIRED'; END IF;
  IF p_shift_id IS NULL OR p_business_id IS NULL OR p_branch_id IS NULL OR p_cash_register_id IS NULL OR p_cashier_id IS NULL THEN
    RAISE EXCEPTION 'SHIFT_CONTEXT_REQUIRED';
  END IF;
  IF p_opening_amount IS NULL OR p_opening_amount < 0 THEN RAISE EXCEPTION 'SHIFT_INVALID_OPENING_AMOUNT'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = p_business_id AND bm.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'SHIFT_NOT_A_MEMBER'; END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','CAJERO']) THEN RAISE EXCEPTION 'SHIFT_FORBIDDEN'; END IF;
  IF p_cashier_id <> auth.uid() AND NOT public.has_business_role(p_business_id, ARRAY['ADMIN']) THEN
    RAISE EXCEPTION 'SHIFT_CASHIER_MISMATCH';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id AND b.business_id = p_business_id AND b.active = true
  ) THEN RAISE EXCEPTION 'SHIFT_INVALID_BRANCH'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cash_registers r
    WHERE r.id = p_cash_register_id
      AND r.business_id = p_business_id
      AND r.branch_id = p_branch_id
      AND r.active = true
      AND r.status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'SHIFT_INVALID_CASH_REGISTER'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.cash_register_id = p_cash_register_id
      AND s.data->>'status' = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'SHIFT_ALREADY_OPEN';
  END IF;

  v_data := jsonb_build_object(
    'id', p_shift_id::text,
    'businessId', p_business_id::text,
    'branchId', p_branch_id::text,
    'cashRegisterId', p_cash_register_id::text,
    'cashierId', p_cashier_id::text,
    'status', 'OPEN',
    'openingAmount', p_opening_amount,
    'openedAt', v_now,
    'openingNotes', p_notes
  );

  INSERT INTO public.shifts(id, business_id, branch_id, cash_register_id, data, version, updated_at)
  VALUES (p_shift_id, p_business_id, p_branch_id, p_cash_register_id, v_data, v_version, v_now);

  RETURN QUERY SELECT v_data, v_version;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'SHIFT_ALREADY_OPEN';
END;
$$;

REVOKE ALL ON FUNCTION public.open_shift_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_shift_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. MOVIMIENTO ATÓMICO: CAJA + TURNO ESTRICTOS
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz);
CREATE OR REPLACE FUNCTION public.register_movement_atomic(
  p_idempotency_key text,
  p_business_id uuid,
  p_branch_id uuid,
  p_type text,
  p_amount numeric,
  p_description text,
  p_payment_method text DEFAULT 'CASH',
  p_cash_amount numeric DEFAULT 0,
  p_sale_id text DEFAULT NULL,
  p_created_at timestamptz DEFAULT now(),
  p_cash_register_id uuid DEFAULT NULL,
  p_verification_source text DEFAULT NULL
)
RETURNS TABLE(
  movement_id text,
  idempotency_key text,
  type text,
  amount numeric,
  description text,
  date timestamptz,
  payment_method text,
  cash_amount numeric,
  business_id uuid,
  branch_id uuid,
  sale_id text,
  created_at timestamptz,
  cash_register_id uuid,
  shift_id text,
  payment_verification_source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_existing public.cash_movements%ROWTYPE;
  v_register_id uuid := p_cash_register_id;
  v_open_shift_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CAJA_AUTH_REQUIRED'; END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'CAJA_IDEMPOTENCY_REQUIRED'; END IF;
  IF p_business_id IS NULL OR p_branch_id IS NULL THEN RAISE EXCEPTION 'CAJA_CONTEXT_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_members bm WHERE bm.business_id = p_business_id AND bm.user_id = auth.uid()) THEN RAISE EXCEPTION 'CAJA_NOT_A_MEMBER'; END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','CAJERO']) THEN RAISE EXCEPTION 'CAJA_FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b.business_id = p_business_id AND b.active = true) THEN RAISE EXCEPTION 'CAJA_INVALID_BRANCH'; END IF;
  IF p_type NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'CAJA_INVALID_TYPE'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'CAJA_INVALID_AMOUNT'; END IF;
  IF p_cash_amount IS NULL OR p_cash_amount < 0 THEN RAISE EXCEPTION 'CAJA_INVALID_CASH_AMOUNT'; END IF;
  IF p_payment_method NOT IN ('CASH','CARD','TRANSFER','QR','MIXED') THEN RAISE EXCEPTION 'CAJA_INVALID_PAYMENT_METHOD'; END IF;
  IF p_payment_method = 'CASH' AND p_verification_source IS DISTINCT FROM 'CASH' THEN RAISE EXCEPTION 'CAJA_CASH_CONFIRMATION_REQUIRED'; END IF;
  IF p_payment_method = 'CARD' AND p_verification_source NOT IN ('EXTERNAL_TERMINAL','PROVIDER') THEN RAISE EXCEPTION 'CAJA_CARD_CONFIRMATION_REQUIRED'; END IF;
  IF p_payment_method IN ('TRANSFER','QR') AND p_verification_source IS DISTINCT FROM 'PROVIDER' THEN RAISE EXCEPTION 'CAJA_PAYMENT_NOT_VERIFIED'; END IF;
  IF p_payment_method = 'MIXED' AND p_verification_source NOT IN ('EXTERNAL_TERMINAL','PROVIDER') THEN RAISE EXCEPTION 'CAJA_MIXED_CONFIRMATION_REQUIRED'; END IF;
  IF p_created_at IS NULL OR p_created_at > clock_timestamp() + interval '5 minutes' THEN RAISE EXCEPTION 'CAJA_INVALID_MOVEMENT_DATE'; END IF;

  SELECT * INTO v_existing
  FROM public.cash_movements cm
  WHERE cm.business_id = p_business_id
    AND cm.branch_id = p_branch_id
    AND cm.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_existing.id::text, v_existing.idempotency_key,
      v_existing.data->>'type', (v_existing.data->>'amount')::numeric,
      v_existing.data->>'description', (v_existing.data->>'date')::timestamptz,
      v_existing.data->>'paymentMethod', COALESCE((v_existing.data->>'cashAmount')::numeric,0),
      v_existing.business_id, v_existing.branch_id, v_existing.data->>'saleId',
      (v_existing.data->>'createdAt')::timestamptz,
      v_existing.cash_register_id, v_existing.shift_id, v_existing.data->>'paymentVerificationSource';
    RETURN;
  END IF;

  IF v_register_id IS NULL THEN
    SELECT count(*) INTO v_open_shift_count
    FROM public.shifts s
    WHERE s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.data->>'status' = 'OPEN';

    IF v_open_shift_count = 0 THEN
      RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT';
    ELSIF v_open_shift_count > 1 THEN
      RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
    END IF;

    SELECT s.cash_register_id INTO v_register_id
    FROM public.shifts s
    WHERE s.business_id = p_business_id
      AND s.branch_id = p_branch_id
      AND s.data->>'status' = 'OPEN'
    ORDER BY s.id ASC
    LIMIT 1;

    IF v_register_id IS NULL THEN
      SELECT count(*) INTO v_open_shift_count
      FROM public.cash_registers r
      WHERE r.business_id = p_business_id
        AND r.branch_id = p_branch_id
        AND r.active = true
        AND r.status = 'ACTIVE';

      IF v_open_shift_count = 0 THEN
        PERFORM public.ensure_default_cash_register(p_business_id, p_branch_id);
        SELECT count(*) INTO v_open_shift_count
        FROM public.cash_registers r
        WHERE r.business_id = p_business_id
          AND r.branch_id = p_branch_id
          AND r.active = true
          AND r.status = 'ACTIVE';
      END IF;

      IF v_open_shift_count <> 1 THEN
        RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
      END IF;

      SELECT r.id INTO v_register_id
      FROM public.cash_registers r
      WHERE r.business_id = p_business_id
        AND r.branch_id = p_branch_id
        AND r.active = true
        AND r.status = 'ACTIVE'
      LIMIT 1;
    END IF;

    IF v_register_id IS NULL THEN
      RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
    END IF;
  END IF;

  SELECT * INTO v_shift
  FROM public.shifts s
  WHERE s.business_id = p_business_id
    AND s.branch_id = p_branch_id
    AND s.data->>'status' = 'OPEN'
    AND (s.cash_register_id = v_register_id OR s.cash_register_id IS NULL)
  ORDER BY (s.cash_register_id = v_register_id) DESC, NULLIF(s.data->>'openedAt','')::timestamptz ASC NULLS LAST, s.id ASC
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT'; END IF;

  -- Compatibilidad segura solo para un turno ABIERTO legado sin caja:
  -- si existe, se vincula al único registro seleccionado de forma explícita.
  IF v_shift.cash_register_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.shifts s2
      WHERE s2.business_id = p_business_id
        AND s2.branch_id = p_branch_id
        AND s2.data->>'status' = 'OPEN'
        AND s2.cash_register_id IS NULL
        AND s2.id <> v_shift.id
    ) THEN
      RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
    END IF;

    UPDATE public.shifts
    SET cash_register_id = v_register_id,
        data = jsonb_set(data, '{cashRegisterId}', to_jsonb(v_register_id::text), true),
        updated_at = clock_timestamp()
    WHERE id = v_shift.id;

    v_shift.cash_register_id := v_register_id;
  END IF;

  IF p_type = 'OUT' THEN
    IF p_payment_method <> 'CASH' OR p_cash_amount <> p_amount THEN RAISE EXCEPTION 'CAJA_INVALID_EXPENSE'; END IF;
  ELSE
    IF p_payment_method = 'CASH' AND p_cash_amount <> p_amount THEN RAISE EXCEPTION 'CAJA_INVALID_CASH_INCOME'; END IF;
    IF p_payment_method IN ('CARD','TRANSFER','QR') AND p_cash_amount <> 0 THEN RAISE EXCEPTION 'CAJA_INVALID_NON_CASH_AMOUNT'; END IF;
    IF p_payment_method = 'MIXED' AND p_cash_amount > p_amount THEN RAISE EXCEPTION 'CAJA_INVALID_MIXED_CASH'; END IF;
  END IF;

  INSERT INTO public.cash_movements(
    id, idempotency_key, business_id, branch_id, cash_register_id, shift_id, data
  ) VALUES (
    gen_random_uuid(), p_idempotency_key, p_business_id, p_branch_id, v_register_id, v_shift.id::text,
    jsonb_build_object(
      'id', p_idempotency_key,
      'idempotencyKey', p_idempotency_key,
      'type', p_type,
      'amount', p_amount,
      'description', p_description,
      'date', p_created_at,
      'paymentMethod', p_payment_method,
      'cashAmount', p_cash_amount,
      'saleId', p_sale_id,
      'shiftId', v_shift.id::text,
      'cashRegisterId', v_register_id::text,
      'createdAt', p_created_at,
      'businessId', p_business_id::text,
      'branchId', p_branch_id::text,
      'userId', auth.uid()::text,
      'paymentVerificationSource', p_verification_source
    )
  )
  ON CONFLICT (business_id, branch_id, idempotency_key) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.cash_movements cm
  WHERE cm.business_id = p_business_id AND cm.branch_id = p_branch_id AND cm.idempotency_key = p_idempotency_key
  FOR UPDATE;

  RETURN QUERY SELECT
    v_existing.id::text, v_existing.idempotency_key,
    v_existing.data->>'type', (v_existing.data->>'amount')::numeric,
    v_existing.data->>'description', (v_existing.data->>'date')::timestamptz,
    v_existing.data->>'paymentMethod', COALESCE((v_existing.data->>'cashAmount')::numeric,0),
    v_existing.business_id, v_existing.branch_id, v_existing.data->>'saleId',
    (v_existing.data->>'createdAt')::timestamptz,
    v_existing.cash_register_id, v_existing.shift_id, v_existing.data->>'paymentVerificationSource';
END;
$$;

REVOKE ALL ON FUNCTION public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. COBRO ATÓMICO: SOLO CONFIRMACIÓN VÁLIDA
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text);
DROP FUNCTION IF EXISTS public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text,uuid,text);
CREATE OR REPLACE FUNCTION public.register_sale_payment_atomic(
  p_sale_id text,
  p_business_id uuid,
  p_branch_id uuid,
  p_payment_id text,
  p_change_id text,
  p_payment_method text,
  p_total numeric,
  p_cash_amount numeric,
  p_received numeric,
  p_change numeric,
  p_reference text DEFAULT NULL,
  p_cash_register_id uuid DEFAULT NULL,
  p_verification_source text DEFAULT NULL
)
RETURNS TABLE(
  sale_data jsonb,
  sale_version integer,
  payment_idempotency_key text,
  payment_amount numeric,
  payment_description text,
  payment_date timestamptz,
  payment_method text,
  payment_cash_amount numeric,
  change_idempotency_key text,
  change_amount numeric,
  change_description text,
  change_date timestamptz,
  business_id uuid,
  branch_id uuid,
  cash_register_id uuid,
  shift_id text,
  payment_verification_source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_payment public.cash_movements%ROWTYPE;
  v_change public.cash_movements%ROWTYPE;
  v_cash_register_id uuid := p_cash_register_id;
  v_open_shift_count integer := 0;
  v_payment_date timestamptz := clock_timestamp();
  v_paid_data jsonb;
  v_has_change boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CAJA_AUTH_REQUIRED'; END IF;
  IF p_sale_id IS NULL OR p_payment_id IS NULL OR btrim(p_payment_id) = '' THEN RAISE EXCEPTION 'CAJA_PAYMENT_IDENTIFIERS_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_members bm WHERE bm.business_id=p_business_id AND bm.user_id=auth.uid()) THEN RAISE EXCEPTION 'CAJA_NOT_A_MEMBER'; END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['ADMIN','CAJERO']) THEN RAISE EXCEPTION 'CAJA_FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id=p_branch_id AND b.business_id=p_business_id AND b.active=true) THEN RAISE EXCEPTION 'CAJA_INVALID_BRANCH'; END IF;
  IF p_payment_method NOT IN ('CASH','CARD','TRANSFER','QR','MIXED') THEN RAISE EXCEPTION 'CAJA_INVALID_PAYMENT_METHOD'; END IF;
  IF p_total IS NULL OR p_total <= 0 OR p_cash_amount IS NULL OR p_cash_amount < 0 OR p_received IS NULL OR p_received < 0 OR p_change IS NULL OR p_change < 0 THEN RAISE EXCEPTION 'CAJA_INVALID_PAYMENT'; END IF;
  IF abs(p_change - greatest(p_received - p_total,0)) > 0.005 THEN RAISE EXCEPTION 'CAJA_INVALID_CHANGE'; END IF;

  -- Nunca se permite confirmar una transferencia/QR por una referencia sola.
  IF p_payment_method IN ('TRANSFER','QR') AND p_verification_source <> 'PROVIDER' THEN
    RAISE EXCEPTION 'CAJA_PAYMENT_NOT_VERIFIED';
  END IF;
  IF p_payment_method = 'CARD' AND p_verification_source NOT IN ('EXTERNAL_TERMINAL','PROVIDER') THEN
    RAISE EXCEPTION 'CAJA_CARD_CONFIRMATION_REQUIRED';
  END IF;
  IF p_payment_method = 'CASH' AND p_verification_source IS DISTINCT FROM 'CASH' THEN
    RAISE EXCEPTION 'CAJA_CASH_CONFIRMATION_REQUIRED';
  END IF;
  IF p_payment_method = 'MIXED' AND p_verification_source NOT IN ('EXTERNAL_TERMINAL','PROVIDER') THEN
    RAISE EXCEPTION 'CAJA_MIXED_CONFIRMATION_REQUIRED';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales s
  WHERE s.id = p_sale_id AND s.business_id = p_business_id AND s.branch_id = p_branch_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;

  IF abs((v_sale.data->>'total')::numeric - p_total) > 0.005 THEN RAISE EXCEPTION 'CAJA_SALE_TOTAL_MISMATCH'; END IF;

  IF p_payment_method IN ('TRANSFER','QR') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.payment_verifications pv
      WHERE pv.business_id = p_business_id
        AND pv.branch_id = p_branch_id
        AND pv.sale_id = p_sale_id
        AND pv.payment_id = p_payment_id
        AND pv.method = p_payment_method
        AND pv.amount = p_total
        AND pv.status = 'CONFIRMED'
        AND pv.verified_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'CAJA_PAYMENT_NOT_VERIFIED';
    END IF;
  END IF;

  SELECT * INTO v_payment
  FROM public.cash_movements cm
  WHERE cm.business_id = p_business_id AND cm.branch_id = p_branch_id AND cm.idempotency_key = p_payment_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_payment.data->>'saleId' IS DISTINCT FROM p_sale_id THEN RAISE EXCEPTION 'CAJA_IDEMPOTENCY_KEY_REUSED'; END IF;
    IF v_sale.data->>'status' NOT IN ('PAID','CLOSED') THEN RAISE EXCEPTION 'CAJA_PAYMENT_SALE_STATE_MISMATCH'; END IF;
    IF p_change_id IS NOT NULL THEN
      SELECT * INTO v_change
      FROM public.cash_movements cm
      WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_change_id
      FOR UPDATE;
      v_has_change := FOUND;
    END IF;
    RETURN QUERY SELECT
      v_sale.data, v_sale.version,
      v_payment.idempotency_key, (v_payment.data->>'amount')::numeric, v_payment.data->>'description', (v_payment.data->>'date')::timestamptz,
      v_payment.data->>'paymentMethod', COALESCE((v_payment.data->>'cashAmount')::numeric,0),
      CASE WHEN v_has_change THEN v_change.idempotency_key ELSE NULL END,
      CASE WHEN v_has_change THEN (v_change.data->>'amount')::numeric ELSE NULL END,
      CASE WHEN v_has_change THEN v_change.data->>'description' ELSE NULL END,
      CASE WHEN v_has_change THEN (v_change.data->>'date')::timestamptz ELSE NULL END,
      p_business_id,p_branch_id,v_payment.cash_register_id,v_payment.shift_id,
      v_payment.data->>'paymentVerificationSource';
    RETURN;
  END IF;

  IF v_sale.data->>'status' IN ('PAID','CLOSED') THEN RAISE EXCEPTION 'SALE_ALREADY_PAID'; END IF;
  IF v_sale.data->>'status' IN ('CANCELLED','REFUNDED') THEN RAISE EXCEPTION 'SALE_NOT_PAYABLE'; END IF;
  IF v_sale.data->>'status' NOT IN ('PENDING_PAYMENT','OPEN') THEN RAISE EXCEPTION 'SALE_INVALID_STATE'; END IF;

  IF v_cash_register_id IS NULL THEN
    SELECT count(*) INTO v_open_shift_count
    FROM public.shifts s
    WHERE s.business_id=p_business_id
      AND s.branch_id=p_branch_id
      AND s.data->>'status'='OPEN';

    IF v_open_shift_count = 0 THEN
      RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT';
    ELSIF v_open_shift_count > 1 THEN
      RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
    END IF;

    SELECT s.cash_register_id INTO v_cash_register_id
    FROM public.shifts s
    WHERE s.business_id=p_business_id
      AND s.branch_id=p_branch_id
      AND s.data->>'status'='OPEN'
    ORDER BY s.id ASC
    LIMIT 1;

    IF v_cash_register_id IS NULL THEN
      SELECT count(*) INTO v_open_shift_count
      FROM public.cash_registers r
      WHERE r.business_id=p_business_id
        AND r.branch_id=p_branch_id
        AND r.active=true
        AND r.status='ACTIVE';

      IF v_open_shift_count = 0 THEN
        PERFORM public.ensure_default_cash_register(p_business_id, p_branch_id);
        SELECT count(*) INTO v_open_shift_count
        FROM public.cash_registers r
        WHERE r.business_id=p_business_id
          AND r.branch_id=p_branch_id
          AND r.active=true
          AND r.status='ACTIVE';
      END IF;

      IF v_open_shift_count <> 1 THEN
        RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
      END IF;

      SELECT r.id INTO v_cash_register_id
      FROM public.cash_registers r
      WHERE r.business_id=p_business_id
        AND r.branch_id=p_branch_id
        AND r.active=true
        AND r.status='ACTIVE'
      LIMIT 1;
    END IF;

    IF v_cash_register_id IS NULL THEN
      RAISE EXCEPTION 'CASH_REGISTER_SELECTION_REQUIRED';
    END IF;
  END IF;

  SELECT * INTO v_shift
  FROM public.shifts s
  WHERE s.business_id=p_business_id
    AND s.branch_id=p_branch_id
    AND s.cash_register_id=v_cash_register_id
    AND s.data->>'status'='OPEN'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAJA_NO_OPEN_SHIFT'; END IF;

  IF p_payment_method='CASH' THEN
    IF abs(p_cash_amount-p_total)>0.005 OR p_received<p_total THEN RAISE EXCEPTION 'CAJA_INVALID_CASH_PAYMENT'; END IF;
  ELSIF p_payment_method IN ('CARD','TRANSFER','QR') THEN
    IF p_cash_amount<>0 OR abs(p_received-p_total)>0.005 OR p_change<>0 THEN RAISE EXCEPTION 'CAJA_INVALID_NON_CASH_PAYMENT'; END IF;
  ELSE
    IF p_cash_amount>p_received OR p_change>p_cash_amount THEN RAISE EXCEPTION 'CAJA_INVALID_MIXED_PAYMENT'; END IF;
  END IF;

  INSERT INTO public.cash_movements(id,idempotency_key,business_id,branch_id,cash_register_id,shift_id,data)
  VALUES (
    gen_random_uuid(),p_payment_id,p_business_id,p_branch_id,v_cash_register_id,v_shift.id::text,
    jsonb_build_object(
      'id',p_payment_id,'idempotencyKey',p_payment_id,'type','IN','amount',p_total,
      'description',format('Venta %s (%s)',coalesce(v_sale.data->>'code',p_sale_id),p_payment_method),
      'date',v_payment_date,'paymentMethod',p_payment_method,'cashAmount',p_cash_amount,
      'saleId',p_sale_id,'shiftId',v_shift.id::text,'cashRegisterId',v_cash_register_id::text,
      'createdAt',v_payment_date,'businessId',p_business_id::text,'branchId',p_branch_id::text,
      'userId',auth.uid()::text,
      'paymentVerificationSource',p_verification_source
    )
  ) ON CONFLICT (business_id,branch_id,idempotency_key) DO NOTHING;

  SELECT * INTO v_payment FROM public.cash_movements cm
  WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_payment_id
  FOR UPDATE;

  IF p_change>0 THEN
    IF p_change_id IS NULL OR btrim(p_change_id)='' THEN RAISE EXCEPTION 'CAJA_CHANGE_ID_REQUIRED'; END IF;
    INSERT INTO public.cash_movements(id,idempotency_key,business_id,branch_id,cash_register_id,shift_id,data)
    VALUES (
      gen_random_uuid(),p_change_id,p_business_id,p_branch_id,v_cash_register_id,v_shift.id::text,
      jsonb_build_object(
        'id',p_change_id,'idempotencyKey',p_change_id,'type','OUT','amount',p_change,
        'description',format('Cambio venta %s',coalesce(v_sale.data->>'code',p_sale_id)),
        'date',v_payment_date,'paymentMethod','CASH','cashAmount',p_change,
        'saleId',p_sale_id,'shiftId',v_shift.id::text,'cashRegisterId',v_cash_register_id::text,
        'createdAt',v_payment_date,'businessId',p_business_id::text,'branchId',p_branch_id::text,
        'userId',auth.uid()::text
      )
    ) ON CONFLICT (business_id,branch_id,idempotency_key) DO NOTHING;
    SELECT * INTO v_change FROM public.cash_movements cm
    WHERE cm.business_id=p_business_id AND cm.branch_id=p_branch_id AND cm.idempotency_key=p_change_id
    FOR UPDATE;
    v_has_change := FOUND;
    IF NOT v_has_change OR v_change.data->>'saleId' IS DISTINCT FROM p_sale_id THEN RAISE EXCEPTION 'CAJA_CHANGE_KEY_REUSED'; END IF;
  END IF;

  v_paid_data := v_sale.data || jsonb_build_object(
    'status','PAID','paymentMethod',p_payment_method,'cashAmount',p_cash_amount,
    'paymentReference',NULLIF(p_reference,''),'paymentReceived',p_received,'changeGiven',p_change,
    'paymentStatus','CONFIRMED','paymentVerificationSource',p_verification_source,
    'paymentVerifiedAt',v_payment_date,'paidAt',v_payment_date,'shiftId',v_shift.id::text,
    'cashRegisterId',v_cash_register_id::text
  );

  UPDATE public.sales
  SET data=v_paid_data,version=v_sale.version+1,updated_at=v_payment_date
  WHERE id=p_sale_id AND business_id=p_business_id AND branch_id=p_branch_id
    AND version=v_sale.version AND data->>'status' IN ('PENDING_PAYMENT','OPEN');
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_PAYMENT_CONFLICT'; END IF;

  RETURN QUERY SELECT
    v_paid_data,v_sale.version+1,
    v_payment.idempotency_key,(v_payment.data->>'amount')::numeric,v_payment.data->>'description',(v_payment.data->>'date')::timestamptz,
    v_payment.data->>'paymentMethod',COALESCE((v_payment.data->>'cashAmount')::numeric,0),
    CASE WHEN v_has_change THEN v_change.idempotency_key ELSE NULL END,
    CASE WHEN v_has_change THEN (v_change.data->>'amount')::numeric ELSE NULL END,
    CASE WHEN v_has_change THEN v_change.data->>'description' ELSE NULL END,
    CASE WHEN v_has_change THEN (v_change.data->>'date')::timestamptz ELSE NULL END,
    p_business_id,p_branch_id,v_cash_register_id,v_shift.id::text,
    v_payment.data->>'paymentVerificationSource';
END;
$$;

REVOKE ALL ON FUNCTION public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text,uuid,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. CIERRE: SOLO shift_id. NUNCA mezcla fechas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_shift_atomic(
  p_shift_id uuid,
  p_counted_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(shift_id uuid,data jsonb,version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_closed_at timestamptz := clock_timestamp();
  v_total_income numeric := 0;
  v_total_expense numeric := 0;
  v_total_cash_income numeric := 0;
  v_expected_amount numeric := 0;
  v_difference numeric := 0;
  v_income_by_method jsonb := '{}'::jsonb;
  v_new_data jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SHIFT_AUTH_REQUIRED'; END IF;
  IF p_counted_amount IS NULL OR p_counted_amount < 0 THEN RAISE EXCEPTION 'SHIFT_INVALID_COUNTED_AMOUNT'; END IF;

  SELECT * INTO v_shift FROM public.shifts s WHERE s.id=p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_members bm WHERE bm.business_id=v_shift.business_id AND bm.user_id=auth.uid()) THEN RAISE EXCEPTION 'SHIFT_NOT_A_MEMBER'; END IF;
  IF NOT public.has_business_role(v_shift.business_id,ARRAY['ADMIN','CAJERO']) THEN RAISE EXCEPTION 'SHIFT_FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id=v_shift.branch_id AND b.business_id=v_shift.business_id AND b.active=true) THEN RAISE EXCEPTION 'SHIFT_INVALID_BRANCH'; END IF;
  IF v_shift.data->>'status'='CLOSED' THEN RAISE EXCEPTION 'SHIFT_ALREADY_CLOSED'; END IF;
  IF v_shift.data->>'status'<>'OPEN' THEN RAISE EXCEPTION 'SHIFT_NOT_OPEN'; END IF;

  -- Todo movimiento financiero nuevo debe estar ligado al turno. Si existen
  -- movimientos no asignados que caen en la vida del turno, NO adivinamos:
  -- bloqueamos el cierre para que el usuario pueda resolver el dato.
  IF EXISTS (
    SELECT 1 FROM public.cash_movements cm
    WHERE cm.business_id=v_shift.business_id
      AND cm.branch_id=v_shift.branch_id
      AND cm.shift_id IS NULL
      AND cm.data_date >= NULLIF(v_shift.data->>'openedAt','')::timestamptz
      AND cm.data_date <= v_closed_at
  ) THEN
    RAISE EXCEPTION 'SHIFT_UNASSIGNED_CASH_MOVEMENTS';
  END IF;

  SELECT
    COALESCE(SUM((cm.data->>'amount')::numeric) FILTER (WHERE cm.data->>'type'='IN'),0),
    COALESCE(SUM((cm.data->>'amount')::numeric) FILTER (WHERE cm.data->>'type'='OUT'),0),
    COALESCE(SUM(COALESCE((cm.data->>'cashAmount')::numeric,0)) FILTER (WHERE cm.data->>'type'='IN'),0)
  INTO v_total_income,v_total_expense,v_total_cash_income
  FROM public.cash_movements cm
  WHERE cm.business_id=v_shift.business_id
    AND cm.branch_id=v_shift.branch_id
    AND cm.shift_id=p_shift_id::text;

  SELECT COALESCE(jsonb_object_agg(method,total),'{}'::jsonb) INTO v_income_by_method
  FROM (
    SELECT COALESCE(cm.data->>'paymentMethod','CASH') method,
           SUM((cm.data->>'amount')::numeric) total
    FROM public.cash_movements cm
    WHERE cm.business_id=v_shift.business_id
      AND cm.branch_id=v_shift.branch_id
      AND cm.shift_id=p_shift_id::text
      AND cm.data->>'type'='IN'
    GROUP BY COALESCE(cm.data->>'paymentMethod','CASH')
  ) methods;

  v_expected_amount := COALESCE((v_shift.data->>'openingAmount')::numeric,0)+v_total_cash_income-v_total_expense;
  v_difference := p_counted_amount-v_expected_amount;

  v_new_data := v_shift.data || jsonb_build_object(
    'status','CLOSED',
    'totalIncome',v_total_income,
    'totalExpense',v_total_expense,
    'totalCashIncome',v_total_cash_income,
    'incomeByMethod',v_income_by_method,
    'expectedAmount',v_expected_amount,
    'countedAmount',p_counted_amount,
    'difference',v_difference,
    'closedAt',v_closed_at,
    'closedBy',auth.uid(),
    'closingNotes',p_notes
  );

  UPDATE public.shifts
  SET data=v_new_data,version=v_shift.version+1,updated_at=v_closed_at
  WHERE id=p_shift_id
    AND version=v_shift.version
    AND data->>'status'='OPEN';
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_CLOSE_CONFLICT'; END IF;

  INSERT INTO public.daily_report_jobs(
    business_id,branch_id,shift_id,business_date,opened_at,closed_at,data_cutoff_at,
    cash_expected,cash_counted,cash_difference,status,next_attempt_at
  )
  SELECT
    v_shift.business_id,v_shift.branch_id,p_shift_id,
    (v_closed_at AT TIME ZONE COALESCE((SELECT timezone FROM public.businesses WHERE id=v_shift.business_id),'UTC'))::date,
    NULLIF(v_shift.data->>'openedAt','')::timestamptz,v_closed_at,v_closed_at,
    v_expected_amount,p_counted_amount,v_difference,'PENDING',v_closed_at
  WHERE NOT EXISTS (SELECT 1 FROM public.daily_report_jobs drj WHERE drj.shift_id=p_shift_id);

  RETURN QUERY SELECT p_shift_id,v_new_data,v_shift.version+1;
END;
$$;

REVOKE ALL ON FUNCTION public.close_shift_atomic(uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_shift_atomic(uuid,numeric,text) TO authenticated;

COMMENT ON FUNCTION public.close_shift_atomic IS
'Caja Enterprise V2: cierre atómico estrictamente por shift_id; no mezcla movimientos por fechas y conserva el job durable del reporte diario.';

-- ---------------------------------------------------------------------------
-- 8. AJUSTE SEGURO DEL DATE SYNC DEL CASH MOVEMENT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_cash_movement_data_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  BEGIN
    NEW.data_date := NULLIF(NEW.data->>'date','')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'CASH_MOVEMENT_INVALID_DATE';
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_cash_movements_data_date_trigger ON public.cash_movements;
CREATE TRIGGER sync_cash_movements_data_date_trigger
BEFORE INSERT OR UPDATE OF data ON public.cash_movements
FOR EACH ROW EXECUTE FUNCTION public.sync_cash_movement_data_date();

COMMIT;
