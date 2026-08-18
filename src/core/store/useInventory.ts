// src/core/store/useInventory.ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { container, productsReady } from "../../infrastructure/di/CompositionRoot";
import { Product, InventoryMovement, LossCategory } from "../entities/Entities";
import { productCatalogStore } from "./productCatalogStore";
import { ProductInput } from "../engines/InventoryEngine";
import { vimdyCore } from "../VimdyCore";
import { useAuth } from "../../presentation/context/AuthContext";
import { connectionStore } from "./connectionStore";
import { isNetworkFailure } from "../services/offlineSale";
import { queueIncreaseStockOffline, queueDecreaseStockOffline } from "../services/offlineInventory";

export type StockStatus = "normal" | "bajo" | "agotado";

export function getStockStatus(product: Product): StockStatus {
  // BLOQUEANTE (bug reportado en video 2026-07-31): un producto con
  // trackStock === false (Servicio, o Cocina sin receta, ej. Caldo de
  // Costilla) nace y se queda en stock 0 a propósito porque no maneja
  // stock propio. Sin este chequeo aparecía como "agotado" para siempre
  // en el KPI de inventario, en su propio badge de estado y en la lista
  // de "stock bajo" — mismo criterio que InventoryEngine/SalesEngine/
  // AlertEngine.
  if (product.trackStock === false) return "normal";
  if (product.stock <= 0) return "agotado";
  if (product.stock <= product.minStock) return "bajo";
  return "normal";
}

export interface InventoryKpis {
  totalProducts: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalValue: number;
  productsWithCost: number;
}

