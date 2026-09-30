// src/core/engines/RecipeEngine.ts
import { Product } from '../entities/Entities';
import { IRepository } from '../../infrastructure/di/repositories/IRepository';

/** Desglose del costo de un ingrediente dentro de la receta de un producto. */
export interface RecipeIngredientCost {
  readonly productId: string;
  readonly name: string;
  readonly unit?: string;
  /** Cantidad de este ingrediente que consume UNA unidad vendida del producto elaborado. */
  readonly quantity: number;
  /** Costo unitario del ingrediente (Product.purchasePrice). */
  readonly unitCost: number;
  /** unitCost * quantity. */
  readonly subtotal: number;
  /** true si el ingrediente se puede quitar/omitir al vender (ver RecipeItem.optional). */
  readonly optional?: boolean;
}

/** Costo real de producción de un producto elaborado (con receta). */
export interface RecipeCost {
  readonly productId: string;
  /** Suma de subtotal de todos los ingredientes. */
  readonly totalCost: number;
  /** En VIMDY una "porción" es 1 unidad vendida, así que hoy es igual a totalCost. */
  readonly costPerPortion: number;
  readonly perIngredient: readonly RecipeIngredientCost[];
  /**
   * Nombres de ingredientes sin `purchasePrice` cargado. Si esta lista no
   * está vacía, `totalCost`/`costPerPortion` NO son confiables (les falta
   * costo real de al menos un ingrediente) — quien consuma este dato debe
   * avisarlo en vez de mostrar la cifra como si fuera exacta.
   */
  readonly missingCostIngredients: readonly string[];
}

/** Rentabilidad real de un producto (elaborado o simple). */
export interface Profitability {
  readonly productId: string;
  readonly price: number;
  readonly cost: number;
  readonly profit: number;
  readonly marginPercent: number;
  /** true si el costo viene de una receta con algún ingrediente sin costo cargado. */
  readonly costUnreliable: boolean;
}

/** Cuánto de un ingrediente concreto limita la producción de un producto. */
export interface ProductionCapacityIngredient {
  readonly productId: string;
  readonly name: string;
  readonly stockAvailable: number;
  /** Cantidad de este ingrediente que se necesita por CADA unidad del producto elaborado. */
  readonly neededPerUnit: number;
  /** floor(stockAvailable / neededPerUnit). Cuántas unidades del producto elaborado alcanza a producir SOLO este ingrediente. */
  readonly unitsIfOnlyThisIngredient: number;
}

/** Capacidad real de producción de un producto elaborado, según el stock actual de sus ingredientes. */
export interface ProductionCapacity {
  readonly productId: string;
  /** El mínimo de unitsIfOnlyThisIngredient entre todos los ingredientes: cuántas unidades se pueden preparar HOY. */
  readonly maxUnits: number;
  /** El ingrediente que determina maxUnits (el primero en la receta si hay empate). null solo si el producto no tiene receta. */
  readonly limitingIngredient: ProductionCapacityIngredient | null;
  readonly breakdown: readonly ProductionCapacityIngredient[];
}

/** Nivel de urgencia de un ProductionStatus, para que la UI y el Gerente Inteligente lo prioricen sin recalcular nada. */
export type ProductionLevel = 'OK' | 'ADVERTENCIA' | 'CRITICO';

/**
 * Foto completa y lista para consumir del estado de producción de UN producto:
 * costo, ganancia, margen, capacidad e ingrediente limitante en un solo objeto.
 * Pensado para que BusinessAnalyzer / Gerente Inteligente / la UI de Inventario
 * llamen un único método en vez de combinar getRecipeCost + getProfitability +
 * getProductionCapacity cada uno por su lado.
 */
export interface ProductionStatus {
  readonly productId: string;
  readonly productName: string;
  /** 'DISPONIBLE' si maxUnits > 0, 'AGOTADO' si maxUnits === 0. */
  readonly status: 'DISPONIBLE' | 'AGOTADO';
  /** Unidades que se pueden preparar HOY con el stock actual de ingredientes. */
  readonly maxUnits: number;
  readonly limitingIngredient: ProductionCapacityIngredient | null;
  readonly cost: number;
  readonly profit: number;
  readonly marginPercent: number;
  /** true si el costo/ganancia no son confiables por faltar purchasePrice de algún ingrediente. */
  readonly costUnreliable: boolean;
  /**
   * 'CRITICO' si maxUnits === 0 (agotado), 'ADVERTENCIA' si maxUnits > 0 pero
   * <= minStock del producto (se va a agotar pronto), 'OK' en otro caso.
   */
  readonly level: ProductionLevel;
}

