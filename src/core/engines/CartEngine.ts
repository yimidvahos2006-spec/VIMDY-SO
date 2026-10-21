import { Product, SaleItem } from '../entities/Entities';

/** Nota normalizada: sin espacios sobrantes; "sin nota" es siempre "". */
export function normalizeLineNote(note?: string | null): string {
  return (note ?? '').trim();
}

/** Identifica una línea del carrito cuando un mismo producto puede tener varias notas. */
export interface CartLineRef {
  note?: string | null;
}

export interface CartAddOptions {
  /**
   * true  → el mismo producto con OTRA nota queda en una línea aparte
   *         (mesas: "sin cebolla" no se le pega a la hamburguesa normal).
   * false → comportamiento clásico (Caja/POS): una línea por producto.
   */
  splitByNote?: boolean;
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
      item.productId === product.id &&
      (!options.splitByNote || normalizeLineNote(item.note) === wanted)
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
        requiresKitchen: product.requiresKitchen ?? false
      }
    ];
  }

  /** ¿Esta línea es la indicada? Sin `line` basta el producto (comportamiento clásico). */
  private matchesLine(item: SaleItem, productId: string, line?: CartLineRef): boolean {
    if (item.productId !== productId) return false;
    if (!line) return true;
    return normalizeLineNote(item.note) === normalizeLineNote(line.note);
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
    units?: number
  ): void {
    const from = normalizeLineNote(fromNote);
    const to = normalizeLineNote(toNote);
    if (from === to) return;

    const index = this.items.findIndex(item => this.matchesLine(item, productId, { note: from }));
    if (index < 0) return;

    const line = this.items[index];
    const isPartial =
      units !== undefined &&
      Number.isFinite(units) &&
      units >= 1 &&
      units < line.quantity &&
      line.quantityRaw === undefined;
    const moved = isPartial ? Math.trunc(units as number) : line.quantity;
    const withNote = (item: SaleItem, quantity: number): SaleItem => {
      const { note: _omit, ...rest } = item;
      return { ...rest, quantity, ...(to ? { note: to } : {}) };
    };

    const targetIndex = this.items.findIndex(
      (item, i) => i !== index && this.matchesLine(item, productId, { note: to })
    );

    const next = this.items.map(item => ({ ...item }));

    if (targetIndex >= 0) {
      next[targetIndex] = { ...next[targetIndex], quantity: next[targetIndex].quantity + moved };
      if (isPartial) next[index] = { ...next[index], quantity: line.quantity - moved };
      else next.splice(index, 1);
    } else if (isPartial) {
      next[index] = { ...next[index], quantity: line.quantity - moved };
      next.splice(index + 1, 0, withNote(line, moved));
    } else {
      next[index] = withNote(line, line.quantity);
    }

    this.items = next;
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