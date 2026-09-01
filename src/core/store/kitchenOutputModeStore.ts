import { ObservableStore } from "./ObservableStore";
import type { KitchenOutputMode } from "../services/kitchenOutput";

/**
 * Punto 5.5/5.7: qué usa el negocio ACTUAL para recibir comandas en Cocina
 * ("pantalla" o "impresora"). Los engines que envían a cocina (OrderEngine,
 * TableEngine, SalesEngine) leen esto en vivo con .get() en el momento de
 * enviar — mismo patrón que companyConfigStore.get().tax en SalesEngine.
 *
 * Default "pantalla" (a diferencia de enabledModulesStore, que arranca en
 * null): todo negocio nuevo trae salida_cocina = 'pantalla' en la base de
 * datos (ver schema.sql), y los tests de humo, que corren sin pasar por
 * AuthContext.hydrateBusinessConfig, deben comportarse igual que un
 * negocio real recién creado.
 *
 * Se hidrata real desde Supabase en AuthContext (hydrateBusinessConfig).
 */
class KitchenOutputModeStore extends ObservableStore<KitchenOutputMode> {
  constructor() {
    super("pantalla");
  }

  get(): KitchenOutputMode {
    return this.snapshot;
  }

  set(mode: KitchenOutputMode) {
    this.publish(mode);
  }

  clear() {
    this.publish("pantalla");
  }
}

export const kitchenOutputModeStore = new KitchenOutputModeStore();