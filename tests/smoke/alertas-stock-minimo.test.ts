// tests/smoke/alertas-stock-minimo.test.ts
/* ===========================================================================
   SMOKE TEST — FASE I: cierre de Inventario. Alertas de stock mínimo
   ---------------------------------------------------------------------------
   `AlertEngine.checkStockAlerts()` se inyecta en SalesEngine en todos los
   smoke tests de venta, pero ninguno prueba SU lógica directamente -- y
   trae una regla delicada, documentada en su propio comentario: un
   producto con `trackStock === false` (Servicio, o un preparado a la orden
   como Café/Pizza) nace y se queda en `stock: 0` A PROPÓSITO porque no
   maneja stock propio -- sin el chequeo que ya tiene, quedaría marcado
   para siempre como "agotado", una alerta falsa que un dueño con cientos
   de productos preparados vería todos los días sin que signifique nada.

   Esta es la última pieza de Fase I: correr esa regla contra los 13
   productos de referencia (mismo catálogo que Fase G), como cierre real de
   Inventario antes de pasar a Caja/Impresoras -- si algún producto de esta
   lista generara una alerta que no debería (o se quedara callado cuando sí
   debería alertar), es aquí donde se ve.
=========================================================================== */

import { describe, it, expect } from "vitest";

import { Product } from "../../src/core/entities/Entities";
import { AlertEngine } from "../../src/core/engines/AlertEngine";
import { computeTracksStock } from "../../src/core/utils/productVisualType";

const alertEngine = new AlertEngine();

function product(overrides: Partial<Product> & { id: string; name: string }): Product {
  return {
    categoryId: "cat-1",
    price: 0,
    minStock: 0,
    active: true,
    favorite: false,
    productionMode: "ON_DEMAND",
    ...overrides
  } as Product;
}

describe("Fase I — AlertEngine.checkStockAlerts: reglas base", () => {
  it("Stock por debajo del mínimo -> alerta HIGH 'stock bajo'", () => {
    const p = product({ id: "p1", name: "Coca-Cola", stock: 4, minStock: 6, trackStock: true });
    const alerts = alertEngine.checkStockAlerts([p]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].priority).toBe("HIGH");
    expect(alerts[0].title).toBe("Coca-Cola con stock bajo");
  });

  it("Stock en cero -> alerta CRITICAL 'agotado' (no HIGH)", () => {
    const p = product({ id: "p1", name: "Coca-Cola", stock: 0, minStock: 6, trackStock: true });
    const alerts = alertEngine.checkStockAlerts([p]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].priority).toBe("CRITICAL");
    expect(alerts[0].title).toBe("Coca-Cola agotado");
  });

  it("Stock por encima del mínimo -> sin alerta", () => {
    const p = product({ id: "p1", name: "Coca-Cola", stock: 40, minStock: 6, trackStock: true });
    expect(alertEngine.checkStockAlerts([p])).toHaveLength(0);
  });

  it("Stock exactamente en el mínimo -> SÍ alerta (el límite es inclusive)", () => {
    const p = product({ id: "p1", name: "Coca-Cola", stock: 6, minStock: 6, trackStock: true });
    const alerts = alertEngine.checkStockAlerts([p]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].priority).toBe("HIGH");
  });
});

