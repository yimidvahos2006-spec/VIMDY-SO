# VIMDY OS — Prueba offline E2E (10 minutos)

## Objetivo
Confirmar que el flujo offline funciona sin duplicados ni data loss al reconectar.

## Checklist previo
- [ ] Dispositivo con VIMDY cargado y logueado
- [ ] Conexión a internet establecida
- [ ] Acceso a Supabase SQL Editor para verificar datos

## Pasos

### 1. Preparar estado inicial
1. Abrir VIMDY en el navegador
2. Anotar el `business_id` del negocio (lo podés ver en Configuración > Negocio)
3. Tomar nota de cuántas ventas hay en Supabase:
   ```sql
   select count(*) from sales where business_id = '<tu-business-id>';
   ```

### 2. Simular offline
1. Apagar wifi o activar modo avión
2. Confirmar que aparece el badge "Sin conexión" en VIMDY

### 3. Ejecutar flujo offline
1. **Venta rápida**: crear una venta con 1 producto, pagarla en efectivo
2. **Mesa**: abrir una mesa, agregar 1 producto, enviar a cocina
3. **Inventario**: ajustar stock de un producto (entrada o salida)
4. **Cliente**: crear un cliente nuevo
5. Confirmar que todas las operaciones quedan en cola (badge de pendientes debe aparecer)

### 4. Reconectar
1. Encender wifi o desactivar modo avión
2. Esperar 30 segundos a que se sincronice
3. Confirmar que el badge "Sin conexión" desaparece
4. Confirmar que los toasts de sincronización aparecen

### 5. Verificar en Supabase (sin duplicados)
Ejecutar estas queries en el SQL Editor:

```sql
-- Ventas: debe haber exactamente 1 venta nueva (la del paso 3)
select id, code, total, created_at
from sales
where business_id = '<tu-business-id>'
order by created_at desc
limit 5;

-- Órdenes de cocina: debe haber exactamente 1 orden nueva
select id, table_id, status, created_at
from kitchen_orders
where business_id = '<tu-business-id>'
order by created_at desc
limit 5;

-- Movimientos de inventario: debe haber exactamente 1 movimiento nuevo
select id, type, quantity, created_at
from inventory_movements
where business_id = '<tu-business-id>'
order by created_at desc
limit 5;

-- Clientes: debe haber exactamente 1 cliente nuevo
select id, name, created_at
from customers
where business_id = '<tu-business-id>'
order by created_at desc
limit 5;

-- Colas offline: deben estar vacías
select count(*) from pending_sales where business_id = '<tu-business-id>';
select count(*) from pending_table_operations where business_id = '<tu-business-id>';
select count(*) from pending_inventory_adjustments where business_id = '<tu-business-id>';
select count(*) from pending_customer_operations where business_id = '<tu-business-id>';
```

## Criterios de éxito
- [ ] No hay duplicados en `sales`, `kitchen_orders`, `inventory_movements`, `customers`
- [ ] Todas las tablas `pending_*` tienen 0 filas para el negocio
- [ ] Los totales en el Dashboard coinciden con lo vendido offline
- [ ] No hay errores en la consola del navegador

## Si algo falla
1. Revisar `opsLogger` en la consola del navegador
2. Verificar en Supabase `system_errors` si hay errores de sync
3. Reportar con captura de pantalla de la consola y las queries de verificación
