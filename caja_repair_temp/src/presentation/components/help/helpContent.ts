import type { HelpContent } from "../help/HelpModal";

/**
 * Contenido de ayuda contextual para cada módulo de VIMDY.
 *
 * Cada módulo principal tiene su propia explicación de cómo funciona
 * y consejos para el usuario.
 */
export const HELP_CONTENT: Record<string, HelpContent> = {
  caja: {
    title: "Ayuda de Caja",
    description: "Caja es el módulo principal para registrar ventas y controlar el dinero de tu negocio.",
    sections: [
      {
        title: "¿Qué puedes hacer en Caja?",
        content: "• Registrar ventas rápidas\n• Ver el turno de caja actual\n• Ver historial de ventas\n• Controlar el dinero en efectivo"
      },
      {
        title: "¿Cómo hacer una venta?",
        content: "1. Toca 'Venta rápida'\n2. Agrega productos al carrito tocándolos\n3. Ajusta cantidades si es necesario\n4. Toca 'Cobrar' para terminar la venta\n5. Selecciona el método de pago\n6. ¡Listo! La venta queda registrada"
      },
      {
        title: "Abrir y cerrar turno",
        content: "• Abrir turno: Indica cuánto dinero hay en caja al iniciar el día\n• Cerrar turno: Al terminar, verás el resumen de ventas y el dinero que debe estar en caja"
      }
    ],
    tips: [
      "Siempre abre tu turno antes de empezar a vender",
      "Si no tienes conexión, las ventas se guardan localmente y se sincronizan después",
      "Revisa el historial de ventas para ver qué productos se venden más"
    ]
  },
  inventario: {
    title: "Ayuda de Inventario",
    description: "Inventario te permite gestionar los productos que vendes, controlar stock y organizar tu catálogo.",
    sections: [
      {
        title: "¿Qué puedes hacer en Inventario?",
        content: "• Crear y editar productos\n• Controlar existencias (stock)\n• Organizar productos por categorías\n• Ver alertas de productos agotados"
      },
      {
        title: "Tipos de productos",
        content: "• Producto de inventario: Se vende tal como está (bebidas, snacks)\n• Producto de cocina: Requiere preparación (hamburguesas, pizzas)\n• Ingrediente: Se usa en recetas, no se vende directamente\n• Servicio: No tiene stock (domicilios, cover)"
      },
      {
        title: "Venta por peso",
        content: "Si vendes productos por peso (carnes, frutas, queso), selecciona la unidad 'kg', 'g', 'libra', 'litro' o 'ml'. El sistema calculará el precio automáticamente según el peso ingresado."
      },
      {
        title: "Control de stock",
        content: "• Stock inicial: Las unidades que tienes ahora\n• Stock mínimo: Cuándo quieres recibir alerta de 'agotándose'\n• Cuando vendes, el stock se descuenta automáticamente"
      }
    ],
    tips: [
      "Empieza creando tus productos más vendidos",
      "Si no quieres controlar stock, deja el stock inicial en 0",
      "Las categorías ayudan a organizar tu catálogo y encontrar productos más rápido"
    ]
  },
  cocina: {
    title: "Ayuda de Cocina",
    description: "Cocina es donde se reciben los pedidos que se hacen desde Caja o Mesas.",
    sections: [
      {
        title: "¿Qué puedes hacer en Cocina?",
        content: "• Ver comandas activas en tiempo real\n• Marcar pedidos como 'en preparación'\n• Marcar pedidos como 'listos'\n• Ver historial de pedidos entregados"
      },
      {
        title: "Flujo de una comanda",
        content: "1. Se crea un pedido desde Caja o Mesas\n2. La comanda aparece en Cocina\n3. El cocinero la marca como 'en preparación'\n4. Cuando está lista, se marca como 'lista'\n5. El mesero o cajero entrega el pedido"
      },
      {
        title: "Pantalla vs Impresora",
        content: "• Pantalla (KDS): Las comandas aparecen en esta pantalla en tiempo real\n• Impresora: Las comandas se imprimen en ticket térmico\n\nPuedes cambiar esta configuración en Configuración > Negocio"
      }
    ],
    tips: [
      "Las comandas se ordenan por hora de creación",
      "Los productos con requieren más tiempo aparecen con color amarillo",
      "Puedes filtrar por estado para ver solo las comandas pendientes"
    ]
  },
  mesas: {
    title: "Ayuda de Mesas",
    description: "Mesas te permite gestionar el espacio físico de tu negocio y controlar qué mesa está ocupada o libre.",
    sections: [
      {
        title: "¿Qué puedes hacer en Mesas?",
        content: "• Ver el estado de cada mesa (libre, ocupada, reservada)\n• Abrir una mesa para empezar a tomar pedidos\n• Ver los productos de cada mesa\n• Cobrar y cerrar una mesa"
      },
      {
        title: "Flujo de una mesa",
        content: "1. La mesa está 'libre' (desocupada)\n2. Tocas la mesa para abrirla\n3. Indicas cuántas personas son\n4. Agregas productos al pedido\n5. Los productos se envían a cocina (si aplica)\n6. Cuando terminan, cobras y cierras la mesa"
      },
      {
        title: "Mesas con meseros",
        content: "Si tienes meseros, cada uno toca su nombre antes de ver las mesas. Así puedes saber qué mesero atendió cada mesa.\n\nSi no tienes meseros (autoservicio), puedes tocar directamente la mesa."
      },
      {
        title: "Estados de mesa",
        content: "• Verde: Libre — desocupada, disponible\n• Roja: Ocupada — tiene un pedido activo\n• Amarilla: Reservada — apartada para alguien"
      }
    ],
    tips: [
      "Puedes ver el total de cada mesa tocándola",
      "Los pedidos de una mesa se pueden enviar a cocina en cualquier momento",
      "Al cerrar una mesa, el total se registra como una venta"
    ]
  },
  meseros: {
    title: "Ayuda de Personal",
    description: "Personal es donde gestionas el equipo que atiende tu negocio.",
    sections: [
      {
        title: "¿Qué puedes hacer en Personal?",
        content: "• Agregar nombres de tu personal\n• Ver quién atiende cada mesa\n• Controlar el rendimiento por persona"
      },
      {
        title: "¿Cómo funciona el personal?",
        content: "• El personal no necesita login — solo toca su nombre\n• Cada mesa abierta se asigna a la persona activa\n• Puedes cambiar de persona en cualquier momento"
      },
      {
        title: "Agregar personal",
        content: "Ve a Configuración → Personal para agregar nuevos nombres. Solo necesitas un nombre."
      }
    ],
    tips: [
      "Si una persona ya no trabaja para ti, puedes desactivarla en Configuración",
      "El personal puede ver solo las mesas, no tiene acceso a reportes ni caja"
    ]
  },
  productos: {
    title: "Ayuda de Productos",
    description: "Productos es donde creas y gestionas todo lo que vendes en tu negocio.",
    sections: [
      {
        title: "¿Qué puedes hacer en Productos?",
        content: "• Crear nuevos productos\n• Editar productos existentes\n• Organizar por categorías\n• Controlar precios y costos"
      },
      {
        title: "Campos de un producto",
        content: "• Nombre: Cómo aparece en la venta\n• Precio: Lo que paga el cliente\n• Costo: Lo que te cuesta a ti (para calcular ganancia)\n• Categoría: Para organizar tu catálogo\n• Stock: Si quieres controlar existencias"
      },
      {
        title: "Tipos de productos",
        content: "• Inventario: Producto que se vende tal cual (golosinas, bebidas)\n• Cocina: Requiere preparación (platos, hamburguesas)\n• Receta: Producto con ingredientes (salsas, preparaciones)\n• Servicio: No tiene stock (domicilios, cover)"
      }
    ],
    tips: [
      "Puedes crear productos rápidamente desde el botón '+'",
      "Si vendes por peso, selecciona kg, g, libra, litro o ml como unidad",
      "Las categorías ayudan a encontrar productos más rápido en Caja"
    ]
  }
};
