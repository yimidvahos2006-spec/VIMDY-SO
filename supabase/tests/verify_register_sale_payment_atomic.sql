-- VIMDY OS — verify_register_sale_payment_atomic.sql
-- -----------------------------------------------------------------------------
-- Validador autocontenido para Supabase SQL Editor.
--
-- Diseño:
--   * NO usa objetos temporales de esquema.
--   * NO crea tablas temporales.
--   * NO crea funciones auxiliares temporales.
--   * Todas las pruebas viven dentro de bloques DO anónimos.
--   * Los fixtures, triggers y funciones de prueba se ejecutan dentro de una
--     única transacción y el script termina con ROLLBACK.
--
-- Resultado:
--   * Cada bloque emite PASS/FAIL/SKIP mediante RAISE NOTICE.
--   * El SQL Editor no necesita conservar ningún estado entre sesiones.
--
-- IMPORTANTE:
--   Este script verifica el esquema y las RPC desplegadas en el proyecto sobre
--   el que se ejecuta. Que el archivo exista en el repositorio NO demuestra que
--   la migration correspondiente esté aplicada en Supabase.
-- -----------------------------------------------------------------------------

BEGIN;

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

-- ============================================================================
-- BLOQUE 1 — CONTRATO DE LA RPC + IDEMPOTENCIA + RLS
-- ============================================================================
DO $$
DECLARE
  v_rpc regprocedure;
  v_rpc_count integer;
  v_unique_arbiter boolean := false;
  v_payment_table boolean := false;
  v_payment_unique boolean := false;
  v_digital_method_check boolean := false;
  v_sales_rls boolean := false;
  v_sales_select_policy boolean := false;
  v_pass integer := 0;
  v_fail integer := 0;
BEGIN
  -- 01_RPC_CONTRACT ----------------------------------------------------------
  BEGIN
    SELECT count(*)
    INTO v_rpc_count
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'register_sale_payment_atomic';

    v_rpc := to_regprocedure(
      'public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text,uuid,text,uuid)'
    );

    IF v_rpc_count <> 1 OR v_rpc IS NULL THEN
      RAISE EXCEPTION
        'Debe existir exactamente una register_sale_payment_atomic con la firma final de 14 parámetros. Encontradas=%s, firma_final=%s.',
        v_rpc_count,
        v_rpc IS NOT NULL;
    END IF;

    IF NOT (
      SELECT p.prosecdef
      FROM pg_catalog.pg_proc p
      WHERE p.oid = v_rpc
    ) THEN
      RAISE EXCEPTION 'La RPC no está definida como SECURITY DEFINER.';
    END IF;

    IF NOT has_function_privilege('authenticated', v_rpc, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated no tiene EXECUTE sobre la RPC canónica.';
    END IF;

    IF has_function_privilege('anon', v_rpc, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon conserva EXECUTE sobre la RPC canónica.';
    END IF;

    v_pass := v_pass + 1;
    RAISE NOTICE '[PASS] 01_RPC_CONTRACT — RPC única, firma canónica de 14 parámetros y permisos correctos.';
  EXCEPTION
    WHEN OTHERS THEN
      v_fail := v_fail + 1;
      RAISE NOTICE '[FAIL] 01_RPC_CONTRACT — %', SQLERRM;
  END;

  -- 02_IDEMPOTENCY_ARBITER ---------------------------------------------------
  BEGIN
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class t
        ON t.oid = i.indrelid
      JOIN pg_catalog.pg_namespace n
        ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'cash_movements'
        AND i.indisunique
        AND i.indpred IS NULL
        AND i.indnkeyatts = 3
        AND (
          SELECT array_agg(a.attname::text ORDER BY u.ord)
          FROM unnest(i.indkey[1:i.indnkeyatts]) WITH ORDINALITY u(attnum, ord)
          JOIN pg_catalog.pg_attribute a
            ON a.attrelid = i.indrelid
           AND a.attnum = u.attnum
        ) = ARRAY['business_id','branch_id','idempotency_key']::text[]
    )
    INTO v_unique_arbiter;

    IF NOT v_unique_arbiter THEN
      RAISE EXCEPTION
        'Falta el UNIQUE real requerido por ON CONFLICT sobre cash_movements(business_id,branch_id,idempotency_key).';
    END IF;

    v_pass := v_pass + 1;
    RAISE NOTICE '[PASS] 02_IDEMPOTENCY_ARBITER — UNIQUE detectado por columnas; no se exige un nombre de índice concreto.';
  EXCEPTION
    WHEN OTHERS THEN
      v_fail := v_fail + 1;
      RAISE NOTICE '[FAIL] 02_IDEMPOTENCY_ARBITER — %', SQLERRM;
  END;

  -- 03_PAYMENT_VERIFICATIONS -------------------------------------------------
  BEGIN
    v_payment_table := to_regclass('public.payment_verifications') IS NOT NULL;

    IF NOT v_payment_table THEN
      RAISE EXCEPTION 'No existe public.payment_verifications.';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.payment_verifications'::regclass
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%method%'
        AND pg_get_constraintdef(c.oid) ILIKE '%TRANSFER%'
        AND pg_get_constraintdef(c.oid) ILIKE '%QR%'
    )
    INTO v_digital_method_check;

    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class t
        ON t.oid = i.indrelid
      JOIN pg_catalog.pg_namespace n
        ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'payment_verifications'
        AND i.indisunique
        AND i.indpred IS NULL
        AND i.indnkeyatts = 3
        AND (
          SELECT array_agg(a.attname::text ORDER BY u.ord)
          FROM unnest(i.indkey[1:i.indnkeyatts]) WITH ORDINALITY u(attnum, ord)
          JOIN pg_catalog.pg_attribute a
            ON a.attrelid = i.indrelid
           AND a.attnum = u.attnum
        ) = ARRAY['business_id','branch_id','payment_id']::text[]
    )
    INTO v_payment_unique;

    IF NOT v_digital_method_check THEN
      RAISE EXCEPTION 'payment_verifications no conserva el CHECK real de TRANSFER/QR.';
    END IF;

    IF NOT v_payment_unique THEN
      RAISE EXCEPTION
        'Falta UNIQUE sobre payment_verifications(business_id,branch_id,payment_id).';
    END IF;

    v_pass := v_pass + 1;
    RAISE NOTICE '[PASS] 03_PAYMENT_VERIFICATIONS — CHECK TRANSFER/QR + UNIQUE de idempotencia.';
  EXCEPTION
    WHEN OTHERS THEN
      v_fail := v_fail + 1;
      RAISE NOTICE '[FAIL] 03_PAYMENT_VERIFICATIONS — %', SQLERRM;
  END;

  -- 04_RLS_SCHEMA ------------------------------------------------------------
  BEGIN
    SELECT c.relrowsecurity
    INTO v_sales_rls
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'sales';

    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'sales'
        AND p.cmd = 'SELECT'
    )
    INTO v_sales_select_policy;

    IF NOT v_sales_rls OR NOT v_sales_select_policy THEN
      RAISE EXCEPTION 'sales no tiene RLS habilitado y/o no tiene política SELECT.';
    END IF;

    v_pass := v_pass + 1;
    RAISE NOTICE '[PASS] 04_RLS_SCHEMA — RLS habilitado en sales y política SELECT presente.';
  EXCEPTION
    WHEN OTHERS THEN
      v_fail := v_fail + 1;
      RAISE NOTICE '[FAIL] 04_RLS_SCHEMA — %', SQLERRM;
  END;

  RAISE NOTICE 'BLOQUE 1 — PASS=% FAIL=%', v_pass, v_fail;