describe("Fase I — AlertEngine contra los 13 productos de referencia", () => {
  it("Los preparados a la orden (Café, Pizza, Jugo, Pollo...) con stock 0 NUNCA generan alerta falsa", () => {
    // trackStock=false es justo lo que produce computeTracksStock() para
    // cocina_receta + ON_DEMAND -- el mismo cálculo que ya usa el editor.
    expect(computeTracksStock("cocina_receta", true, "ON_DEMAND")).toBe(false);

    const preparadosALaOrden = [
      product({ id: "cafe", name: "Café", stock: 0, minStock: 0, trackStock: false }),
      product({ id: "pizza", name: "Pizza", stock: 0, minStock: 0, trackStock: false }),
      product({ id: "hamburguesa", name: "Hamburguesa", stock: 0, minStock: 0, trackStock: false }),
      product({ id: "perro", name: "Perro", stock: 0, minStock: 0, trackStock: false }),
      product({ id: "jugo", name: "Jugo", stock: 0, minStock: 0, trackStock: false }),
      product({ id: "batido", name: "Batido", stock: 0, minStock: 0, trackStock: false }),
      product({ id: "pollo", name: "Pollo preparado", stock: 0, minStock: 0, trackStock: false })
    ];

    expect(alertEngine.checkStockAlerts(preparadosALaOrden)).toHaveLength(0);
  });

  it("Domicilio (Servicio) nunca genera alerta, sin importar el stock", () => {
    expect(computeTracksStock("servicio", false, "ON_DEMAND")).toBe(false);
    const domicilio = product({ id: "domicilio", name: "Domicilio", stock: 0, minStock: 0, trackStock: false });
    expect(alertEngine.checkStockAlerts([domicilio])).toHaveLength(0);
  });

  it("Stock directo (Coca-Cola, Cerveza, Helado) y producción por tanda (Pastel, Pan) SÍ alertan cuando corresponde", () => {
    expect(computeTracksStock("inventario", false, "ON_DEMAND")).toBe(true);
    expect(computeTracksStock("cocina_receta", true, "BATCH")).toBe(true);

    const manejanStockPropio = [
      product({ id: "coca", name: "Coca-Cola", stock: 2, minStock: 6, trackStock: true }),
      product({ id: "cerveza", name: "Cerveza", stock: 0, minStock: 12, trackStock: true }),
      product({ id: "helado", name: "Helado", stock: 3, minStock: 5, trackStock: true }),
      product({ id: "pastel", name: "Pastel", stock: 1, minStock: 2, trackStock: true }),
      product({ id: "pan", name: "Pan", stock: 0, minStock: 10, trackStock: true })
    ];

    const alerts = alertEngine.checkStockAlerts(manejanStockPropio);
    expect(alerts).toHaveLength(5);
    expect(alerts.find((a) => a.title === "Cerveza agotado")?.priority).toBe("CRITICAL");
    expect(alerts.find((a) => a.title === "Coca-Cola con stock bajo")?.priority).toBe("HIGH");
    expect(alerts.find((a) => a.title === "Pan agotado")?.priority).toBe("CRITICAL");
  });

  it("Catálogo completo de los 13: exactamente los que manejan stock propio y están bajos generan alerta, ni uno más ni uno menos", () => {
    const catalogo = [
      product({ id: "coca", name: "Coca-Cola", stock: 2, minStock: 6, trackStock: true }),       // alerta
      product({ id: "cerveza", name: "Cerveza", stock: 60, minStock: 12, trackStock: true }),    // sin alerta (bien surtida)
      product({ id: "cafe", name: "Café", stock: 0, minStock: 0, trackStock: false }),           // sin alerta (no maneja stock)
      product({ id: "pizza", name: "Pizza", stock: 0, minStock: 0, trackStock: false }),         // sin alerta
      product({ id: "hamburguesa", name: "Hamburguesa", stock: 0, minStock: 0, trackStock: false }), // sin alerta
      product({ id: "perro", name: "Perro", stock: 0, minStock: 0, trackStock: false }),         // sin alerta
      product({ id: "jugo", name: "Jugo", stock: 0, minStock: 0, trackStock: false }),           // sin alerta
      product({ id: "batido", name: "Batido", stock: 0, minStock: 0, trackStock: false }),       // sin alerta
      product({ id: "pastel", name: "Pastel", stock: 0, minStock: 2, trackStock: true }),        // alerta (agotado)
      product({ id: "pan", name: "Pan", stock: 40, minStock: 10, trackStock: true }),            // sin alerta (bien surtido)
      product({ id: "helado", name: "Helado", stock: 5, minStock: 5, trackStock: true }),        // alerta (justo en el mínimo)
      product({ id: "pollo", name: "Pollo preparado", stock: 0, minStock: 0, trackStock: false }), // sin alerta
      product({ id: "domicilio", name: "Domicilio", stock: 0, minStock: 0, trackStock: false })  // sin alerta
    ];

    const alerts = alertEngine.checkStockAlerts(catalogo);
    const titles = alerts.map((a) => a.title).sort();

    expect(titles).toEqual([
      "Coca-Cola con stock bajo",
      "Helado con stock bajo",
      "Pastel agotado"
    ]);
  });
});