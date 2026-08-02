import { Sale, SaleItem } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { roundMoney } from "../config/globalization";

export interface Receipt {
  id: string;
  code: string;
  customerId: string;
  customerName: string;
  cashier: string;
  paymentMethod: string;
  items: SaleItem[];
  /** Moneda del negocio en el momento de la venta (ej. "COP", "USD", "MXN"). */
  currency: string;
  subtotal: number;
  tax: number;
  discount: number;
  /** BLOQUEANTE (auditoría Fase 2 — rama Bar): ver Sale.tip. */
  tip: number;
  total: number;
  received: number;
  change: number;
  createdAt: Date;
}

/**
 * ReceiptEngine
 * ---------------------------------------------------------------------------
 * Persistencia real de recibos (Fase 1 — Blindar VIMDY).
 *
 * Antes: los recibos vivían SOLO en un array en memoria (`history`) dentro
 * de esta clase. Al recargar la página, cerrar el navegador o entrar desde
 * otro dispositivo, todo el historial de recibos del día desaparecía —
 * incluso una venta ya cobrada no tenía comprobante recuperable.
 *
 * Ahora: cada recibo se guarda en la tabla `receipts` de Supabase (ver
 * supabase/schema.sql), aislado por negocio con Row Level Security, igual
 * que ya pasa con `sales`. Se recibe el repositorio por inyección de
 * dependencias (ver CompositionRoot.ts), mismo patrón que el resto del
 * sistema — nunca se habla con Supabase directamente desde aquí.
 *
 * `code` (el número/id de venta al que corresponde el recibo) no es la
 * llave primaria de la tabla — `id` sí lo es (UUID propio del recibo) —
 * así que las búsquedas por code/cliente/fecha se resuelven trayendo los
 * recibos del negocio y filtrando en memoria, igual que ya hace
 * UserRepository.findByEmail con `app_users`. Es aceptable porque el
 * volumen de recibos de un negocio real es pequeño comparado con hacer
 * scans SQL sobre JSONB para un caso de uso que hoy es de bajo tráfico
 * (historial/reimpresión); si el volumen crece, se puede "sacar" `code` a
 * una columna real sin tocar esta interfaz pública.
 */
export class ReceiptEngine {
  constructor(private readonly repository: IRepository<Receipt>) {}

  /**
   * Genera un recibo y lo persiste de inmediato.
   *
   * `currency` viene de `businesses.currency` (vía companyConfigStore, ver
   * SalesEngine.generateReceipt) y decide cómo se redondean subtotal/tax:
   * en COP y CLP no existen los centavos, así que se redondean a peso
   * entero; en USD/EUR/MXN/PEN/ARS sí llevan 2 decimales. Antes esto era
   * `.toFixed(2)` fijo sin importar el país — un negocio en Bogotá emitía
   * recibos con centavos que ningún cliente puede pagar de verdad.
   */
  public async generate(
    sale: Sale,
    customerName: string,
    cashier: string,
    paymentMethod: string,
    received: number,
    discount: number = 0,
    taxRate: number = 0.19,
    currency: string = "COP"
  ): Promise<Receipt> {
    // BLOQUEANTE (auditoría Fase 2 — rama Bar): sale.total ya incluye la
    // propina (ver SalesEngine.calculateTotal), así que hay que restarla
    // ANTES de estimar subtotal/IVA con la proporción taxRate — si no, una
    // venta con propina mostraría un IVA inflado que nunca se cobró.
    const tip = sale.tip ?? 0;
    const totalWithoutTip = sale.total - tip;
    const subtotal = totalWithoutTip / (1 + taxRate);
    const tax = totalWithoutTip - subtotal;

    const receipt: Receipt = {
      id: crypto.randomUUID(),
      code: sale.id,
      customerId: sale.customerId,
      customerName,
      cashier,
      paymentMethod,
      items: [...sale.items],
      currency,
      subtotal: roundMoney(subtotal, currency),
      tax: roundMoney(tax, currency),
      discount: roundMoney(discount, currency),
      tip: roundMoney(tip, currency),
      total: roundMoney(sale.total, currency),
      received: roundMoney(received, currency),
      change: roundMoney(Math.max(received - sale.total, 0), currency),
      createdAt: new Date()
    };

    await this.repository.save(receipt);

    return receipt;
  }

  /**
   * Obtiene todos los recibos del negocio.
   */
  public async getAll(): Promise<Receipt[]> {
    return this.repository.findAll();
  }

  /**
   * Busca un recibo por el código (id) de la venta a la que pertenece.
   */
  public async getByCode(code: string): Promise<Receipt | undefined> {
    const receipts = await this.repository.findAll();
    return receipts.find(receipt => receipt.code === code);
  }

  /**
   * Recibos del cliente.
   */
  public async getByCustomer(customerId: string): Promise<Receipt[]> {
    const receipts = await this.repository.findAll();
    return receipts.filter(receipt => receipt.customerId === customerId);
  }

  /**
   * Recibos del día.
   */
  public async getToday(): Promise<Receipt[]> {
    const today = new Date().toDateString();
    const receipts = await this.repository.findAll();
    return receipts.filter(
      receipt => receipt.createdAt.toDateString() === today
    );
  }

  /**
   * Últimos recibos, del más reciente al más antiguo.
   */
  public async getRecent(limit: number = 20): Promise<Receipt[]> {
    const receipts = await this.repository.findAll();
    return receipts
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  /**
   * Total facturado.
   */
  public async getTotalAmount(): Promise<number> {
    const receipts = await this.repository.findAll();
    return receipts.reduce((sum, receipt) => sum + receipt.total, 0);
  }

  /**
   * Total impuestos.
   */
  public async getTotalTaxes(): Promise<number> {
    const receipts = await this.repository.findAll();
    return receipts.reduce((sum, receipt) => sum + receipt.tax, 0);
  }

  /**
   * Total descuentos.
   */
  public async getTotalDiscounts(): Promise<number> {
    const receipts = await this.repository.findAll();
    return receipts.reduce((sum, receipt) => sum + receipt.discount, 0);
  }

  /**
   * Total propinas. BLOQUEANTE (auditoría Fase 2 — rama Bar): antes no
   * existía el dato en ningún lado, así que no había forma de saber cuánta
   * propina se cobró en un turno/día — ni para el cajero, ni para
   * repartirla entre meseros al cierre.
   */
  public async getTotalTips(): Promise<number> {
    const receipts = await this.repository.findAll();
    return receipts.reduce((sum, receipt) => sum + receipt.tip, 0);
  }

  /**
   * Reimprime un recibo ya emitido (lo trae de Supabase, no de memoria).
   */
  public async reprint(code: string): Promise<Receipt> {
    const receipt = await this.getByCode(code);

    if (!receipt) {
      throw new Error("RECEIPT_NOT_FOUND");
    }

    return receipt;
  }

  /**
   * Elimina un recibo (por code, es decir por la venta a la que pertenece).
   */
  public async remove(code: string): Promise<void> {
    const receipt = await this.getByCode(code);

    if (!receipt) {
      return;
    }

    await this.repository.delete(receipt.id);
  }
}