// src/infrastructure/di/CompositionRoot.ts
import { ProductRepository } from './repositories/ProductRepository';
import { SaleRepository } from './repositories/SaleRepository';
import { CustomerRepository } from './repositories/CustomerRepository';
import { KitchenOrderRepository } from './repositories/KitchenOrderRepository';
import { AlertRepository } from './repositories/AlertRepository';
import { MovementRepository } from './repositories/MovementRepository';
import { CashMovementRepository } from './repositories/CashMovementRepository';
import { TableRepository } from './repositories/TableRepository';
import { OrderRepository } from './repositories/OrderRepository';
import { ShiftRepository } from './repositories/ShiftRepository';
import { UserRepository } from './repositories/UserRepository';
import { RoleRepository } from './repositories/RoleRepository';
import { PermissionRepository } from './repositories/PermissionRepository';
import { AuditLogRepository } from './repositories/AuditLogRepository';
import { CategoryRepository } from './repositories/CategoryRepository';
import { SupplierRepository } from './repositories/SupplierRepository';
import { PurchaseOrderRepository } from './repositories/PurchaseOrderRepository';
import { BusinessSnapshotRepository } from './repositories/BusinessSnapshotRepository';
import { NotificationRepository } from './repositories/NotificationRepository';
import { WaiterRepository } from './repositories/WaiterRepository';
import { ReceiptRepository } from './repositories/ReceiptRepository';

import { InventoryEngine } from '../../core/engines/InventoryEngine';
import { RecipeEngine } from '../../core/engines/RecipeEngine';
import { PurchaseIntelligenceEngine } from '../../core/engines/PurchaseIntelligenceEngine';
import { PurchaseOrderEngine } from '../../core/engines/PurchaseOrderEngine';
import { ForecastEngine } from '../../core/engines/ForecastEngine';
import { CategoryEngine } from '../../core/engines/CategoryEngine';
import { SupplierEngine } from '../../core/engines/SupplierEngine';
import { WaiterEngine } from '../../core/engines/WaiterEngine';
import { KardexEngine } from '../../core/engines/KardexEngine';
import { HealthEngine } from '../../core/engines/HealthEngine';
import { DashboardEngine } from '../../core/engines/DashboardEngine';
import { AIEngine } from '../../core/engines/AIEngine';
import { CustomerEngine } from '../../core/engines/CustomerEngine';
import { KitchenEngine } from '../../core/engines/KitchenEngine';
import { CartEngine } from '../../core/engines/CartEngine';
import { PaymentEngine } from '../../core/engines/PaymentEngine';
import { ReceiptEngine } from '../../core/engines/ReceiptEngine';
import { CashEngine } from '../../core/engines/CashEngine';
import { AlertEngine } from '../../core/engines/AlertEngine';
import { PosCore } from '../../core/engines/PosCore';
import { SalesEngine } from '../../core/engines/SalesEngine';
import { TableEngine } from '../../core/engines/TableEngine';
import { OrderEngine } from '../../core/engines/OrderEngine';
import { ShiftEngine } from '../../core/engines/ShiftEngine';
import { PermissionEngine } from '../../core/engines/PermissionEngine';
import { RoleEngine } from '../../core/engines/RoleEngine';
import { AuditEngine } from '../../core/engines/AuditEngine';
import { UserEngine } from '../../core/engines/UserEngine';
import { AccessEngine } from '../../core/engines/AccessEngine';

import { seedIdentity } from './seedIdentity';
import { companyConfigStore } from '../../core/store/companyConfigStore';
import { vimdyCore } from '../../core/VimdyCore';

