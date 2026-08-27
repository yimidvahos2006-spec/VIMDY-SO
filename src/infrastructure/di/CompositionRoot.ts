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

import { seedIdentity } from "./seedIdentity";
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
// REPOS — se crean eager porque son ligeros
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
const purchaseOrderRepo = new PurchaseOrderRepository();
const businessSnapshotRepo = new BusinessSnapshotRepository();
const notificationRepo = new NotificationRepository();
const waiterRepo = new WaiterRepository();
const receiptRepo = new ReceiptRepository();

// --------------------
// LAZY SINGLETON HELPERS — los engines se instancian solo al usarse
// --------------------
let permissionEngine: PermissionEngine | null = null;
let roleEngine: RoleEngine | null = null;
let auditEngine: AuditEngine | null = null;
let userEngine: UserEngine | null = null;
let accessEngine: AccessEngine | null = null;

let kardexEngine: KardexEngine | null = null;
let inventoryEngine: InventoryEngine | null = null;
let recipeEngine: RecipeEngine | null = null;
let purchaseIntelligenceEngine: PurchaseIntelligenceEngine | null = null;
let purchaseOrderEngine: PurchaseOrderEngine | null = null;
let forecastEngine: ForecastEngine | null = null;
let categoryEngine: CategoryEngine | null = null;
let supplierEngine: SupplierEngine | null = null;
let waiterEngine: WaiterEngine | null = null;
let healthEngine: HealthEngine | null = null;
let aiEngine: AIEngine | null = null;
let customerEngine: CustomerEngine | null = null;
let kitchenEngine: KitchenEngine | null = null;

let dashboardEngine: DashboardEngine | null = null;

let cartEngine: CartEngine | null = null;
let paymentEngine: PaymentEngine | null = null;
let receiptEngine: ReceiptEngine | null = null;
let cashEngine: CashEngine | null = null;
let shiftEngine: ShiftEngine | null = null;
let alertEngine: AlertEngine | null = null;
let posCore: PosCore | null = null;

let salesEngine: SalesEngine | null = null;
let orderEngine: OrderEngine | null = null;
let tableEngine: TableEngine | null = null;

let businessAnalyzer: BusinessAnalyzer | null = null;
let patternLearningEngine: PatternLearningEngine | null = null;
let copilotEngine: CopilotEngine | null = null;
let commandEngine: CommandEngine | null = null;
let questionRouter: QuestionRouter | null = null;

let dashboardService: DashboardService | null = null;
let copilotService: CopilotService | null = null;
let inventoryService: InventoryService | null = null;
let customerService: CustomerService | null = null;
let kitchenService: KitchenService | null = null;

function ensurePermissionEngine(): PermissionEngine {
  if (!permissionEngine) permissionEngine = new PermissionEngine(permissionRepo);
  return permissionEngine;
}

function ensureRoleEngine(): RoleEngine {
  if (!roleEngine) roleEngine = new RoleEngine(roleRepo, ensurePermissionEngine());
  return roleEngine;
}

function ensureAuditEngine(): AuditEngine {
  if (!auditEngine) auditEngine = new AuditEngine(auditLogRepo);
  return auditEngine;
}

function ensureUserEngine(): UserEngine {
  if (!userEngine) userEngine = new UserEngine(userRepo, ensureRoleEngine(), ensureAuditEngine());
  return userEngine;
}

function ensureAccessEngine(): AccessEngine {
  if (!accessEngine) accessEngine = new AccessEngine(ensureUserEngine(), ensureRoleEngine());
  return accessEngine;
}

function ensureKardexEngine(): KardexEngine {
  if (!kardexEngine) kardexEngine = new KardexEngine(movementRepo);
  return kardexEngine;
}

function ensureInventoryEngine(): InventoryEngine {
  if (!inventoryEngine) inventoryEngine = new InventoryEngine(productRepo, ensureKardexEngine(), supplierRepo, categoryRepo);
  return inventoryEngine;
}

function ensureRecipeEngine(): RecipeEngine {
  if (!recipeEngine) recipeEngine = new RecipeEngine(productRepo);
  return recipeEngine;
}

function ensurePurchaseIntelligenceEngine(): PurchaseIntelligenceEngine {
  if (!purchaseIntelligenceEngine) purchaseIntelligenceEngine = new PurchaseIntelligenceEngine(ensureInventoryEngine(), saleRepo);
  return purchaseIntelligenceEngine;
}

function ensurePurchaseOrderEngine(): PurchaseOrderEngine {
  if (!purchaseOrderEngine) purchaseOrderEngine = new PurchaseOrderEngine(purchaseOrderRepo, ensureInventoryEngine(), ensureRecipeEngine());
  return purchaseOrderEngine;
}

function ensureForecastEngine(): ForecastEngine {
  if (!forecastEngine) forecastEngine = new ForecastEngine(saleRepo, ensureInventoryEngine(), ensurePurchaseIntelligenceEngine());
  return forecastEngine;
}

