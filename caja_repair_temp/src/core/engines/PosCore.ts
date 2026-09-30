import { Product, Sale, SaleItem } from "../entities/Entities";

import { CartEngine } from "./CartEngine";
import { InventoryEngine } from "./InventoryEngine";
import { KitchenEngine } from "./KitchenEngine";
import { AIEngine } from "./AIEngine";

export class  PosCore{

  constructor(

    private readonly cart: CartEngine,

    private readonly inventory: InventoryEngine,

    private readonly kitchen: KitchenEngine,

    private readonly ai: AIEngine

  ) {}

  /**
   * Agrega un producto al carrito.
   */
  public addProduct(
    product: Product,
    quantity: number = 1
  ): void {

    this.cart.addItem(product, quantity);

  }

  /**
   * Elimina un producto.
   */
  public removeProduct(productId: string): void {

    this.cart.removeItem(productId);

  }

  /**
   * Vacía el carrito.
   */
  public clearCart(): void {

    this.cart.clear();

  }

  /**
   * Total actual.
   */
  public getTotal(): number {

    return this.cart.getTotal();

  }

  /**
   * Productos del carrito.
   */
  public getItems(): SaleItem[] {

    return this.cart.getItems();

  }

  /**
   * Cantidad de productos.
   */
  public getCount(): number {

    return this.cart.getCount();

  }

  /**
   * Valida si existe una venta.
   */
  public canProcessSale(): boolean {

    return !this.cart.isEmpty();

  }

}