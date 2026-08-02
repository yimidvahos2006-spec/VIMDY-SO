# 04_VENTA.md

# Aplicación Venta

---

# Definición

Venta es la aplicación donde ocurre el ingreso de dinero al negocio.

Todo su diseño está orientado a registrar pedidos y cobrar de la forma más rápida posible.

No existe ninguna función que distraiga de ese objetivo.

---

# Objetivo

Permitir registrar una venta completa en el menor tiempo posible, con la menor cantidad de clics posible y sin errores.

---

# Usuario Principal

* Cajero
* Mesero
* Administrador

---

# Funciones Principales

## Pedidos

* Crear pedido.
* Editar pedido.
* Agregar productos.
* Eliminar productos.
* Cambiar cantidades.
* Agregar observaciones.

---

## Mesas

* Abrir mesa.
* Cambiar de mesa.
* Unir mesas.
* Dividir mesas.
* Liberar mesa.

---

## Cobro

* Cobrar pedido.
* Dividir cuenta.
* Cobrar por persona.
* Cobro parcial.
* Aplicar descuento.
* Aplicar propina.
* Anular venta (según permisos).

---

## Métodos de Pago

* Efectivo.
* Tarjeta.
* Transferencia.
* QR.
* Crédito.
* Mixto.

El sistema debe permitir combinar varios métodos de pago en una misma venta.

---

## Comprobantes

* Imprimir.
* Reimprimir.
* Enviar por WhatsApp.
* Enviar por correo.

---

# Flujo Principal

Cliente llega

↓

Mesero abre mesa

↓

Agrega productos

↓

Envía a cocina

↓

Cliente consume

↓

Solicita cuenta

↓

Caja cobra

↓

Venta finalizada

↓

Inventario actualizado

↓

Reportes actualizados

↓

IA analiza la operación

---

# Estados del Pedido

Todo pedido debe encontrarse únicamente en uno de estos estados:

* Nuevo.
* En preparación.
* Listo.
* Entregado.
* Cobrado.
* Cancelado.

Nunca existirán estados duplicados.

---

# Prioridad Visual

Siempre se muestra primero:

* Productos.
* Total.
* Estado del pedido.

Después:

* Cliente.
* Observaciones.
* Historial.

---

# Atajos

La aplicación debe poder utilizarse casi completamente mediante teclado.

Ejemplos:

* Buscar producto.
* Agregar producto.
* Cambiar cantidad.
* Cobrar.
* Imprimir.

El teclado siempre tendrá prioridad sobre el mouse cuando sea posible.

---

# Errores

Los errores nunca interrumpen el flujo de venta.

Ejemplos:

"No pudimos imprimir el comprobante."

La venta ya quedó registrada.

Puede volver a imprimir cuando desee.

La prioridad siempre es proteger la venta.

---

# Estados Vacíos

Ejemplos:

"No hay productos agregados."

"Seleccione una mesa."

"Aún no existe ningún pedido."

Nunca habrá pantallas completamente vacías.

---

# Qué Nunca Hará

La aplicación Venta nunca mostrará:

* Reportes financieros.
* Configuración.
* Inventario completo.
* Administración de usuarios.
* Estadísticas históricas.

Todo eso pertenece a otras aplicaciones.

---

# Relación con otras Aplicaciones

Venta envía información a:

* Operación.
* Cocina.
* Inventario.
* Clientes.
* Centro de Mando.
* Asistente IA.

Nunca trabaja aislada.

---

# Regla Suprema

Si un cajero necesita pensar para cobrar una venta, el diseño ha fallado.

Cobrar debe sentirse tan natural como entregar dinero en una caja registradora.