/**
 * RecipeEngine — FASE 5, PASO 2 (Motor de Producción).
 * ---------------------------------------------------------------------------
 * Única fuente de verdad para todo lo que se deriva de `Product.recipe`:
 * costo real de producción, rentabilidad y capacidad real de producción
 * (incluyendo el ingrediente limitante). No escribe nada — es de solo
 * lectura — y no descuenta inventario (eso lo sigue haciendo
 * InventoryEngine.consumeForSale). Lo consumen InventoryEngine (para
 * validar disponibilidad antes de vender), BusinessAnalyzer (Centro de
 * Ganancias/Pérdidas y Gerente Inteligente) y la UI de Inventario.
 *
 * Nunca inventa cifras: si falta el purchasePrice de un ingrediente, lo
 * reporta explícitamente (`missingCostIngredients` / `costUnreliable`) en
 * vez de asumir cero o inventar un costo.
 */
export class RecipeEngine {
  constructor(private readonly productRepository: IRepository<Product>) {}

  /** Trae todos los productos y arma el mapa id -> Product que usan el resto de los métodos. */
  private async loadProductMap(): Promise<Map<string, Product>> {
    const products = await this.productRepository.findAll();
    return new Map(products.map((p) => [p.id, p]));
  }

  /**
   * Costo real de producción de un producto, a partir de su receta.
   * `allProducts` es opcional: si no se pasa, este método hace su propio
   * findAll() (útil para llamadas sueltas); si se pasa (ej. desde
   * BusinessAnalyzer, que ya tiene el mapa cargado), se reutiliza para no
   * repetir la consulta.
   */
  public getRecipeCost(product: Product, allProducts: Map<string, Product>): RecipeCost | null {
    if (!product.recipe || product.recipe.length === 0) {
      return null;
    }

    const perIngredient: RecipeIngredientCost[] = [];
    const missingCostIngredients: string[] = [];
    let totalCost = 0;

    for (const item of product.recipe) {
      const ingredient = allProducts.get(item.productId);
      const name = ingredient?.name ?? 'Ingrediente eliminado';

      if (!ingredient || ingredient.purchasePrice === undefined) {
        missingCostIngredients.push(name);
        perIngredient.push({
          productId: item.productId,
          name,
          unit: ingredient?.unit,
          quantity: item.quantity,
          unitCost: 0,
          subtotal: 0,
          optional: item.optional
        });
        continue;
      }

      const subtotal = ingredient.purchasePrice * item.quantity;
      totalCost += subtotal;

      perIngredient.push({
        productId: item.productId,
        name,
        unit: ingredient.unit,
        quantity: item.quantity,
        unitCost: ingredient.purchasePrice,
        subtotal,
        optional: item.optional
      });
    }

    return {
      productId: product.id,
      totalCost,
      costPerPortion: totalCost,
      perIngredient,
      missingCostIngredients
    };
  }

  /**
   * Rentabilidad real: precio de venta, costo real, ganancia y margen.
   * Si el producto tiene receta, el costo sale de getRecipeCost(); si no,
   * de su propio purchasePrice (0 si tampoco lo tiene, dejando constancia
   * en costUnreliable en vez de fingir que el costo es exacto).
   */
  public getProfitability(product: Product, allProducts: Map<string, Product>): Profitability {
    const recipeCost = this.getRecipeCost(product, allProducts);

    const cost = recipeCost ? recipeCost.totalCost : product.purchasePrice ?? 0;
    const costUnreliable = recipeCost
      ? recipeCost.missingCostIngredients.length > 0
      : product.purchasePrice === undefined;

    const profit = product.price - cost;
    const marginPercent = product.price > 0 ? (profit / product.price) * 100 : 0;

    return {
      productId: product.id,
      price: product.price,
      cost,
      profit,
      marginPercent,
      costUnreliable
    };
  }

