# VIMDY — Plan de lanzamiento (Fases 6-22)

## Fase 6 — Prueba de usuario

### Objetivo
Detectar problemas de UX que los tests automatizados no capturan.

### Protoccolo
1. Reclutar 1 persona que nunca haya usado VIMDY.
2. Entregar dispositivo con negocio vacío.
3. Pedir: "Crea un producto y realiza una venta."
4. No explicar nada.
5. Observar y registrar:
   - Dónde se pierde
   - Qué botón busca
   - Qué texto no entiende
   - Qué pantalla le confunde
   - Qué hace mal
6. Si pregunta "¿Dónde hago esto?", marcar como problema de UX.

### Regla
Si 5 usuarios cometen el mismo error → no es culpa de los usuarios, es problema de UX.

---

## Fase 7 — Piloto de 5 negocios

### Criterios de selección
1. Restaurante pequeño (sin meseros/cocina propia)
2. Cafetería (con mesas, sin meseros)
3. Restaurante completo (meseros + cocina)
4. Food truck (sin mesas, sin meseros)
5. Panadería (ingredientes + recetas)

### Duración
Cada piloto: 7 días mínimo.

### Qué probar cada uno
| Negocio | Módulos críticos |
|---|---|
| Restaurante pequeño | Productos, ventas, caja, cocina sencilla |
| Cafetería | Mesas, productos, ventas rápidas, caja |
| Restaurante completo | Mesero → pedido → cocina → entrega → caja → inventario |
| Food truck | Venta rápida, sin mesas, sin meseros, caja |
| Panadería | Ingredientes, recetas, producción, inventario, ventas |

---

## Fase 8 — Protocolo de cada piloto

### Día 1
- [ ] Crear cuenta
- [ ] Configurar negocio (tipo, módulos)
- [ ] Cargar productos iniciales

### Día 2
- [ ] Crear empleados
- [ ] Configurar permisos/roles
- [ ] Probar acceso de cada rol

### Día 3
- [ ] Abrir caja
- [ ] Realizar 5 ventas
- [ ] Probar pago efectivo, tarjeta, mixto

### Día 4
- [ ] Probar cocina (si aplica)
- [ ] Probar mesas/meseros (si aplica)
- [ ] Verificar descuento de inventario

### Día 5
- [ ] Registrar devolución
- [ ] Cerrar caja
- [ ] Verificar arqueo

### Día 6
- [ ] Revisar reportes
- [ ] Verificar dashboard
- [ ] Probar offline (desconectar Internet)

### Día 7
- [ ] Entrevista de feedback (preguntas §82 del plan maestro)
- [ ] Registrar incidencias
- [ ] Decidir si continúa a pago

---

## Fase 10 — Corrección de pilotos

### Formato de reporte
```
ID:
PILOTO:
MÓDULO:
PROBLEMA:
PASOS PARA REPRODUCIR:
RESULTADO ESPERADO:
RESULTADO ACTUAL:
GRAVEDAD: 🔴 BLOQUEANTE / 🟠 IMPORTANTE / 🟡 MENOR
RESPONSABLE:
ESTADO:
```

### Criterios de bloqueo
No lanzar si aparece:
- Venta perdida
- Pago duplicado
- Caja incorrecta
- Inventario corrupto
- Datos de otro negocio visibles
- Fallo de permisos
- Sincronización que pierde datos
- Error que impide vender

---

## Fase 11 — Prueba de día completo

### Escenario
```
08:00 Abrir caja
08:15 Venta
09:00 Venta
10:00 Pedido cocina
11:00 Devolución
12:00 10 pedidos simultáneos
13:00 Desconectar Internet
13:05 Ventas offline (5)
13:30 Reconectar
14:00 Sincronización
15:00 Descuento
17:00 Retiro de caja
20:00 Cerrar caja
```

### Verificación post-cierre
Comparar:
- [ ] Ventas = suma de todos los pagos
- [ ] Caja = fondo inicial + ingresos - egresos
- [ ] Inventario = stock inicial - vendido
- [ ] Reportes coinciden con caja

---

## Fase 12 — Pruebas en dispositivos reales

### Dispositivos
- [ ] PC — Chrome
- [ ] Android — Chrome móvil
- [ ] Tablet — navegador
- [ ] iPhone — Safari (si aplica)

