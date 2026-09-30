import { LossCategory } from "../entities/Entities";

/**
 * lossCategoryLabels.ts — PASO 2.5 (Centro de Pérdidas)
 * ---------------------------------------------------------------------------
 * Única fuente de verdad para el nombre legible de cada LossCategory.
 * La usan: el formulario de "Disminuir stock" en Inventario (para que el
 * negocio elija el motivo), el store useLossCenter (para agrupar y mostrar
 * pérdidas por motivo) y BusinessAnalyzer (para que el Gerente Inteligente
 * hable con el mismo nombre que ve el dueño en pantalla). Cambiar un
 * nombre acá lo cambia en los tres lugares a la vez.
 */
export const LOSS_CATEGORY_LABEL: Record<LossCategory, string> = {
  MERMA: "Merma",
  VENCIDO: "Producto vencido",
  CONSUMO_INTERNO: "Consumo interno",
  ROBO: "Robo",
  ERROR: "Error de inventario",
  "DAÑO": "Daño",
  AJUSTE_ADMINISTRATIVO: "Ajuste administrativo",
  OTRO: "Otro"
};

/** Orden sugerido para selects y leyendas de gráficas. */
export const LOSS_CATEGORY_ORDER: LossCategory[] = [
  "MERMA",
  "VENCIDO",
  "CONSUMO_INTERNO",
  "ROBO",
  "ERROR",
  "DAÑO",
  "AJUSTE_ADMINISTRATIVO",
  "OTRO"
];