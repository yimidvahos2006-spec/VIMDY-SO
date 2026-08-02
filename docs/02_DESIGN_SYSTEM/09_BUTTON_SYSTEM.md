# BUTTON SYSTEM

## Objetivo

Los botones representan la intención del usuario.

Cada pantalla debe tener una única acción principal.

Nunca deben competir entre sí.

---

# Filosofía

Un botón debe transmitir:

• Claridad

• Confianza

• Rapidez

• Seguridad

Nunca debe llamar la atención por efectos visuales.

Debe llamar la atención por su importancia.

---

# Jerarquía

VIMDY tiene únicamente cuatro tipos de botones.

## 1. Primary Button

Uso:

Acción principal.

Ejemplos:

• Cobrar

• Guardar

• Confirmar

• Crear Pedido

Color

Background

#FFFFFF

Texto

#09090B

Peso

600

Hover

Opacity 90%

Active

Scale 0.98

Nunca tendrá borde.

Nunca tendrá gradientes.

Nunca tendrá sombra.

---

## 2. Secondary Button

Uso

Acción alternativa.

Ejemplos

Cancelar

Volver

Editar

Background

#18181C

Border

#27272A

Texto

#FFFFFF

Hover

#202024

---

## 3. Ghost Button

Uso

Acciones poco frecuentes.

Ejemplos

Ver detalles

Más información

Exportar

Background

Transparent

Texto

#A1A1AA

Hover

#18181C

---

## 4. Danger Button

Uso

Eliminar

Anular

Cerrar Caja

Texto

#EF4444

Background

Transparent

Hover

rgba(239,68,68,.10)

Nunca será rojo sólido.

Debe advertir sin generar ansiedad.

---

# Tamaños

Small

Altura

32 px

Medium

40 px

(Default)

Large

48 px

Extra Large (XL)

~72 px — SOLO para Modo TV de Cocina (pantalla leída a distancia, no de cerca). No usar en ningún otro lugar de la app sin una razón de distancia de lectura igual de real.

---

# Iconos

Si un botón tiene icono:

Siempre a la izquierda.

Separación

8 px

Nunca icono solamente.

Debe existir texto.

---

# Bordes

Radio

8 px

No existen botones completamente redondos.

---

# Animaciones

Hover

150 ms

Active

100 ms

Sin rebotes.

Sin glow.

Sin efectos 3D.

---

# Espaciado

Horizontal

16 px

Vertical

10 px

---

# Estados

Default

Hover

Focus

Pressed

Disabled

Loading

Success

Error

Todos deben estar definidos.

---

# Loading

Mientras carga

El botón mantiene su tamaño.

Nunca cambia de ancho.

El texto desaparece.

Se muestra un spinner discreto.

---

# Disabled

Opacity

50%

Cursor

not-allowed

No responde al hover.

---

# Regla Suprema

Solo puede existir un botón Primary visible por pantalla.

Si existen dos botones blancos al mismo tiempo,

el diseño está mal.

---

# Controles Icon-Only (excepción documentada)

Esta sección existe porque la regla de arriba ("nunca icono solamente, debe existir texto") aplica a los 4 botones oficiales — que representan una acción de pantalla completa (Cobrar, Guardar, Eliminar) — no a los controles inline dentro de una fila o lista ya densa.

## Cuándo aplica

Únicamente para controles repetidos dentro de un contexto ya identificado:

• Stepper de cantidad (+/-) en una línea de producto.

• Quitar un producto de una lista (carrito, pedido).

• Quitar un descuento o propina ya aplicado.

• Cerrar un modal (ícono X en la esquina).

• Limpiar un campo de búsqueda (ícono X dentro del input).

Ponerles texto visible a cada uno rompe la densidad necesaria de esas pantallas (Caja, Pedidos) y viola otras reglas del propio sistema ("suficiente espacio en blanco", "no existen elementos innecesarios", la Prueba del Restaurante Lleno).

## Reglas obligatorias de la excepción

• Siempre debe llevar `aria-label` descriptivo (ej. `aria-label="Aumentar cantidad"`). Nunca un ícono sin ninguna etiqueta — sigue aplicando la sección de Accesibilidad del checklist.

