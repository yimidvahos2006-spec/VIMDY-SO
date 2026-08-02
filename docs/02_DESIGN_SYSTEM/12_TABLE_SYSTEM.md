# TABLE SYSTEM

## Objetivo

Las tablas existen para consultar, encontrar y actuar sobre información.

Nunca deben sentirse como hojas de cálculo.

Deben sentirse como listas inteligentes.

---

# Filosofía

La tabla debe responder tres preguntas inmediatamente:

• ¿Qué estoy viendo?

• ¿Qué es importante?

• ¿Qué puedo hacer?

Todo lo demás sobra.

---

# Apariencia

Background

#09090B

Header

#121215

Filas

Transparent

Hover

#18181C

Border

#27272A

Border Opacity

40%

Radius

12 px

Sombras

Nunca

Gradientes

Nunca

---

# Altura

Header

48 px

Fila

52 px

Nunca filas gigantes.

Nunca filas demasiado pequeñas.

---

# Tipografía

Header

11 px

Semibold

Uppercase

Tracking Wide

Color

#71717A

---

Contenido

14 px

Regular

Color

#FFFFFF

---

Información secundaria

12 px

Color

#A1A1AA

---

# Espaciado

Padding Horizontal

20 px

Padding Vertical

14 px

---

# Columnas

Siempre alineadas.

Nunca cambiar de ancho aleatoriamente.

Prioridad

1.

Nombre

2.

Estado

3.

Cantidad

4.

Precio

5.

Fecha

6.

Acciones

---

# Orden

La información importante siempre va primero.

Incorrecto

ID

Código

Interno

Fecha

Cliente

Total

Correcto

Cliente

Total

Estado

Fecha

---

# Hover

Hover

Background

#18181C

Duración

150 ms

No mover filas.

No cambiar tamaño.

---

# Selección

Una fila seleccionada

Background

#121215

Border Left

4 px

Color

#38BDF8

---

# Estados

Default

Hover

Selected

Loading

Empty

Error

---

# Loading

Skeleton

Nunca spinner gigante.

Las filas mantienen el tamaño.

---

# Empty

Ejemplo

"No hay ventas registradas."

Debe indicar claramente qué ocurre.

Nunca mostrar una tabla completamente vacía.

---

# Error

Texto

"No pudimos cargar esta información."

Botón

Reintentar

---

# Ordenamiento

Cada columna importante puede ordenar.

Ascendente

Descendente

Nunca más estados.

---

# Búsqueda

Siempre disponible.

Ejemplo

Buscar cliente...

Buscar producto...

Buscar factura...

Debe responder inmediatamente.

---

# Paginación

Automática.

Opciones

20

50

100

200

Nunca mostrar miles de registros al mismo tiempo.

---

# Acciones

Siempre al extremo derecho.

Ejemplos

Editar

Ver

Imprimir

Más opciones

Nunca llenar la fila de botones.

---

# Estado

Los estados utilizan únicamente:

Activo

Color

#22C55E

Pendiente

#F59E0B

Cancelado

#EF4444

Finalizado

#38BDF8

Nunca utilizar colores decorativos.

---

# Responsive

Desktop

Tabla completa.

Tablet

Oculta columnas secundarias.

Mobile

Se transforma en Cards.

Nunca usar scroll horizontal infinito.

---

# Accesibilidad

Toda tabla debe permitir:

Navegación por teclado.

Focus visible.

Lectores de pantalla.

Contraste AA.

---

# Rendimiento

Virtualización para tablas grandes.

Carga progresiva.

Scroll fluido.

Nunca bloquear la interfaz.

---

# Regla Suprema

Una tabla debe permitir encontrar cualquier información en menos de cinco segundos.

Si el usuario necesita leer toda la fila para entenderla,

la tabla está mal diseñada.