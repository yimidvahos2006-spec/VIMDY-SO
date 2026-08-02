# INPUT SYSTEM

## Objetivo

Los campos de entrada son la principal forma de comunicación entre el usuario y VIMDY.

Cada input debe sentirse rápido, limpio y evidente.

Nunca debe generar dudas sobre qué información espera.

---

# Filosofía

Un buen input desaparece.

El usuario piensa en escribir, no en el componente.

Los campos deben transmitir:

• Claridad

• Rapidez

• Precisión

• Orden

Nunca deben parecer formularios burocráticos.

---

# Apariencia

Background

#121215

Border

#27272A

Texto

#FFFFFF

Placeholder

#71717A

Border Radius

8 px

Sin sombras.

Sin gradientes.

Sin efectos de cristal.

---

# Altura

Small

36 px

Medium

44 px

(Default)

Large

52 px

---

# Padding

Horizontal

16 px

Vertical

12 px

---

# Tipografía

Texto

14 px

Font Weight

400

Color

#FFFFFF

Placeholder

14 px

Color

#71717A

---

# Estados

Todos los inputs deben soportar:

• Default

• Hover

• Focus

• Filled

• Disabled

• Read Only

• Error

• Success

---

# Estado Hover

Border

#3F3F46

Duración

150 ms

No cambia el fondo.

---

# Estado Focus

Border

#38BDF8

No glow.

No sombras.

No animaciones exageradas.

Solo un borde limpio.

---

# Estado Filled

El borde vuelve al color normal.

El texto permanece blanco.

---

# Estado Disabled

Opacity

60%

Cursor

not-allowed

No responde al hover.

---

# Estado Read Only

Background

#18181C

Cursor

default

El usuario puede copiar el contenido.

No editarlo.

---

# Estado Error

Border

#EF4444

Mensaje

Debajo del input.

Color

#EF4444

Ejemplo

"Ingresa un teléfono válido."

Nunca mostrar códigos técnicos.

---

# Estado Success

Border

#22C55E

Solo cuando realmente sea necesario.

No usar mensajes innecesarios.

---

# Etiquetas

Las etiquetas siempre van arriba.

Nunca dentro del input.

Ejemplo

Nombre

┌─────────────────────────────┐
│ Juan Pérez                  │
└─────────────────────────────┘

No usar etiquetas flotantes.

---

# Placeholder

Debe ser una ayuda.

Nunca reemplaza la etiqueta.

Ejemplo

Label

Correo electrónico

Placeholder

ejemplo@correo.com

---

# Iconos

Si existe un icono:

Siempre a la izquierda.

Separación

12 px

Nunca más de un icono.

---

# Tipos de Input

VIMDY soporta oficialmente:

• Texto

• Número

• Dinero

• Teléfono

• Correo

• Fecha

• Hora

• Contraseña

• Búsqueda

• Cantidad

• Código

• Observaciones

---

# Búsqueda

Siempre incluye:

Icono de lupa.

Placeholder claro.

Ejemplo

Buscar productos...

Debe responder inmediatamente.

---

# Validación

La validación ocurre mientras el usuario escribe.

Nunca después de enviar el formulario.

Los mensajes deben explicar la solución.

Incorrecto

"Campo inválido."

Correcto

"El teléfono debe tener 10 dígitos."

---

# Accesibilidad

Todos los inputs deben tener:

Label

ID único

Soporte para teclado

Focus visible

Compatibilidad con lectores de pantalla

---

# Regla Suprema

El usuario nunca debe preguntarse:

"¿Qué debo escribir aquí?"

Si eso ocurre,

el diseño del input está mal.