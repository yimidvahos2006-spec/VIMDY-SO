# 05_REGLAS_OPERATIVAS.md

## Reglas de Funcionamiento Interno
* **Consistencia de Datos:** Toda entrada de insumo o venta debe impactar el inventario y la caja en tiempo real de forma atómica.
* **Trazabilidad Absoluta:** Cada modificación en comanda, cancelación de ítem o descuento debe quedar registrada con usuario, fecha y hora.
* **Separación de Roles y Permisos:** El acceso a funciones sensibles (cortes de caja, anulaciones, edición de precios) está strictly restringido por jerarquía operativa.
* **Cierres de Caja Inviolables:** No se permiten modificaciones retroactivas en turnos ya cerrados sin auditoría explícita.