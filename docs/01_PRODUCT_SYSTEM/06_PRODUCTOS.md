# 06_PRODUCTOS.md

# Aplicación Productos

---

# Definición

Productos es la aplicación responsable de administrar todos los recursos que el negocio compra, almacena, prepara y vende.

Es el corazón del control operativo.

Todo lo que afecta el inventario nace o termina aquí.

---

# Objetivo

Mantener un control absoluto sobre productos, recetas, inventario, costos y proveedores.

Cada venta debe reflejar automáticamente el consumo real de insumos.

---

# Usuario Principal

* Administrador
* Encargado de Inventario
* Compras

---

# Funciones Principales

## Productos

* Crear producto.
* Editar producto.
* Eliminar producto (según permisos).
* Activar o desactivar producto.
* Organizar por categorías.

---

## Categorías

Ejemplos:

* Entradas.
* Hamburguesas.
* Pizzas.
* Bebidas.
* Postres.
* Adicionales.

Las categorías solo organizan.

No afectan la lógica del sistema.

---

## Recetas

Cada producto puede tener una receta.

La receta define exactamente qué insumos consume cada venta.

Ejemplo:

Hamburguesa Doble

* 2 Panes.
* 2 Carnes.
* 2 Quesos.
* 30 g Salsa.
* 20 g Lechuga.

Cuando el producto se vende, el inventario se descuenta automáticamente.

---

## Inventario

Permite controlar:

* Existencias.
* Entradas.
* Salidas.
* Ajustes.
* Mermas.
* Vencimientos.
* Stock mínimo.

Todo movimiento queda registrado.

---

## Compras

Permite:

* Crear órdenes de compra.
* Registrar compras.
* Recibir mercancía.
* Actualizar inventario.
* Actualizar costos.

---

## Proveedores

Cada proveedor almacena:

* Nombre.
* Contacto.
* Productos suministrados.
* Historial de compras.
* Condiciones comerciales.

---

## Costos

Cada producto tendrá:

* Costo de producción.
* Precio de venta.
* Utilidad.
* Margen.
* Rentabilidad.

Estos datos alimentan directamente al Centro de Mando y a la IA.

---

# Flujo Principal

Proveedor

↓

Compra

↓

Inventario aumenta

↓

Producto disponible

↓

Venta

↓

Inventario disminuye

↓

Centro de Mando actualiza

↓

IA analiza

---

# Tipos de Productos

VIMDY reconoce diferentes tipos:

* Producto terminado.
* Insumo.
* Bebida.
* Ingrediente.
* Combo.
* Servicio.

Cada tipo tiene comportamientos específicos.

---

# Movimientos de Inventario

Todos los movimientos deben quedar registrados.

Ejemplos:

* Compra.
* Venta.
* Merma.
* Ajuste.
* Producción.
* Transferencia.
* Devolución.

Nunca existirán movimientos sin historial.

---

# Alertas

Solo se mostrarán alertas útiles.

Ejemplos:

* Producto agotado.
* Stock bajo.
* Producto próximo a vencer.
* Compra recomendada.

No existirán alertas innecesarias.

---

# Estados Vacíos

Ejemplos:

"No hay productos registrados."

"No existen proveedores."

"No hay compras pendientes."

Nunca habrá pantallas vacías.

---

# Qué Nunca Hará

La aplicación Productos nunca:

* Registrará ventas.
* Gestionará mesas.
* Administrará clientes.
* Configurará usuarios.
* Mostrará indicadores financieros generales.

Su responsabilidad es administrar los recursos del negocio.

---

# Relación con otras Aplicaciones

Recibe información de:

* Compras.
* Configuración.

Envía información hacia:

* Venta.
* Operación.
* Inventario.
* Centro de Mando.
* Asistente IA.

Toda actualización ocurre automáticamente.

---

# Regla Suprema

Si el dueño necesita contar manualmente los productos para saber cuánto tiene realmente, la aplicación ha fallado.

Productos debe reflejar en todo momento el inventario real del negocio.
