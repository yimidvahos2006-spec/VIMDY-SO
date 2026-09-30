VIMDY — cierre de caja → reporte automático

Qué implementa

El RPC close_shift_atomic crea el job del reporte en la misma transacción que cierra la caja.

El navegador hace un functions.invoke() inmediatamente después del cierre solo para acelerar el procesamiento.

Si el navegador se cierra, el job permanece en Supabase.

process-daily-report genera el snapshot y el reporte en servidor y crea/gestiona entregas.

WhatsApp y email tienen reintentos con backoff y estado visible.

whatsapp-webhook actualiza SENT/DELIVERED/READ/FAILED desde Meta.

El Dashboard muestra el último cierre automático y el reporte generado.

Configuración de destinatarios vive en Supabase, no en memoria local.

Email se usa como respaldo cuando WhatsApp no está configurado o falla, según configuración.

Secrets / configuración de servidor

Requeridos para el procesamiento:

DAILY_REPORT_WORKER_SECRET

RESEND_API_KEY (para correo)

RESEND_FROM (por ejemplo VIMDY notificaciones@vimdy.co)

Para WhatsApp:

WHATSAPP_ACCESS_TOKEN

WHATSAPP_PHONE_NUMBER_ID

WHATSAPP_GRAPH_VERSION

WHATSAPP_DAILY_REPORT_TEMPLATE

WHATSAPP_DAILY_REPORT_LANGUAGE (por defecto es_CO)

WHATSAPP_WEBHOOK_VERIFY_TOKEN

WHATSAPP_APP_SECRET

Deploy

supabase db push
supabase functions deploy process-daily-report --no-verify-jwt
supabase functions deploy whatsapp-webhook --no-verify-jwt

Configura los secrets con supabase secrets set ....

Programa process-daily-report cada minuto como backstop mediante Supabase Cron/Integrations o supabase/daily_report_cron.sql.

El camino inmediato al cerrar caja usa JWT del usuario; el backstop usa x-daily-report-secret.

WhatsApp

El flujo usa mensajes de plantilla de WhatsApp Business Platform. La plantilla debe existir en Meta con las siete variables de cuerpo, en este orden:

nombre del negocio

fecha empresarial

ventas netas

transacciones

promedio

diferencia de caja

alertas de stock bajo

Texto sugerido de la plantilla:

VIMDY — Cierre de {{1}} ({{2}})
Ventas netas: {{3}}
Transacciones: {{4}}
Promedio: {{5}}
Diferencia de caja: {{6}}
Stock bajo: {{7}}
Reporte generado por VIMDY.

Prueba empresarial mínima

Abrir caja.

Hacer una venta en efectivo.

Hacer una venta en tarjeta.

Hacer un reembolso.

Cerrar caja con conteo real.

Verificar daily_report_jobs.

Verificar daily_report_deliveries.

Cerrar el navegador inmediatamente.

Verificar que el worker siga procesando.

Verificar el Dashboard.

Verificar el mensaje en el canal configurado.

Nunca usar datos ficticios en producción.

Nota de costos de WhatsApp (25 Sep 2026)

El canal activo para el cierre diario es el correo electrónico. El destinatario se configura por negocio desde Ajustes y el backend envía el mensaje mediante la Edge Function. WhatsApp queda fuera de este flujo por ahora y puede habilitarse posteriormente sin cambiar el job durable ni la estructura de entregas.

Fuentes: Meta WhatsApp Business Policy y Platform Pricing; Supabase Queues/Cron/Webhooks; Resend Pricing.