# FEEDBACK SYSTEM

## Objetivo

El sistema siempre debe informar al usuario qué está ocurriendo.

Nunca debe dejarlo con dudas.

Nunca debe generar ansiedad.

El feedback existe para transmitir seguridad.

---

# Filosofía

VIMDY habla poco.

Pero cuando habla,

siempre aporta valor.

Cada mensaje debe responder una de estas preguntas:

• ¿Qué ocurrió?

• ¿Qué está pasando?

• ¿Qué debo hacer ahora?

---

# Principios

Todo feedback debe ser:

• Claro

• Breve

• Humano

• Accionable

• Oportuno

Nunca técnico.

Nunca dramático.

Nunca exagerado.

---

# Tipos de Feedback

VIMDY utiliza únicamente cinco tipos.

• Información

• Éxito

• Advertencia

• Error

• Carga

Nada más.

---

# Información

Color

#38BDF8

Uso

Explicar estados.

Ejemplo

"Sincronizando información..."

---

# Éxito

Color

#22C55E

Ejemplos

Venta registrada.

Cliente actualizado.

Producto creado.

Inventario sincronizado.

Nunca escribir

"Operación completada correctamente."

---

# Advertencia

Color

#F59E0B

Uso

El usuario todavía puede continuar.

Ejemplos

Quedan pocas unidades.

Mesa sin cliente asignado.

Caja próxima al cierre.

---

# Error

Color

#EF4444

Uso

Impide continuar.

Siempre explica la solución.

Incorrecto

Error.

Incorrecto

Error 500.

Correcto

"No pudimos imprimir el ticket."

"Verifica la impresora e intenta nuevamente."

---

# Loading

Mientras el sistema trabaja.

Nunca bloquear toda la interfaz.

Siempre mostrar:

Skeleton

Spinner discreto

Texto corto

Ejemplo

Guardando...

---

# Toast

Ubicación

Parte inferior central.

Duración

2500 ms

Máximo

Un Toast visible.

Nunca apilar diez mensajes.

---

# Notificaciones

Solo cuando exista una acción importante.

Nunca enviar notificaciones por acciones normales.

Incorrecto

Producto abierto.

Pantalla cargada.

Usuario inició sesión.

Correcto

Inventario bajo.

Caja cerrada.

Pedido cancelado.

---

# Confirmaciones

Solo para acciones irreversibles.

Eliminar producto.

Cerrar caja.

Anular venta.

Nunca confirmar:

Guardar.

Editar.

Actualizar.

---

# Mensajes

Todos siguen esta estructura.

Problema.

↓

Consecuencia.

↓

Solución.

Ejemplo

"No pudimos conectar con la cocina."

"Los pedidos no se están enviando."

"Revisa la conexión e intenta nuevamente."

---

# Sonidos

Por defecto

Silencio.

Solo sonidos para:

Pago aprobado.

Error crítico.

Llamado urgente.

Nunca sonidos decorativos.

---

# Vibración

Solo en dispositivos móviles.

Acciones críticas.

Nunca vibrar por todo.

---

# Animaciones

Duración

150 ms

Muy discretas.

Nunca rebotes.

Nunca explosiones.

Nunca celebraciones.

---

# Accesibilidad

Todo feedback debe:

Ser visible.

Ser legible.

Ser anunciado por lectores de pantalla.

Mantener contraste AA.

No depender únicamente del color.

---

# Regla Suprema

El usuario nunca debe preguntarse:

"¿Qué pasó?"

Si eso ocurre,

el feedback está mal diseñado.