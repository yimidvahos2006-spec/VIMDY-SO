-- ============================================================================
-- 20261016000000_step4_dian_pending_lease.sql
-- ----------------------------------------------------------------------------
-- Paso 9C Fase 4.2: recuperacion durable de facturas DIAN en estado pending.
--
-- PROBLEMA
-- --------
-- Con el orden de procesamiento
--     INSERT pending -> consecutivo -> firma -> sendBill -> UPDATE resultado
-- una muerte en cualquiera de esos puntos dejaba una fila `pending` que el
-- early-return de la Edge Function (dian-invoice/index.ts) devolvia tal cual,
-- para siempre: no habia worker, ni accion `retry`, ni lease. La factura
-- quedaba huerfana de forma permanente.
--
-- SOLUCION
-- --------
-- Anadir `processing_started_at` para manejar un lease simple:
--   NULL                      -> la fila fue creada pero nadie la reclamo
--   ahora - <timeout>         -> hay un request procesando
--   mas viejo que <timeout>   -> el lease EXPIRO: es stale y se puede reclamar
--
-- El timeout de staleness NO se fija aqui: lo aplica la Edge Function, que lo
-- toma del mismo valor que ya usa la cola electronic_invoice_jobs
-- (next_retry_at = now() + 60s en index.ts). Ver 20261016000000 abajo.
--
-- TIMEOUT DE STALENESS
-- --------------------
-- Valor: 60_000 ms (1 minuto).
-- Justificacion: NO es un valor inventado. Es la cadencia de reintento que el
-- propio proyecto ya usa para electronic_invoice_jobs.next_retry_at
-- (`new Date(Date.now() + 60000)` en dian-invoice/index.ts). Reutilizarla
-- evita que existan dos politica de retry distintas en el mismo flujo.
-- Impacto: una transmision a la DIAN sandbox/produccion que tarde mas de 60s
-- podria ser considerada stale por otra request. Ese riesgo esta mitigado
-- porque, antes de retransmitir, la Edge Function consulta getStatus() a la
-- DIAN cuando transmitted_at IS NOT NULL, y solo retransmite si DIAN confirma
-- que el documento no existe.
--
-- CAMPOS EXISTENTES QUE NO SE REUTILIZAN (y por que)
-- ---------------------------------------------------
--   created_at      -> "cuando se creo la fila". Actualizarlo al reclamar
--                      cambiaria su significado historico.
--   last_attempt_at -> "ultimo intento de transmision". Usarlo como inicio de
--                      lease lo degradaria a "ultimo reclamo".
--   transmitted_at   -> YA marca correctamente si sendBill fue invocado: solo
--                      se escribe en las dos ramas posteriores a sendBill
--                      (exito en L898, error de red en L815). Se reutiliza tal
--                      cual como evidencia de "intento de transmision".
--
-- IMPACTO RLS/RBAC
-- -----------------
-- Ninguno. electronic_invoices conserva su RLS; agregar una columna no altera
-- policies. El lease se opera con el service role de la Edge Function, igual
-- que el resto de las escrituras de esa funcion.
--
-- Migracion NUEVA: no se modifica ninguna migracion historica.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Columna de lease
-- ---------------------------------------------------------------------------
ALTER TABLE public.electronic_invoices
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

COMMENT ON COLUMN public.electronic_invoices.processing_started_at IS
  'Inicio del lease de procesamiento. NULL = sin reclamar. Una request solo puede reclamar un pending cuyo lease ya expiro (processing_started_at < now() - timeout). El timeout lo aplica la Edge Function (60s, misma cadencia que electronic_invoice_jobs.next_retry_at).';

-- ---------------------------------------------------------------------------
-- 1b) Columna de "intento de transmision" (anterior a sendBill)
-- ---------------------------------------------------------------------------
-- POR QUE: transmitted_at solo se escribe DESPUES de sendBill(), en las dos
-- ramas posteriores (exito y error de red). Si el proceso muere entre que
-- sendBill() responde y el UPDATE, transmitted_at queda NULL aunque la DIAN
-- YA haya recibido el documento. Interpretar transmitted_at IS NULL como
-- "la DIAN nunca lo recibio" es INSEGURO: retransmitir sobre esa senal
-- duplicaria la factura ante la DIAN.
--
-- transmission_started_at se persiste ANTES de invocar sendBill(), de modo que
-- la combinacion de ambos timestamps distinguish tres situaciones:
--   NULL / NULL                      -> no se intento transmitir
--   NOT NULL / NULL                  -> sendBill empezo y el proceso pudo morir:
--                                        NO retransmitir, consultar getStatus()
--   NOT NULL / NOT NULL              -> hubo intento y se alcanzo la
--                                        persistencia posterior
ALTER TABLE public.electronic_invoices
  ADD COLUMN IF NOT EXISTS transmission_started_at timestamptz;

COMMENT ON COLUMN public.electronic_invoices.transmission_started_at IS
  'Momento en que se invoco sendBill(), escrito ANTES de la llamada. Junto con transmitted_at permite distinguir "nunca se intento" de "se intento pero no se pudo persistir el resultado". Un retry NUNCA debe retransmitir solo porque transmitted_at IS NULL si esta columna ya tiene valor: debe consultar getStatus() a la DIAN.';

-- ---------------------------------------------------------------------------
-- 2) Indice parcial para localizar candidatos stale
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS electronic_invoices_pending_lease_idx
  ON public.electronic_invoices (status, processing_started_at)
  WHERE status = 'pending';

COMMENT ON INDEX public.electronic_invoices_pending_lease_idx IS
  'Localiza pendientes con lease vencido. Parcial porque solo importa para status=pending; los estados terminales (accepted/rejected/error/cancelled) no se indexan.';

COMMIT;