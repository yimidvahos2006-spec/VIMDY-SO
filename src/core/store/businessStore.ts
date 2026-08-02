export interface Business {

  name: string;

  nit: string;

  owner: string;

  phone: string;

  email: string;

  address: string;

  city: string;

  country: string;

  logo?: string;

  currency: string;

  /**
   * Número de WhatsApp donde le llegan al negocio los pedidos a domicilio
   * (formato libre, ej. "+57 300 1234567"). Obligatorio cuando
   * CompanyConfig.enableDelivery es true (ver SettingsDashboard.tsx) — es
   * lo que usa el QR del ticket (Configuración > Impresión) para abrir un
   * chat de WhatsApp real con el negocio. Si está vacío, se usa `phone`
   * como respaldo al armar ese QR.
   */
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

    country: "Colombia",

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

      country: "Colombia",

      logo: "",

      currency: "COP",

      whatsappOrders: ""

    };

  }

}

export const businessStore = new BusinessStore();