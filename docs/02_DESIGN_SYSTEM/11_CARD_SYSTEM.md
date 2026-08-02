# CARD SYSTEM

## Objetivo

Las Cards son superficies de información.

No son decoración.

No existen para dividir la pantalla.

Existen para organizar información y facilitar decisiones.

---

# Filosofía

Una Card debe sentirse como una pieza sólida del sistema.

Silenciosa.

Elegante.

Precisa.

Nunca debe competir con el contenido.

El dato siempre es el protagonista.

---

# Apariencia

Background

#121215

Border

#27272A

Border Opacity

40%

Border Radius

12 px

Shadow

Ninguna

Gradientes

Prohibidos

Glow

Prohibido

Cristal

Prohibido

---

# Espaciado

Padding interno

24 px

Separación entre Cards

24 px

Nunca menos de 16 px.

Nunca más de 32 px.

---

# Jerarquía

Toda Card sigue exactamente esta estructura.

──────────────────────────

Etiqueta

Valor principal

Información secundaria

Acción (opcional)

──────────────────────────

Ejemplo

VENTAS HOY

$4.250.000

+12% respecto ayer

Ver detalles

---

# Tipografía

Etiqueta

11 px

Semibold

Tracking Wide

Color

#71717A

Mayúsculas

Siempre

---

Valor Principal

36 px

Semibold

Color

#FFFFFF

---

Información secundaria

14 px

Regular

Color

#A1A1AA

---

# Hover

Solo cuando sea interactiva.

Hover

Background

#18181C

Duración

150 ms

Cursor

Pointer

Nunca aumenta de tamaño.

Nunca tiene sombras.

---

# Estados

Todas las Cards soportan

Default

Hover

Loading

Empty

Disabled

Error

---

# Loading

Skeleton

Background

#18181C

Animación muy suave.

Nunca spinner gigante.

Nunca bloquea toda la pantalla.

---

# Empty

Ejemplo

"No hay ventas registradas hoy."

Debe explicar claramente qué sucede.

Nunca mostrar

0

0

0

Sin explicación.

---

# Error

Background

#121215

Borde izquierdo

4 px

Color

#EF4444

Texto

"No pudimos cargar esta información."

Botón

Reintentar

---

# Cards de KPIs

Solo muestran

Etiqueta

Valor

Variación

Nunca más.

Ejemplo

VENTAS

$2.540.000

+8%

---

# Cards Informativas

Pueden incluir

Icono

Título

Descripción

Acción

Ejemplo

Asistente IA

El inventario de queso alcanzará para dos días.

[ Comprar ahora ]

---

# Cards de Producto

Orden

Imagen

Nombre

Precio

Stock

Estado

Nunca incluir información irrelevante.

---

# Cards de Cliente

Orden

Inicial o Avatar

Nombre

Teléfono

Última compra

Estado

---

# Cards Accionables

Toda Card que permita interacción debe tener un único objetivo.

Incorrecto

Editar

Eliminar

Duplicar

Mover

Compartir

Todo al mismo tiempo.

Correcto

Editar

↓

Dentro aparecen las demás opciones.

---

# Responsive

Desktop

Múltiples columnas

Tablet

Dos columnas

Mobile

Una sola columna

Nunca cambiar el contenido.

Solo cambia la distribución.

---

# Accesibilidad

Toda Card interactiva debe:

Responder al teclado

Mostrar Focus

Tener aria-label

Mantener contraste AA

---

# Regla Suprema

Si una Card necesita más de cinco segundos para entenderse,

no es una Card.

Es un problema de diseño.

La información debe poder escanearse en menos de tres segundos.