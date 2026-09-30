/**
 * operation.ts
 * ---------------------------------------------------------------------------
 * Types para la configuración de operación del negocio.
 *
 * Estos types representan las decisiones EXPLÍCITAS del usuario sobre
 * cómo funciona su negocio. No se deducen del tipo de negocio.
 */

/**
 * Canales de venta: ¿Dónde vende el negocio?
 * 'presencial' = en el local físicamente
 * 'llevar' = pedidos para recoger
 * 'domicilio' = entrega a domicilio
 * 'web' = venta en página web propia
 * 'plataformas' = Rappi, UberEats, etc.
 */
export type SalesChannel =
  | 'presencial'
  | 'llevar'
  | 'domicilio'
  | 'web'
  | 'plataformas';

export const SALES_CHANNEL_LABELS: Record<SalesChannel, string> = {
  presencial: 'En el local',
  llevar: 'Para llevar',
  domicilio: 'Domicilio',
  web: 'Página web',
  plataformas: 'Plataformas externas',
};

export const SALES_CHANNEL_OPTIONS: ReadonlyArray<{ value: SalesChannel; label: string; emoji: string }> = [
  { value: 'presencial', label: 'En el local', emoji: '🏪' },
  { value: 'llevar', label: 'Para llevar', emoji: '🛍️' },
  { value: 'domicilio', label: 'Domicilio', emoji: '🛵' },
  { value: 'web', label: 'Página web', emoji: '🌐' },
  { value: 'plataformas', label: 'Rappi / UberEats', emoji: '📱' },
];

/**
 * Tipo de inventario: ¿Qué maneja el negocio?
 * 'ingredientes' = materias primas
 * 'productos' = productos terminados
 * 'ambos' = ingredientes + productos terminados
 * null = pendiente de configurar
 */
export type InventoryType = 'ingredientes' | 'productos' | 'ambos';

export const INVENTORY_TYPE_OPTIONS: ReadonlyArray<{ value: InventoryType; label: string; description: string }> = [
  { value: 'ingredientes', label: 'Ingredientes', description: 'Materias primas como harina, carne, vegetales' },
  { value: 'productos', label: 'Productos terminados', description: 'Productos listos para vender' },
  { value: 'ambos', label: 'Ambos', description: 'Ingredientes y productos terminados' },
];

/**
 * Modo de producción: ¿Cómo produce el negocio?
 * 'on_demand' = bajo pedido (prepara al vender)
 * 'batch' = por lotes (produce antes de vender)
 * 'ambos' = ambos modos
 * null = pendiente de configurar
 */
export type ProductionMode = 'on_demand' | 'batch' | 'ambos';

export const PRODUCTION_MODE_OPTIONS: ReadonlyArray<{ value: ProductionMode; label: string; description: string }> = [
  { value: 'on_demand', label: 'Bajo pedido', description: 'Prepara cada producto al momento de la venta' },
  { value: 'batch', label: 'Por lotes', description: 'Produce por anticipado en cantidades' },
  { value: 'ambos', label: 'Ambos', description: 'Combina producción bajo pedido y por lotes' },
];

/**
 * Configuración completa de operación del negocio.
 * Se guarda en Supabase y se sincroniza con stores locales.
 */
export interface OperationConfig {
  /** Canales de venta activos */
  salesChannels: SalesChannel[];
  /** Tipo de inventario (null = pendiente) */
  inventoryType: InventoryType | null;
  /** Modo de producción (null = pendiente) */
  productionMode: ProductionMode | null;
  /** KDS/pantalla activo (solo si tiene cocina) */
  kdsEnabled: boolean;
  /** Impresora de cocina activa (solo si tiene cocina) */
  printerEnabled: boolean;
}

/**
 * Configuración por defecto para un negocio nuevo.
 * Todo en estado "pendiente" para que el onboarding pregunte.
 */
export const DEFAULT_OPERATION_CONFIG: OperationConfig = {
  salesChannels: [],
  inventoryType: null,
  productionMode: null,
  kdsEnabled: false,
  printerEnabled: false,
};

/**
 * Respuestas del onboarding que determinan la configuración.
 */
export interface OnboardingAnswers {
  salesChannels: SalesChannel[];
  hasTables: boolean | null;      // null = "configurar después"
  hasStaff: boolean | null;       // null = "configurar después"
  hasKitchen: boolean | null;     // null = "configurar después"
  hasInventory: boolean | null;   // null = "configurar después"
  useCustomers: boolean | null;   // null = "configurar después"
  inventoryType: InventoryType | null;
  productionMode: ProductionMode | null;
  kitchenOutput: 'kds' | 'printer' | 'ambos' | null;  // null = "configurar después"
}

/**
 * Calcula los módulos activos basándose en las respuestas del onboarding.
 * NO usa business_type para decidir.
 */
export function calculateModulesFromAnswers(answers: OnboardingAnswers): string[] {
  const modules: string[] = ['caja', 'pedidos']; // Siempre activos

  if (answers.hasTables === true) modules.push('mesas');
  if (answers.hasKitchen === true) modules.push('cocina');
  if (answers.hasInventory === true) modules.push('inventario');
  if (answers.useCustomers === true) modules.push('clientes');

  return modules;
}

/**
 * Calcula la configuración de operación basándose en las respuestas.
 */
export function calculateOperationConfigFromAnswers(answers: OnboardingAnswers): OperationConfig {
  return {
    salesChannels: answers.salesChannels,
    inventoryType: answers.hasInventory === true ? (answers.inventoryType ?? null) : null,
    productionMode: answers.hasInventory === true ? (answers.productionMode ?? null) : null,
    kdsEnabled: answers.hasKitchen === true && (answers.kitchenOutput === 'kds' || answers.kitchenOutput === 'ambos'),
    printerEnabled: answers.hasKitchen === true && (answers.kitchenOutput === 'printer' || answers.kitchenOutput === 'ambos'),
  };
}
