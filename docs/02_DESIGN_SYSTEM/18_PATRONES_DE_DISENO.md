# PATRONES DE DISEÑO

## Objetivo

Los Patrones de Diseño establecen soluciones reutilizables para los problemas más comunes de la interfaz.

Su propósito es garantizar que el usuario siempre encuentre la misma lógica de funcionamiento en cualquier parte del sistema.

Nunca se debe inventar una nueva interacción si ya existe un patrón aprobado.

---

# Filosofía

La consistencia genera velocidad.

Cuando el usuario aprende una interacción,

debe poder reutilizar ese conocimiento en todo VIMDY.

Cada patrón reduce la carga cognitiva.

---

# Patrón 1
## Crear

Toda creación de información sigue el mismo flujo.

Acción principal

↓

Formulario

↓

Guardar

↓

Toast de éxito

↓

Actualización inmediata

Nunca abrir varias ventanas.

Nunca recargar toda la aplicación.

---

# Patrón 2
## Editar

Seleccionar elemento

↓

Editar

↓

Modificar

↓

Guardar

↓

Toast

↓

Actualización automática

El usuario nunca pierde el contexto.

---

# Patrón 3
## Eliminar

Seleccionar elemento

↓

Confirmación

↓

Eliminar

↓

Toast

↓

Lista actualizada

Solo las acciones irreversibles requieren confirmación.

---

# Patrón 4
## Buscar

Buscar

↓

Resultados inmediatos

↓

Seleccionar

↓

Continuar

Nunca obligar al usuario a navegar por múltiples pantallas.

---

# Patrón 5
## Filtrar

Aplicar filtro

↓

Actualizar resultados

↓

Conservar filtro activo

Los filtros permanecen hasta que el usuario decida eliminarlos.

---

# Patrón 6
## Ordenar

Seleccionar columna

↓

Ascendente

↓

Descendente

↓

Estado inicial

Solo existen esos tres estados.

---

# Patrón 7
## Estados Vacíos

No existen datos

↓

Explicación

↓

Acción sugerida

Ejemplo

"No hay clientes registrados."

[ Crear cliente ]

Nunca mostrar pantallas completamente vacías.

---

# Patrón 8
## Error

Problema

↓

Explicación

↓

Solución

↓

Reintentar

Nunca mostrar mensajes técnicos.

Nunca mostrar códigos de error.

---

# Patrón 9
## Carga

Skeleton

↓

Contenido

Nunca bloquear toda la pantalla.

Nunca utilizar spinners grandes.

---

# Patrón 10
## Navegación

Aplicación

↓

Vista

↓

Acción

Nunca más de dos niveles de navegación.

---

# Patrón 11
## Confirmación

Solo para acciones críticas.

Eliminar.

Cerrar caja.

Anular venta.

Nunca confirmar acciones normales.

---

# Patrón 12
## Deshacer

Cuando sea posible,

las acciones permiten deshacer.

Ejemplo

Producto eliminado.

↓

Toast

↓

Deshacer

El usuario debe sentirse seguro al trabajar.

---

# Patrón 13
## IA

La IA nunca interrumpe.

Solo aparece cuando detecta:

Riesgos.

Anomalías.

Oportunidades.

Siempre ofrece una acción inmediata.

---

# Patrón 14
## Responsive

Desktop

Tablet

Mobile

Mantienen exactamente la misma lógica.

Solo cambia la distribución.

Nunca cambia el flujo.

---

# Patrón 15
## Accesibilidad

Todos los patrones deben permitir:

Teclado.

Focus visible.

Lectores de pantalla.

Contraste AA.

---

# Regla Suprema

Si un usuario aprende un flujo una vez,

debe poder repetirlo en cualquier parte del sistema sin volver a pensar.

La mejor interfaz es aquella que se comporta siempre igual.