import { Product, SaleItem } from '../entities/Entities';

export class CartEngine {
  private items: SaleItem[] = [];

  public addItem(product: Product, quantity = 1, note?: string): void {
    const index = this.items.findIndex(
      item => item.productId === product.id
    );

    if (index >= 0) {
      const current = this.items[index];

      const updated: SaleItem = {
        ...current,
        quantity: current.quantity + quantity,
        ...(note ? { note } : {})
      };

      this.items = this.items.map((item, i) =>
        i === index ? updated : item
      );

      return;
    }

    this.items = [
      ...this.items,
      {
        productId: product.id,
        quantity,
        price: product.price,
        ...(note ? { note } : {}),
        requiresKitchen: product.requiresKitchen ?? true
      }
    ];
  }

  public removeItem(productId: string): void {
    this.items = this.items.filter(
      item => item.productId !== productId
    );
  }

  public updateQuantity(
    productId: string,
    quantity: number
  ): void {
    if (quantity <= 0) {
      this.removeItem(productId);
      return;
    }

    this.items = this.items.map(item =>
      item.productId === productId
        ? {
            ...item,
            quantity
          }
        : item
    );
  }

  public clear(): void {
    this.items = [];
  }

  /**
   * Reconstruye el carrito a partir de items YA persistidos (ej.
   * Table.items leído fresco del repositorio/Supabase). A diferencia de
   * addItem(), no recibe un Product ni recalcula precio/requiresKitchen:
   * esos items ya tienen su valor definitivo (el que se congeló cuando se
   * agregaron la primera vez), así que se cargan tal cual.
   *
   * Existe para que un engine pueda usar CartEngine como calculadora de
   * carrito sin mantener una copia propia en memoria — el estado real
   * sigue viviendo en la base de datos, no en esta instancia.
   */
  public loadItems(items: readonly SaleItem[]): void {
    this.items = [...items];
  }

  public getItems(): SaleItem[] {
    return [...this.items];
  }

  public getTotal(): number {
    return this.items.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    );
  }

  public getCount(): number {
    return this.items.reduce(
      (total, item) => total + item.quantity,
      0
    );
  }

  public isEmpty(): boolean {
    return this.items.length === 0;
  }
}