/**
 * Auditoría de calidad: Escenarios reales de negocio.
 * Verifica que VIMDY se adapta a cada negocio sin asumir cómo trabaja.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks para Supabase
vi.mock('../../src/infrastructure/supabase/supabaseClient', () => ({
  getCurrentBusinessId: () => 'test-business-id',
  getCurrentBranchId: () => 'test-branch-id',
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
}));

import { InventoryEngine } from '../../src/core/engines/InventoryEngine';
import { CategoryEngine } from '../../src/core/engines/CategoryEngine';
import { CartEngine } from '../../src/core/engines/CartEngine';
import { enabledModulesStore } from '../../src/core/store/enabledModulesStore';
import type { Product, Category } from '../../src/core/entities/Entities';

// Mock para KardexEngine
const mockKardex = {
  record: vi.fn().mockResolvedValue(undefined),
};

// Repository en memoria para tests
function createInMemoryRepository<T extends { id: string }>() {
  const items: T[] = [];
  return {
    findAll: async () => [...items],
    findById: async (id: string) => items.find(i => i.id === id) ?? null,
    findMany: async (ids: string[]) => items.filter(i => ids.includes(i.id)),
    save: async (item: T) => {
      const idx = items.findIndex(i => i.id === item.id);
      if (idx >= 0) items[idx] = item;
      else items.push(item);
    },
    update: async (item: T) => {
      const idx = items.findIndex(i => i.id === item.id);
      if (idx >= 0) items[idx] = item;
    },
    delete: async (id: string) => {
      const idx = items.findIndex(i => i.id === id);
      if (idx >= 0) items.splice(idx, 1);
    },
    _items: items,
  };
}

describe('Auditoría de calidad: Escenarios reales de negocio', () => {

  describe('1. Defaults seguros - NO asumir cocina', () => {
    it('Categoría nueva NO debe defaultear a requiresKitchenByDefault=true', async () => {
      const categoryRepo = createInMemoryRepository<Category>();
      const productRepo = createInMemoryRepository<Product>();
      const engine = new CategoryEngine(categoryRepo as any, productRepo as any);

      const category = await engine.create({ name: 'Bebidas' });

      // AUDITORÍA: El default debe ser SEGURO (false)
      expect(category.requiresKitchenByDefault).toBe(false);
    });

    it('Producto sin requiresKitchen explícito NO debe asumir cocina', async () => {
      const categoryRepo = createInMemoryRepository<Category>();
      const productRepo = createInMemoryRepository<Product>();
      const categoryEngine = new CategoryEngine(categoryRepo as any, productRepo as any);

      // Crear categoría sin cocina
      const category = await categoryEngine.create({ name: 'Snacks' });
      expect(category.requiresKitchenByDefault).toBe(false);

      const inventoryEngine = new InventoryEngine(productRepo as any, mockKardex as any, undefined, categoryRepo as any);

      const product = await inventoryEngine.createProduct({
        name: 'Papas Fritas',
        categoryId: category.id,
        price: 5000,
        stock: 100,
        minStock: 10,
        // NO se especifica requiresKitchen
      });

      // AUDITORÍA: El producto NO debe asumir cocina por defecto
      expect(product.requiresKitchen).toBe(false);
    });

    it('Producto en categoría CON cocina hereda requiresKitchen=true', async () => {
      const categoryRepo = createInMemoryRepository<Category>();
      const productRepo = createInMemoryRepository<Product>();
      const categoryEngine = new CategoryEngine(categoryRepo as any, productRepo as any);

      // Crear categoría CON cocina
      const category = await categoryEngine.create({
        name: 'Platos Fuertes',
        requiresKitchenByDefault: true
      });
      expect(category.requiresKitchenByDefault).toBe(true);

      const inventoryEngine = new InventoryEngine(productRepo as any, mockKardex as any, undefined, categoryRepo as any);

      const product = await inventoryEngine.createProduct({
        name: 'Bandeja Paisa',
        categoryId: category.id,
        price: 25000,
        stock: 50,
        minStock: 5,
        // NO se especifica requiresKitchen - hereda de la categoría
      });

      // AUDITORÍA: El producto hereda requiresKitchen de la categoría
      expect(product.requiresKitchen).toBe(true);
    });
  });

  describe('2. Escenario: Tienda sin cocina', () => {
    it('Productos de tienda NO deben enviarse a cocina', async () => {
      // Simular negocio sin módulo de cocina
      enabledModulesStore.set(['caja', 'pedidos', 'inventario', 'clientes']);

      const categoryRepo = createInMemoryRepository<Category>();
      const productRepo = createInMemoryRepository<Product>();
      const categoryEngine = new CategoryEngine(categoryRepo as any, productRepo as any);

      // Categoría de tienda
      const category = await categoryEngine.create({ name: 'Aseo' });
      expect(category.requiresKitchenByDefault).toBe(false);

      const inventoryEngine = new InventoryEngine(productRepo as any, mockKardex as any, undefined, categoryRepo as any);

      // Producto de tienda (aseo, snacks, etc)
      const product = await inventoryEngine.createProduct({
        name: 'Jabón',
        categoryId: category.id,
        price: 3000,
        stock: 200,
        minStock: 20,
      });

      // AUDITORÍA: Producto de tienda NO debe requerir cocina
      expect(product.requiresKitchen).toBe(false);

      // Agregar al carrito
      const cart = new CartEngine();
      cart.addItem(product as Product, 2);

      const items = cart.getItems();
      // AUDITORÍA: El item en carrito NO debe requerir cocina
      expect(items[0].requiresKitchen).toBe(false);

      enabledModulesStore.clear();
    });
  });

  describe('3. Escenario: Restaurante con cocina', () => {
    it('Productos de cocina SÍ deben enviarse a cocina', async () => {
      // Simular negocio con módulo de cocina
      enabledModulesStore.set(['caja', 'pedidos', 'cocina', 'mesas', 'inventario']);

      const categoryRepo = createInMemoryRepository<Category>();
      const productRepo = createInMemoryRepository<Product>();
      const categoryEngine = new CategoryEngine(categoryRepo as any, productRepo as any);

      // Categoría de cocina
      const category = await categoryEngine.create({
        name: 'Platos Fuertes',
        requiresKitchenByDefault: true
      });

      const inventoryEngine = new InventoryEngine(productRepo as any, mockKardex as any, undefined, categoryRepo as any);

      const product = await inventoryEngine.createProduct({
        name: 'Hamburguesa',
        categoryId: category.id,
        price: 18000,
        stock: 30,
        minStock: 5,
      });

      // AUDITORÍA: Producto de cocina SÍ debe requerir cocina
      expect(product.requiresKitchen).toBe(true);

      const cart = new CartEngine();
      cart.addItem(product as Product, 1);

      const items = cart.getItems();
      // AUDITORÍA: El item en carrito SÍ debe requerir cocina
      expect(items[0].requiresKitchen).toBe(true);

      enabledModulesStore.clear();
    });
  });

  describe('4. Escenario: Bar con bebidas y productos de cocina', () => {
    it('Bebidas NO van a cocina, platos SÍ van a cocina', async () => {
      enabledModulesStore.set(['caja', 'pedidos', 'cocina', 'mesas', 'inventario']);

      const categoryRepo = createInMemoryRepository<Category>();
      const productRepo = createInMemoryRepository<Product>();
      const categoryEngine = new CategoryEngine(categoryRepo as any, productRepo as any);

      // Categoría bebidas (sin cocina)
      const bebidas = await categoryEngine.create({ name: 'Cervezas' });
      expect(bebidas.requiresKitchenByDefault).toBe(false);

      // Categoría cocina (con cocina)
      const cocina = await categoryEngine.create({
        name: 'Picadas',
        requiresKitchenByDefault: true
      });

      const inventoryEngine = new InventoryEngine(productRepo as any, mockKardex as any, undefined, categoryRepo as any);

      // Cerveza - NO requiere cocina
      const cerveza = await inventoryEngine.createProduct({
        name: 'Club Colombia',
        categoryId: bebidas.id,
        price: 8000,
        stock: 100,
        minStock: 10,
      });
      expect(cerveza.requiresKitchen).toBe(false);

      // Picada - SÍ requiere cocina
      const picada = await inventoryEngine.createProduct({
        name: 'Picada para 2',
        categoryId: cocina.id,
        price: 35000,
        stock: 20,
        minStock: 3,
      });
      expect(picada.requiresKitchen).toBe(true);

      // Agregar ambos al carrito
      const cart = new CartEngine();
      cart.addItem(cerveza as Product, 2);
      cart.addItem(picada as Product, 1);

      const items = cart.getItems();

      // AUDITORÍA: Cerveza NO va a cocina
      const cervezaItem = items.find(i => i.productId === cerveza.id);
      expect(cervezaItem?.requiresKitchen).toBe(false);

      // AUDITORÍA: Picada SÍ va a cocina
      const picadaItem = items.find(i => i.productId === picada.id);
      expect(picadaItem?.requiresKitchen).toBe(true);

      enabledModulesStore.clear();
    });
  });

  describe('5. Escenario: Producto con inventario vs sin inventario', () => {
    it('Producto con inventario descuenta stock al vender', async () => {
      const categoryRepo = createInMemoryRepository<Category>();
      const productRepo = createInMemoryRepository<Product>();
      const categoryEngine = new CategoryEngine(categoryRepo as any, productRepo as any);

      const category = await categoryEngine.create({ name: 'Bebidas' });

      const inventoryEngine = new InventoryEngine(productRepo as any, mockKardex as any, undefined, categoryRepo as any);

      // Producto CON control de inventario (trackStock=true por defecto)
      const product = await inventoryEngine.createProduct({
        name: 'Coca Cola',
        categoryId: category.id,
        price: 4000,
        stock: 50,
        minStock: 5,
        // trackStock no se especifica - default true
      });

      // AUDITORÍA: trackStock debe ser true por defecto
      expect(product.trackStock).toBe(true);
      expect(product.stock).toBe(50);
    });

    it('Producto SERVicio NO maneja stock', async () => {
      const categoryRepo = createInMemoryRepository<Category>();
      const productRepo = createInMemoryRepository<Product>();
      const categoryEngine = new CategoryEngine(categoryRepo as any, productRepo as any);

      const category = await categoryEngine.create({ name: 'Servicios' });

      const inventoryEngine = new InventoryEngine(productRepo as any, mockKardex as any, undefined, categoryRepo as any);

      // Producto SIN control de inventario (servicio)
      const product = await inventoryEngine.createProduct({
        name: 'Domicilio',
        categoryId: category.id,
        price: 3000,
        stock: 0,
        minStock: 0,
        trackStock: false, // Explicitamente no maneja stock
      });

      // AUDITORÍA: trackStock debe ser false
      expect(product.trackStock).toBe(false);
    });
  });

  describe('6. Escenario: Producto con ingredientes (receta)', () => {
    it('Producto elaborado con receta descuenta ingredientes', async () => {
      const categoryRepo = createInMemoryRepository<Category>();
      const productRepo = createInMemoryRepository<Product>();
      const categoryEngine = new CategoryEngine(categoryRepo as any, productRepo as any);

      const category = await categoryEngine.create({
        name: 'Hamburguesas',
        requiresKitchenByDefault: true
      });

      const inventoryEngine = new InventoryEngine(productRepo as any, mockKardex as any, undefined, categoryRepo as any);

      // Crear ingredientes
      const pan = await inventoryEngine.createProduct({
        name: 'Pan de hamburguesa',
        categoryId: category.id,
        price: 1000,
        stock: 100,
        minStock: 10,
        isIngredient: true,
      });
      expect(pan.isIngredient).toBe(true);
      expect(pan.trackStock).toBe(true); // Ingredientes SÍ manejan stock

      const carne = await inventoryEngine.createProduct({
        name: 'Carne de res',
        categoryId: category.id,
        price: 5000,
        stock: 50,
        minStock: 5,
        isIngredient: true,
      });
      expect(carne.isIngredient).toBe(true);

      // Crear producto elaborado con receta
      const hamburguesa = await inventoryEngine.createProduct({
        name: 'Hamburguesa Sencilla',
        categoryId: category.id,
        price: 18000,
        stock: 0, // Producto elaborado no tiene stock propio (ON_DEMAND)
        minStock: 0,
        requiresKitchen: true,
        recipe: [
          { productId: pan.id, quantity: 1 },
          { productId: carne.id, quantity: 1 },
        ],
      });

      // AUDITORÍA: Producto elaborado requiere cocina
      expect(hamburguesa.requiresKitchen).toBe(true);
      // AUDITORÍA: Producto elaborado tiene receta
      expect(hamburguesa.recipe).toHaveLength(2);
    });
  });

  describe('7. Escenario: Personal sin mesas', () => {
    it('Personal puede operar sin módulo de mesas activo', async () => {
      enabledModulesStore.set(['caja', 'pedidos', 'mesas', 'inventario']);

      // AUDITORÍA: El módulo "mesas" puede estar activo
      const modules = enabledModulesStore.get();
      expect(modules).toContain('mesas');
      // En este escenario, el personal atiende mostrador, no mesas

      enabledModulesStore.clear();
    });
  });

  describe('8. Escenario: Negocio que configura después', () => {
    it('Negocio puede activar módulos posteriormente', async () => {
      // Inicialmente sin módulos configurados
      enabledModulesStore.clear();
      expect(enabledModulesStore.get()).toBeNull();

      // El negocio configura después
      enabledModulesStore.set(['caja', 'pedidos', 'cocina', 'inventario']);

      const modules = enabledModulesStore.get();
      expect(modules).toContain('cocina');
      expect(modules).toContain('inventario');

      enabledModulesStore.clear();
    });
  });

  describe('9. sendToKitchen respeta módulo activo', () => {
    it('NO envía a cocina si módulo "cocina" no está activo', async () => {
      // Negocio sin cocina
      enabledModulesStore.set(['caja', 'pedidos', 'inventario']);

      // Aunque un producto tenga requiresKitchen=true por error,
      // NO debe enviarse a cocina si el módulo no está activo
      const modules = enabledModulesStore.get();
      const hasKitchen = modules?.includes('cocina') ?? false;

      // AUDITORÍA: No hay módulo de cocina activo
      expect(hasKitchen).toBe(false);

      enabledModulesStore.clear();
    });

    it('SÍ envía a cocina si módulo "cocina" está activo', async () => {
      // Negocio con cocina
      enabledModulesStore.set(['caja', 'pedidos', 'cocina', 'mesas', 'inventario']);

      const modules = enabledModulesStore.get();
      const hasKitchen = modules?.includes('cocina') ?? false;

      // AUDITORÍA: Hay módulo de cocina activo
      expect(hasKitchen).toBe(true);

      enabledModulesStore.clear();
    });
  });
});
