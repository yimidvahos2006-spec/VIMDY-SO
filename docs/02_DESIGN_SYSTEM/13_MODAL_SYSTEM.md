# MODAL SYSTEM

## Objetivo

Los Modales existen únicamente para acciones críticas.

Nunca son una pantalla adicional.

Nunca reemplazan una mala navegación.

Un Modal interrumpe el flujo del usuario.

Por eso debe usarse con extrema disciplina.

---

# Filosofía

Un Modal debe responder únicamente una pregunta:

"¿Realmente necesito detener al usuario para esta acción?"

Si la respuesta es NO,

el Modal no debe existir.

---

# Cuándo usar un Modal

Está permitido únicamente para:

• Confirmaciones críticas

• Información importante

• Formularios cortos

• Vista rápida

• Acciones irreversibles

---

# Cuándo NO usar un Modal

Nunca para:

Configuración extensa

Tablas grandes

Reportes

Dashboards

Navegación

Asistentes paso a paso

Pantallas completas

Si el contenido supera 30 segundos de lectura,

debe convertirse en una pantalla.

---

# Apariencia

Background

#121215

Border

#27272A

Border Radius

16 px

Shadow

Ninguna

Gradientes

Nunca

Glow

Nunca

---

# Overlay

Color

rgba(9,9,11,.75)

Blur

Muy ligero

Nunca completamente negro.

El usuario debe entender que la pantalla sigue existiendo.

---

# Tamaños

Small

420 px

Medium

640 px

(Default)

Large

900 px

Fullscreen

Solo para dispositivos móviles.

---

# Espaciado

Padding

32 px

Separación entre elementos

24 px

---

# Estructura

Todo Modal sigue esta estructura.

────────────────────────

Título

Descripción

Contenido

Acciones

────────────────────────

Nunca alterar este orden.

---

# Tipografía

Título

20 px

Semibold

Color

#FFFFFF

---

Descripción

14 px

Regular

Color

#A1A1AA

---

Contenido

14 px

Regular

Color

#FFFFFF

---

# Botones

Máximo

Dos botones visibles.

Primary

Acción principal.

Secondary

Cancelar.

Nunca tres botones importantes.

---

# Cierre

Siempre puede cerrarse mediante:

ESC

Botón X

Click fuera (cuando sea seguro)

Cancelar

---

# Confirmaciones

Solo para acciones irreversibles.

Ejemplos

Eliminar cliente

Cerrar caja

Anular venta

Eliminar producto

Nunca confirmar acciones normales.

Guardar.

Editar.

Actualizar.

---

# Formularios

Máximo

6 campos visibles.

Si necesita más,

crear una pantalla dedicada.

---

# Loading

Mientras procesa

El Modal permanece abierto.

Los botones se bloquean.

Se muestra un indicador discreto.

Nunca cerrar el Modal antes de terminar.

---

# Error

Ejemplo

"No pudimos guardar los cambios."

Mostrar solución.

Nunca códigos técnicos.

Nunca errores de servidor.

---

# Éxito

Cerrar automáticamente.

Mostrar Toast.

Nunca dejar un Modal abierto diciendo:

"Proceso completado."

---

# Animación

Entrada

150 ms

Salida

120 ms

Escala

98% → 100%

Muy sutil.

Nunca rebotes.

Nunca efectos teatrales.

---

# Responsive

Desktop

Centrado.

Tablet

Centrado.

Mobile

Pantalla completa.

---

# Accesibilidad

Todo Modal debe:

Bloquear navegación de fondo.

Mantener Focus.

Responder a ESC.

Tener aria-label.

Permitir navegación por teclado.

---

# Regla Suprema

Si un Modal puede evitarse,

debe evitarse.

El mejor Modal

es el que nunca fue necesario abrir.