function ensureCategoryEngine(): CategoryEngine {
  if (!categoryEngine) categoryEngine = new CategoryEngine(categoryRepo, productRepo);
  return categoryEngine;
}

function ensureSupplierEngine(): SupplierEngine {
  if (!supplierEngine) supplierEngine = new SupplierEngine(supplierRepo, productRepo);
  return supplierEngine;
}

function ensureWaiterEngine(): WaiterEngine {
  if (!waiterEngine) waiterEngine = new WaiterEngine(waiterRepo);
  return waiterEngine;
}

function ensureHealthEngine(): HealthEngine {
  if (!healthEngine) healthEngine = new HealthEngine();
  return healthEngine;
}

function ensureAiEngine(): AIEngine {
  if (!aiEngine) aiEngine = new AIEngine();
  return aiEngine;
}

function ensureCustomerEngine(): CustomerEngine {
  if (!customerEngine) customerEngine = new CustomerEngine(customerRepo, saleRepo);
  return customerEngine;
}

function ensureKitchenEngine(): KitchenEngine {
  if (!kitchenEngine) kitchenEngine = new KitchenEngine(kitchenRepo, ensureAuditEngine());
  return kitchenEngine;
}

function ensureDashboardEngine(): DashboardEngine {
  if (!dashboardEngine) {
    dashboardEngine = new DashboardEngine(
      productRepo,
      saleRepo,
      customerRepo,
      kitchenRepo,
      alertRepo,
      ensureHealthEngine(),
      ensureAiEngine(),
      ensureInventoryEngine(),
      ensureRecipeEngine()
    );
  }
  return dashboardEngine;
}

function ensureCartEngine(): CartEngine {
  if (!cartEngine) cartEngine = new CartEngine();
  return cartEngine;
}

function ensurePaymentEngine(): PaymentEngine {
  if (!paymentEngine) paymentEngine = new PaymentEngine();
  return paymentEngine;
}

function ensureReceiptEngine(): ReceiptEngine {
  if (!receiptEngine) receiptEngine = new ReceiptEngine(receiptRepo);
  return receiptEngine;
}

function ensureCashEngine(): CashEngine {
  if (!cashEngine) cashEngine = new CashEngine(cashMovementRepo);
  return cashEngine;
}

function ensureShiftEngine(): ShiftEngine {
  if (!shiftEngine) shiftEngine = new ShiftEngine(shiftRepo, ensureCashEngine());
  return shiftEngine;
}

function ensureAlertEngine(): AlertEngine {
  if (!alertEngine) alertEngine = new AlertEngine();
  return alertEngine;
}

function ensurePosCore(): PosCore {
  if (!posCore) posCore = new PosCore(ensureCartEngine(), ensureInventoryEngine(), ensureKitchenEngine(), ensureAiEngine());
  return posCore;
}

function ensureSalesEngine(): SalesEngine {
  if (!salesEngine) {
    salesEngine = new SalesEngine(
      saleRepo,
      ensureCartEngine(),
      ensureInventoryEngine(),
      ensurePaymentEngine(),
      ensureReceiptEngine(),
      ensureKitchenEngine(),
      ensureCashEngine(),
      ensureCustomerEngine(),
      ensureAlertEngine(),
      ensureHealthEngine(),
      ensureKardexEngine(),
      ensurePosCore(),
      ensureAuditEngine(),
      {
        defaultTaxRate: companyConfigStore.get().tax / 100,
        defaultCustomerId: "CLIENTE_GENERAL",
        loyaltyPointsPerCurrencyUnit: 0.001
      }
    );
  }
  return salesEngine;
}

function ensureOrderEngine(): OrderEngine {
  if (!orderEngine) orderEngine = new OrderEngine(orderRepo, ensureKitchenEngine(), ensureSalesEngine());
  return orderEngine;
}

function ensureTableEngine(): TableEngine {
  if (!tableEngine) tableEngine = new TableEngine(tableRepo, ensureKitchenEngine(), ensureSalesEngine(), ensureOrderEngine());
  return tableEngine;
}

function ensureBusinessAnalyzer(): BusinessAnalyzer {
  if (!businessAnalyzer) {
    businessAnalyzer = new BusinessAnalyzer(
      ensureDashboardEngine(),
      ensureInventoryEngine(),
      ensureCashEngine(),
      ensureCustomerEngine(),
      orderRepo,
      tableRepo,
      userRepo,
      ensureRecipeEngine(),
      ensureKardexEngine(),
      ensureForecastEngine(),
      ensurePurchaseIntelligenceEngine(),
      ensureAuditEngine()
    );
  }
  return businessAnalyzer;
}

function ensurePatternLearningEngine(): PatternLearningEngine {
  if (!patternLearningEngine) patternLearningEngine = new PatternLearningEngine(businessSnapshotRepo, ensureBusinessAnalyzer());
  return patternLearningEngine;
}