END;
$$;

-- ============================================================================
-- BLOQUE 2 — FIXTURES + MATRIZ DE PAGOS + IDEMPOTENCIA + ROLLBACK + FULFILLMENT
-- ============================================================================
DO $$
DECLARE
  v_user_id uuid;
  v_business_id uuid;
  v_branch_id uuid;
  v_cash_register_id uuid;
  v_shift_id uuid;
  v_product_id uuid;
  v_low_stock_product_id uuid;
  v_pass integer := 0;
  v_fail integer := 0;
  v_sale_id uuid;
  v_sale_id_2 uuid;
  v_payment_id text;
  v_method text;
  v_reference text;
  v_cash_amount numeric;
  v_status text;
  v_persisted_method text;
  v_persisted_amount numeric;
  v_persisted_cash_amount numeric;
  v_count integer;
  v_count_before integer;
  v_count_after integer;
  v_rejected boolean;
  v_stock_before numeric;
  v_stock_after numeric;
  v_sale_count integer;
  v_sale_item_count integer;
  v_inventory_count integer;
  v_kitchen_count integer;
  v_operation_count integer;
  v_result record;
  v_payload jsonb;
  v_first jsonb;
  v_retry jsonb;
  v_fail_paid_trigger_created boolean := false;
  v_fail_kitchen_trigger_created boolean := false;
