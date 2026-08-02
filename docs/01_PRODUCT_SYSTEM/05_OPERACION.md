# 05_OPERACION.md

# Aplicación Operación

---

# Definición

Operación es la aplicación que coordina todo lo que sucede desde que un cliente realiza un pedido hasta que ese pedido llega a la mesa.

Su objetivo no es vender.

Su objetivo es mantener la operación organizada.

---

# Objetivo

Permitir que cocina, barra, meseros y supervisores trabajen sincronizados en tiempo real.

Toda la información debe fluir automáticamente.

Nunca manualmente.

---

# Usuario Principal

* Meseros
* Cocina
* Barra
* Supervisor

---

# Funciones Principales

## Gestión de Mesas

* Ver estado de todas las mesas.
* Abrir mesa.
* Cambiar mesa.
* Unir mesas.
* Separar mesas.
* Liberar mesa.

---

## Gestión de Pedidos

* Ver pedidos activos.
* Agregar productos.
* Modificar pedidos.
* Cancelar productos (según permisos).
* Enviar pedidos.
* Reenviar pedidos.

---

## Cocina

* Recibir comandas.
* Cambiar estado.
* Confirmar preparación.
* Marcar pedido listo.

---

## Barra

* Recibir bebidas.
* Preparar bebidas.
* Confirmar entrega.

---

## Meseros

* Ver pedidos listos.
* Entregar pedido.
* Solicitar cuenta.

---

# Flujo Operativo

Mesa abierta

↓

Pedido creado

↓

Pedido enviado

↓

Cocina recibe

↓

Preparación

↓

Pedido listo

↓

Mesero recoge

↓

Cliente recibe

↓

Cobro

↓

Mesa disponible

---

# Estados del Pedido

Los estados oficiales son:

* Nuevo
* En preparación
* Listo
* Entregado
* Cobrado
* Cancelado

No podrán existir estados personalizados.

---

# Estados de Mesa

Cada mesa únicamente puede estar en uno de estos estados:

* Libre
* Ocupada
* Pidiendo
* En preparación
* Comiendo
* Solicitó cuenta
* Cerrada

El estado cambia automáticamente cuando la operación avanza.

---

# Prioridad Visual

Siempre debe verse primero:

* Mesas con problemas.
* Pedidos pendientes.
* Pedidos retrasados.
* Pedidos listos.

Después:

* Información secundaria.

---

# Alertas

Solo existirán alertas importantes.

Ejemplos:

* Pedido retrasado.
* Mesa esperando cuenta.
* Cocina congestionada.
* Barra congestionada.

Nunca aparecerán alertas irrelevantes.

---

# Tiempo

La aplicación trabaja constantemente con tiempo real.

Debe mostrar:

* Tiempo desde que llegó el pedido.
* Tiempo de preparación.
* Tiempo de espera.
* Tiempo promedio del servicio.

Nunca utilizará cronómetros decorativos.

Solo información útil.

---

# Sincronización

Cada cambio realizado debe actualizar automáticamente:

* Venta
* Cocina
* Inventario
* Centro de Mando
* IA

El usuario nunca actualiza manualmente.

---

# Estados Vacíos

Ejemplos:

"No existen pedidos activos."

"No hay mesas ocupadas."

"La cocina está al día."

Nunca habrá pantallas vacías.

---

# Qué Nunca Hará

La aplicación Operación nunca administrará:

* Productos.
* Clientes.
* Usuarios.
* Reportes financieros.
* Configuración.

Su única responsabilidad es coordinar la operación del negocio.

---

# Relación con otras Aplicaciones

Recibe información de:

* Venta.

Envía información hacia:

* Cocina.
* Inventario.
* Centro de Mando.
* Clientes.
* Asistente IA.

Toda la operación ocurre automáticamente.

---

# Regla Suprema

Si un mesero necesita preguntar en qué estado está un pedido, la aplicación ha fallado.

Operación debe responder esa pregunta antes de que el mesero tenga que hacerla.
