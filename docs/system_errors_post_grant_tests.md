# BLOQUE 4 — Pruebas post-GRANT

Ejecutar estas pruebas desde el navegador con sesión autenticada real (`yimidvahos2006@gmail.com`, `business_id = 5ccff48a-45b2-43f9-ab52-fcc191f5ee72`).

## Prueba 1 — INSERT tenant actual
**Esperado:** éxito
**Código:**
```javascript
const { supabase } = await import('/src/infrastructure/supabase/supabaseClient');
const { data, error } = await supabase
  .from('system_errors')
  .insert({
    business_id: '5ccff48a-45b2-43f9-ab52-fcc191f5ee72',
    message: 'test-insercion-ok',
    severity: 'error',
    category: 'test',
    source: 'web',
    context: { test: true }
  })
  .select();
```

## Prueba 2 — INSERT business_id = NULL
**Esperado:** éxito
**Código:**
```javascript
const { supabase } = await import('/src/infrastructure/supabase/supabaseClient');
const { data, error } = await supabase
  .from('system_errors')
  .insert({
    business_id: null,
    message: 'test-insercion-null',
    severity: 'warning',
    category: 'test',
    source: 'web',
    context: { test: true }
  })
  .select();
```

## Prueba 3 — INSERT otro tenant
**Esperado:** rechazo por RLS
**Código:**
```javascript
const { supabase } = await import('/src/infrastructure/supabase/supabaseClient');
const { data, error } = await supabase
  .from('system_errors')
  .insert({
    business_id: '11111111-1111-1111-1111-111111111111',
    message: 'test-insercion-other-tenant',
    severity: 'error',
    category: 'test',
    source: 'web',
    context: { test: true }
  })
  .select();
```

## Prueba 4 — SELECT
**Esperado:** rechazo
**Código:**
```javascript
const { supabase } = await import('/src/infrastructure/supabase/supabaseClient');
const { data, error } = await supabase
  .from('system_errors')
  .select('*')
  .limit(1);
```

## Prueba 5 — UPDATE
**Esperado:** rechazo
**Código:**
```javascript
const { supabase } = await import('/src/infrastructure/supabase/supabaseClient');
const { data, error } = await supabase
  .from('system_errors')
  .update({ message: 'test-update' })
  .eq('id', '00000000-0000-0000-0000-000000000000');
```

## Prueba 6 — DELETE
**Esperado:** rechazo
**Código:**
```javascript
const { supabase } = await import('/src/infrastructure/supabase/supabaseClient');
const { data, error } = await supabase
  .from('system_errors')
  .delete()
  .eq('id', '00000000-0000-0000-0000-000000000000');
```

## Formato de reporte
Para cada prueba registrar:
- `status`: executed / exception
- `data`: resultado
- `error.code`: código Postgres/Supabase
- `error.message`: mensaje exacto
- `PASS/FAIL`: comparación contra esperado
