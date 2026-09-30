export interface UserSession {

  id: string;

  name: string;

  role: string;

  email?: string;

  logged: boolean;

  loginAt?: Date;

}

class UserSessionStore {

  private session: UserSession = {

    id: "",

    name: "",

    role: "",

    email: "",

    logged: false

  };

  get() {

    return { ...this.session };

  }

  login(

    id: string,

    name: string,

    role: string,

    email?: string

  ) {

    this.session = {

      id,

      name,

      role,

      email,

      logged: true,

      loginAt: new Date()

    };

  }

  logout() {

    this.session = {

      id: "",

      name: "",

      role: "",

      email: "",

      logged: false

    };

  }

  isLogged() {

    return this.session.logged;

  }

  getRole() {

    return this.session.role;

  }

  getUserName() {

    return this.session.name;

  }

}

export const userSessionStore = new UserSessionStore();