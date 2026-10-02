BEGIN;

DO $migration$
DECLARE
  v_function regprocedure;
  v_definition text;
  v_updated_definition text;
  v_cashier_guard text := 'ARRAY[''ADMIN'',''CAJERO'']';
  v_manager_guard text := 'ARRAY[''ADMIN'',''CAJERO'',''GERENTE'']';
  v_functions regprocedure[] := ARRAY[
    'public.open_shift_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text)'::regprocedure,
    'public.register_movement_atomic(text,uuid,uuid,text,numeric,text,text,numeric,text,timestamptz,uuid,text)'::regprocedure,
    'public.register_sale_payment_atomic(text,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,text,uuid,text,uuid)'::regprocedure
  ];
BEGIN
  FOREACH v_function IN ARRAY v_functions LOOP
    v_definition := pg_get_functiondef(v_function);
    IF strpos(v_definition, v_cashier_guard) = 0 THEN
      RAISE EXCEPTION 'Expected cash role guard not found in %', v_function;
    END IF;

    v_updated_definition := replace(v_definition, v_cashier_guard, v_manager_guard);
    IF v_updated_definition = v_definition THEN
      RAISE EXCEPTION 'Cash role guard was not updated in %', v_function;
    END IF;

    EXECUTE v_updated_definition;
  END LOOP;
END;
$migration$;

COMMIT;