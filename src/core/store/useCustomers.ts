import { useCallback, useEffect, useMemo, useState } from "react";
import { container, productsReady } from "../../infrastructure/di/CompositionRoot";
import { Customer, Product, Sale } from "../entities/Entities";
import { vimdyCore } from "../VimdyCore";
import { connectionStore } from "./connectionStore";
import { isNetworkFailure } from "../services/offlineSale";
import { queueCreateCustomerOffline } from "../services/offlineCustomer";

export type LoyaltyLevel = "bronce" | "plata" | "oro";

export interface LoyaltyInfo {
  level: LoyaltyLevel;
  label: string;
  stars: number;
}

/** Mismos umbrales que ya usa PosCustomer al vender, para que el nivel de
 * un cliente se vea igual en Caja y en la pantalla de Clientes. */
export function getLoyaltyInfo(points: number): LoyaltyInfo {
  if (points >= 500) return { level: "oro", label: "Oro", stars: 5 };
  if (points >= 150) return { level: "plata", label: "Plata", stars: 4 };
  return { level: "bronce", label: "Bronce", stars: 2 };
}

export interface CustomerWithStats extends Customer {
  ltv: number;
  purchaseCount: number;
  lastPurchaseAt: Date | null;
}

export interface CustomersKpis {
  totalCustomers: number;
  totalPoints: number;
  totalLtv: number;
  topCustomer: CustomerWithStats | null;
}

type CustomerStatsMap = Map<
  string,
  { purchaseCount: number; ltv: number; lastPurchaseAt: Date | null }
>;

export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  // FASE 3 (Optimización): antes se guardaba acá el arreglo completo de
  // TODAS las ventas del negocio (getAllSales()) solo para reducirlo a un
  // puñado de números por cliente. Ahora esos números ya vienen calculados
  // desde Postgres (ver SaleRepository.getCustomerPurchaseStats()) y esto
  // guarda directamente el resultado agregado, sin traer una sola venta
  // completa a memoria. El historial detallado de un cliente puntual (el
  // que se ve al abrir su ficha) sigue viniendo aparte, ya optimizado
  // desde antes, vía getSalesFor().
  const [customerStats, setCustomerStats] = useState<CustomerStatsMap>(new Map());
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    await productsReady;
    const [allCustomers, stats, allProducts] = await Promise.all([
      container.customerEngine.get().getAllCustomers(),
      container.salesEngine.get().getCustomerPurchaseStats(),
      container.inventoryEngine.get().listAll(),
    ]);
    setCustomers(allCustomers);
    setCustomerStats(stats);
    setProducts(allProducts);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load()
      .catch((e: any) => setError(e.message ?? "No se pudieron cargar los clientes."))
      .finally(() => setLoading(false));
  }, [load]);

  // Sincronización en vivo: un cliente nuevo/editado en otro dispositivo,
  // o una venta que cambia el LTV/puntos de un cliente, llega vía
  // realtimeSync.ts como evento "customer" o "sale" en este bus.
  useEffect(() => {
    const offCustomer = vimdyCore.on("customer", () => load());
    const offSale = vimdyCore.on("sale", () => load());
    return () => {
      offCustomer();
      offSale();
    };
  }, [load]);

  const productNameById = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [products]);

  const customersWithStats: CustomerWithStats[] = useMemo(() => {
    return customers.map((customer) => {
      const stats = customerStats.get(customer.id);
      return {
        ...customer,
        ltv: stats?.ltv ?? 0,
        purchaseCount: stats?.purchaseCount ?? 0,
        lastPurchaseAt: stats?.lastPurchaseAt ?? null,
      };
    });
  }, [customers, customerStats]);

  const kpis: CustomersKpis = useMemo(() => {
    const totalPoints = customersWithStats.reduce((sum, c) => sum + (c.points ?? 0), 0);
    const totalLtv = customersWithStats.reduce((sum, c) => sum + c.ltv, 0);
    const topCustomer = customersWithStats.length
      ? [...customersWithStats].sort((a, b) => b.ltv - a.ltv)[0]
      : null;
    return {
      totalCustomers: customersWithStats.length,
      totalPoints,
      totalLtv,
      topCustomer: topCustomer && topCustomer.ltv > 0 ? topCustomer : null,
    };
  }, [customersWithStats]);

  // FASE 3 (Optimización): antes leía del arreglo completo de ventas ya
  // cargado en memoria. Ahora pide directo a la base de datos las ventas de
  // ESE cliente (SalesEngine.getSalesByCustomer(), filtrado por SQL) solo
  // cuando alguien realmente abre su ficha — no antes, y no las de nadie
  // más. Ya vienen ordenadas de más nueva a más vieja desde el repositorio.
  async function getSalesFor(customerId: string): Promise<Sale[]> {
    return await container.salesEngine.get().getSalesByCustomer(customerId);
  }

  function getProductName(productId: string): string {
    return productNameById.get(productId) ?? "Producto eliminado";
  }

  async function createCustomer(input: { name: string; email?: string; phone?: string }) {
    setError(null);

    const customer: Customer = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      email: input.email?.trim() ?? "",
      phone: input.phone?.trim() || undefined,
      points: 0,
      createdAt: new Date(),
    };

    // PASO 1.9 (Cola offline para escrituras) — sin conexión real ni
    // siquiera se intenta hablar con Supabase: se va directo al camino
    // offline, igual que hace useInventory.ts con los ajustes de stock.
    if (!connectionStore.isOnline()) {
      await queueCreateCustomerOffline(customer);
      await load();
      return true;
    }

    try {
      await container.customerEngine.get().save(customer);
      await load();
      return true;
    } catch (e: any) {
      if (isNetworkFailure(e)) {
        // Se cayó por red a mitad del intento: no se le muestra un error
        // al usuario, se encola igual que arriba.
        await queueCreateCustomerOffline(customer);
        await load();
        return true;
      }

      setError(e.message ?? "No se pudo crear el cliente.");
      return false;
    }
  }

  async function updateCustomer(customer: Customer) {
    setError(null);
    try {
      await container.customerEngine.get().update(customer);
      await load();
      return true;
    } catch (e: any) {
      setError(e.message ?? "No se pudo actualizar el cliente.");
      return false;
    }
  }

  async function deleteCustomer(id: string) {
    setError(null);
    try {
      await container.customerEngine.get().delete(id);
      await load();
      return true;
    } catch (e: any) {
      setError(e.message ?? "No se pudo eliminar el cliente.");
      return false;
    }
  }

  return {
    customers: customersWithStats,
    kpis,
    loading,
    error,
    getSalesFor,
    getProductName,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    refresh: load,
  };
}