export function useInventory() {
  const { user } = useAuth();
  const performedBy = user?.name ?? "Sistema";
  const [products, setProducts] = useState<Product[]>([]);
  const [recentMovements, setRecentMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    await productsReady;
    const [all, movements] = await Promise.all([
      container.inventoryEngine.listAll(),
      container.kardexEngine.getRecentHistory(15),
    ]);
    setProducts(all);
    setRecentMovements(movements);
    // Mantiene sincronizado el catálogo que usa la Caja, para que un ajuste
    // hecho desde Inventario se vea de inmediato al volver a vender.
    await productCatalogStore.refresh();
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // Sincronización en vivo: si otro dispositivo vende, ajusta o reabastece
  // stock, realtimeSync.ts detecta el cambio en Supabase y emite
  // "inventory" en este bus. Este hook lo escucha y se recarga solo, sin
  // que nadie tenga que refrescar la página en este dispositivo.
  useEffect(() => {
    const unsubscribe = vimdyCore.on("inventory", () => {
      load();
    });
    return unsubscribe;
  }, [load]);

  const kpis: InventoryKpis = useMemo(() => {
    let totalValue = 0;
    let productsWithCost = 0;

    for (const p of products) {
      if (p.trackStock !== false && p.purchasePrice !== undefined) {
        totalValue += p.purchasePrice * p.stock;
        productsWithCost += 1;
      }
    }

    return {
      totalProducts: products.length,
      lowStockCount: products.filter((p) => getStockStatus(p) === "bajo").length,
      outOfStockCount: products.filter((p) => getStockStatus(p) === "agotado").length,
      totalValue,
      productsWithCost,
    };
  }, [products]);

  const lowStockProducts = useMemo(
    () => products.filter((p) => getStockStatus(p) !== "normal"),
    [products]
  );

  async function getHistory(productId: string): Promise<InventoryMovement[]> {
    const history = await container.kardexEngine.getHistory(productId);
    return [...history].sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  /**
   * PASO 1.7 (Cola offline para escrituras) — refleja en el estado local
   * `products` el mismo delta que offlineInventory.ts ya aplicó de forma
   * optimista en productCatalogStore. A propósito NO se usa `load()` aquí:
   * mientras el ajuste sigue solo en la cola local, el servidor (y por lo
   * tanto el caché que lee InventoryEngine.listAll()) todavía no sabe nada
   * de este cambio, así que recargar desde ahí borraría el ajuste que el
   * usuario acaba de hacer hasta que se sincronice de verdad.
   */
  function applyLocalStockDelta(productId: string, delta: number) {
    setProducts((current) =>
      current.map((product) =>
        product.id === productId
          ? { ...product, stock: product.stock + delta, lastUpdated: new Date() }
          : product
      )
    );
  }

  async function increaseStock(
    productId: string,
    quantity: number,
    reason: string,
    supplierId?: string,
    purchasePrice?: number
  ) {
    setError(null);
    const movementId = crypto.randomUUID();

    // PASO 1.7 (Cola offline para escrituras) — sin conexión real ni
    // siquiera se intenta hablar con Supabase: se va directo al camino
    // offline, igual que hace processSale.ts con las ventas.
    if (!connectionStore.isOnline()) {
      const productName = products.find((p) => p.id === productId)?.name ?? productId;
      await queueIncreaseStockOffline({
        id: movementId,
        productId,
        productName,
        quantity,
        reason,
        performedBy,
        supplierId,
        purchasePrice
      });
      applyLocalStockDelta(productId, quantity);
      return true;
    }

    try {
      await container.inventoryEngine.increaseStock(
        productId,
        quantity,
        reason,
        performedBy,
        supplierId,
        purchasePrice,
        movementId
      );
      await load();
      return true;
    } catch (e: any) {
      if (isNetworkFailure(e)) {
        // Se cayó por red a mitad del intento: no se le muestra un error
        // al usuario, se encola igual que arriba.
        const productName = products.find((p) => p.id === productId)?.name ?? productId;
        await queueIncreaseStockOffline({
          id: movementId,
          productId,
          productName,
          quantity,
          reason,
          performedBy,
          supplierId,
          purchasePrice
        });
        applyLocalStockDelta(productId, quantity);
        return true;
      }

      setError(e.message ?? "No se pudo aumentar el stock.");
      return false;
    }
  }

  async function decreaseStock(productId: string, quantity: number, reason: string, lossCategory?: LossCategory) {
    setError(null);
    const movementId = crypto.randomUUID();

    if (!connectionStore.isOnline()) {
      const productName = products.find((p) => p.id === productId)?.name ?? productId;
      await queueDecreaseStockOffline({
        id: movementId,
        productId,
        productName,
        quantity,
        reason,
        performedBy,
        lossCategory
      });
      applyLocalStockDelta(productId, -quantity);
      return true;
    }

    try {
      await container.inventoryEngine.decreaseStock(productId, quantity, reason, performedBy, lossCategory, movementId);
      await load();
      return true;
    } catch (e: any) {
      if (isNetworkFailure(e)) {
        const productName = products.find((p) => p.id === productId)?.name ?? productId;
        await queueDecreaseStockOffline({
          id: movementId,
          productId,
          productName,
          quantity,
          reason,
          performedBy,
          lossCategory
        });
        applyLocalStockDelta(productId, -quantity);
        return true;
      }

      setError(e.message ?? "No se pudo descontar el stock.");
      return false;
    }
  }

  async function createProduct(input: ProductInput): Promise<boolean> {
    setError(null);
    try {
      await container.inventoryEngine.createProduct(input, performedBy);
      // Recarga Inventario y sincroniza el catálogo que usa Caja de inmediato.
      await load();
      await productCatalogStore.refresh();
      vimdyCore.emit("inventory");
      return true;
    } catch (e: any) {
      const messages: Record<string, string> = {
        NOMBRE_REQUERIDO: "El nombre del producto es obligatorio.",
        NOMBRE_DUPLICADO: "Ya existe un producto con ese nombre. Usa otro nombre o edita el actual.",
        CATEGORIA_REQUERIDA: "Selecciona una categoría.",
        PRECIO_INVALIDO: "El precio de venta no es válido.",
        SKU_DUPLICADO: "Ya existe un producto con ese SKU.",
        BARCODE_DUPLICADO: "Ya existe un producto con ese código de barras.",
        INGREDIENTE_INEXISTENTE: "Uno de los ingredientes de la receta ya no existe en el inventario.",
        INGREDIENTE_DUPLICADO: "No puedes repetir el mismo ingrediente dentro de una receta.",
        INGREDIENTE_CANTIDAD_INVALIDA: "La cantidad de los ingredientes debe ser mayor a cero.",
      };
      setError(messages[e?.message] ?? "No se pudo crear el producto. Intenta de nuevo.");
      return false;
    }
  }

  async function updateProduct(id: string, input: ProductInput): Promise<boolean> {
    setError(null);
    try {
      await container.inventoryEngine.updateProduct(id, input);
      await load();
      await productCatalogStore.refresh();
      vimdyCore.emit("inventory");
      return true;
    } catch (e: any) {
      const messages: Record<string, string> = {
        NOMBRE_REQUERIDO: "El nombre del producto es obligatorio.",
        NOMBRE_DUPLICADO: "Ya existe un producto con ese nombre. Usa otro nombre o edita el actual.",
        CATEGORIA_REQUERIDA: "Selecciona una categoría.",
        PRECIO_INVALIDO: "El precio de venta no es válido.",
        SKU_DUPLICADO: "Ya existe un producto con ese SKU.",
        BARCODE_DUPLICADO: "Ya existe un producto con ese código de barras.",
        PRODUCT_NOT_FOUND: "Este producto ya no existe.",
        INGREDIENTE_INEXISTENTE: "Uno de los ingredientes de la receta ya no existe en el inventario.",
        INGREDIENTE_DUPLICADO: "No puedes repetir el mismo ingrediente dentro de una receta.",
        INGREDIENTE_CANTIDAD_INVALIDA: "La cantidad de los ingredientes debe ser mayor a cero.",
      };
      setError(messages[e?.message] ?? "No se pudo actualizar el producto. Intenta de nuevo.");
      return false;
    }
  }

  async function deleteProduct(id: string): Promise<boolean> {
    setError(null);
    try {
      await container.inventoryEngine.deleteProduct(id);
      await load();
      await productCatalogStore.refresh();
      vimdyCore.emit("inventory");
      return true;
    } catch (e: any) {
      const messages: Record<string, string> = {
        PRODUCT_NOT_FOUND: "Este producto ya no existe.",
        PRODUCT_IN_USE: "No se puede eliminar porque este producto sigue siendo usado en una receta.",
      };
      setError(messages[e?.message] ?? "No se pudo eliminar el producto. Intenta de nuevo.");
      return false;
    }
  }

  /**
   * BLOQUEANTE (auditoría Fase 2 — Panadería): ejecuta una tanda de
   * producción real (ver InventoryEngine.produceBatch). A diferencia de
   * increaseStock/decreaseStock, esto SÍ requiere conexión: toca varios
   * productos a la vez (todos los ingredientes + el producto elaborado) y
   * necesita el descuento atómico real de cada uno — la cola offline de
   * un solo ajuste no alcanza a garantizar eso. Si el negocio está sin
   * conexión, se le pide reintentar cuando vuelva a tener internet, en
   * vez de fingir que la tanda quedó registrada.
   */
  async function produceBatch(productId: string, quantity: number): Promise<boolean> {
    setError(null);

    if (!connectionStore.isOnline()) {
      setError("Sin conexión: la producción por tanda necesita internet para no dejar el inventario a medias. Intenta de nuevo cuando vuelvas a tener señal.");
      return false;
    }

    try {
      await container.inventoryEngine.produceBatch(productId, quantity, performedBy);
      await load();
      await productCatalogStore.refresh();
      vimdyCore.emit("inventory");
      return true;
    } catch (e: any) {
      const messages: Record<string, string> = {
        PRODUCT_NOT_FOUND: "Este producto ya no existe.",
      };
      const message: string = e?.message ?? "";
      if (message.startsWith("INSUFFICIENT_STOCK")) {
        setError(message.replace("INSUFFICIENT_STOCK: ", "No hay suficiente ingrediente: "));
      } else if (message.startsWith("PRODUCT_HAS_NO_RECIPE") || message.startsWith("NOT_BATCH_PRODUCT") || message.startsWith("INVALID_QUANTITY")) {
        setError(message.split(": ").slice(1).join(": ") || message);
      } else {
        setError(messages[message] ?? "No se pudo registrar la producción. Intenta de nuevo.");
      }
      return false;
    }
  }

  return {
    products,
    recentMovements,
    kpis,
    lowStockProducts,
    loading,
    error,
    refresh: load,
    getHistory,
    increaseStock,
    decreaseStock,
    produceBatch,
    createProduct,
    updateProduct,
    deleteProduct,
    productsWithCost: kpis.productsWithCost,
  };
}