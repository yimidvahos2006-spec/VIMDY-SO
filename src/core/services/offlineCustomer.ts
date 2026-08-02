import { Customer } from "../entities/Entities";
import { pendingCustomerOperationsStore } from "../offline/pendingCustomerOperationsStore";
import { CustomerLocalRepository } from "../../infrastructure/di/repositories/CustomerLocalRepository";
import { toast } from "../store/toastStore";
import { vimdyCore } from "../VimdyCore";

/**
 * offlineCustomer.ts
 * ---------------------------------------------------------------------------
 * PASO 1.9 del plan offline: equivalente de offlineInventory.ts/offlineTable.ts
 * para creación de clientes. `isNetworkFailure` para esta operación se
 * reutiliza tal cual desde offlineSale.ts (ver useCustomers.ts) — la
 * distinción entre error de red y error de negocio no depende de qué
 * operación se esté haciendo.
 *
 * Encola el cliente en pendingCustomerOperationsStore Y lo guarda de
 * inmediato en el caché local de Clientes (CustomerLocalRepository, el
 * mismo que ya usa CustomerRepository.findAll() — ver Paso 1.5), para que
 * la pantalla de Clientes (y Caja, al buscar cliente para una venta) lo
 * vean sin esperar a que vuelva la conexión. La fila REAL en Supabase recién
 * se crea cuando la operación se sincroniza (ver syncPendingCustomerOperations.ts).
 */

const local = new CustomerLocalRepository();

const OFFLINE_CREATE_MESSAGE =
  "Sin conexión: el cliente quedó guardado en este dispositivo y se sincronizará solo cuando vuelva internet.";

/**
 * Encola la creación de un cliente hecha sin conexión. `customer.id` debe
 * venir ya generado por el llamador (checklist crítico #4 / mismo criterio
 * que las otras colas) — es la misma clave de idempotencia que evita
 * duplicar el cliente cuando esta operación se sincronice de verdad.
 */
export async function queueCreateCustomerOffline(customer: Customer): Promise<Customer> {
  await pendingCustomerOperationsStore.enqueue(customer);

  await local.save(customer);
  vimdyCore.emit("customer", { action: "customer.created", customer });

  toast.warning(OFFLINE_CREATE_MESSAGE);

  return customer;
}