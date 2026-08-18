import { beforeEach, describe, expect, it, vi } from "vitest";

var enqueueMock: ReturnType<typeof vi.fn>;
var applyStockDeltaMock: ReturnType<typeof vi.fn>;
var warningMock: ReturnType<typeof vi.fn>;
var saveMock: ReturnType<typeof vi.fn>;
var findByIdMock: ReturnType<typeof vi.fn>;
var logWarningMock: ReturnType<typeof vi.fn>;

vi.mock("../../src/core/offline/pendingInventoryAdjustmentsStore", () => {
  enqueueMock = vi.fn();
  return {
    pendingInventoryAdjustmentsStore: {
      enqueue: enqueueMock
    }
  };
});

vi.mock("../../src/core/store/productCatalogStore", () => {
  applyStockDeltaMock = vi.fn();
  return {
    productCatalogStore: {
      applyStockDelta: applyStockDeltaMock
    }
  };
});

vi.mock("../../src/core/store/toastStore", () => {
  warningMock = vi.fn();
  return {
    toast: {
      warning: warningMock
    }
  };
});

vi.mock("../../src/infrastructure/logging/opsLogger", () => {
  logWarningMock = vi.fn();
  return {
    logWarning: logWarningMock
  };
});

vi.mock("../../src/infrastructure/di/repositories/ProductLocalRepository", () => {
  findByIdMock = vi.fn();
  saveMock = vi.fn();
  // IMPORTANTE: el código real hace `new ProductLocalRepository()`, y una
  // función flecha no se puede usar con `new` (lanza "is not a constructor").
  // Por eso el mock debe ser una función normal, no `() => ({...})`.
  return {
    ProductLocalRepository: vi.fn().mockImplementation(function ProductLocalRepositoryMock(this: any) {
      this.findById = findByIdMock;
      this.save = saveMock;
    })
  };
});

import {
  queueDecreaseStockOffline,
  queueIncreaseStockOffline
} from "../../src/core/services/offlineInventory";

describe("offlineInventory.ts", () => {
  beforeEach(() => {
    enqueueMock.mockClear();
    applyStockDeltaMock.mockClear();
    warningMock.mockClear();
    saveMock.mockClear();
    findByIdMock.mockClear();
    logWarningMock.mockClear();
  });

  it("enqueues increase stock offline with explicit movement id and updates local cache", async () => {
    findByIdMock.mockResolvedValue({ id: "prod-1", stock: 10, lastUpdated: new Date() });

    await queueIncreaseStockOffline({
      id: "offline-move-1",
      productId: "prod-1",
      productName: "Producto X",
      quantity: 5,
      reason: "Inventario offline",
      performedBy: "user-1",
      supplierId: "supplier-1",
      purchasePrice: 800
    });

    expect(enqueueMock).toHaveBeenCalledWith({
      id: "offline-move-1",
      productId: "prod-1",
      productName: "Producto X",
      type: "INCREASE",
      quantity: 5,
      reason: "Inventario offline",
      performedBy: "user-1",
      supplierId: "supplier-1",
      purchasePrice: 800
    });

    expect(applyStockDeltaMock).toHaveBeenCalledWith("prod-1", 5);
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ id: "prod-1", stock: 15 }));
    expect(warningMock).toHaveBeenCalledWith(expect.stringContaining("entrada de stock"));
    expect(logWarningMock).not.toHaveBeenCalled();
  });

  it("enqueues decrease stock offline with explicit movement id and updates local cache", async () => {
    findByIdMock.mockResolvedValue({ id: "prod-2", stock: 20, lastUpdated: new Date() });

    await queueDecreaseStockOffline({
      id: "offline-move-2",
      productId: "prod-2",
      productName: "Producto Y",
      quantity: 7,
      reason: "Consumo interno",
      performedBy: "user-2",
      lossCategory: "ROBO"
    });

    expect(enqueueMock).toHaveBeenCalledWith({
      id: "offline-move-2",
      productId: "prod-2",
      productName: "Producto Y",
      type: "DECREASE",
      quantity: 7,
      reason: "Consumo interno",
      performedBy: "user-2",
      lossCategory: "ROBO"
    });

    expect(applyStockDeltaMock).toHaveBeenCalledWith("prod-2", -7);
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ id: "prod-2", stock: 13 }));
    expect(warningMock).toHaveBeenCalledWith(expect.stringContaining("salida de stock"));
    expect(logWarningMock).not.toHaveBeenCalled();
  });

  it("does not throw when local cache persistence fails", async () => {
    findByIdMock.mockRejectedValue(new Error("DB locked"));

    await expect(
      queueIncreaseStockOffline({
        id: "offline-move-3",
        productId: "prod-3",
        productName: "Producto Z",
        quantity: 2,
        reason: "Ajuste offline"
      })
    ).resolves.toBeUndefined();

    expect(enqueueMock).toHaveBeenCalled();
    expect(logWarningMock).toHaveBeenCalledWith(
      "No se pudo actualizar el stock optimista en el caché local",
      expect.objectContaining({ category: "offline" })
    );
  });
});