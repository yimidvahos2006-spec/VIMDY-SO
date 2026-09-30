import { CountryCode } from "../config/globalization";

export interface Business {
  name: string;
  nit: string;
  owner: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  country: CountryCode;
  logo?: string;
  currency: string;
  whatsappOrders?: string;
}

class BusinessStore {
  private business: Business = {
    name: "VIMDY Demo",
    nit: "",
    owner: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    country: "CO",
    logo: "",
    currency: "COP",
    whatsappOrders: ""
  };

  get() {
    return { ...this.business };
  }

  update(data: Partial<Business>) {
    this.business = {
      ...this.business,
      ...data
    };
  }

  setLogo(logo: string) {
    this.business.logo = logo;
  }

  clear() {
    this.business = {
      name: "",
      nit: "",
      owner: "",
      phone: "",
      email: "",
      address: "",
      city: "",
      country: "CO",
      logo: "",
      currency: "COP",
      whatsappOrders: ""
    };
  }
}

export const businessStore = new BusinessStore();