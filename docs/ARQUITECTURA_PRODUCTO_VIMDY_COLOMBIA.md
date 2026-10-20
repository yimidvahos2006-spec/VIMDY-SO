# Arquitectura de producto de VIMDY — Colombia

**Estado:** propuesta de arquitectura de producto; no implica que las funciones listadas estén implementadas ni habilitadas en producción.  
**Alcance inicial:** negocios de alimentos y bebidas en Colombia.  
**Regla de trabajo:** primero asegurar la operación básica y sus datos; después ampliar funciones. Los cambios se desarrollan y validan en la rama de trabajo, sin experimentar con operaciones financieras reales.

## 1. Visión del producto

VIMDY debe sentirse sencillo el primer día y seguir siendo útil cuando el negocio crezca. Una cafetería con un local debe poder vender y cuadrar su caja sin configurar diez módulos. Una empresa con varias sedes debe poder dirigirlas desde una misma cuenta, pero ver con claridad de qué sede viene cada venta, movimiento, empleado e indicador.

Principios no negociables:

1. **Fácil para empezar.** Preguntar solo lo necesario; explicar cada decisión con lenguaje de negocio, no técnico.
2. **Un negocio no es una sucursal.** Un negocio es la empresa o unidad comercial principal. Una sucursal es una sede de ese negocio.
3. **Un dato financiero debe tener origen.** Ventas, pagos, movimientos de caja e inventario deben quedar ligados al negocio y a la sucursal correspondientes.
4. **Nada de éxitos falsos.** La interfaz solo confirma una operación después de recibir confirmación autoritativa del servidor.
5. **Permisos reales.** Ocultar botones en el navegador no basta; los permisos y el alcance de negocio/sucursal deben validarse en servidor.
6. **Crecer sin obligar.** Un local puede empezar con una sucursal principal y agregar otras después.
7. **Privacidad por diseño.** La ubicación sirve para localizar una sede. VIMDY no debe rastrear continuamente a empleados por defecto.
8. **Colombia primero.** Moneda COP, zona horaria, idioma, impuestos y requisitos operativos deben sentirse naturales para el mercado colombiano; ampliar países no debe bloquear este objetivo.

## 2. Modelo mental del cliente

- **Negocio:** el restaurante, cafetería, panadería, bar u otra operación F&B que se administra como una unidad principal dentro de VIMDY.
- **Sucursal:** sede física de un negocio, por ejemplo “Centro” y “Norte”.
- **Caja:** punto o registro de efectivo asignado a una sucursal.
- **Turno:** sesión de trabajo de un responsable de caja.
- **Usuario/empleado:** persona con permisos definidos en un negocio y, cuando aplique, limitados a ciertas sucursales.
- **Cuenta:** identidad para iniciar sesión; puede tener acceso a uno o más negocios según permisos y reglas del plan.

La interfaz debe preferir expresiones claras como “Mi negocio”, “Sucursales”, “Cambiar de sucursal” y “Crear otro negocio”. Nunca debe presentar “Crear negocio” como vía normal para añadir una sede.

## 3. Registro y configuración inicial

### Flujo recomendado

1. **Crear cuenta / iniciar sesión.**
2. **Crear el negocio una sola vez:** nombre, tipo de operación y datos básicos.
3. **Configurar sede principal:** nombre visible (por defecto “Sede principal”), dirección y teléfono opcional.
4. **Preguntar de forma simple:** “¿Tu negocio tiene más de una sede?” — “No, tengo un local” / “Sí, tengo varias sucursales”.
5. Si responde que tiene varias, permitir agregar de 1 a N sedes iniciales y seguir agregándolas después desde Configuración. No obligar a completar todas las direcciones en el primer día.
6. **Configurar la operación mínima:** módulos que necesita; no activar cocina, mesas, inventario u otros flujos sin que el negocio los necesite.
7. **Guía breve y contextual:** mostrar cómo abrir caja, registrar una venta y revisar el cierre; nunca ejecutar ventas de prueba automáticamente en datos reales.

La pregunta por cantidad de sedes puede servir para estimar el trabajo inicial o proponer formularios, pero no debe crear sedes incompletas silenciosamente. Antes de guardar, mostrar un resumen y permitir corregirlo.

### Negocio adicional versus sucursal

- “Añadir sucursal” ocurre dentro del negocio actual y conserva su identidad empresarial.
- “Crear otro negocio” es para administrar otra empresa o unidad comercial distinta.
- Si una cuenta autenticada aparece sin negocio asociado, mostrar una recuperación comprensible y una opción segura de reintento; no enviar directamente a crear otro negocio sin explicar por qué.
- La ausencia de una relación en la sesión no demuestra que los datos hayan sido borrados. No recrear ni migrar datos hasta verificar identidad, membresías y negocio.

## 4. Sucursales con GPS

### Experiencia deseada

Cada sucursal debe poder guardar:
- nombre de la sede;
- dirección escrita y, si procede, dirección normalizada;
- ciudad/municipio y departamento;
- teléfono opcional;
- latitud y longitud, solo cuando se hayan confirmado;
- estado activa/inactiva y marca de sucursal principal.

En el mapa, el propietario podría:
- ver las sedes a las que tiene permiso;
- seleccionar una sede para ver su ficha;
- abrir indicaciones en la aplicación de mapas preferida;
- corregir manualmente la ubicación si el pin queda desplazado.

### Captura de ubicación

Ofrecer dos opciones explícitas: escribir la dirección o usar “Detectar mi ubicación”. El navegador debe pedir permiso al usuario; denegarlo no debe impedir guardar dirección manualmente. El GPS registra la sede, no la posición continua de trabajadores. Para geocodificación o mapas externos, seleccionar proveedor, revisar costo, límites, privacidad y claves antes de integrarlo.

