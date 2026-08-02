# VIMDY DESIGN SYSTEM
# 04 — LAYOUT SYSTEM

---

# Objetivo

El Layout System define la estructura física de VIMDY.

No define colores.

No define componentes.

Define dónde vive cada elemento.

Su misión es garantizar que cualquier pantalla del sistema conserve el mismo orden, la misma jerarquía y la misma sensación de estabilidad.

---

# Filosofía

Una buena interfaz no necesita explicarse.

El usuario siempre sabe dónde mirar.

Siempre sabe dónde hacer clic.

Siempre sabe dónde está.

El layout nunca cambia sin una razón funcional.

---

# La Regla del Sistema Operativo

VIMDY no está compuesto por páginas independientes.

Está compuesto por aplicaciones que viven dentro del mismo sistema operativo.

Por esta razón:

El Header nunca cambia.

El Sidebar nunca cambia.

El comportamiento nunca cambia.

Solo cambia el contenido central.

---

# Estructura Principal

Toda pantalla sigue exactamente esta estructura.

┌──────────────────────────────────────────────┐
│                  HEADER                      │
├──────────────┬───────────────────────────────┤
│              │                               │
│              │                               │
│   SIDEBAR    │        ÁREA DE TRABAJO        │
│              │                               │
│              │                               │
├──────────────┴───────────────────────────────┤
│               MENSAJES DEL SISTEMA           │
└──────────────────────────────────────────────┘

Nunca modificar esta estructura.

---

# Header

Altura

80 px

Siempre permanece visible.

Nunca desaparece.

Nunca cambia de posición.

Funciones:

• Buscar

• Notificaciones

• Usuario

Nada más.

---

# Sidebar

Ancho expandido

240 px

Ancho colapsado

80 px

Siempre permanece visible.

Nunca cambia de lado.

Nunca contiene publicidad.

Nunca contiene banners.

---

# Área de Trabajo

Todo ocurre aquí.

Debe ocupar el máximo espacio disponible.

No tiene límites artificiales.

No utiliza cajas innecesarias.

---

# Márgenes

Desktop

48 px

Tablet

32 px

Mobile

24 px

Nunca pegar contenido al borde.

---

# Scroll

Solo existe un scroll principal.

Nunca utilizar scroll dentro de tarjetas.

Nunca utilizar doble scroll.

---

# Grid Principal

Todo el sistema utiliza una grilla de 12 columnas.

Permite adaptar cualquier pantalla.

---

# Separación entre Bloques

48 px

Siempre constante.

---

# Paneles

Los paneles nunca flotan.

Siempre pertenecen al sistema.

No parecen ventanas.

---

# Dashboard

El Dashboard utiliza una estructura vertical.

1.

Resumen

↓

2.

KPIs

↓

3.

Actividad

↓

4.

Análisis

Nunca mezclar todo.

---

# Formularios

Siempre siguen este orden.

Título

↓

Descripción

↓

Campos

↓

Acciones

Nunca alterar esta secuencia.

---

# Tablas

Título

↓

Filtros

↓

Tabla

↓

Paginación

Nunca cambiar este orden.

---

# Modales

Centro de pantalla.

Máximo:

720 px

Nunca ocupar toda la pantalla.

---

# Drawer

Siempre entra desde la derecha.

Nunca desde abajo.

Nunca desde la izquierda.

---

# Responsive

Desktop

Sidebar visible.

Header completo.

12 columnas.

Tablet

Sidebar colapsado.

8 columnas.

Mobile

Sidebar oculto.

Bottom Navigation.

4 columnas.

---

# Prioridad Visual

Siempre existe un único punto de atención.

Nunca dos.

Nunca tres.

---

# Regla del Centro

El contenido importante siempre vive dentro del área central.

Nunca en los extremos.

---

# Regla del Movimiento

Los elementos no saltan.

Los elementos aparecen.

Los elementos desaparecen.

Todo mantiene estabilidad.

---

# Pantallas Vacías

Cuando no exista información:

Mostrar mensaje.

Mostrar acción.

Nunca mostrar una pantalla completamente vacía.

---

# Estados de Carga

Primero aparece la estructura.

Después los datos.

Nunca mover el layout durante la carga.

---

# Errores Prohibidos

❌ Dos scrolls.

❌ Sidebar diferente entre pantallas.

❌ Header diferente.

❌ Componentes fuera de la grilla.

❌ Márgenes diferentes.

❌ Cambios bruscos de estructura.

❌ Layouts distintos para módulos similares.

---

# Checklist

Antes de aprobar una pantalla verificar:

□ Mantiene la estructura oficial.

□ Respeta Header.

□ Respeta Sidebar.

□ Utiliza la grilla.

□ Existe un solo scroll.

□ Existe un único punto de atención.

□ El contenido está alineado.

□ La navegación es consistente.

---

# Regla Suprema

El usuario nunca debe sentir que cambió de aplicación.

Debe sentir que simplemente abrió otra herramienta dentro del mismo Sistema Operativo VIMDY.