import { DashboardService } from '../../application/services/DashboardService';
import { InventoryService } from '../../application/services/InventoryService';
import { CustomerService } from '../../application/services/CustomerService';
import { KitchenService } from '../../application/services/KitchenService';
import { CopilotService } from '../../application/services/CopilotService';
import { CopilotEngine } from '../../core/engines/CopilotEngine';
import { BusinessAnalyzer } from '../../core/engines/BusinessAnalyzer';
import { QuestionRouter } from '../../core/engines/QuestionRouter';
import { PatternLearningEngine } from '../../core/engines/PatternLearningEngine';
import { CommandEngine } from '../../core/engines/CommandEngine';
import { CopilotApiClient } from './CopilotApiClient';
import { logError } from "../logging/opsLogger";

// --------------------
// REPOS
// --------------------
const productRepo = new ProductRepository();
const saleRepo = new SaleRepository();
const customerRepo = new CustomerRepository();
const kitchenRepo = new KitchenOrderRepository();
const alertRepo = new AlertRepository();
const movementRepo = new MovementRepository();
const cashMovementRepo = new CashMovementRepository();
const tableRepo = new TableRepository();
const orderRepo = new OrderRepository();
const shiftRepo = new ShiftRepository();
const userRepo = new UserRepository();
const roleRepo = new RoleRepository();
const permissionRepo = new PermissionRepository();
const auditLogRepo = new AuditLogRepository();
const categoryRepo = new CategoryRepository();
const supplierRepo = new SupplierRepository();
// PASO 2.7 (Compras Inteligentes): el engine se conecta en la tarea 2.
const purchaseOrderRepo = new PurchaseOrderRepository();
const businessSnapshotRepo = new BusinessSnapshotRepository();
const notificationRepo = new NotificationRepository();
const waiterRepo = new WaiterRepository();
const receiptRepo = new ReceiptRepository();

// --------------------
// ENGINES — identidad, roles, permisos, autenticación, auditoría
// --------------------
const permissionEngine = new PermissionEngine(permissionRepo);
const roleEngine = new RoleEngine(roleRepo, permissionEngine);
const auditEngine = new AuditEngine(auditLogRepo);
const userEngine = new UserEngine(userRepo, roleEngine, auditEngine);
const accessEngine = new AccessEngine(userEngine, roleEngine);

/**
 * Catálogo de permisos + roles base (ADMIN, CAJERO, MESERO, etc). Este
 * catálogo es fijo y del sistema (no es dato de un negocio), así que sí
 * se sigue sembrando una sola vez al arrancar.
 *
 * Antes, aquí mismo se creaba un usuario "Administrador" local con
 * contraseña fija (admin@vimdy.local) si `app_users` estaba vacío. Eso
 * era necesario cuando el login todavía no existía de verdad. Ahora el
 * dueño de cada negocio se crea con la Edge Function `register-business`
 * (ver authBusinessContext.ts) y los empleados adicionales se crean desde
 * el PASO 6 del onboarding (EmployeesStep) o desde Configuración — crear
 * aquí un admin con credenciales fijas sería un usuario falso e inseguro.
 */
export const identityReady = seedIdentity(permissionEngine, roleEngine);

/**
 * Antes esta promesa sembraba un catálogo GENÉRICO de categorías
 * (Hamburguesas, Pizzas, Bebidas...) igual para cualquier negocio nuevo.
 * Fase 3 — Onboarding inteligente: ahora las categorías reales las crea
 * el PASO 7 del asistente (CategoriesStep.tsx), a partir del tipo de
 * negocio elegido en el PASO 3 (ver src/core/config/onboardingCategories.ts).
 * Se mantiene como promesa resuelta de inmediato solo para no romper a
 * quien ya espera `categoriesReady`/`productsReady` antes de leer del
 * repositorio de productos.
 */
export const categoriesReady: Promise<void> = Promise.resolve();

/**
 * Antes se sembraba un catálogo de productos de ejemplo (ver git history
 * de seedProducts.ts) para poder probar Caja/Inventario sin capturar nada
 * a mano. Un negocio real empieza con catálogo vacío: es el propio dueño
 * quien crea sus productos desde el módulo de Productos (Parte 1). Esta
 * promesa se mantiene solo para que el resto de pantallas (Caja, Voz,
 * Dashboard) sigan esperando a que las categorías estén listas antes de
 * leer del repositorio de productos.
 */
