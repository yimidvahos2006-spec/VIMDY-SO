import { ObservableStore } from "./ObservableStore";
import type { KitchenOutputMode } from "../services/kitchenOutput";

/**
 * Punto 5.5/5.7: qué usa el negocio ACTUAL para recibir comandas en Cocina
 * ("pantalla" o "impresora"). Los engines que envían a cocina (OrderEngine,
 * TableEngine, SalesEngine) leen esto en vivo con .get() en el momento de
 * enviar — mismo patrón que companyConfigStore.get().tax en SalesEngine.
 *
 * Default "none": durante el arranque todavía no conocemos la configuración
 * operativa del negocio. Así nunca enviamos accidentalmente una comanda a
 * una pantalla inexistente mientras el perfil real se está hidratando.
 * La configuración persistida se aplica desde businessOperatingProfileBootstrap.
 */
class KitchenOutputModeStore extends ObservableStore<KitchenOutputMode> {
  constructor() {
    super("none");
  }

  get(): KitchenOutputMode {
    return this.snapshot;
  }

  set(mode: KitchenOutputMode) {
    this.publish(mode);
  }

  clear() {
    this.publish("none");
  }
}

export const kitchenOutputModeStore = new KitchenOutputModeStore();