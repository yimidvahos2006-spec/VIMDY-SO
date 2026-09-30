-- ============================================================================
-- VIMDY OS — Migración: Arquitectura de Configuración de Operación
-- ----------------------------------------------------------------------------
-- Fecha: 2026-08-26
-- Propósito: Agregar campos para configuración flexible de operación del negocio.
--
-- PRINCIPIO: VIMDY NO decide cómo funciona un negocio.
-- Estos campos almacenan las decisiones EXPLÍCITAS del usuario.
--
-- Para negocios existentes:
--   - Se conserva toda la configuración actual
--   - Solo se migra lo que pueda determinarse con certeza desde datos REALES
--   - Lo que no se puede determinar queda como NULL (pendiente de revisión)
--   - Los UPDATEs solo afectan filas con valores por defecto/no configurados
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CANALES DE VENTA
--    ¿Dónde vende el negocio? (independiente de módulos operativos)
--    Valores: 'presencial', 'llevar', 'domicilio', 'web', 'plataformas'
-- ----------------------------------------------------------------------------
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS sales_channels text[] NOT NULL DEFAULT '{}';

-- ----------------------------------------------------------------------------
-- 2. TIPO DE INVENTARIO
--    ¿Qué maneja el negocio en inventario?
--    Valores: 'ingredientes', 'productos', 'ambos'
--    NULL = pendiente de configurar (no se deduce de business_type)
-- ----------------------------------------------------------------------------
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS inventory_type text;

-- ----------------------------------------------------------------------------
-- 3. MODO DE PRODUCCIÓN
--    ¿Cómo produce el negocio?
--    Valores: 'on_demand', 'batch', 'ambos'
--    NULL = pendiente de configurar
-- ----------------------------------------------------------------------------
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS production_mode text;

-- ----------------------------------------------------------------------------
-- 4. KDS (PANTALLA) E IMPRESORA
--    Son INDEPENDIENTES y pueden coexistir.
--    Se activan SOLO si el negocio tiene cocina.
--    Default: false (NO activar automáticamente)
-- ----------------------------------------------------------------------------
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS kds_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS printer_enabled boolean NOT NULL DEFAULT false;

-- ============================================================================
-- 5. MIGURACIÓN SEGURA DE DATOS EXISTENTES
--    NO deducir operación desde business_type.
--    Solo migrar lo que pueda determinarse con certeza desde datos REALES.
--    Cada UPDATE incluye WHERE para preservar valores explícitos del usuario.
-- ============================================================================

-- 5a. Canales de venta: basarse en enabled_modules (fuente de verdad real)
--     Si tiene mesas → probablemente vende presencial + llevar
--     Si solo tiene pedidos → probablemente llevar
--     Default conservador: solo 'presencial'
--     WHERE: solo actualiza si todavía tiene el valor por defecto ('{}')
UPDATE businesses SET
  sales_channels = CASE
    WHEN enabled_modules @> ARRAY['mesas'] AND enabled_modules @> ARRAY['pedidos']
      THEN ARRAY['presencial', 'llevar']
    WHEN enabled_modules @> ARRAY['pedidos']
      THEN ARRAY['presencial', 'llevar']
    ELSE ARRAY['presencial']
  END
WHERE sales_channels = '{}';

-- 5b. Inventario: basarse en enabled_modules (fuente de verdad real)
--     Si tiene módulo 'inventario' activo → 'ambos' (asume manejo completo)
--     Si no → NULL (pendiente, no sabemos qué tipo maneja)
--     WHERE: solo actualiza si el valor es NULL (no configurado todavía)
UPDATE businesses SET
  inventory_type = CASE
    WHEN enabled_modules @> ARRAY['inventario'] THEN 'ambos'
    ELSE NULL
  END
WHERE inventory_type IS NULL;

-- 5c. KDS/Impresora: basarse en salida_cocina (fuente de verdad real)
--     Solo para negocios que TIENEN cocina activa
--     WHERE: solo actualiza si ambos valores están en default (false).
--            Si el usuario configuró explícitamente kds_enabled=true,
--            no se sobrescribe.
UPDATE businesses SET
  kds_enabled = (salida_cocina = 'pantalla' OR salida_cocina IS NULL),
  printer_enabled = (salida_cocina = 'impresora')
WHERE enabled_modules @> ARRAY['cocina']
  AND kds_enabled = false
  AND printer_enabled = false;

-- 5d. Negocios SIN cocina: asegurar KDS e impresora en false
--     WHERE: solo actualiza si alguno está incorrectamente en true.
--            Si ya están en false, no se tocan.
UPDATE businesses SET
  kds_enabled = false,
  printer_enabled = false
WHERE NOT (enabled_modules @> ARRAY['cocina'])
  AND (kds_enabled = true OR printer_enabled = true);

-- ============================================================================
-- 6. VERIFICACIÓN (descomentar para verificar migración)
-- ============================================================================
-- SELECT
--   id,
--   name,
--   business_type,
--   enabled_modules,
--   sales_channels,
--   inventory_type,
--   kds_enabled,
--   printer_enabled
-- FROM businesses;