### Datos y seguridad

Las coordenadas pertenecen a la sucursal y deben tener relación con su negocio. No cambiar de sucursal al azar ni usar el negocio actual como único filtro para consultas multi-sucursal. Toda consulta o mutación financiera debe validar negocio, sucursal, membresía y permiso en servidor. Antes de añadir columnas o una migración, verificar el esquema remoto, índices, políticas RLS y compatibilidad histórica.

## 5. Caja y operaciones financieras

Caja debe mantenerse separada por sucursal, caja y turno:
- apertura con responsable, hora y efectivo inicial;
- movimientos de entrada/salida con motivo, usuario, sucursal e idempotencia;
- cobros ligados a ventas y método de pago;
- transferencias entre cajas con origen/destino y estados claros;
- conteo y cierre con esperado, contado y diferencia explicada;
- historial de auditoría y protección frente a doble clic/reintento;
- permisos de supervisor para ajustes y acciones excepcionales.

No hacer pruebas financieras contra el negocio real con ventas ficticias, movimientos de ensayo o cierres inventados. Los tests automatizados deben usar datos aislados/fakes o un entorno claramente designado; si solo existe la base real, empezar por lectura y análisis de código y acordar cada operación persistente con el propietario.

## 6. Panel del dueño

El panel debe contestar preguntas útiles, no solo mostrar gráficos:
- ¿Cómo vamos hoy y en el periodo seleccionado?
- ¿Qué sucursal está incluida?
- ¿Qué caja o turno está abierto y quién es responsable?
- ¿Hay una diferencia, pago pendiente o dato que requiere atención?
- ¿Qué productos se están agotando?
- ¿Cómo se comparan las sedes con el mismo periodo y las mismas definiciones?

Todo indicador debe tener rango de fechas, zona horaria y alcance (negocio/sucursal) visibles. Los totales consolidados deben ser calculados de forma consistente en servidor. Los pronósticos deben explicar periodo, muestra y limitaciones.

## 7. Navegación y consistencia UX

- Una navegación principal estable, con nombres familiares.
- Contexto de negocio y sucursal visible, especialmente en Caja e Inventario.
- Si existen varias sedes, selector de sucursal accesible y con el nombre completo.
- Confirmaciones claras antes de guardar acciones sensibles.
- Estados distinguibles: guardado, pendiente, error, sin conexión y solo lectura.
- Mensajes accionables: decir qué pasó y cuál es el siguiente paso.
- Las pantallas de configuración deben distinguir “negocio” de “sucursal” en el título y la ayuda.
- Errores de carga no deben redirigir automáticamente al formulario de creación de negocio sin ofrecer reintento y explicación.

## 8. Hoja de ruta propuesta

### P0 — Recuperar acceso y proteger los datos
- Resolver por qué el Preview está enviando a “Crear negocio” y comprobar la membresía del usuario sin exponer IDs ni secretos.
- Mantener producción intacta y confirmar qué configuración y commit tiene el Preview.
- Validar que el flujo de inicio de sesión y selección de negocio funcione.
- Hacer lectura del estado de Caja; todavía no registrar operaciones reales.
- Corregir la discrepancia entre migraciones aplicadas y el historial de migraciones antes de cualquier despliegue de esquema futuro.

**Salida de P0:** el usuario puede entrar a su negocio existente en Preview y navegar a Caja sin crear un negocio duplicado.

### P1 — Caja funcional y confiable
- Pruebas unitarias y de flujo para apertura, cobro, movimientos, transferencia, conteo y cierre.
- Verificar permisos, negocio/sucursal, idempotencia, errores y estados pendientes.
- No aprobar el módulo por un build exitoso solamente; exigir evidencia del flujo y persistencia según la política de pruebas acordada.

### P2 — Sucursales y GPS
- Revisar modelo de datos, RLS y aislamiento existentes.
- Definir migración aditiva y reversible para coordenadas si no existen campos equivalentes.
- Diseñar gestión de sucursales: crear, editar, activar/desactivar y marcar principal; evitar eliminación destructiva cuando hay historial.
- Implementar dirección, selección manual de pin y geolocalización con permiso.
- Validar selector de sucursal y consistencia de Caja, Inventario, reportes y empleados por sede.

### P3 — Registro simple y crecimiento
- Incorporar la pregunta sobre una o varias sedes en el onboarding después de crear correctamente el negocio principal.
- Permitir “lo hago después”.
- No imponer un límite comercial definitivo de cinco sedes hasta definir planes y costos.
- Ofrecer creación de otro negocio en un flujo distinto, con explicación.

### P4 — Consolidación y crecimiento
- Reportes consolidados y filtros comparables por sede.
- Alertas con acciones claras.
- Rendimiento con más productos, usuarios, movimientos y sucursales.
- Accesibilidad, móviles/tablets, monitoreo y recuperación ante errores.

## 9. Criterios para declarar una función terminada

Una función solo se considera lista cuando:
- su flujo UX es comprensible para una persona no técnica;
- maneja carga, vacío, error, permisos y reintento;
- persiste en servidor y se rehidrata tras recargar;
- se verifica el alcance por negocio y sucursal;
- hay pruebas relevantes y revisión de regresión;
- se documenta qué se probó y qué no;
- su despliegue no depende de secretos expuestos ni modifica accidentalmente el entorno productivo.

**Estado de este documento:** dirección de producto y plan de trabajo. No equivale a una implementación de GPS, onboarding multi-sucursal ni certificación de Caja.
