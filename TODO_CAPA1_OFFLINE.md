# Capa 1 — Offline-first (LO QUE FALTA)

## Objetivo
Que un sábado a las 8pm, con el local lleno y sin internet, el POS siga vendiendo, cobrando, enviando a cocina y abriendo/cerrando mesas sin perder datos. Al recuperar conexión, todo se sincroniza solo, sin duplicados ni conflictos.

## Estado actual
- Base existe: `offlineSale`, `offlineTable`, `pendingSalesStore`, `pendingTableOperationsQueue`, `syncPendingSales`, `syncPendingTableOperations`.
- Faltan: catálogo offline, inventario offline, cola de cocina offline, sincronización multi-dispositivo, y E2E de escenario real offline.

## Plan exacto

### 1. Catálogo e inventario offline
- [ ] Cachear productos/categorías en IndexedDB (`productCatalogStore`) al cargar.
- [ ] Lectura sin conexión: si no hay red, servir desde cache + memoria.
- [ ] Sincronizar cambios de catálogo al recuperar conexión (sin sobrescribir cambios locales).

### 2. Venta offline completa
- [ ] `processSale` debe detectar `!connectionStore.isOnline()` y encolar en `pendingSalesStore`.
- [ ] Al recuperar conexión, `syncPendingSales` envía cola automáticamente.
- [ ] Validar idempotencia: misma `saleId` no duplica inventario ni caja.
- [ ] Mostrar badge/pending count en UI cuando haya ventas pendientes.

### 3. Cocina offline
- [ ] Si no hay red al enviar a cocina, guardar comanda local con status `PENDING_SYNC`.
- [ ] Al reconectar, empujar comandas pendientes a Supabase/KitchenEngine.
- [ ] UI Cocina debe mostrar items pendientes de sincronización.

### 4. Mesas offline
- [ ] `openTable` sin red → encolar en `pendingTableOperationsStore`.
- [ ] `closeTable` sin red → encolar operación.
- [ ] `addItem`/`removeItem` en mesas sin red → optimista local + cola.
- [ ] Al reconectar, ejecutar cola en orden, resolviendo conflictos por `version`.

### 5. Sincronización robusta
- [ ] Cola única por dispositivo con orden de operaciones.
- [ ] Detectar conflicto de versión y pedir reload (ya existe `OptimisticLockError`).
- [ ] Reintentos exponenciales con backoff.
- [ ] Logging de sync para debugging.

### 6. Pruebas E2E offline
- [ ] Simular caída de red en Playwright.
- [ ] Vender sin conexión → validar encolado.
- [ ] Recuperar conexión → validar sincronización.
- [ ] Validar no-duplicidad de inventario, caja y comandas.

## Criterio de aceptación
1. Un vendedor puede cobrar 3 ventas sin internet.
2. Al recuperar conexión, las 3 ventas aparecen en Supabase sin duplicados.
3. El inventario se descuenta exactamente una vez por venta.
4. Las comandas de cocina llegan en el orden correcto.
5. Si hay conflicto de versión, el usuario ve un mensaje claro y puede recargar.

## Estimación
- Items 1-5: ~2-3 días de desarrollo intensivo.
- Item 6: ~1 día de pruebas E2E.
- Total: ~3-4 días hábiles.
