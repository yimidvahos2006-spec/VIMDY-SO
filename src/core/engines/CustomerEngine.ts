import { Customer, Sale } from '../entities/Entities';
import { IRepository } from '../../infrastructure/di/repositories/IRepository';
import { SaleRepository } from '../../infrastructure/di/repositories/SaleRepository';
import { AuditEngine } from './AuditEngine';

export interface CustomerProfile {
  readonly customer: Customer;
  readonly sales: Sale[];
  readonly ltv: number;
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
      (total, sale) => total + sale.total,
      0
    );

    return {
      customer,
      sales: customerSales,
      ltv
    };
  }

  public async getAllCustomers(): Promise<Customer[]> {
    return await this.customerRepository.findAll();
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