BEGIN
  -- 05_FIXTURES --------------------------------------------------------------
  BEGIN
    SELECT id
    INTO v_user_id
    FROM auth.users
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'No existe ningún usuario en auth.users.';
    END IF;

    PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    INSERT INTO public.businesses(
      name,
      plan,
      trial_ends_at,
      timezone,
      subscription_status,
      currency,
      tax_rate,
      inventory_type,
      tables_enabled,
      kitchen_enabled,
      kitchen_output_mode,
      kds_enabled,
      printer_enabled
    )
    VALUES(
      'VIMDY TEST ATOMIC ' || substr(gen_random_uuid()::text, 1, 8),
      'trial',
      clock_timestamp() + interval '30 days',
      'America/Bogota',
      'trial',
      'COP',
      0,
      'productos',
      false,
      true,
      'kds',
      true,
      false
    )
    RETURNING id INTO v_business_id;

    INSERT INTO public.branches(business_id, name, active)
    VALUES(v_business_id, 'Sucursal Test Principal', true)
    RETURNING id INTO v_branch_id;

    INSERT INTO public.business_members(user_id, business_id, role)
    VALUES(v_user_id, v_business_id, 'CAJERO');

    INSERT INTO public.cash_registers(
      business_id,
      branch_id,
      code,
      name,
      active,
      status,
      data
    )
    VALUES(
      v_business_id,
      v_branch_id,
      'TEST-' || substr(gen_random_uuid()::text, 1, 8),
      'Caja Test Atomic',
      true,
      'ACTIVE',
      '{}'::jsonb
    )
    RETURNING id INTO v_cash_register_id;

    v_shift_id := gen_random_uuid();
    PERFORM public.open_shift_atomic(
      v_shift_id,
      v_business_id,
      v_branch_id,
      v_cash_register_id,
      v_user_id,
      0,
      'VIMDY TEST'
    );

    INSERT INTO public.products(
      id,
      business_id,
      branch_id,
      version,
      data,
      created_at,
      updated_at
    )
    VALUES(
      gen_random_uuid(),
      v_business_id,
      v_branch_id,
      1,
      jsonb_build_object(
        'id', 'PLACEHOLDER',
        'name', 'Producto Test Atomic',
        'price', 1000,
        'taxRate', 0,
        'stock', 20,
        'trackStock', true,
        'active', true,
        'isIngredient', false,
        'requiresKitchen', true,
        'recipe', '[]'::jsonb,
        'productionMode', 'ON_DEMAND'
      ),
      clock_timestamp(),
      clock_timestamp()
    )
    RETURNING id INTO v_product_id;

    UPDATE public.products
    SET data = jsonb_set(data, '{id}', to_jsonb(v_product_id::text), true)
    WHERE id = v_product_id;

    INSERT INTO public.products(
      id,
      business_id,
      branch_id,
      version,
      data,
      created_at,
      updated_at
    )
    VALUES(
      gen_random_uuid(),
      v_business_id,
      v_branch_id,
      1,
      jsonb_build_object(
        'id', 'PLACEHOLDER',
        'name', 'Producto Test Sin Stock',
        'price', 500,
        'taxRate', 0,
        'stock', 0,
        'trackStock', true,
        'active', true,
        'isIngredient', false,
        'requiresKitchen', true,
        'recipe', '[]'::jsonb,
        'productionMode', 'ON_DEMAND'
      ),
      clock_timestamp(),
      clock_timestamp()
    )
    RETURNING id INTO v_low_stock_product_id;

    UPDATE public.products
    SET data = jsonb_set(data, '{id}', to_jsonb(v_low_stock_product_id::text), true)
    WHERE id = v_low_stock_product_id;

    v_pass := v_pass + 1;
    RAISE NOTICE '[PASS] 05_FIXTURES — tenant, sucursal, caja, turno y productos de prueba creados.';
  EXCEPTION
    WHEN OTHERS THEN
      v_fail := v_fail + 1;
      RAISE NOTICE '[FAIL] 05_FIXTURES — %', SQLERRM;
      RAISE NOTICE '[INFO] BLOQUE 2 no puede ejecutar las pruebas dependientes sin fixtures.';
      RAISE NOTICE 'BLOQUE 2 — PASS=% FAIL=%', v_pass, v_fail;
      RETURN;
  END;

  -- 06_PAYMENT_MATRIX -------------------------------------------------------
  BEGIN
    FOR v_method IN
      SELECT unnest(ARRAY['CASH','CARD','TRANSFER','QR','MIXED']::text[])
    LOOP
      v_sale_id := gen_random_uuid();
      v_payment_id := 'sale-payment-' || v_sale_id::text;
      v_cash_amount := CASE
        WHEN v_method = 'CASH' THEN 1000
        WHEN v_method = 'MIXED' THEN 400
        ELSE 0
      END;
      v_reference := CASE
        WHEN v_method IN ('TRANSFER','QR')
          THEN 'PROV-' || v_method || '-' || substr(v_sale_id::text, 1, 8)
        ELSE NULL
      END;

      INSERT INTO public.sales(
        id,
        business_id,
        branch_id,
        version,
        data,
        created_at,
        updated_at
      )
      VALUES(
        v_sale_id,
        v_business_id,
        v_branch_id,
        1,
        jsonb_build_object(
          'id', v_sale_id::text,
          'code', 'PAYTEST-' || substr(v_sale_id::text, 1, 8),
          'status', 'PENDING_PAYMENT',
          'paymentStatus', 'PENDING_VERIFICATION',
          'type', 'QUICK',
          'subtotal', 1000,
          'tax', 0,
          'discount', 0,
          'tip', 0,
          'deliveryFee', 0,
          'total', 1000,
          'items', '[]'::jsonb
        ),
        clock_timestamp(),
        clock_timestamp()
      );

      IF v_method IN ('TRANSFER','QR') THEN
        INSERT INTO public.payment_verifications(
          business_id,
          branch_id,
          sale_id,
          payment_id,
          method,
          amount,
          provider,
          provider_reference,
          status,
          verified_at,
          metadata
        )
        VALUES(
          v_business_id,
          v_branch_id,
          v_sale_id::text,
          v_payment_id,
          v_method,
          1000,
          'VIMDY_TEST_PROVIDER',
          v_reference,
          'CONFIRMED',
          clock_timestamp(),
          jsonb_build_object('test', true, 'method', v_method, 'amount', 1000)
        );
      END IF;

      SELECT *
      INTO v_result
      FROM public.register_sale_payment_atomic(
        v_sale_id::text,
        v_business_id,
        v_branch_id,
        v_payment_id,
        NULL,
        v_method,
        1000,
        v_cash_amount,
        1000,
        0,
        v_reference,
        v_cash_register_id,
        CASE
          WHEN v_method = 'CASH' THEN 'CASH'
          WHEN v_method IN ('CARD','MIXED') THEN 'EXTERNAL_TERMINAL'
          ELSE 'PROVIDER'
        END,
        v_shift_id
      );

      SELECT
        s.data->>'status',
        cm.data->>'paymentMethod',
        (cm.data->>'amount')::numeric,
        COALESCE((cm.data->>'cashAmount')::numeric, 0)
      INTO
        v_status,
        v_persisted_method,
        v_persisted_amount,
        v_persisted_cash_amount
      FROM public.sales s
      JOIN public.cash_movements cm
        ON cm.business_id = v_business_id
       AND cm.branch_id = v_branch_id
       AND cm.idempotency_key = v_payment_id
      WHERE s.id = v_sale_id;

      SELECT count(*)
      INTO v_count
      FROM public.cash_movements
      WHERE business_id = v_business_id
        AND branch_id = v_branch_id
        AND idempotency_key = v_payment_id;

      IF v_count <> 1 THEN
        RAISE EXCEPTION 'METHOD_%: cash_movements=%', v_method, v_count;
      END IF;
      IF v_status IS DISTINCT FROM 'PAID' THEN
        RAISE EXCEPTION 'METHOD_%: status=%', v_method, COALESCE(v_status, 'NULL');
      END IF;
      IF v_persisted_method IS DISTINCT FROM v_method THEN
        RAISE EXCEPTION 'METHOD_%: paymentMethod=%', v_method, COALESCE(v_persisted_method, 'NULL');
      END IF;
      IF abs(v_persisted_amount - 1000) > 0.005 THEN
        RAISE EXCEPTION 'METHOD_%: amount=%', v_method, v_persisted_amount;
      END IF;
      IF abs(v_persisted_cash_amount - v_cash_amount) > 0.005 THEN
        RAISE EXCEPTION 'METHOD_%: cashAmount=%', v_method, v_persisted_cash_amount;
      END IF;
    END LOOP;

    v_pass := v_pass + 1;
    RAISE NOTICE '[PASS] 06_PAYMENT_MATRIX — CASH, CARD, TRANSFER, QR y MIXED procesaron con la firma real de 14 parámetros.';
  EXCEPTION
    WHEN OTHERS THEN
      v_fail := v_fail + 1;
      RAISE NOTICE '[FAIL] 06_PAYMENT_MATRIX — %', SQLERRM;
  END;

  -- 07_PAYMENT_IDEMPOTENCY ---------------------------------------------------
  BEGIN
    v_sale_id := gen_random_uuid();
    v_payment_id := 'idempotent-payment-' || gen_random_uuid()::text;

    INSERT INTO public.sales(
      id,business_id,branch_id,version,data,created_at,updated_at
    )
    VALUES(
      v_sale_id,
      v_business_id,
      v_branch_id,
      1,
      jsonb_build_object(
        'id', v_sale_id::text,
        'status', 'PENDING_PAYMENT',
        'paymentStatus', 'PENDING_VERIFICATION',
        'type', 'QUICK',
        'subtotal', 1000,
        'tax', 0,
        'discount', 0,
        'tip', 0,
        'deliveryFee', 0,
        'total', 1000,
        'items', '[]'::jsonb
      ),
      clock_timestamp(),
      clock_timestamp()
    );

    SELECT *
    INTO v_result
    FROM public.register_sale_payment_atomic(
      v_sale_id::text,
      v_business_id,
      v_branch_id,
      v_payment_id,
      NULL,
      'CASH',
      1000,
      1000,
      1000,
      0,
      NULL,
      v_cash_register_id,
      'CASH',
      v_shift_id
    );

    SELECT count(*)
    INTO v_count_before
    FROM public.cash_movements
    WHERE business_id = v_business_id
      AND branch_id = v_branch_id
      AND idempotency_key = v_payment_id;

    SELECT *
    INTO v_result
    FROM public.register_sale_payment_atomic(
      v_sale_id::text,
      v_business_id,
      v_branch_id,
      v_payment_id,
      NULL,
      'CASH',
      1000,
      1000,
      1000,
      0,
      NULL,
      v_cash_register_id,
      'CASH',
      v_shift_id
    );

    SELECT count(*)
    INTO v_count_after
    FROM public.cash_movements
    WHERE business_id = v_business_id
      AND branch_id = v_branch_id
      AND idempotency_key = v_payment_id;

    IF v_count_before <> 1 OR v_count_after <> 1 THEN
      RAISE EXCEPTION 'Idempotencia financiera %/%', v_count_before, v_count_after;
    END IF;

    v_pass := v_pass + 1;
    RAISE NOTICE '[PASS] 07_PAYMENT_IDEMPOTENCY — el mismo paymentId dos veces deja exactamente un cash_movement.';
  EXCEPTION
    WHEN OTHERS THEN
      v_fail := v_fail + 1;
      RAISE NOTICE '[FAIL] 07_PAYMENT_IDEMPOTENCY — %', SQLERRM;
  END;

  -- 08_PAYMENT_KEY_REUSE ----------------------------------------------------
  BEGIN
    v_sale_id := gen_random_uuid();
    v_sale_id_2 := gen_random_uuid();
    v_payment_id := 'reused-payment-' || gen_random_uuid()::text;
    v_rejected := false;

    INSERT INTO public.sales(
      id,business_id,branch_id,version,data,created_at,updated_at
    )
    VALUES
    (
      v_sale_id,
      v_business_id,
      v_branch_id,
      1,
      jsonb_build_object(
        'id', v_sale_id::text,
        'status', 'PENDING_PAYMENT',
        'paymentStatus', 'PENDING_VERIFICATION',
        'type', 'QUICK',
        'subtotal', 1000,
        'tax', 0,
        'discount', 0,
        'tip', 0,
        'deliveryFee', 0,
        'total', 1000,
        'items', '[]'::jsonb
      ),
      clock_timestamp(),
      clock_timestamp()
    );

    INSERT INTO public.sales(
      id,business_id,branch_id,version,data,created_at,updated_at
    )
    VALUES
    (
      v_sale_id_2,
      v_business_id,
      v_branch_id,
      1,
      jsonb_build_object(
        'id', v_sale_id_2::text,
        'status', 'PENDING_PAYMENT',
        'paymentStatus', 'PENDING_VERIFICATION',
        'type', 'QUICK',
        'subtotal', 1000,
        'tax', 0,
        'discount', 0,
        'tip', 0,
        'deliveryFee', 0,
        'total', 1000,
        'items', '[]'::jsonb
      ),
      clock_timestamp(),
      clock_timestamp()
    );

    SELECT *
    INTO v_result
    FROM public.register_sale_payment_atomic(
      v_sale_id::text,
      v_business_id,
      v_branch_id,
      v_payment_id,
      NULL,
      'CASH',
      1000,
      1000,
      1000,
      0,
      NULL,
      v_cash_register_id,
      'CASH',
      v_shift_id
    );

    BEGIN
      SELECT *
      INTO v_result
      FROM public.register_sale_payment_atomic(
        v_sale_id_2::text,
        v_business_id,
        v_branch_id,
        v_payment_id,
        NULL,
        'CASH',
        1000,
        1000,
        1000,
        0,
        NULL,
        v_cash_register_id,
        'CASH',
        v_shift_id
      );
    EXCEPTION
      WHEN OTHERS THEN
        IF strpos(COALESCE(SQLERRM, ''), 'CAJA_IDEMPOTENCY_KEY_REUSED') > 0 THEN
          v_rejected := true;
        ELSE
          RAISE;
        END IF;
    END;

    IF NOT v_rejected THEN
      RAISE EXCEPTION 'La misma paymentId fue aceptada para otra venta.';
    END IF;

    v_pass := v_pass + 1;
    RAISE NOTICE '[PASS] 08_PAYMENT_KEY_REUSE — una paymentId no puede reutilizarse con otra venta.';
  EXCEPTION
    WHEN OTHERS THEN
      v_fail := v_fail + 1;
      RAISE NOTICE '[FAIL] 08_PAYMENT_KEY_REUSE — %', SQLERRM;
  END;

  -- 09_PAYMENT_ROLLBACK -----------------------------------------------------
  BEGIN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.vimdy_verify_fail_paid_sale()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $body$
      BEGIN
        IF current_setting('vimdy.test_force_payment_failure', true) = '1'
           AND NEW.data->>'status' = 'PAID'
           AND OLD.data->>'status' IS DISTINCT FROM 'PAID'
        THEN
          RAISE EXCEPTION 'VIMDY_TEST_PAYMENT_FAILURE';
        END IF;
        RETURN NEW;
      END;
      $body$;
    $fn$;

    v_fail_paid_trigger_created := true;

    v_sale_id := gen_random_uuid();
    v_payment_id := 'rollback-payment-' || gen_random_uuid()::text;

    INSERT INTO public.sales(
      id,business_id,branch_id,version,data,created_at,updated_at
    )
    VALUES(
      v_sale_id,
      v_business_id,
      v_branch_id,
      1,
      jsonb_build_object(
        'id', v_sale_id::text,
        'status', 'PENDING_PAYMENT',
        'paymentStatus', 'PENDING_VERIFICATION',
        'type', 'QUICK',
        'subtotal', 1000,
        'tax', 0,
        'discount', 0,
        'tip', 0,
        'deliveryFee', 0,
        'total', 1000,
        'items', '[]'::jsonb
      ),
      clock_timestamp(),
      clock_timestamp()
    );

    EXECUTE $trg$
      CREATE TRIGGER vimdy_verify_fail_paid_sale
      BEFORE UPDATE OF data ON public.sales
      FOR EACH ROW
      EXECUTE FUNCTION public.vimdy_verify_fail_paid_sale()
    $trg$;

    PERFORM set_config('vimdy.test_force_payment_failure', '1', true);

    v_rejected := false;
    BEGIN
      PERFORM *
      FROM public.register_sale_payment_atomic(
        v_sale_id::text,
        v_business_id,
        v_branch_id,
        v_payment_id,
        NULL,
        'CASH',
        1000,
        1000,
        1000,
        0,
        NULL,
        v_cash_register_id,
        'CASH',
        v_shift_id
      );
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM = 'VIMDY_TEST_PAYMENT_FAILURE' THEN
          v_rejected := true;
        ELSE
          RAISE;
        END IF;
    END;

    PERFORM set_config('vimdy.test_force_payment_failure', '', true);
    EXECUTE 'DROP TRIGGER IF EXISTS vimdy_verify_fail_paid_sale ON public.sales';
    v_fail_paid_trigger_created := false;

    SELECT data->>'status'
    INTO v_status
    FROM public.sales
    WHERE id = v_sale_id;

    SELECT count(*)
    INTO v_count
    FROM public.cash_movements
    WHERE business_id = v_business_id
      AND branch_id = v_branch_id
      AND idempotency_key = v_payment_id;

    IF NOT v_rejected THEN
      RAISE EXCEPTION 'No ocurrió el fallo controlado.';
    END IF;
    IF v_status IS DISTINCT FROM 'PENDING_PAYMENT' THEN
      RAISE EXCEPTION 'La venta quedó en estado %', COALESCE(v_status, 'NULL');
    END IF;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'Quedó cash_movement tras rollback.';
    END IF;

    v_pass := v_pass + 1;
    RAISE NOTICE '[PASS] 09_PAYMENT_ROLLBACK — el fallo posterior al movimiento financiero revierte cash_movement y PAID.';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config('vimdy.test_force_payment_failure', '', true);
      EXECUTE 'DROP TRIGGER IF EXISTS vimdy_verify_fail_paid_sale ON public.sales';
      v_fail_paid_trigger_created := false;
      v_fail := v_fail + 1;
      RAISE NOTICE '[FAIL] 09_PAYMENT_ROLLBACK — %', SQLERRM;
  END;

  -- 10_FULFILLMENT_IDEMPOTENCY ----------------------------------------------
  BEGIN
    v_sale_id := gen_random_uuid();
    v_payment_id := 'sale-fulfillment-idempotency-' || gen_random_uuid()::text;

    v_payload := jsonb_build_object(
      'id', v_sale_id::text,
      'type', 'QUICK',
      'items', jsonb_build_array(
        jsonb_build_object(
          'productId', v_product_id::text,
          'quantity', 1,
          'price', 1000
        )
      )
    );

    v_first := public.create_sale_fulfillment_atomic(
      v_business_id,
      v_branch_id,
      v_payment_id,
      v_payload
    );

    IF v_first->>'success' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Primer fulfillment falló: %', v_first;
    END IF;

    SELECT (data->>'stock')::numeric
    INTO v_stock_before
    FROM public.products
    WHERE id = v_product_id;

    v_retry := public.create_sale_fulfillment_atomic(
      v_business_id,
      v_branch_id,
      v_payment_id,
      v_payload
    );

    SELECT (data->>'stock')::numeric
    INTO v_stock_after
    FROM public.products
    WHERE id = v_product_id;

    SELECT count(*)
    INTO v_sale_count
    FROM public.sales
    WHERE id = v_sale_id
      AND business_id = v_business_id
      AND branch_id = v_branch_id;

    SELECT count(*)
    INTO v_inventory_count
    FROM public.inventory_movements
    WHERE business_id = v_business_id
      AND branch_id = v_branch_id
      AND data->>'saleId' = v_sale_id::text;

    SELECT count(*)
    INTO v_kitchen_count
    FROM public.kitchen_orders
    WHERE id = v_sale_id
      AND business_id = v_business_id
      AND branch_id = v_branch_id;

    IF v_retry->>'idempotent' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Retry no devolvió idempotent=true: %', v_retry;
    END IF;
    IF v_sale_count <> 1 THEN
      RAISE EXCEPTION 'sales=%', v_sale_count;
    END IF;
    IF abs(v_stock_before - v_stock_after) > 0.005 THEN
      RAISE EXCEPTION 'Stock cambió en retry %/%', v_stock_before, v_stock_after;
    END IF;
    IF v_inventory_count <> 1 THEN
      RAISE EXCEPTION 'inventory_movements=%', v_inventory_count;
    END IF;
    IF v_kitchen_count <> 1 THEN
      RAISE EXCEPTION 'kitchen_orders=%', v_kitchen_count;
    END IF;

    v_pass := v_pass + 1;
    RAISE NOTICE '[PASS] 10_FULFILLMENT_IDEMPOTENCY — mismo saleId + idempotencyKey produce una venta, un movimiento de inventario y una comanda.';
  EXCEPTION
    WHEN OTHERS THEN
      v_fail := v_fail + 1;
      RAISE NOTICE '[FAIL] 10_FULFILLMENT_IDEMPOTENCY — %', SQLERRM;
  END;

  -- 11_FULFILLMENT_ROLLBACK_STOCK -------------------------------------------
  BEGIN
    v_sale_id := gen_random_uuid();
    v_payment_id := 'sale-fulfillment-stock-failure-' || gen_random_uuid()::text;

    v_payload := jsonb_build_object(
      'id', v_sale_id::text,
      'type', 'QUICK',
      'items', jsonb_build_array(
        jsonb_build_object(
          'productId', v_low_stock_product_id::text,
          'quantity', 1,
          'price', 500
        )
      )
    );

    v_result := public.create_sale_fulfillment_atomic(
      v_business_id,
      v_branch_id,
      v_payment_id,
      v_payload
    );

    IF v_result->>'success' IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'Se esperaba success=false: %', v_result;
    END IF;

    IF strpos(COALESCE(v_result->>'error', ''), 'INSUFFICIENT_STOCK') = 0 THEN
      RAISE EXCEPTION 'Error inesperado: %', v_result;
    END IF;

    SELECT count(*) INTO v_sale_count
    FROM public.sales
    WHERE id = v_sale_id;

    SELECT count(*) INTO v_sale_item_count
    FROM public.sale_items
    WHERE sale_id = v_sale_id;

    SELECT count(*) INTO v_inventory_count
    FROM public.inventory_movements
    WHERE business_id = v_business_id
      AND branch_id = v_branch_id
      AND data->>'saleId' = v_sale_id::text;

    SELECT count(*) INTO v_kitchen_count
    FROM public.kitchen_orders
    WHERE id = v_sale_id
      AND business_id = v_business_id
      AND branch_id = v_branch_id;

    SELECT count(*) INTO v_operation_count
    FROM public.sale_fulfillment_operations
    WHERE business_id = v_business_id
      AND branch_id = v_branch_id
      AND idempotency_key = v_payment_id;

    SELECT (data->>'stock')::numeric
    INTO v_stock_after
    FROM public.products
    WHERE id = v_low_stock_product_id;

    IF v_sale_count <> 0
       OR v_sale_item_count <> 0
       OR v_inventory_count <> 0
       OR v_kitchen_count <> 0
       OR v_operation_count <> 0 THEN
      RAISE EXCEPTION
        'Rollback incompleto sales=% items=% inventory=% kitchen=% operation=%',
        v_sale_count,
        v_sale_item_count,
        v_inventory_count,
        v_kitchen_count,
        v_operation_count;
    END IF;

    IF abs(v_stock_after) > 0.005 THEN
      RAISE EXCEPTION 'Stock cambió de 0 a %', v_stock_after;
    END IF;

    v_pass := v_pass + 1;
    RAISE NOTICE '[PASS] 11_FULFILLMENT_ROLLBACK_STOCK — stock insuficiente revierte venta, detalle, Kardex, operación y cocina.';
  EXCEPTION
    WHEN OTHERS THEN
      v_fail := v_fail + 1;
      RAISE NOTICE '[FAIL] 11_FULFILLMENT_ROLLBACK_STOCK — %', SQLERRM;
  END;

  -- 12_FULFILLMENT_ROLLBACK_KITCHEN -----------------------------------------
  BEGIN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.vimdy_verify_fail_kitchen_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $body$
      BEGIN
        IF current_setting('vimdy.test_force_kitchen_failure', true) = '1' THEN
          RAISE EXCEPTION 'VIMDY_TEST_KITCHEN_FAILURE';
        END IF;
        RETURN NEW;
      END;
      $body$;
    $fn$;

    v_fail_kitchen_trigger_created := true;
    v_sale_id := gen_random_uuid();
    v_payment_id := 'sale-fulfillment-kitchen-failure-' || gen_random_uuid()::text;

    SELECT (data->>'stock')::numeric
    INTO v_stock_before
    FROM public.products
    WHERE id = v_product_id;

    v_payload := jsonb_build_object(
      'id', v_sale_id::text,
      'type', 'QUICK',
      'items', jsonb_build_array(
        jsonb_build_object(
          'productId', v_product_id::text,
          'quantity', 1,
          'price', 1000
        )
      )
    );

    EXECUTE $trg$
      CREATE TRIGGER vimdy_verify_fail_kitchen_insert
      BEFORE INSERT ON public.kitchen_orders
      FOR EACH ROW
      EXECUTE FUNCTION public.vimdy_verify_fail_kitchen_insert()
    $trg$;

    PERFORM set_config('vimdy.test_force_kitchen_failure', '1', true);

    v_result := public.create_sale_fulfillment_atomic(
      v_business_id,
      v_branch_id,
      v_payment_id,
      v_payload
    );

    PERFORM set_config('vimdy.test_force_kitchen_failure', '', true);
    EXECUTE 'DROP TRIGGER IF EXISTS vimdy_verify_fail_kitchen_insert ON public.kitchen_orders';
    v_fail_kitchen_trigger_created := false;

    IF v_result->>'success' IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'Se esperaba fallo controlado de cocina: %', v_result;
    END IF;

    SELECT count(*) INTO v_sale_count
    FROM public.sales
    WHERE id = v_sale_id;

    SELECT count(*) INTO v_sale_item_count
    FROM public.sale_items
    WHERE sale_id = v_sale_id;

    SELECT count(*) INTO v_inventory_count
    FROM public.inventory_movements
    WHERE business_id = v_business_id
      AND branch_id = v_branch_id
      AND data->>'saleId' = v_sale_id::text;

    SELECT count(*) INTO v_kitchen_count
    FROM public.kitchen_orders
    WHERE id = v_sale_id
      AND business_id = v_business_id
      AND branch_id = v_branch_id;

    SELECT count(*) INTO v_operation_count
    FROM public.sale_fulfillment_operations
    WHERE business_id = v_business_id
      AND branch_id = v_branch_id
      AND idempotency_key = v_payment_id;

    SELECT (data->>'stock')::numeric
    INTO v_stock_after
    FROM public.products
    WHERE id = v_product_id;

    IF v_sale_count <> 0
       OR v_sale_item_count <> 0
       OR v_inventory_count <> 0
       OR v_kitchen_count <> 0
       OR v_operation_count <> 0 THEN
      RAISE EXCEPTION
        'Rollback cocina incompleto sales=% items=% inventory=% kitchen=% operation=%',
        v_sale_count,
        v_sale_item_count,
        v_inventory_count,
        v_kitchen_count,
        v_operation_count;
    END IF;

    IF abs(v_stock_before - v_stock_after) > 0.005 THEN
      RAISE EXCEPTION 'Stock no revirtió %/%', v_stock_before, v_stock_after;
    END IF;

    v_pass := v_pass + 1;
    RAISE NOTICE '[PASS] 12_FULFILLMENT_ROLLBACK_KITCHEN — fallo de cocina revierte venta, sale_items, stock, Kardex y ledger.';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config('vimdy.test_force_kitchen_failure', '', true);
      EXECUTE 'DROP TRIGGER IF EXISTS vimdy_verify_fail_kitchen_insert ON public.kitchen_orders';
      v_fail_kitchen_trigger_created := false;
      v_fail := v_fail + 1;
      RAISE NOTICE '[FAIL] 12_FULFILLMENT_ROLLBACK_KITCHEN — %', SQLERRM;
  END;

  -- Limpieza defensiva de triggers/funciones auxiliares dentro de la misma
  -- transacción. El ROLLBACK final también garantiza que nada quede persistido.
  IF v_fail_paid_trigger_created THEN
    EXECUTE 'DROP TRIGGER IF EXISTS vimdy_verify_fail_paid_sale ON public.sales';
  END IF;
  IF v_fail_kitchen_trigger_created THEN
    EXECUTE 'DROP TRIGGER IF EXISTS vimdy_verify_fail_kitchen_insert ON public.kitchen_orders';
  END IF;

  EXECUTE 'DROP FUNCTION IF EXISTS public.vimdy_verify_fail_paid_sale()';
  EXECUTE 'DROP FUNCTION IF EXISTS public.vimdy_verify_fail_kitchen_insert()';

  RAISE NOTICE 'BLOQUE 2 — PASS=% FAIL=%', v_pass, v_fail;
