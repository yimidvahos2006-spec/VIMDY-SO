import { Customer, Sale } from '../entities/Entities';
import { IRepository } from '../../infrastructure/di/repositories/IRepository';
import { SaleRepository } from '../../infrastructure/di/repositories/SaleRepository';
import { AuditEngine } from './AuditEngine';
import { getSaleNetTotal, isRevenueSaleStatus } from '../utils/saleRefunds';
import { isOptimisticLockError } from '../errors/OptimisticLockError';
import { vimdyCore } from '../VimdyCore';
import { buildCustomerVipProfile, type CustomerVipProfile } from '../domain/customers/vipProfile';
import { isLoyaltyEligibleCustomer } from '../domain/customers/loyalty';

export interface CustomerProfile {
  readonly customer: Customer;
  readonly sales: Sale[];
  readonly ltv: number;
  /** Resumen VIP derivado de las ventas: gasto, visitas, favoritos, nivel. */
  readonly vip: CustomerVipProfile;
}

/**
 * Paso 5: repositorios que saben leer SOLO del caché local (IndexedDB) y
 * refrescarlo aparte. CustomerRepository lo cumple; los repositorios en
 * memoria de los tests no, y el motor cae a findAll() en ese caso.
 */
export interface LocalFirstCustomerSource {
  findAllLocal(): Promise<Customer[]>;
  refreshFromServer(): Promise<Customer[]>;
}

function isLocalFirstSource(repository: unknown): repository is LocalFirstCustomerSource {
  const candidate = repository as Partial<LocalFirstCustomerSource> | null;
  return (
    typeof candidate?.findAllLocal === "function" &&
    typeof candidate?.refreshFromServer === "function"
  );
}

export class CustomerEngine {
  constructor(
    private readonly customerRepository: IRepository<Customer>,
    // FASE 3 (Optimización): antes era IRepository<Sale> genérico y
    // getCustomerProfile() traía TODA la tabla de ventas con findAll() para
    // filtrar en JavaScript. Se tipa como el repositorio concreto para
    // poder usar findByCustomer(), que filtra por SQL (ver
    // customer_purchase_history_migration.sql).
    private readonly saleRepository: SaleRepository,
    // Paso 6: auditoría real de create/update/delete. Opcional para no romper
    // los constructores existentes de tests y DI que no pasan motor de auditoría;
    // cuando está presente, toda mutación de cliente queda registrada.
    private readonly audit?: AuditEngine
  ) {}

  public async getCustomerProfile(
    id: string
  ): Promise<CustomerProfile> {
    const customer = await this.customerRepository.findById(id);

    if (!customer) {
      throw new Error('CUSTOMER_NOT_FOUND');
    }

    const customerSales = await this.saleRepository.findByCustomer(id);

    const ltv = customerSales.reduce(
      (total, sale) => isRevenueSaleStatus(sale.status)
        ? total + getSaleNetTotal(sale)
        : total,
      0
    );

    return {
      customer,
      sales: customerSales,
      ltv,
      vip: buildCustomerVipProfile(customerSales)
    };
  }

  /**
   * Conexión Caja → Clientes. Se llama cuando una venta con cliente asociado
   * ya quedó COBRADA (SalesEngine.registerPayment).
   *
   * - Suma los puntos ganados al cliente. Si otro dispositivo guardó al mismo
   *   cliente justo antes (OptimisticLockError) se relee y se reintenta una
   *   vez, para no perder puntos por una carrera entre cajas.
   * - El historial y los totales (gasto, visitas, favoritos) no se guardan en
   *   el cliente: se derivan de las ventas, así que ya incluyen esta venta.
   * - Avisa con el evento "customer" para que cualquier pantalla abierta
   *   (Clientes, Dashboard) se refresque sola en segundo plano.
   *
   * Los clientes genéricos de mostrador y los inexistentes se ignoran.
   * Devuelve true si se registró la compra en un cliente real.
   */
  public async recordPurchase(
    customerId: string | null | undefined,
    sale: Sale,
    earnedPoints: number
  ): Promise<boolean> {
    if (!isLoyaltyEligibleCustomer(customerId)) return false;

    const points = Number.isFinite(earnedPoints) ? Math.max(Math.floor(earnedPoints), 0) : 0;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const customer = await this.customerRepository.findById(customerId as string);
      if (!customer) return false;

      if (points === 0) break;

      try {
        await this.customerRepository.update({
          ...customer,
          points: (customer.points ?? 0) + points
        });
        break;
      } catch (error) {
        if (isOptimisticLockError(error) && attempt === 0) continue;
        throw error;
      }
    }

