import { CustomerEngine } from "./CustomerEngine";
import { CommandIntent } from "../store/commandIntentStore";

export interface CommandResult {
  /** Ruta de VIMDY a la que hay que navegar para ejecutar el comando. */
  readonly route: string;
  /** Intent opcional para que la pantalla destino abra un modal o prellene un campo. */
  readonly intent?: CommandIntent;
  /** Lo que el Copiloto le dice al usuario después de ejecutar el comando. */
  readonly confirmationMessage: string;
}

/**
 * CommandEngine
 * ---------------------------------------------------------------------------
 * PASO 6 — Comandos Inteligentes. Reconoce intenciones de acción escritas
 * en lenguaje natural ("crea un producto", "busca al cliente Juan", "abre
 * la caja") y las traduce en una acción real de VIMDY: navegar a la pantalla
 * correcta y, cuando aplica, dejarle un intent (abrir modal, prellenar
 * búsqueda) a través de commandIntentStore.
 *
 * Es intencionalmente simple (coincidencia de patrones, no un LLM): así los
 * comandos son deterministas, gratis (no gastan la API de Claude) e
 * instantáneos. Si el texto no calza con ningún comando conocido, devuelve
 * null y CopilotService sigue el camino normal (preguntarle a Claude).
 */
export class CommandEngine {
  constructor(private readonly customerEngine: CustomerEngine) {}

  public async parse(rawText: string): Promise<CommandResult | null> {
    const text = rawText.trim().toLowerCase();
    if (!text) return null;

    // Crear producto.
    if (/crea(r)?\s+(un\s+)?producto|nuevo producto|agregar producto/.test(text)) {
      return {
        route: "/inventario",
        intent: { type: "OPEN_NEW_PRODUCT" },
        confirmationMessage:
          "Listo, te abrí el formulario de nuevo producto en Inventario. Completa nombre, precio y stock desde ahí."
      };
    }

    // Buscar cliente (con o sin nombre).
    const customerMatch =
      text.match(/buscar (?:el |al )?cliente(?:\s+llamado)?\s+([a-záéíóúñ\s]+)/) ??
      text.match(/cliente\s+([a-záéíóúñ\s]+)/);
    if (customerMatch) {
      const query = customerMatch[1].trim();
      const customers = await this.customerEngine.getAllCustomers();
      const found = customers.find((c) => c.name.toLowerCase().includes(query));

      return {
        route: "/clientes",
        intent: { type: "SEARCH_CUSTOMER", params: { query } },
        confirmationMessage: found
          ? `Te llevé a Clientes con "${found.name}" ya filtrado.`
          : `Te llevé a Clientes buscando "${query}", pero no encontré ningún cliente registrado con ese nombre. Puedes crearlo desde ahí.`
      };
    }

    // Mostrar inventario.
    if (/mostrar inventario|ver inventario|abr(e|ir)(me)? el inventario/.test(text)) {
      return { route: "/inventario", confirmationMessage: "Te abrí el módulo de Inventario." };
    }

    // Mostrar ventas / reportes.
    if (/mostrar ventas|ver ventas|abr(e|ir)(me)? (las )?ventas|ver reportes|mostrar reportes/.test(text)) {
      return { route: "/reportes", confirmationMessage: "Te abrí Reportes con las ventas del negocio." };
    }

    // Abrir caja.
    if (/abrir caja|abr(e|ir)(me)? la caja|ir a caja/.test(text)) {
      return { route: "/caja", confirmationMessage: "Te abrí el módulo de Caja." };
    }

    // Cerrar turno.
    if (/cerrar turno|cierre de turno/.test(text)) {
      return {
        route: "/caja",
        confirmationMessage: "Te abrí Caja — el botón para cerrar turno está en el panel de turno, ahí mismo."
      };
    }

    // Abrir cocina.
    if (/abrir cocina|ver cocina|abr(e|ir)(me)? la cocina/.test(text)) {
      return { route: "/cocina", confirmationMessage: "Te abrí Cocina con las comandas activas." };
    }

    // Buscar / mostrar pedidos.
    if (/buscar pedido|ver pedidos|mostrar pedidos/.test(text)) {
      return {
        route: "/cocina",
        confirmationMessage: "Te abrí Cocina — ahí puedes ver todas las comandas activas y su estado."
      };
    }

    return null;
  }
}