END;
$$;

-- ============================================================================
-- BLOQUE 3 — AISLAMIENTO MULTI-TENANT + BRANCH
-- ============================================================================
DO $$
DECLARE
  v_user_id uuid;
  v_business_id uuid;
  v_branch_id uuid;
  v_other_branch_id uuid;
  v_foreign_business_id uuid;
  v_foreign_branch_id uuid;
  v_cash_register_id uuid;
  v_shift_id uuid;
  v_sale_id uuid;
  v_payment_id text;
  v_result record;
  v_rejected boolean := false;
  v_foreign_visible integer := 0;
  v_wrong_branch_movements integer := 0;
  v_pass integer := 0;
  v_fail integer := 0;
BEGIN
  -- Fixtures independientes de este bloque: no usa estado de otro DO.
  BEGIN
    SELECT id
    INTO v_user_id
    FROM auth.users
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'No existe ningún usuario en auth.users.';
    END IF;

    PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    INSERT INTO public.businesses(
      name,plan,trial_ends_at,timezone,subscription_status,currency,tax_rate,inventory_type
    )
    VALUES(
      'VIMDY TEST ISOLATION ' || substr(gen_random_uuid()::text, 1, 8),
      'trial',
      clock_timestamp() + interval '30 days',
      'America/Bogota',
      'trial',
      'COP',
      0,
      'productos'
    )
    RETURNING id INTO v_business_id;

    INSERT INTO public.branches(business_id,name,active)
    VALUES(v_business_id,'Sucursal Isolation Principal',true)
    RETURNING id INTO v_branch_id;

    INSERT INTO public.branches(business_id,name,active)
    VALUES(v_business_id,'Sucursal Isolation Secundaria',true)
    RETURNING id INTO v_other_branch_id;

    INSERT INTO public.business_members(user_id,business_id,role)
    VALUES(v_user_id,v_business_id,'CAJERO');

    INSERT INTO public.cash_registers(
      business_id,branch_id,code,name,active,status,data
    )
    VALUES(
      v_business_id,
      v_branch_id,
      'ISO-' || substr(gen_random_uuid()::text, 1, 8),
      'Caja Isolation',
      true,
      'ACTIVE',
      '{}'::jsonb
    )
    RETURNING id INTO v_cash_register_id;

    v_shift_id := gen_random_uuid();
    PERFORM public.open_shift_atomic(
      v_shift_id,
      v_business_id,
      v_branch_id,
      v_cash_register_id,
      v_user_id,
      0,
      'VIMDY ISOLATION TEST'
    );

    INSERT INTO public.businesses(
      name,plan,trial_ends_at,timezone,subscription_status,currency,tax_rate,inventory_type
    )
    VALUES(
      'VIMDY TEST FOREIGN ' || substr(gen_random_uuid()::text, 1, 8),
      'trial',
      clock_timestamp() + interval '30 days',
      'America/Bogota',
      'trial',
      'COP',
      0,
      'productos'
    )
    RETURNING id INTO v_foreign_business_id;

    INSERT INTO public.branches(business_id,name,active)
    VALUES(v_foreign_business_id,'Sucursal Foreign Test',true)
    RETURNING id INTO v_foreign_branch_id;

    INSERT INTO public.sales(
      id,business_id,branch_id,version,data,created_at,updated_at
    )
    VALUES(
      gen_random_uuid(),
      v_foreign_business_id,
      v_foreign_branch_id,
      1,
      jsonb_build_object(
        'status','PENDING_PAYMENT',
        'type','QUICK',
        'subtotal',1000,
        'tax',0,
        'discount',0,
        'tip',0,
        'total',1000,
        'items','[]'::jsonb
      ),
      clock_timestamp(),
      clock_timestamp()
    );

    EXECUTE 'SET LOCAL ROLE authenticated';

    SELECT count(*)
    INTO v_foreign_visible
    FROM public.sales
    WHERE business_id = v_foreign_business_id;

    EXECUTE 'RESET ROLE';

    IF v_foreign_visible <> 0 THEN
      RAISE EXCEPTION
        'El tenant extranjero es visible con authenticated: % filas',
        v_foreign_visible;
    END IF;

    v_sale_id := gen_random_uuid();
    v_payment_id := 'branch-isolation-' || gen_random_uuid()::text;

    INSERT INTO public.sales(
      id,business_id,branch_id,version,data,created_at,updated_at
    )
    VALUES(
      v_sale_id,
      v_business_id,
      v_branch_id,
      1,
      jsonb_build_object(
        'id',v_sale_id::text,
        'status','PENDING_PAYMENT',
        'paymentStatus','PENDING_VERIFICATION',
        'type','QUICK',
        'subtotal',1000,
        'tax',0,
        'discount',0,
        'tip',0,
        'deliveryFee',0,
        'total',1000,
        'items','[]'::jsonb
      ),
      clock_timestamp(),
      clock_timestamp()
    );

    BEGIN
      SELECT *
      INTO v_result
      FROM public.register_sale_payment_atomic(
        v_sale_id::text,
        v_business_id,
        v_other_branch_id,
        v_payment_id,
        NULL,
        'CASH',
        1000,
        1000,
        1000,
        0,
        NULL,
        v_cash_register_id,
        'CASH',
        v_shift_id
      );
    EXCEPTION
      WHEN OTHERS THEN
        IF strpos(COALESCE(SQLERRM,''),'SALE_NOT_FOUND') > 0
           OR strpos(COALESCE(SQLERRM,''),'CAJA_INVALID_BRANCH') > 0 THEN
          v_rejected := true;
        ELSE
          RAISE;
        END IF;
    END;

    SELECT count(*)
    INTO v_wrong_branch_movements
    FROM public.cash_movements
    WHERE business_id = v_business_id
      AND branch_id = v_other_branch_id
      AND idempotency_key = v_payment_id;

    IF NOT v_rejected THEN
      RAISE EXCEPTION 'La RPC aceptó una branch diferente a la de la venta.';
    END IF;

    IF v_wrong_branch_movements <> 0 THEN
      RAISE EXCEPTION 'Se creó movimiento en branch incorrecta.';
    END IF;

    v_pass := v_pass + 1;
    RAISE NOTICE '[PASS] 13_RLS_AND_BRANCH_ISOLATION — tenant extranjero no visible y cobro con branch incorrecta rechazado.';
  EXCEPTION
    WHEN OTHERS THEN
      EXECUTE 'RESET ROLE';
      v_fail := v_fail + 1;
      RAISE NOTICE '[FAIL] 13_RLS_AND_BRANCH_ISOLATION — %', SQLERRM;
  END;

  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'BLOQUE 3 — PASS=% FAIL=%', v_pass, v_fail;
END;
$$;

-- Todo lo creado por los tests (fixtures, triggers y funciones auxiliares)
-- desaparece aquí. El validador no deja basura en el proyecto.
ROLLBACK;
