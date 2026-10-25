-- ============================================================================
-- supabase/diagnostics/cash_expected_history_check.sql
-- SOLO LECTURA (no modifica nada). Correr DESPUÉS de 20261111000000_cash_expected_single_rule.sql
--
-- Muestra los turnos YA CERRADOS cuyo "esperado" guardado es distinto al que da
-- la regla única de efectivo. No se reescribe la historia: esto es solo para que
-- tú decidas qué hacer con cada caso (normalmente, ninguno si solo hay pruebas).
--
-- Cómo leerlo:
--   diferencia_esperado = esperado_regla_unica - esperado_guardado
--   diferencia > 0  -> el cierre guardado esperaba MENOS efectivo del que correspondía
--                      (el cajero pudo salir con un falso "sobrante").
--   diferencia < 0  -> esperaba MÁS (pudo salir un falso "faltante").
-- ============================================================================
SELECT
  s.id                                              AS turno,
  s.business_id                                     AS negocio,
  s.data->>'closedAt'                               AS cerrado_en,
  (s.data->>'openingAmount')::numeric               AS fondo_inicial,
  (s.data->>'expectedAmount')::numeric              AS esperado_guardado,
  c.expected_amount                                 AS esperado_regla_unica,
  c.expected_amount - (s.data->>'expectedAmount')::numeric AS diferencia_esperado,
  (s.data->>'countedAmount')::numeric               AS contado,
  (s.data->>'difference')::numeric                  AS diferencia_guardada,
  (s.data->>'countedAmount')::numeric - c.expected_amount AS diferencia_con_regla_unica
FROM public.shifts s
CROSS JOIN LATERAL public.caja_shift_cash_totals(s.id) c
WHERE s.data->>'status' = 'CLOSED'
  AND s.data->>'expectedAmount' IS NOT NULL
  AND abs(c.expected_amount - (s.data->>'expectedAmount')::numeric) > 0.005
ORDER BY s.data->>'closedAt' DESC
LIMIT 200;