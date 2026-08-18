# VIMDY — Fase 6: Prueba de usuario
Protocolo oficial para evaluar si un usuario nuevo puede usar VIMDY sin explicaciones.

## Perfiles de los 5 usuarios

| Usuario | Perfil |
|---|---|
| U1 | Persona que nunca ha usado un POS |
| U2 | Persona que usa celular/computador normalmente |
| U3 | Persona que trabaja o ha trabajado en comercio |
| U4 | Persona relacionada con restaurante/cafetería |
| U5 | Dueño o administrador de un pequeño negocio |

## Preparación previa

1. Crear negocio vacío: "Café Prueba"
2. Estado inicial: 0 productos, 0 ventas, 0 clientes, 0 ingredientes, 0 empleados, 0 mesas
3. Dispositivo limpio (sin datos de prueba)
4. Observador con hoja de registro + cronómetro

## Guion exacto

Entregar el dispositivo y decir solamente:

> "Este es un sistema para administrar un negocio. Tienes un negocio nuevo y vacío. Necesito que crees un producto llamado Café con leche, que cuesta $8.000, y hagas una venta de ese producto."

Y silencio.

No explicar:
- dónde está Productos
- dónde está Ventas
- qué significa cada botón
- dónde se cobra
- cómo regresar

## Regla de oro

Si el usuario pregunta "¿Dónde tengo que ir?", **no responder inmediatamente**.

Preguntar: "¿Qué intentarías hacer?"

Si está completamente bloqueado durante demasiado tiempo, entonces sí pueden intervenir, pero deben registrar: "Usuario bloqueado en [módulo]; intervención necesaria."

## Hoja de registro

| Usuario | Tiempo | Confusión | Pregunta | Intervención |
|---|---|---|---|---|
| U1 |  |  |  |  |
| U2 |  |  |  |  |
| U3 |  |  |  |  |
| U4 |  |  |  |  |
| U5 |  |  |  |  |

## Segunda venta

Después de completar la primera venta:

> "Haz otra venta del mismo producto."

Sin explicarle nada.

Objetivo: comparar velocidad y fluidez Venta #1 vs Venta #2.

## Prueba de caja

Después de la segunda venta:

> "Ahora dime cuánto dinero debería haber en caja."

No explicar dónde verlo.

Objetivo: verificar que el usuario puede interpretar el estado de caja sin ayuda.

## Prueba de comprensión

Al final:

> "Explícame con tus propias palabras para qué sirve VIMDY."

No dar opciones.

## Criterios de clasificación de problemas

| Tipo | Símbolo | Descripción |
|---|---|---|
| Problema técnico | 🔴 | Algo no funciona |
| Problema de UX | 🟠 | Funciona, pero el usuario no sabe utilizarlo |
| Problema de concepto | 🔵 | El usuario no entiende qué significa algo |
| Problema de negocio | 🟣 | VIMDY funciona, pero el flujo no coincide con cómo trabaja el negocio |
| Sin problema | 🟢 | Todo fluye correctamente |

## Criterios para aprobar Fase 6

- 🔴 0 errores críticos: ningún usuario debe perder una venta, cobrar incorrectamente, generar datos duplicados, ver información ajena o dejar la caja inconsistente.
- 🟢 4/5 pueden completar la tarea sin asistencia significativa.
- 🟢 4/5 entienden la navegación principal.
- 🟢 4/5 pueden hacer la segunda venta más fácilmente.
- 🟢 4/5 entienden qué hace VIMDY.

Si no se cumplen, Fase 6 sigue abierta.

## Formato de resultados

Entregar así:

```
FASE 6 — RESULTADOS

U1
Primera venta: 4:32
Problema: no encontró Productos
Pregunta: "¿Dónde creo el producto?"
Intervención: sí
Clasificación: 🟠 UX
Sugerencia: ...

U2
Primera venta: 2:15
Problema: ninguno
Intervención: no
Clasificación: 🟢 SIN PROBLEMA

...
```

Con esa información se define la lista de correcciones antes de pasar a Fase 7.