### Condiciones de red
- [ ] Internet normal
- [ ] Internet lento (3G simulado)
- [ ] Sin Internet (offline)

### Checklist por dispositivo
- [ ] Login funciona
- [ ] Navegación completa
- [ ] Venta rápida
- [ ] Caja abre/cierra
- [ ] Inventario se actualiza
- [ ] Reportes cargan
- [ ] Sin errores en consola

---

## Fase 13 — Pago real

### Antes de cobrar clientes
1. Hacer 1 transacción de prueba en el flujo real.
2. Verificar ciclo completo:
   ```
   Cliente → Pago → Proveedor → Confirmación → VIMDY → Suscripción
   ```
3. No activar cobros comerciales hasta que el ciclo esté comprobado.

### Solo métodos funcionando
- Colombia: Wompi
- Resto: PayPal
- No activar métodos incompletos.

---

## Fase 14 — Parte empresarial

### Antes de vender públicamente
- [ ] Términos y condiciones
- [ ] Política de privacidad
- [ ] Tratamiento de datos
- [ ] Política de cancelación
- [ ] Información de soporte
- [ ] Facturación configurada
- [ ] Condiciones de suscripción

### No asumir
Una configuración fiscal/pago de un país no sirve automáticamente para otros.

---

## Fase 15 — Lanzamiento controlado

### No hacer
"Ya lanzamos VIMDY, entren todos."

### Hacer
1. Semana 1: 5 negocios piloto
2. Semana 3: 10 negocios
3. Semana 5: 25 negocios
4. Semana 7: 50 negocios
5. Semana 9: 100 negocios

### Soporte durante lanzamiento
- Respuesta rápida
- Registrar cada problema
- Si 3 clientes tienen el mismo problema → prioridad de producto

---

## Fase 16 — Conversión a pago

### Para los primeros pilotos
Una vez que hayan comprobado que VIMDY funciona:
"¿Quieres continuar utilizando VIMDY?"

### Planes
- Mensual: $79.000 COP
- Anual: $799.000 COP (2 meses gratis)

### No presionar
El objetivo es comprobar que realmente existe disposición a pagar.

---

## Fase 17 — Conseguir los 100

### Meta mensual
| Mes | Nuevos clientes |
|---|---|
| Agosto | 10 |
| Septiembre | 15 |
| Octubre | 20 |
| Noviembre | 25 |
| Diciembre | 30 |

### Ritmo semanal
~5 clientes por semana.

---

## Fase 18 — Sistema de ventas

### Rutina semanal
- Lunes: Buscar negocios
- Martes: Contactarlos
- Miércoles: Hacer demos
- Jueves: Instalar/configurar pilotos
- Viernes: Cerrar ventas
- Sábado: Visitar/acompañar negocios

### Demostración de 5 minutos
1. Crear producto
2. Hacer venta
3. Mandar a cocina
4. Cobrar
5. Mostrar caja
6. Mostrar inventario
7. Mostrar dashboard

Y terminar: "Esto es VIMDY."

---

## Fase 19 — Lo que debemos vender

### No vender
- "Tenemos 217 tests"
- "Tenemos Supabase"
- "Tenemos 20 módulos"

### Vender
> "VIMDY te permite controlar las ventas, caja, inventario y operación de tu negocio desde un solo lugar."

Y después demostrarlo.

---

## Fase 20 — Métricas

### Cada semana revisar

#### Producto
- Errores
- Ventas
- Transacciones
- Sincronizaciones
- Fallos

#### Negocio
- Negocios activos
- Negocios pagos
- Cancelaciones
- Renovaciones

#### Uso
- Ventas por negocio
- Usuarios activos
- Frecuencia de uso

#### Soporte
- Problemas
- Tiempo de respuesta
- Problemas repetidos

---

## Fase 21 — Regla para nuevas funciones

Antes de agregar algo, preguntar:
1. ¿Los clientes lo están pidiendo?
2. ¿Soluciona un problema real?
3. ¿Aumenta el valor de VIMDY?
4. ¿Mejora retención?

Si todas son NO → VIMDY 1.1, no ahora.

---

## Fase 22 — Definición de éxito

VIMDY será un éxito cuando:
```
Negocio
↓
entra
↓
entiende
↓
vende
↓
cobra
↓
controla
↓
confía
↓
paga
↓
continúa pagando
↓
recomienda VIMDY
```

Ese último paso es el objetivo.
