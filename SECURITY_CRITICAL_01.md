Prioridad crítica 1 — Contención de secretos en paquetes
Estado del trabajo en esta entrega
[x] Se excluyeron del paquete de trabajo los archivos `.env`, `.env.local` y `.env.e2e.local`.
[x] Se excluyó `supabase/.temp/`, que contenía configuración y claves generadas por el runtime local de Supabase.
[x] Se excluyó `src/.temp/` y `.playwright-mcp/` (logs y artefactos locales de pruebas).
[x] Se sustituyeron los valores del `.env.example` por marcadores de ejemplo y se retiró el duplicado `env.example.txt`.
[x] Se implementó `scripts/package-release.mjs` (el archivo original estaba vacío) con exclusiones obligatorias y detección de patrones de secretos antes de generar el ZIP. El paquete de release también excluye las suites de test y sus fixtures, así que las claves de prueba no entran en la entrega.
[ ] Pendiente fuera del ZIP: verificar y rotar cualquier credencial real que haya salido de un entorno privado. Este proyecto no tiene acceso a los paneles de Supabase, Resend o Vercel y no puede revocar credenciales por sí solo.
Evidencias observadas
El ZIP original incluía tres archivos de entorno locales, un token OIDC de Vercel ya expirado al momento de la inspección, una configuración del runtime Docker local de Supabase con claves generadas para ese entorno, y un archivo E2E que declaraba `SUPABASE_SERVICE_ROLE_KEY`. El `.env` local apuntaba a un proyecto Supabase alojado y al dominio de la aplicación. No se reproducen valores en este informe.
El hecho de que un valor esté presente en un archivo no demuestra por sí solo que siga activo o que sea de producción. Hasta que se confirme en el proveedor, no reutilizar ni distribuir los valores originales.
Acciones de proveedor que faltan para cerrar al 100 %
Resend — prioridad inmediata si `RESEND_SMTP_PASS` era una credencial activa. En el panel de Resend crea una nueva API key con el permiso mínimo necesario (preferiblemente solo envío), actualiza la variable correspondiente en Vercel, despliega y verifica el envío de correo. Después elimina la credencial anterior. No pegues claves en tickets, chats ni commits.
Supabase — valida el `SUPABASE_SERVICE_ROLE_KEY` del archivo E2E. Si corresponde a una clave del proyecto alojado, crea la clave secreta nueva en Settings → API Keys, actualiza únicamente los servicios backend que la necesiten, valida y desactiva la clave anterior. Nunca pongas una clave `service_role`/`sb_secret` en variables `VITE_*` ni en el navegador; dichas claves omiten RLS. Si el valor era un fixture inerte o clave local, documenta esa comprobación y no rote claves de producción innecesariamente.
Vercel — token OIDC local. El token incluido estaba expirado; se eliminó del paquete. No se halló evidencia en este archivo de un token de acceso personal Vercel distinto. Revisa la cuenta si el mismo estado local se compartió mientras el token aún era válido.
Historial y copias. Si estos archivos fueron committeados o enviados a repositorios/artifacts compartidos, revoca primero cualquier secreto activo, elimina los archivos de la historia del repositorio según el procedimiento oficial y limpia copias/artefactos accesibles. `.gitignore` evita futuras adiciones accidentales, pero no borra historial ni archivos ZIP ya distribuidos.
Entrega limpia. Para crear un ZIP fuente saneado, ejecuta `npm run package:release`. El script falla si encuentra patrones de tokens o claves entre los archivos incluidos. El artefacto se genera en `.release/vimdy-os-source.zip` y excluye `dist/`, las suites de test y las claves de prueba; la entrega/deploy debe reconstruirse desde el código fuente.
Verificación mínima
Después de generar el ZIP:
```bash
npm run package:release
unzip -t .release/vimdy-os-source.zip
unzip -Z1 .release/vimdy-os-source.zip | grep -E '(^|/)(\.env|\.env\.(local|e2e\.local|production|staging|test)|docker\.env)$|(^|/)(\.playwright-mcp|\.vercel|supabase/\.temp|src/\.temp)(/|$)|\.(pem|key|p12|pfx)$'
```
El primer comando crea el artefacto; `unzip -t` debe reportarlo íntegro y el último comando no debe imprimir rutas. El archivo `.env.example` se conserva de forma intencional porque solo contiene marcadores de ejemplo no funcionales.
Criterio de cierre: la distribución saneada está cerrada cuando el ZIP pasa la validación y las credenciales activas expuestas se han rotado o se ha documentado de forma verificable que los valores eran ficticios/expirados/locales. Limpiar el ZIP no revoca una credencial que ya haya salido de él.