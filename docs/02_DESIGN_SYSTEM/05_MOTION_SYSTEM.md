# VIMDY DESIGN SYSTEM
# 05 — MOTION SYSTEM

---

# Objetivo

El Motion System define el comportamiento de toda animación, transición y movimiento dentro de VIMDY.

El movimiento nunca existe para decorar.

Existe únicamente para comunicar.

Guiar.

Confirmar.

Reducir la incertidumbre.

---

# Filosofía

Una buena animación casi no se nota.

Si el usuario observa la animación más que la información, el diseño falló.

El movimiento debe sentirse natural.

Silencioso.

Predecible.

Rápido.

---

# Principio Fundamental

Toda animación debe responder una sola pregunta:

¿Qué cambió?

Nunca debe existir movimiento sin significado.

---

# Regla de la Velocidad

Toda transición debe ser inmediata.

Duración estándar

150 ms

Nunca superar

250 ms

Nunca utilizar animaciones lentas.

---

# Curva Oficial

ease-out

Toda la aplicación utiliza la misma curva.

Nunca utilizar:

ease-in

bounce

elastic

spring exagerados

---

# Fade

Se utiliza únicamente para:

• Toasts

• Mensajes

• Estados

Nunca para pantallas completas.

---

# Slide

Solo permitido para:

Drawer

Sidebar

Modales laterales

Nunca utilizar Slide para cambiar de página.

---

# Escala

Permitida únicamente en:

Hover de botones

Hover de tarjetas

Nunca superior al 2%.

---

# Hover

El usuario debe sentir respuesta inmediata.

Cambios permitidos:

• Fondo

• Color

• Borde

Nunca mover componentes.

---

# Focus

El foco debe ser elegante.

Nunca agresivo.

Utilizar únicamente:

Borde azul VIMDY

#38BDF8

Opacidad baja.

---

# Sidebar

Expandir

250 ms

Colapsar

200 ms

Movimiento horizontal.

Nunca rebotes.

---

# Header

Nunca anima.

Siempre permanece estable.

---

# Dashboard

Los KPIs aparecen mediante Fade corto.

Nunca caen.

Nunca vuelan.

Nunca hacen zoom.

---

# Tarjetas

Hover

Elevación visual mínima.

Cambio de fondo.

Nunca sombras gigantes.

---

# Botones

Hover

150 ms

Active

100 ms

Disabled

Sin animación.

---

# Inputs

Focus

Cambio de borde.

Nada más.

---

# Tablas

Cambio de filas

Instantáneo.

Nunca animar cada fila.

---

# Modales

Fade

+

Scale

98%

↓

100%

Duración

180 ms

---

# Drawer

Entra desde la derecha.

Nunca desde abajo.

Nunca rebota.

---

# Toasts

Fade

+

Desplazamiento vertical

8 px

Duración total

2500 ms

---

# Loading

Nunca utilizar spinners gigantes.

Preferir:

Skeleton

Placeholder

Carga progresiva.

---

# Skeleton

Debe mantener exactamente el layout final.

Nunca mover componentes cuando llegan los datos.

---

# Cambio entre Aplicaciones

Dashboard

↓

Ventas

↓

Clientes

↓

Productos

Siempre instantáneo.

No existen transiciones cinematográficas.

---

# Cambio entre Estados

Libre

↓

Ocupado

↓

Cobrado

↓

Cerrado

Debe sentirse inmediato.

---

# IA

Las recomendaciones aparecen suavemente.

Nunca invaden la pantalla.

Nunca interrumpen.

---

# Error

No vibrar.

No sacudir.

No sonidos.

Solo mensaje claro.

---

# Confirmaciones

Venta registrada.

Pedido enviado.

Producto guardado.

Se muestran mediante Toast discreto.

Nunca modal.

---

# Responsive

Desktop

Movimiento completo.

Tablet

Igual.

Mobile

Reducir distancia.

Mantener velocidad.

---

# Accesibilidad

Si el usuario activa:

Reducir movimiento

Todas las animaciones desaparecen.

Solo permanece Fade mínimo.

---

# Errores Prohibidos

❌ Bounce

❌ Zoom exagerado

❌ Rotaciones

❌ Animaciones largas

❌ Componentes flotando

❌ Partículas

❌ Luces

❌ Destellos

❌ Efectos gamer

❌ Animaciones diferentes entre módulos

---

# Checklist

Antes de aprobar una animación verificar:

□ Comunica un cambio.

□ Es rápida.

□ No distrae.

□ Usa la duración oficial.

□ Usa la curva oficial.

□ No rompe el ritmo del sistema.

□ Respeta la accesibilidad.

---

# Regla Suprema

El usuario nunca debe recordar una animación.

Debe recordar que el sistema respondió inmediatamente.