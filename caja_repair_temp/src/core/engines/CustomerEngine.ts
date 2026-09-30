import { Customer, Sale } from '../entities/Entities';
import { IRepository } from '../../infrastructure/di/repositories/IRepository';
import { SaleRepository } from '../../infrastructure/di/repositories/SaleRepository';

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
    private readonly saleRepository: SaleRepository
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

  public async save(customer: Customer): Promise<void> {
    await this.customerRepository.save(customer);
  }

  public async update(customer: Customer): Promise<void> {
    await this.customerRepository.update(customer);
  }

  public async delete(id: string): Promise<void> {
    await this.customerRepository.delete(id);
  }
}