export const productsReady: Promise<void> = categoriesReady;

// --------------------
// ENGINES — inventario, salud, IA, cliente, cocina
// --------------------
const kardexEngine = new KardexEngine(movementRepo);
// Paso 3.2 (Cocina): categoryRepo como 4to argumento (opcional) para que
// InventoryEngine.createProduct() pueda heredar Category.requiresKitchenByDefault
// cuando el formulario/import no manda `requiresKitchen` explícito.
const inventoryEngine = new InventoryEngine(productRepo, kardexEngine, supplierRepo, categoryRepo);
// PASO 2 (Motor de Producción): única fuente de verdad para costo real,
// rentabilidad y capacidad de producción derivados de Product.recipe.
// Solo lee de productRepo, no depende de inventoryEngine.
const recipeEngine = new RecipeEngine(productRepo);
// PASO 2.6 (Compras Inteligentes — recomendaciones): analiza inventario +
// velocidad de venta/consumo (directo y vía recetas) para recomendar qué
// comprar. Solo lee, nunca modifica stock ni crea órdenes.
const purchaseIntelligenceEngine = new PurchaseIntelligenceEngine(inventoryEngine, saleRepo);
// PASO 2.7 (Compras Inteligentes — ejecución): convierte recomendaciones en
// órdenes de compra reales, reutilizando InventoryEngine.increaseStock() al
// recibir. Nunca borra órdenes (historial permanente).
const purchaseOrderEngine = new PurchaseOrderEngine(purchaseOrderRepo, inventoryEngine, recipeEngine);
// PASO 2.8 (Pronóstico Inteligente): reutiliza PurchaseIntelligenceEngine para
// "qué ingrediente se agota primero" y "qué compras adelantar" — nunca
// duplica el cálculo de velocidad de consumo, solo lo cruza con el pronóstico
// de ventas por día de semana.
const forecastEngine = new ForecastEngine(saleRepo, inventoryEngine, purchaseIntelligenceEngine);
const categoryEngine = new CategoryEngine(categoryRepo, productRepo);
const supplierEngine = new SupplierEngine(supplierRepo, productRepo);
const waiterEngine = new WaiterEngine(waiterRepo);
const healthEngine = new HealthEngine();
const aiEngine = new AIEngine();
const customerEngine = new CustomerEngine(customerRepo, saleRepo);
const kitchenEngine = new KitchenEngine(kitchenRepo, auditEngine);

const dashboardEngine = new DashboardEngine(
  productRepo,
  saleRepo,
  customerRepo,
  kitchenRepo,
  alertRepo,
  healthEngine,
  aiEngine,
  inventoryEngine,
  recipeEngine
);

// --------------------
// ENGINES — venta, cobro, caja, recibo, alertas, mesas
// --------------------
const cartEngine = new CartEngine();
const paymentEngine = new PaymentEngine();
const receiptEngine = new ReceiptEngine(receiptRepo);
const cashEngine = new CashEngine(cashMovementRepo);
const shiftEngine = new ShiftEngine(shiftRepo, cashEngine);
const alertEngine = new AlertEngine();
const posCore = new PosCore(cartEngine, inventoryEngine, kitchenEngine, aiEngine);

const salesEngine = new SalesEngine(
  saleRepo,
  cartEngine,
  inventoryEngine,
  paymentEngine,
  receiptEngine,
  kitchenEngine,
  cashEngine,
  customerEngine,
  alertEngine,
  healthEngine,
  kardexEngine,
  posCore,
  auditEngine,
  {
    // La tasa de IVA y el cliente/puntos por defecto ya no quedan fijos en
    // el motor: se leen de companyConfigStore, que es lo que edita
    // Configuracion > Impuestos. Si el negocio cambia su tasa, la venta
    // (y el recibo) la reflejan de inmediato sin tocar código.
    defaultTaxRate: companyConfigStore.get().tax / 100,
    defaultCustomerId: "CLIENTE_GENERAL",
    loyaltyPointsPerCurrencyUnit: 0.001
  }
);

