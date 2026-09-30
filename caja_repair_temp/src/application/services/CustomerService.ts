import { CustomerEngine } from '../../core/engines/CustomerEngine';

export class CustomerService {
  constructor(
    private readonly engine: CustomerEngine
  ) {}

  public async getCustomerProfile(id: string) {
    return await this.engine.getCustomerProfile(id);
  }
}