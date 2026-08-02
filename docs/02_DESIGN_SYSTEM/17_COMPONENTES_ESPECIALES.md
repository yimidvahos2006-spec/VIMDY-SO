# COMPONENTES ESPECIALES

## Objetivo

Los Componentes Especiales son elementos reutilizables que resuelven necesidades específicas del sistema operativo VIMDY.

No deben convertirse en componentes genéricos.

Cada uno existe porque cumple una función operativa concreta.

---

# Filosofía

Un componente especial debe:

• Resolver un problema específico.

• Ser reutilizable.

• Mantener la simplicidad.

• No romper la identidad visual.

---

# Componentes Oficiales

VIMDY reconoce únicamente los siguientes componentes especiales.

• KPI Card

• Status Badge

• Toast

• Empty State

• Skeleton Loader

• Search Bar

• Command Palette

• Timeline

• Progress Indicator

• Statistic Widget

• Avatar

• Divider

• Quick Action

---

# KPI Card

Uso

Mostrar indicadores críticos.

Ejemplos

Ventas

Utilidad

Pedidos

Clientes

Nunca mostrar demasiada información.

Solo:

Etiqueta

Valor

Variación

---

# Status Badge

Representa estados.

Tamaño

28–32 px

Radius

Full

Color según estado.

Estados oficiales

Activo

#22C55E

Pendiente

#F59E0B

Cancelado

#EF4444

Finalizado

#38BDF8

Nunca crear colores nuevos.

---

# Toast

Ubicación

Parte inferior central.

Duración

2500 ms

Máximo

Uno visible.

No bloquear la pantalla.

---

# Empty State

Cuando no existen datos.

Debe contener

Icono

Título

Descripción

Acción

Ejemplo

No hay productos registrados.

[ Crear producto ]

Nunca mostrar pantallas vacías.

---

# Skeleton Loader

Reemplaza contenido mientras carga.

Nunca usar Spinner gigante.

Debe mantener exactamente el tamaño del contenido final.

---

# Search Bar

Siempre visible.

Icono

Lupa

Placeholder

Buscar...

Debe responder inmediatamente.

---

# Command Palette

Atajo

Ctrl + K

Desktop

⌘ + K

Mac

Permite buscar:

Clientes

Productos

Pedidos

Ventas

Configuraciones

Reportes

Nunca reemplaza la navegación.

La complementa.

---

# Timeline

Uso

Mostrar eventos cronológicos.

Ejemplos

Historial de pedidos.

Auditoría.

Movimientos.

Orden

Más reciente primero.

---

# Progress Indicator

Representa progreso.

Nunca usar colores llamativos.

Color

#38BDF8

Background

#18181C

---

# Statistic Widget

Combina

Número

Icono

Descripción

Tendencia

Se utiliza únicamente en el Centro de Mando.

---

# Avatar

Puede contener

Foto

Iniciales

Icono

Tamaño

32 px

40 px

48 px

Nunca mayor.

---

# Divider

Color

#27272A

Opacity

40%

Uso

Separar contenido.

Nunca usar líneas decorativas.

---

# Quick Action

Representa una acción inmediata.

Ejemplos

Nueva venta

Nuevo cliente

Nueva compra

Debe ser fácilmente reconocible.

Nunca más de cuatro Quick Actions visibles.

---

# Responsive

Todos los componentes especiales deben adaptarse automáticamente.

Desktop

Tablet

Mobile

Sin cambiar comportamiento.

Solo distribución.

---

# Accesibilidad

Todos deben soportar

Teclado

Focus visible

Lectores de pantalla

Contraste AA

---

# Rendimiento

Todos los componentes deben ser:

Reutilizables.

Livianos.

Independientes.

Sin lógica duplicada.

---

# Regla Suprema

Si un componente especial puede resolverse utilizando un componente existente,

no debe crearse uno nuevo.

En VIMDY se reutiliza antes de inventar.