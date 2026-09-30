-- ============================================================================
-- VIMDY OS — Wompi Colombia: corrección de policies RLS
-- ============================================================================
-- Corrige el error 42601 ("solo se permite WITH CHECK para INSERT") causado
-- por usar USING (false) en policies de INSERT. Esta corrección es idempotente
-- y no toca tablas, índices, funciones ni constraints existentes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Corregir policies de wompi_incoming_payments
-- ----------------------------------------------------------------------------

-- INSERT debe usar WITH CHECK, no USING
DROP POLICY IF EXISTS wompi_incoming_payments_no_client_write ON wompi_incoming_payments;
CREATE POLICY wompi_incoming_payments_no_client_write ON wompi_incoming_payments
  FOR INSERT WITH CHECK (false);

-- UPDATE y DELETE sí usan USING
DROP POLICY IF EXISTS wompi_incoming_payments_no_client_update ON wompi_incoming_payments;
CREATE POLICY wompi_incoming_payments_no_client_update ON wompi_incoming_payments
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS wompi_incoming_payments_no_client_delete ON wompi_incoming_payments;
CREATE POLICY wompi_incoming_payments_no_client_delete ON wompi_incoming_payments
  FOR DELETE USING (false);

-- ----------------------------------------------------------------------------
-- 2. Corregir policies de wompi_payment_audit_log
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS wompi_payment_audit_log_no_client_write ON wompi_payment_audit_log;
CREATE POLICY wompi_payment_audit_log_no_client_write ON wompi_payment_audit_log
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS wompi_payment_audit_log_no_client_update ON wompi_payment_audit_log;
CREATE POLICY wompi_payment_audit_log_no_client_update ON wompi_payment_audit_log
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS wompi_payment_audit_log_no_client_delete ON wompi_payment_audit_log;
CREATE POLICY wompi_payment_audit_log_no_client_delete ON wompi_payment_audit_log
  FOR DELETE USING (false);