• No es una variante de VimdyButton. Es un componente/patrón aparte — nunca reemplaza a Primary/Secondary/Ghost/Danger para una acción de pantalla completa.

• Tamaño mínimo de área táctil: 32px × 32px, aunque el ícono visual sea más pequeño (accesibilidad táctil en tablet/mostrador).

• Mismo radio de borde (8px) y mismas transiciones (150ms hover) que el resto de controles — no se inventa una animación nueva para esta categoría.

## Regla suprema de esta sección

Si un control nuevo no encaja claramente en los casos listados arriba, no es una excepción — es un botón, y debe llevar texto visible como cualquier Primary/Secondary/Ghost/Danger.

---

# Controles Selector / Toggle (categoría aparte — NO es VimdyButton)

Esta categoría tampoco es un botón de acción, así que tampoco aplican las 4 variantes (Primary/Secondary/Ghost/Danger) ni la regla de "un solo primary por pantalla".

## Cuándo aplica

Un grupo de opciones donde el usuario elige una (o activa/desactiva algo), no donde ejecuta una acción:

• Selector de método de pago (Efectivo/Tarjeta/Transferencia/Mixto).

• Chips de monto rápido en efectivo.

• Selector de prioridad de un pedido (Normal/Alta/Urgente).

• Interruptor tipo switch (ej. "requiere factura", "ocultar agotados").

• Filtro de categorías en una lista.

La señal para reconocerlo en código: usa `aria-pressed`, no un `onClick` de una sola acción — representa un estado que se puede consultar, no algo que "ocurre y termina".

## Reglas obligatorias

• El estado activo debe usar el token de color que corresponda al significado (`vimdy-accent` para selección neutra, `vimdy-warning`/`vimdy-danger` si el propio significado de la opción lo pide — ej. prioridad "Urgente").

• El estado inactivo usa `vimdy-surface` / `vimdy-border`, nunca un gris fuera de la paleta.

• Siempre `aria-pressed` (o el equivalente correcto de accesibilidad para el patrón — un switch real usa `role="switch"` + `aria-checked`).

• No se mezcla con VimdyButton: un selector de opciones no "compite" con la regla de un solo primary por pantalla, porque no es una acción — son estados.

Si tienes dudas sobre si algo es un botón de acción o un selector, pregúntate: **¿esto ejecuta algo y termina (Cobrar, Guardar, Eliminar), o representa una elección que sigue viva mientras el usuario decide (¿efectivo o tarjeta?, ¿cuál categoría?)?** Lo primero es VimdyButton. Lo segundo es esta categoría.

---

# Acento de Función Especial (excepción documentada — IA, producción por lotes)

Tampoco es una variante de VimdyButton. Es para acciones que SÍ ejecutan algo y terminan (por eso no son un selector), pero que a propósito necesitan destacarse como "esto es distinto de una acción normal" — hoy solo dos casos: acciones impulsadas por IA (`vimdy-ai`) y producción por lotes/recetas (`vimdy-warning` o `vimdy-recipe` según el contexto).

## Cuándo aplica

Únicamente cuando la acción usa uno de los tokens de marca ya reservados para esto en `tailwind.config.js` (`vimdy-ai`, `vimdy-ai-hover`, `vimdy-recipe`, `vimdy-recipe-hover`) — ejemplos: "Importar menú con IA", "Producir tanda".

## Por qué no es simplemente Secondary

Quitarle el color de marca y volverlo un Secondary gris le quita al usuario la señal visual de "esto es una función de IA" antes de hacer click — esa distinción es intencional en el sistema, no un descuido.

## Reglas obligatorias

• Solo usa los tokens ya reservados para esto — nunca un color nuevo inventado para "destacar" otra acción que no sea IA o producción por lotes.

• Mismo radio de borde, mismo alto (`h-11`) y mismas transiciones que el resto de controles — la única diferencia permitida es el color.

• Si una acción nueva "se siente especial" pero no es IA ni producción por lotes, no es esta categoría — es un Primary o Secondary normal. No inventes un tercer acento sin agregar el token correspondiente a `tailwind.config.js` primero y documentarlo aquí.