function ensureCopilotEngine(): CopilotEngine {
  if (!copilotEngine) copilotEngine = new CopilotEngine(ensureBusinessAnalyzer(), ensurePatternLearningEngine());
  return copilotEngine;
}

function ensureCommandEngine(): CommandEngine {
  if (!commandEngine) commandEngine = new CommandEngine(ensureCustomerEngine());
  return commandEngine;
}

function ensureQuestionRouter(): QuestionRouter {
  if (!questionRouter) questionRouter = new QuestionRouter(ensureBusinessAnalyzer());
  return questionRouter;
}

function ensureDashboardService(): DashboardService {
  if (!dashboardService) dashboardService = new DashboardService(ensureDashboardEngine());
  return dashboardService;
}

function ensureCopilotService(): CopilotService {
  if (!copilotService) copilotService = new CopilotService(ensureCopilotEngine(), new CopilotApiClient());
  return copilotService;
}

function ensureInventoryService(): InventoryService {
  if (!inventoryService) inventoryService = new InventoryService(ensureInventoryEngine());
  return inventoryService;
}

function ensureCustomerService(): CustomerService {
  if (!customerService) customerService = new CustomerService(ensureCustomerEngine());
  return customerService;
}

function ensureKitchenService(): KitchenService {
  if (!kitchenService) kitchenService = new KitchenService(ensureKitchenEngine());
  return kitchenService;
}

/**
 * Catálogo de permisos + roles base (ADMIN, CAJERO, MESERO, etc). Este
 * catálogo es fijo y del sistema (no es dato de un negocio), así que sí
 * se sigue sembrando una sola vez al arrancar.
 */
export const identityReady = (async () => {
  await seedIdentity(ensurePermissionEngine(), ensureRoleEngine());
})();

export const categoriesReady: Promise<void> = Promise.resolve();
export const productsReady: Promise<void> = categoriesReady;
export const tablesReady: Promise<void> = Promise.resolve();

/**
 * PASO 9 — Aprendizaje: cada vez que se cierra un turno de caja (fin del
 * día operativo, aunque haya varios cajeros/turnos ese mismo día),
 * PatternLearningEngine guarda/actualiza la foto de HOY.
 */
vimdyCore.on("shift", (payload) => {
  if (payload?.action !== "CLOSED") return;

  ensurePatternLearningEngine()
    .recordTodaySnapshot("VIMDY", companyConfigStore.get().currency)
    .catch((error) => {
      logError("[PASO 9] No se pudo guardar la foto diaria del negocio", { category: "sync", context: { error: String(error) } });
    });
});

// --------------------
// SERVICES — también lazy, misma API pública
// --------------------
export const container = {
  dashboardService: { get() { return ensureDashboardService(); } },
  copilotService: { get() { return ensureCopilotService(); } },
  commandEngine: { get() { return ensureCommandEngine(); } },
  questionRouter: { get() { return ensureQuestionRouter(); } },
  businessAnalyzer: { get() { return ensureBusinessAnalyzer(); } },
  patternLearningEngine: { get() { return ensurePatternLearningEngine(); } },
  inventoryService: { get() { return ensureInventoryService(); } },
  inventoryEngine: { get() { return ensureInventoryEngine(); } },
  recipeEngine: { get() { return ensureRecipeEngine(); } },
  purchaseIntelligenceEngine: { get() { return ensurePurchaseIntelligenceEngine(); } },
  purchaseOrderEngine: { get() { return ensurePurchaseOrderEngine(); } },
  forecastEngine: { get() { return ensureForecastEngine(); } },
  categoryEngine: { get() { return ensureCategoryEngine(); } },
  supplierEngine: { get() { return ensureSupplierEngine(); } },
  waiterEngine: { get() { return ensureWaiterEngine(); } },
  kardexEngine: { get() { return ensureKardexEngine(); } },
  customerService: { get() { return ensureCustomerService(); } },
  customerEngine: { get() { return ensureCustomerEngine(); } },
  kitchenService: { get() { return ensureKitchenService(); } },
  kitchenEngine: { get() { return ensureKitchenEngine(); } },
  salesEngine: { get() { return ensureSalesEngine(); } },
  tableEngine: { get() { return ensureTableEngine(); } },
  orderEngine: { get() { return ensureOrderEngine(); } },
  shiftEngine: { get() { return ensureShiftEngine(); } },
  cashEngine: { get() { return ensureCashEngine(); } },
  permissionEngine: { get() { return ensurePermissionEngine(); } },
  roleEngine: { get() { return ensureRoleEngine(); } },
  auditEngine: { get() { return ensureAuditEngine(); } },
  userEngine: { get() { return ensureUserEngine(); } },
  accessEngine: { get() { return ensureAccessEngine(); } },
  notificationRepo,
  saleService: {
    save: async (sale: any) => {
      await saleRepo.save(sale);
    }
  }
};