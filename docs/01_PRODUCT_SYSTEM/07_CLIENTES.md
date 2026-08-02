# 07_CLIENTES.md

# Aplicación Clientes

---

# Definición

Clientes es la aplicación encargada de centralizar toda la información relacionada con las personas que compran en el negocio.

Su propósito no es almacenar datos por almacenar.

Su propósito es ayudar a conocer mejor al cliente para mejorar el servicio, aumentar la fidelización y tomar mejores decisiones comerciales.

---

# Objetivo

Construir un historial completo de cada cliente sin aumentar la carga de trabajo del personal.

Toda la información debe generarse automáticamente siempre que sea posible.

---

# Usuario Principal

* Administrador
* Caja
* Atención al cliente

---

# Funciones Principales

## Registro de Clientes

Permite registrar:

* Nombre
* Teléfono
* Correo electrónico
* Fecha de nacimiento
* Dirección
* Observaciones

El registro debe ser rápido y opcional.

Nunca bloqueará una venta.

---

## Historial

Cada cliente conserva automáticamente:

* Número de visitas
* Total gastado
* Ticket promedio
* Última compra
* Productos favoritos
* Historial completo de compras

No requiere registro manual.

---

## Preferencias

El sistema puede almacenar información como:

* Sin cebolla
* Sin picante
* Mesa favorita
* Método de pago frecuente
* Productos favoritos

Estas preferencias ayudan a ofrecer una mejor experiencia.

---

## Fidelización

Permite implementar programas como:

* Acumulación de puntos
* Descuentos
* Beneficios
* Clientes frecuentes
* Membresías

Todo configurable.

---

## Reservas

Permite:

* Crear reservas
* Modificar reservas
* Cancelar reservas
* Confirmar asistencia
* Historial de reservas

---

## Observaciones

Cada cliente puede tener notas internas.

Ejemplos:

* Cliente VIP.
* Pago contra factura.
* Requiere atención especial.

Estas notas son visibles solo para el personal autorizado.

---

# Flujo Principal

Cliente nuevo

↓

Primera compra

↓

Historial creado

↓

Visitas posteriores

↓

Preferencias aprendidas

↓

IA analiza comportamiento

↓

Recomendaciones comerciales

---

# Información Importante

Para cada cliente VIMDY mostrará:

* Nombre
* Última visita
* Total gastado
* Frecuencia
* Estado de fidelización

Nunca mostrará información irrelevante.

---

# Búsqueda

La búsqueda debe permitir encontrar clientes por:

* Nombre
* Teléfono
* Correo
* Documento (si aplica)

La respuesta debe ser inmediata.

---

# Privacidad

La información del cliente pertenece al negocio.

VIMDY protege esa información mediante permisos y controles de acceso.

Solo usuarios autorizados pueden consultar o modificar datos sensibles.

---

# Estados Vacíos

Ejemplos:

"No hay clientes registrados."

"Aún no existen reservas."

"Este cliente todavía no tiene historial."

Nunca habrá pantallas completamente vacías.

---

# Qué Nunca Hará

La aplicación Clientes nunca:

* Administrará inventario.
* Registrará ventas directamente.
* Configurará usuarios.
* Modificará productos.

Su responsabilidad es administrar la relación con los clientes.

---

# Relación con otras Aplicaciones

Recibe información de:

* Venta
* Reservas

Envía información hacia:

* Centro de Mando
* Asistente IA

Toda la información se sincroniza automáticamente.

---

# Regla Suprema

El personal nunca debe preguntar dos veces la misma información a un cliente frecuente.

VIMDY debe recordar el historial, las preferencias y la relación comercial para ofrecer un servicio más rápido, más personal y más profesional.
