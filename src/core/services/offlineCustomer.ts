import { Customer } from "../entities/Entities";
import { pendingCustomerOperationsStore } from "../offline/pendingCustomerOperationsStore";
import { CustomerLocalRepository } from "../../infrastructure/di/repositories/CustomerLocalRepository";
import { toast } from "../store/toastStore";
import { vimdyCore } from "../VimdyCore";
import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { isNetworkFailure } from "./offlineSale";
import { isCustomerPhoneConflict } from "../offline/customerPhoneConflict";

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

export interface CheckoutCustomerResult {
  /** Cliente que debe quedar seleccionado en la venta. */
  readonly customer: Customer;
  /** true = quedó en la cola offline (se sincroniza al volver internet). */
  readonly queued: boolean;
  /** true = el teléfono ya existía en el servidor y se usó ese cliente. */
  readonly linkedToExisting: boolean;
}

/**
 * Creación rápida de un cliente desde Caja (CustomerCheckoutModal).
 *
 * Mismo criterio que useCustomers.createCustomer(), pero sin recargar la
 * lista completa ni las estadísticas de compras (en Caja cada segundo
 * cuenta):
 * - sin conexión, o red caída a mitad del guardado -> cola offline;
 * - teléfono ya registrado (23505) -> se reconecta con el cliente existente
 *   (Paso 3) en vez de fallar.
 * Cualquier otro error se propaga para que el modal lo muestre.
 */
export async function createCustomerFromCheckout(
  customer: Customer
): Promise<CheckoutCustomerResult> {
  if (!connectionStore.isOnline()) {
    await queueCreateCustomerOffline(customer);
    return { customer, queued: true, linkedToExisting: false };
  }

  try {
    await container.customerEngine.get().save(customer);
    // Paso 5: el cliente recién creado queda también en el caché local, para
    // poder buscarlo sin internet aunque aún no haya habido un refresco.
    await local.save(customer).catch(() => undefined);
    vimdyCore.emit("customer", { action: "customer.created", customer });
    return { customer, queued: false, linkedToExisting: false };
  } catch (error) {
    if (isNetworkFailure(error)) {
      await queueCreateCustomerOffline(customer);
      return { customer, queued: true, linkedToExisting: false };
    }

    if (isCustomerPhoneConflict(error) && customer.phone) {
      const existing = await container.customerEngine
        .get()
        .findByPhone(customer.phone, customer.id);

      if (existing) {
        return { customer: existing, queued: false, linkedToExisting: true };
      }
    }

    throw error;
  }
}