  /**
   * Capacidad real de producción: cuántas unidades de este producto se
   * pueden preparar HOY con el stock actual de sus ingredientes, y cuál
   * ingrediente es el que frena la producción (el limitante).
   * Devuelve null si el producto no tiene receta (un producto simple
   * "produce" lo que indique su propio stock, eso ya lo maneja InventoryEngine).
   */
  public getProductionCapacity(product: Product, allProducts: Map<string, Product>): ProductionCapacity | null {
    if (!product.recipe || product.recipe.length === 0) {
      return null;
    }

    const breakdown: ProductionCapacityIngredient[] = product.recipe.map((item) => {
      const ingredient = allProducts.get(item.productId);
      const stockAvailable = ingredient?.stock ?? 0;
      const neededPerUnit = item.quantity;
      const unitsIfOnlyThisIngredient =
        neededPerUnit > 0 ? Math.floor(stockAvailable / neededPerUnit) : Number.POSITIVE_INFINITY;

      return {
        productId: item.productId,
        name: ingredient?.name ?? 'Ingrediente eliminado',
        stockAvailable,
        neededPerUnit,
        unitsIfOnlyThisIngredient
      };
    });

    let limitingIngredient = breakdown[0];
    for (const row of breakdown) {
      if (row.unitsIfOnlyThisIngredient < limitingIngredient.unitsIfOnlyThisIngredient) {
        limitingIngredient = row;
      }
    }

    const maxUnits =
      limitingIngredient.unitsIfOnlyThisIngredient === Number.POSITIVE_INFINITY
        ? 0
        : Math.max(0, limitingIngredient.unitsIfOnlyThisIngredient);

    return {
      productId: product.id,
      maxUnits,
      limitingIngredient,
      breakdown
    };
  }

  /**
   * Foto completa del estado de producción de un producto: combina
   * getProductionCapacity() + getProfitability() en un solo objeto listo
   * para mostrar en UI o para que el Gerente Inteligente arme una frase
   * ("Solo puedes preparar 12 hamburguesas", "Compra pan").
   * Devuelve null si el producto no tiene receta (no es un producto elaborado).
   */
  public getProductionStatus(product: Product, allProducts: Map<string, Product>): ProductionStatus | null {
    const capacity = this.getProductionCapacity(product, allProducts);
    if (!capacity) {
      return null;
    }

    const profitability = this.getProfitability(product, allProducts);

    let level: ProductionLevel;
    if (capacity.maxUnits <= 0) {
      level = 'CRITICO';
    } else if (capacity.maxUnits <= product.minStock) {
      level = 'ADVERTENCIA';
    } else {
      level = 'OK';
    }

    return {
      productId: product.id,
      productName: product.name,
      status: capacity.maxUnits > 0 ? 'DISPONIBLE' : 'AGOTADO',
      maxUnits: capacity.maxUnits,
      limitingIngredient: capacity.limitingIngredient,
      cost: profitability.cost,
      profit: profitability.profit,
      marginPercent: profitability.marginPercent,
      costUnreliable: profitability.costUnreliable,
      level
    };
  }

  /**
   * Igual que getProductionStatus, pero resuelve el producto por id y hace su
   * propio fetch (findAll + Map). Pensado para consumidores sueltos (un solo
   * producto) como el Gerente Inteligente respondiendo una pregunta puntual;
   * si vas a pedir varios productos de una, usa getAllProductionCapacities /
   * getProductionStatus directamente sobre un Map ya cargado, para no repetir
   * el fetch.
   */
  public async getProductionStatusById(productId: string): Promise<ProductionStatus | null> {
    const allProducts = await this.loadProductMap();
    const product = allProducts.get(productId);
    if (!product) {
      return null;
    }
    return this.getProductionStatus(product, allProducts);
  }

  /**
   * Conveniencia: resuelve costo, rentabilidad y capacidad de TODOS los
   * productos con receta en una sola pasada (una sola consulta al
   * repositorio), para que BusinessAnalyzer, la UI y el Gerente Inteligente
   * no repitan el fetch + Map cada uno por su lado.
   */
  public async getAllProductionCapacities(): Promise<Map<string, ProductionCapacity>> {
    const allProducts = await this.loadProductMap();
    const result = new Map<string, ProductionCapacity>();

    for (const product of allProducts.values()) {
      const capacity = this.getProductionCapacity(product, allProducts);
      if (capacity) {
        result.set(product.id, capacity);
      }
    }

    return result;
  }

  /** Igual que getAllProductionCapacities, pero para rentabilidad de todos los productos activos. */
  public async getAllProfitability(): Promise<Map<string, Profitability>> {
    const allProducts = await this.loadProductMap();
    const result = new Map<string, Profitability>();

    for (const product of allProducts.values()) {
      result.set(product.id, this.getProfitability(product, allProducts));
    }

    return result;
  }
}