export interface Customer {

  id: number;

  name: string;

  phone: string;

  email?: string;

  visits: number;

  totalSpent: number;

  lastVisit?: Date;

}

class CustomerStore {

  private customers: Customer[] = [];

  getAll() {

    return [...this.customers];

  }

  getById(id: number) {

    return this.customers.find(

      customer => customer.id === id

    );

  }

  getByPhone(phone: string) {

    return this.customers.find(

      customer => customer.phone === phone

    );

  }

  add(name: string, phone: string, email?: string) {

    const exists = this.getByPhone(phone);

    if (exists) return exists;

    const customer: Customer = {

      id: Date.now(),

      name,

      phone,

      email,

      visits: 0,

      totalSpent: 0

    };

    this.customers.push(customer);

    return customer;

  }

  registerPurchase(

    phone: string,

    amount: number

  ) {

    const customer = this.getByPhone(phone);

    if (!customer) return;

    customer.visits++;

    customer.totalSpent += amount;

    customer.lastVisit = new Date();

  }

  getBestCustomers(limit: number = 10) {

    return [...this.customers]

      .sort((a, b) => b.totalSpent - a.totalSpent)

      .slice(0, limit);

  }

  clear() {

    this.customers = [];

  }

}

export const customerStore = new CustomerStore();