const tableEngine = new TableEngine(
  tableRepo,
  kitchenEngine,
  salesEngine
);

/**
 * Antes esta promesa sembraba un mapa FIJO de 12 mesas (Salón Principal,
 * Terraza, Barra) para cualquier negocio nuevo, incluso uno sin mesas
 * (ej. una tienda). Fase 3 — Onboarding inteligente: ahora las mesas
 * reales las crea el PASO 5 del asistente (TablesStep.tsx), con la
 * cantidad que el dueño elige de verdad, y solo si el negocio usa el
 * módulo "mesas". Se mantiene como promesa resuelta de inmediato solo
 * para no romper a quien ya espera `tablesReady` antes de leer del
 * TableEngine (Meseros, Dashboard).
 */
export const tablesReady: Promise<void> = Promise.resolve();

const orderEngine = new OrderEngine(
  orderRepo,
  kitchenEngine,
  salesEngine
);

// --------------------
// ENGINES / SERVICES — VIMDY Intelligence Engine (FASE 2)
// --------------------
const businessAnalyzer = new BusinessAnalyzer(
  dashboardEngine,
  inventoryEngine,
  cashEngine,
  customerEngine,
  orderRepo,
  tableRepo,
  userRepo,
  recipeEngine,
  kardexEngine,
  forecastEngine,
  purchaseIntelligenceEngine,
  auditEngine
);
const patternLearningEngine = new PatternLearningEngine(businessSnapshotRepo, businessAnalyzer);
const copilotEngine = new CopilotEngine(businessAnalyzer, patternLearningEngine);
const copilotApiClient = new CopilotApiClient();
const commandEngine = new CommandEngine(customerEngine);
const questionRouter = new QuestionRouter(businessAnalyzer);

/**
 * PASO 9 — Aprendizaje: cada vez que se cierra un turno de caja (fin del
 * día operativo, aunque haya varios cajeros/turnos ese mismo día),
 * PatternLearningEngine guarda/actualiza la foto de HOY. Es idempotente
 * (una foto por día), así que no importa si se cierra más de un turno.
 * No bloquea el cierre del turno: si falla, solo se registra en consola.
 */
vimdyCore.on("shift", (payload) => {
  if (payload?.action !== "CLOSED") return;

  patternLearningEngine
    .recordTodaySnapshot("VIMDY", companyConfigStore.get().currency)
    .catch((error) => {
      logError("[PASO 9] No se pudo guardar la foto diaria del negocio", { category: "sync", context: { error: String(error) } });
    });
});

// --------------------
// SERVICES
// --------------------
export const container = {
  dashboardService: new DashboardService(dashboardEngine),
  copilotService: new CopilotService(copilotEngine, copilotApiClient),
  commandEngine,
  questionRouter,
  businessAnalyzer,
  patternLearningEngine,
  inventoryService: new InventoryService(inventoryEngine),
  inventoryEngine,
  recipeEngine,
  purchaseIntelligenceEngine,
  purchaseOrderEngine,
  forecastEngine,
  categoryEngine,
  supplierEngine,
  waiterEngine,
  kardexEngine,
  customerService: new CustomerService(customerEngine),
  customerEngine,
  kitchenService: new KitchenService(kitchenEngine),
  salesEngine,
  tableEngine,
  orderEngine,
  shiftEngine,
  cashEngine,
  permissionEngine,
  roleEngine,
  auditEngine,
  userEngine,
  accessEngine,
  notificationRepo,
  saleService: {
    save: async (sale: any) => {
      await saleRepo.save(sale);
    }
  }
};