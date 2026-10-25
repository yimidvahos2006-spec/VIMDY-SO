import { Product, SaleItem } from '../entities/Entities';
import {
  applyLineOperation,
  normalizeLineNote,
  sameLine
} from '../offline/tableLineRules';

// La identidad de línea vive en tableLineRules.ts (fuente única, también la
// usan la cola offline y el estado optimista). Se re-exporta por compatibilidad.
export { normalizeLineNote };

/**
 * Identifica una línea del carrito cuando un mismo producto puede tener varias
 * variantes: nota, tamaño y extras. Lo que no se indica cuenta como "ninguno".
 */
export interface CartLineRef {
  note?: string | null;
  selectedSizeId?: string | null;
  selectedExtraIds?: readonly string[] | null;
}

export interface CartAddOptions {
  /**
   * true  → el mismo producto con OTRA nota queda en una línea aparte
   *         (mesas: "sin cebolla" no se le pega a la hamburguesa normal).
   * false → comportamiento clásico (Caja/POS): una línea por producto.
   */
  splitByNote?: boolean;
  /** Variante elegida (solo se usa con splitByNote): tamaño y extras forman parte de la identidad. */
  selectedSizeId?: string | null;
  selectedExtraIds?: readonly string[] | null;
}

export class CartEngine {
  private items: SaleItem[] = [];

  public addItem(
    product: Product,
    quantity = 1,
    note?: string,
    options: CartAddOptions = {}
  ): void {
    const wanted = normalizeLineNote(note);
    const index = this.items.findIndex(item =>
      options.splitByNote
        ? sameLine(item, {
            productId: product.id,
            note: wanted,
            selectedSizeId: options.selectedSizeId,
            selectedExtraIds: options.selectedExtraIds
          })
        : item.productId === product.id
    );

    if (index >= 0) {
      const current = this.items[index];

      const updated: SaleItem = {
        ...current,
        quantity: current.quantity + quantity,
        ...(wanted ? { note: wanted } : {})
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
        ...(wanted ? { note: wanted } : {}),
        ...(options.splitByNote && options.selectedSizeId
          ? { selectedSizeId: options.selectedSizeId }
          : {}),
        ...(options.splitByNote && options.selectedExtraIds?.length
          ? { selectedExtraIds: [...new Set(options.selectedExtraIds)].sort() }
          : {}),
        requiresKitchen: product.requiresKitchen ?? false
      }
    ];
  }

  /** ¿Esta línea es la indicada? Sin `line` basta el producto (comportamiento clásico). */
  private matchesLine(item: SaleItem, productId: string, line?: CartLineRef): boolean {
    if (item.productId !== productId) return false;
    if (!line) return true;
    return sameLine(item, { productId, ...line });
  }

  public removeItem(productId: string, line?: CartLineRef): void {
    this.items = this.items.filter(
      item => !this.matchesLine(item, productId, line)
    );
  }

  public updateQuantity(
    productId: string,
    quantity: number,
    line?: CartLineRef
  ): void {
    if (quantity <= 0) {
      this.removeItem(productId, line);
      return;
    }

    this.items = this.items.map(item =>
      this.matchesLine(item, productId, line)
        ? {
            ...item,
            quantity
          }
        : item
    );
  }

  /**
   * Cambia la nota de una línea de mesa. Con `units` menor que la cantidad de
   * la línea, solo esas unidades pasan a la nota nueva (ej. 2 hamburguesas,
   * una "sin cebolla"); el resto queda como estaba. Si ya existe una línea del
   * mismo producto con la nota nueva, las unidades se suman a ella.
   */
  public setLineNote(
    productId: string,
    fromNote: string | null | undefined,
    toNote: string | null | undefined,
    units?: number,
    variant?: Pick<CartLineRef, 'selectedSizeId' | 'selectedExtraIds'>
  ): void {
    this.items = applyLineOperation(this.items, {
      type: 'UPDATE_NOTE',
      line: { productId, note: fromNote, ...variant },
      toNote,
      units
    });
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