    vimdyCore.emit('customer', {
      action: 'customer.purchase_recorded',
      customerId,
      saleId: sale.id,
      source: 'pos'
    });

    return true;
  }

  public async getAllCustomers(): Promise<Customer[]> {
    return await this.customerRepository.findAll();
  }

  /**
   * Paso 5: clientes leídos solo del caché local, sin esperar a la red.
   * Es lo que usa la búsqueda de Caja para responder al instante.
   */
  public async getCustomersFromLocal(): Promise<Customer[]> {
    if (isLocalFirstSource(this.customerRepository)) {
      return this.customerRepository.findAllLocal();
    }
    return this.customerRepository.findAll();
  }

  /**
   * Paso 5: actualiza el caché local desde Supabase. Devuelve false si este
   * repositorio no tiene caché local; lanza si no hay red o tarda demasiado.
   */
  public async refreshCustomers(): Promise<boolean> {
    if (!isLocalFirstSource(this.customerRepository)) return false;
    await this.customerRepository.refreshFromServer();
    return true;
  }

  /**
   * Paso 6: búsqueda de clientes por nombre, teléfono o correo.
   *
   * Usa SOLO campos que el modelo declara en `Customer` (name, phone, email,
   * documentType, documentNumber). La búsqueda operativa de clientes sigue
   * siendo por nombre, teléfono y correo; el documento fiscal se utiliza para
   * facturación electrónica y no sustituye la identificación interna por UUID.
   *
   * El filtrado por negocio/sucursal NO se hace aquí: lo aplica el RLS del
   * repositorio, de modo que el usuario solo puede buscar dentro de lo que su
   * `auth_branch_ids()` le permite ver.
   */
  public async search(query: string, limit: number = 50): Promise<Customer[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const customers = await this.customerRepository.findAll();

    return customers
      .filter((customer) => {
        const name = (customer.name ?? '').toLowerCase();
        const phone = (customer.phone ?? '').toLowerCase();
        const email = (customer.email ?? '').toLowerCase();
        return name.includes(needle) || phone.includes(needle) || email.includes(needle);
      })
      .slice(0, Math.max(limit, 0));
  }

  /**
   * PASO 3: cliente que ya usa este teléfono según el servidor (o null).
   * Delegado al repositorio concreto; si el repositorio inyectado no lo
   * soporta (tests/DI antiguos) devuelve null.
   */
  public async findByPhone(phone: string, excludeId?: string): Promise<Customer | null> {
    const repo = this.customerRepository as IRepository<Customer> & {
      findByPhone?: (phone: string, excludeId?: string) => Promise<Customer | null>;
    };
    return typeof repo.findByPhone === 'function' ? repo.findByPhone(phone, excludeId) : null;
  }

  public async save(customer: Customer): Promise<void> {
    await this.customerRepository.save(customer);
    await this.logAudit('CUSTOMER_CREATED', customer, `Cliente "${customer.name}" creado.`);
  }

  public async update(customer: Customer): Promise<void> {
    await this.customerRepository.update(customer);
    await this.logAudit('CUSTOMER_UPDATED', customer, `Cliente "${customer.name}" actualizado.`);
  }

  public async delete(id: string): Promise<void> {
    // Se resuelve el cliente antes de borrar para poder auditar con nombre y
    // negocio: si no existe, no se borrea ni se registra nada.
    const customer = await this.customerRepository.findById(id);
    if (!customer) {
      throw new Error('CUSTOMER_NOT_FOUND');
    }

    await this.customerRepository.delete(id);
    await this.logAudit('CUSTOMER_DELETED', customer, `Cliente "${customer.name}" eliminado.`);
  }

  /**
   * Auditoría de clientes. Nunca debe tumbar la operación: si el registro de
   * auditoría falla, la mutación ya quedó confirmada y el error se propaga solo
   * hacia el log, igual que en SalesEngine.
   */
  private async logAudit(
    action: string,
    customer: Customer,
    description: string
  ): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.log(
        customer.businessId ?? 'sistema',
        action,
        'customers',
        description,
        customer.id
      );
    } catch {
      // Auditoría es best-effort: perderla no deshace la operación ya confirmada.
    }
  }
}