import { ObservableStore } from "./ObservableStore";
import { roundWeight, WEIGHT_STEP } from "../utils/weightUnits";

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  note?: string;
  discount?: number;
  /**
   * Paso 2.6 (Cocina en el botón de Caja): copia de Product.requiresKitchen
   * tomada en el momento en que el producto entra al carrito de la UI
   * (distinto del carrito de dominio en CartEngine/SaleItem, que ya tenía
   * su propia copia). PosSalePanel la usa para decidir si el botón dice
   * "Cocina" o "Cobrar". Default true si no vino (mismo criterio que el
   * resto del catálogo).
   */
  requiresKitchen?: boolean;
  /**
   * BLOQUEANTE (auditoría Fase 2 — Supermercado): copia de Product.unit
   * tomada al agregar el ítem (ej. "kg", "litro", "unidad"). Puramente
   * informativa para la UI (PosCart la muestra junto a la cantidad); quien
   * decide el COMPORTAMIENTO (cantidad decimal, paso de +/-) es
   * `soldByWeight`, no este texto.
   */
  unit?: string;
  /**
   * true si este ítem se vende por peso/volumen variable (ver
   * core/utils/weightUnits.ts) — se agregó desde el modal de báscula
   * (PosWeightEntryModal) en vez de agregarse con cantidad 1 fija. Cambia
   * cómo add()/increase()/decrease()/setQuantity() tratan `quantity`:
   * decimal con 3 cifras en vez de entero.
   */
  soldByWeight?: boolean;
}

class CartStore extends ObservableStore<CartItem[]> {
  private items: CartItem[] = [];

  constructor() {
    super([]);
  }

  /** Refresca el snapshot inmutable y notifica a los componentes suscritos. */
  private sync() {
    this.publish([...this.items]);
  }

  getItems() {
    return this.snapshot;
  }

  getTotal() {
    return this.items.reduce(
      (total, item) => total + (item.price - (item.discount ?? 0)) * item.quantity,
      0
    );
  }

  getCount() {
    return this.items.reduce((count, item) => count + item.quantity, 0);
  }

  /**
   * `quantity` es opcional y solo lo usa el modal de báscula (ver
   * PosWeightEntryModal): al pesar un producto, se conoce de entrada el
   * peso exacto que hay que agregar, en vez del 1 fijo de siempre. Si el
   * producto YA está en el carrito con la misma nota/descuento, el peso
   * nuevo se SUMA al de la línea existente (igual que escanear dos veces
   * un producto normal suma +1 en vez de crear una segunda línea).
   */
  add(item: Omit<CartItem, "quantity"> & { quantity?: number }) {
    const { quantity: initialQuantity, ...rest } = item;

    const existing = this.items.find(
      (i) => i.id === rest.id && i.note === rest.note && i.discount === rest.discount
    );

    if (existing) {
      const nextQuantity = existing.quantity + (initialQuantity ?? 1);
      existing.quantity = existing.soldByWeight ? roundWeight(nextQuantity) : nextQuantity;
    } else {
      this.items.push({ ...rest, quantity: initialQuantity ?? 1 });
    }

    this.sync();
  }

  remove(id: string) {
    this.items = this.items.filter((item) => item.id !== id);
    this.sync();
  }

  /**
   * Paso de +1 normal para productos por unidad; para un producto pesado
   * (soldByWeight) suma WEIGHT_STEP (0.1 kg/litro) en vez de una unidad
   * entera, que no tendría sentido para algo que se vende suelto.
   */
  increase(id: string) {
    const item = this.items.find((item) => item.id === id);
    if (!item) return;

    if (item.soldByWeight) {
      item.quantity = roundWeight(item.quantity + WEIGHT_STEP);
    } else {
      item.quantity++;
    }

    this.sync();
  }

  decrease(id: string) {
    const item = this.items.find((item) => item.id === id);
    if (!item) return;

    item.quantity = item.soldByWeight
      ? roundWeight(item.quantity - WEIGHT_STEP)
      : item.quantity - 1;

    if (item.quantity <= 0) {
      this.remove(id);
      return;
    }

    this.sync();
  }

  /**
   * Fija la cantidad de un ítem escrita manualmente por el cajero.
   * Si el valor es 0 o negativo, el producto se elimina del carrito
   * (mismo comportamiento que decrease() al llegar a 0).
   *
   * BLOQUEANTE (auditoría Fase 2 — Supermercado): antes esto SIEMPRE hacía
   * Math.floor(quantity), así que un cajero no podía escribir "0.750" a
   * mano ni para un producto pesado — se convertía en "0" y desaparecía
   * del carrito. Ahora un ítem soldByWeight conserva decimales (redondeados
   * a gramo/mililitro exacto); el resto del catálogo sigue funcionando
   * exactamente igual que siempre (entero).
   */
  setQuantity(id: string, quantity: number) {
    const item = this.items.find((item) => item.id === id);
    if (!item) return;

    const safeQuantity = item.soldByWeight ? roundWeight(quantity) : Math.floor(quantity);

    if (!Number.isFinite(safeQuantity) || safeQuantity <= 0) {
      this.remove(id);
      return;
    }

    item.quantity = safeQuantity;
    this.sync();
  }

  updateNote(id: string, note: string) {
    const item = this.items.find((item) => item.id === id);
    if (item) {
      item.note = note;
      this.sync();
    }
  }

  updateDiscount(id: string, discount: number) {
    const item = this.items.find((item) => item.id === id);
    if (item) {
      item.discount = discount;
      this.sync();
    }
  }

  clear() {
    this.items = [];
    this.sync();
  }
}

export const cartStore = new CartStore();